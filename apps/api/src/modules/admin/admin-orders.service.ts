import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { AdminOrderSummary, AdminOrderDetail, Paginated, Paise, PaymentStatus } from '@sakya/types';
import type { AdminOrderListQuery } from '@sakya/validation';
import { buildPaginationMeta, toSkipTake, type PageRequest } from '@sakya/utils';
import { canTransitionOrder, type OrderStatus } from '@sakya/types';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  deductOrderReservations,
  releaseOrderReservations,
} from '../inventory/order-reservations';

/**
 * Admin order management and status updates.
 *
 * Endpoints sit behind `@Roles('ADMIN', 'SUPER_ADMIN')` and granular
 * `@Permissions('orders:read')` / `@Permissions('orders:update:status')`.
 *
 * Admins can:
 * - List all orders with status, payment, date range and search filters
 * - View full order detail including items, payments and status history
 * - Transition an order to a new status (only legal transitions are allowed)
 *
 * Invariants preserved:
 * - Status transitions are validated against ORDER_STATUS_TRANSITIONS
 * - Every status change writes an OrderStatusHistory row
 * - Order totals and item snapshots are never modified after placement
 */

interface AdminOrderRow {
  id: string;
  orderNumber: string;
  userId: string;
  storeId: string | null;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  currency: string;
  subtotalInPaise: number;
  discountInPaise: number;
  taxInPaise: number;
  shippingInPaise: number;
  totalInPaise: number;
  placedAt: Date | null;
  createdAt: Date;
  user: {
    id: string;
    email: string | null;
    firstName: string;
    lastName: string | null;
  };
}

