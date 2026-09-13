import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import type { PaginatedStoreOrders, StoreOrderDetail } from '@sakya/types';
import type { StoreOrderListQuery, StoreOrderStatusUpdateRequest } from '@sakya/validation';
import { buildPaginationMeta, toSkipTake, type PageRequest } from '@sakya/utils';
import { canTransitionOrder, type OrderStatus } from '@sakya/types';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';

/** Store-facing order operations.
 *
 * Store staff can only see and update orders assigned to their store.
 * Order status transitions follow the existing ORDER_STATUS_TRANSITIONS map.
 */
@Injectable()
export class StoreOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  // -----------------------------------------------------------------------
  // List orders for a store
  // -----------------------------------------------------------------------

  async listStoreOrders(
    storeId: string,
    userId: string,
    query: StoreOrderListQuery,
  ): Promise<PaginatedStoreOrders> {
    await this.assertStoreAccess(storeId, userId);

    const pageRequest: PageRequest = { page: query.page, perPage: query.limit };
    const { skip, take } = toSkipTake(pageRequest);

    const where: Prisma.OrderWhereInput = {
      storeId,
      ...(query.status && { status: query.status }),
      ...(query.from && { createdAt: { gte: new Date(query.from) } }),
      ...(query.to && { createdAt: { lte: new Date(query.to) } }),
    };

    if (query.search) {
      where.OR = [
        { orderNumber: { contains: query.search, mode: 'insensitive' } },
        { user: { email: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              phone: true,
            },
          },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    const meta = buildPaginationMeta(pageRequest, total);

    return {
      items: orders.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        customer: order.user,
        status: order.status as OrderStatus,
        paymentStatus: order.paymentStatus,
        currency: order.currency,
        subtotalInPaise: order.subtotalInPaise as import('@sakya/types').Paise,
        discountInPaise: order.discountInPaise as import('@sakya/types').Paise,
        taxInPaise: order.taxInPaise as import('@sakya/types').Paise,
        shippingInPaise: order.shippingInPaise as import('@sakya/types').Paise,
        totalInPaise: order.totalInPaise as import('@sakya/types').Paise,
        shippingAddress: order.shippingAddress,
        notes: order.notes,
        placedAt: order.placedAt?.toISOString() ?? null,
        createdAt: order.createdAt.toISOString(),
      })),
      meta,
    };
  }

  // -----------------------------------------------------------------------
  // Get order detail for store
  // -----------------------------------------------------------------------

  async getStoreOrder(
    storeId: string,
    orderId: string,
    userId: string,
  ): Promise<StoreOrderDetail> {
    await this.assertStoreAccess(storeId, userId);

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, storeId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
          },
        },
        items: {
          orderBy: { createdAt: 'asc' },
        },
        payments: {
          orderBy: { createdAt: 'asc' },
        },
        statusHistory: {
          orderBy: { createdAt: 'asc' },
        },
        shipment: true,
        deliveryAssignment: {
          include: {
            deliveryPartner: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                phone: true,
              },
            },
          },
        },
      },
    });

    if (order === null) {
      throw new NotFoundException(`No order found for id "${orderId}" at this store`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o: any = order;
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      customer: o.user,
      status: o.status,
      paymentStatus: o.paymentStatus,
      currency: o.currency,
      subtotalInPaise: o.subtotalInPaise,
      discountInPaise: o.discountInPaise,
      taxInPaise: o.taxInPaise,
      shippingInPaise: o.shippingInPaise,
      totalInPaise: o.totalInPaise,
      shippingAddress: o.shippingAddress,
      notes: o.notes,
      placedAt: o.placedAt?.toISOString() ?? null,
      createdAt: o.createdAt.toISOString(),
      items: o.items.map((item: any) => ({
        id: item.id,
        productTitle: item.productTitle,
        variantTitle: item.variantTitle,
        sku: item.sku,
        quantity: item.quantity,
        unitPriceInPaise: item.unitPriceInPaise,
        discountInPaise: item.discountInPaise,
        taxInPaise: item.taxInPaise,
        totalInPaise: item.totalInPaise,
      })),
      payments: o.payments.map((p: any) => ({
        id: p.id,
        provider: p.provider,
        method: p.method,
        status: p.status,
        amountInPaise: p.amountInPaise,
        failureReason: p.failureReason,
      })),
      statusHistory: o.statusHistory.map((h: any) => ({
        id: h.id,
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        reason: h.reason,
        changedByUserId: h.changedByUserId,
        createdAt: h.createdAt.toISOString(),
      })),
      shipment: o.shipment
        ? {
            id: o.shipment.id,
            carrier: o.shipment.carrier,
            trackingNumber: o.shipment.trackingNumber,
            trackingUrl: o.shipment.trackingUrl,
            status: o.shipment.status,
          }
        : null,
      deliveryAssignment: o.deliveryAssignment
        ? {
            id: o.deliveryAssignment.id,
            deliveryPartnerUserId: o.deliveryAssignment.deliveryPartnerUserId,
            deliveryPartner: o.deliveryAssignment.deliveryPartner,
            status: o.deliveryAssignment.status,
            assignedAt: o.deliveryAssignment.assignedAt.toISOString(),
          }
        : null,
    } as StoreOrderDetail;
  }

  // -----------------------------------------------------------------------
  // Update order status (store fulfillment)
  // -----------------------------------------------------------------------

  async updateStoreOrderStatus(
    storeId: string,
    orderId: string,
    userId: string,
    body: StoreOrderStatusUpdateRequest,
  ): Promise<StoreOrderDetail> {
    await this.assertStoreAccess(storeId, userId);

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, storeId },
      select: { id: true, status: true },
    });

    if (order === null) {
      throw new NotFoundException(`No order found for id "${orderId}" at this store`);
    }

    // Only allow store-relevant transitions
    const allowedStoreStatuses: OrderStatus[] = ['CONFIRMED', 'PROCESSING', 'PACKED', 'READY_FOR_PICKUP'];
    if (!allowedStoreStatuses.includes(body.status)) {
      throw new BadRequestException(
        `Store cannot transition order to "${body.status}". Allowed: ${allowedStoreStatuses.join(', ')}`,
      );
    }

    if (!canTransitionOrder(order.status, body.status)) {
      throw new BadRequestException(
        `Cannot transition order from "${order.status}" to "${body.status}"`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: { status: body.status },
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: order.status,
          toStatus: body.status,
          reason: body.reason ?? null,
          changedByUserId: userId,
        },
      });
    });

    return this.getStoreOrder(storeId, orderId, userId);
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private async assertStoreAccess(
    storeId: string,
    userId: string,
  ): Promise<void> {
    const membership = await this.prisma.storeStaff.findUnique({
      where: { storeId_userId: { storeId, userId } },
      select: { id: true, role: true, isActive: true },
    });

    if (membership === null || !membership.isActive) {
      throw new ForbiddenException('You do not have access to this store');
    }
  }
}