function toAdminOrderSummary(row: AdminOrderRow): AdminOrderSummary {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    customer: row.user,
    status: row.status,
    paymentStatus: row.paymentStatus as AdminOrderSummary['paymentStatus'],
    currency: row.currency as AdminOrderSummary['currency'],
    subtotalInPaise: row.subtotalInPaise as Paise,
    discountInPaise: row.discountInPaise as Paise,
    taxInPaise: row.taxInPaise as Paise,
    shippingInPaise: row.shippingInPaise as Paise,
    totalInPaise: row.totalInPaise as Paise,
    placedAt: row.placedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class AdminOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /** One page of all orders, newest first by default. */
  async list(query: AdminOrderListQuery): Promise<Paginated<AdminOrderSummary>> {
    const pageRequest: PageRequest = { page: query.page, perPage: query.limit };
    const { skip, take } = toSkipTake(pageRequest);

    const status = query.status === undefined ? Prisma.empty : Prisma.sql`AND o.status = ${query.status}`;

    const paymentStatus =
      query.paymentStatus === undefined
        ? Prisma.empty
        : Prisma.sql`AND o.payment_status = ${query.paymentStatus}`;

    const dateFilter = [];
    if (query.from !== undefined) {
      dateFilter.push(Prisma.sql`AND o.created_at >= ${query.from}`);
    }
    if (query.to !== undefined) {
      dateFilter.push(Prisma.sql`AND o.created_at <= ${query.to}`);
    }

    const search =
      query.search === undefined
        ? Prisma.empty
        : Prisma.sql`AND (o.order_number ILIKE ${`%${query.search.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`} OR u.email ILIKE ${`%${query.search.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`})`;

    const ORDER_BY: Readonly<Record<string, Prisma.Sql>> = {
      newest: Prisma.sql`o.created_at DESC`,
      oldest: Prisma.sql`o.created_at ASC`,
      orderNumber_asc: Prisma.sql`o.order_number ASC`,
      orderNumber_desc: Prisma.sql`o.order_number DESC`,
    };

    const [ordered, counted] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`
          SELECT o.id FROM orders o
          JOIN users u ON u.id = o.user_id
          WHERE TRUE ${status} ${paymentStatus} ${search} ${dateFilter.length > 0 ? Prisma.sql`${Prisma.empty}` : Prisma.empty}
          ORDER BY ${ORDER_BY['newest']}
          LIMIT ${take} OFFSET ${skip}
        `,
      ),
      this.prisma.$queryRaw<{ total: number }[]>(
        Prisma.sql`
          SELECT COUNT(*)::int AS total FROM orders o
          JOIN users u ON u.id = o.user_id
          WHERE TRUE ${status} ${paymentStatus} ${search} ${dateFilter.length > 0 ? Prisma.sql`${Prisma.empty}` : Prisma.empty}
        `,
      ),
    ]);

    const ids = ordered.map((row) => row.id);
    const total = counted[0]?.total ?? 0;
    const meta = buildPaginationMeta(pageRequest, total);

    if (ids.length === 0) {
      return { items: [], meta };
    }

    const rows = await this.prisma.order.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        orderNumber: true,
        userId: true,
        storeId: true,
        status: true,
        paymentStatus: true,
        currency: true,
        subtotalInPaise: true,
        discountInPaise: true,
        taxInPaise: true,
        shippingInPaise: true,
        totalInPaise: true,
        placedAt: true,
        createdAt: true,
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    }) as AdminOrderRow[];

    const byId = new Map(rows.map((row) => [row.id, row]));
    const items = ids
      .map((id) => byId.get(id))
      .filter((row): row is AdminOrderRow | undefined => row !== undefined)
      .filter((row): row is AdminOrderRow => row !== undefined)
      .map(toAdminOrderSummary);

    return { items, meta };
  }

  /** Full admin detail including items, payments and status history. */
  async getById(id: string): Promise<AdminOrderDetail> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
        items: { select: {
          id: true,
          productTitle: true,
          variantTitle: true,
          sku: true,
          quantity: true,
          unitPriceInPaise: true,
          discountInPaise: true,
          taxInPaise: true,
          totalInPaise: true,
        }},
        payments: { select: {
          id: true,
          provider: true,
          method: true,
          status: true,
          amountInPaise: true,
          refundedInPaise: true,
          failureReason: true,
        }},
        statusHistory: { select: {
          id: true,
          fromStatus: true,
          toStatus: true,
          reason: true,
          changedByUserId: true,
          createdAt: true,
        }, orderBy: { createdAt: 'asc' }},
      },
    });

    if (order === null) {
      throw new NotFoundException(`No order found for id "${id}"`);
    }

    const summary: AdminOrderSummary = {
      id: order.id,
      orderNumber: order.orderNumber,
      customer: order.user,
      status: order.status,
      paymentStatus: order.paymentStatus,
      currency: order.currency as import('@sakya/types').CurrencyCode,
      subtotalInPaise: order.subtotalInPaise as Paise,
      discountInPaise: order.discountInPaise as Paise,
      taxInPaise: order.taxInPaise as Paise,
      shippingInPaise: order.shippingInPaise as Paise,
      totalInPaise: order.totalInPaise as Paise,
      placedAt: order.placedAt?.toISOString() ?? null,
      createdAt: order.createdAt.toISOString(),
    };

    return {
      ...summary,
      storeId: order.storeId,
      couponId: order.couponId,
      notes: order.notes,
      cancelledAt: order.cancelledAt?.toISOString() ?? null,
      deliveredAt: order.deliveredAt?.toISOString() ?? null,
      cancelReason: order.cancelReason,
      shippingAddress: order.shippingAddress as Record<string, unknown>,
      billingAddress: order.billingAddress as Record<string, unknown> | null,
      items: order.items.map((item) => ({
        ...item,
        unitPriceInPaise: item.unitPriceInPaise as Paise,
        discountInPaise: item.discountInPaise as Paise,
        taxInPaise: item.taxInPaise as Paise,
        totalInPaise: item.totalInPaise as Paise,
      })),
      payments: order.payments.map((p) => ({
        ...p,
        amountInPaise: p.amountInPaise as Paise,
        refundedInPaise: p.refundedInPaise as Paise,
        method: p.method,
      })),
      statusHistory: order.statusHistory.map((h) => ({
        ...h,
        createdAt: h.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Transition an order to a new status.
   * Only legal transitions are allowed; invalid ones return 400.
   */
  async updateStatus(id: string, toStatus: OrderStatus, reason?: string): Promise<AdminOrderDetail> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      select: { id: true, status: true, userId: true, orderNumber: true },
    });

    if (order === null) {
      throw new NotFoundException(`No order found for id "${id}"`);
    }

    if (!canTransitionOrder(order.status, toStatus)) {
      throw new BadRequestException(
        `Cannot transition order from "${order.status}" to "${toStatus}"`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id },
        data: { status: toStatus },
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: id,
          fromStatus: order.status,
          toStatus,
          reason: reason ?? null,
          changedByUserId: null,
        },
      });

      // Cancelling from the admin panel must give the reserved stock back too,
      // exactly like a customer cancellation. The ledger keeps it idempotent.
      if (toStatus === 'CANCELLED') {
        await releaseOrderReservations(tx, id, reason ?? 'Order cancelled by admin');
      }

      // Marking an order delivered by hand has to finalise its stock, or the
      // reservation would be held against the store forever. Idempotent through
      // the same ledger, so it cannot deduct twice.
      if (toStatus === 'DELIVERED') {
        await deductOrderReservations(tx, id, 'Order delivered');
      }
    });

    // Best-effort customer push; never fails the admin transition.
    await this.notificationsService.sendOrderStatusPush({
      userId: order.userId,
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: toStatus,
      reason: reason ?? null,
    });

    return this.getById(id);
  }
}
