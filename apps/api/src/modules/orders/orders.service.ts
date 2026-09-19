import { randomBytes } from 'node:crypto';

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { checkoutSchema, type OrderListQuery } from '@sakya/validation';
import type {
  AppliedCouponResponse,
  CartItemResponse,
  CheckoutRequest,
  OrdersResponse,
  OrderResponse,
  Paise,
} from '@sakya/types';
import {
  isPaise,
  multiplyPaise,
  percentageOf,
  subtractPaise,
  sumPaise,
  toPaise,
} from '@sakya/utils';
import { canTransitionOrder } from '@sakya/types';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CartService } from '../cart/cart.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  releaseOrderReservations,
  reserveOrderLine,
} from '../inventory/order-reservations';

/** Placeholder constants — documented so they are recognisable as such. */
const TAX_RATE_PERCENT = 0;
const SHIPPING_IN_PAISE = 0;
const FREE_SHIPPING_THRESHOLD_IN_PAISE = Infinity;

/**
 * Human-readable, collision-resistant order number.
 *
 * `Order.orderNumber` is unique and has no database default, so checkout has to
 * supply one — without this, every order insert failed with
 * `Argument 'orderNumber' is missing`. The date prefix keeps numbers
 * recognisable and roughly sortable; the random suffix makes a collision
 * vanishingly unlikely, and the unique index is the backstop if one occurs.
 */
function generateOrderNumber(): string {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `ORD-${day}-${randomBytes(4).toString('hex').toUpperCase()}`;
}

/**
 * Snapshot a cart line into an order line.
 *
 * `CartService` already resolves the product and variant titles, so they are read
 * straight off `CartItemResponse`. This previously reached for
 * `item.variant.product`, which is not part of that shape — every checkout threw
 * `Cannot read properties of undefined (reading 'product')` against a real
 * database, and the mock in the unit spec hid it.
 */
function snapshotItem(item: CartItemResponse) {
  return {
    id: item.id,
    variantId: item.variantId,
    quantity: item.quantity,
    unitPriceInPaise: toPaise(item.unitPriceInPaise),
    productTitle: item.productTitle,
    variantTitle: item.variantTitle,
    sku: item.sku,
  };
}

function recomputeOrderTotals(
  items: Array<ReturnType<typeof snapshotItem>>,
  coupon: AppliedCouponResponse | null,
) {
  const subtotal = sumPaise(...items.map((item) => multiplyPaise(item.unitPriceInPaise, item.quantity)));

  let discount: Paise = toPaise(0);
  if (coupon !== null && items.length > 0) {
    if (coupon.type === 'PERCENTAGE') {
      // Coupon value is stored in basis points (100 = 1%); percentageOf expects a percent.
      discount = percentageOf(subtotal, coupon.valueInPaise / 100);
    } else if (coupon.type === 'FIXED_AMOUNT') {
      discount = toPaise(Math.min(coupon.valueInPaise, subtotal));
    }
  }

  const afterDiscount = subtractPaise(subtotal, discount);
  const tax = percentageOf(afterDiscount, TAX_RATE_PERCENT);
  const shipping: Paise = afterDiscount >= FREE_SHIPPING_THRESHOLD_IN_PAISE ? toPaise(0) : toPaise(SHIPPING_IN_PAISE);

  return {
    subtotalInPaise: subtotal,
    discountInPaise: discount,
    taxInPaise: tax,
    shippingInPaise: shipping,
    totalInPaise: subtractPaise(sumPaise(subtotal, tax, shipping), discount),
  };
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cartService: CartService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // -----------------------------------------------------------------------
  // Checkout: place an order from the current cart
  // -----------------------------------------------------------------------

  async checkout(userId: string, body: CheckoutRequest): Promise<OrderResponse> {
    const parsed = checkoutSchema.parse(body);

    const cart = await this.cartService.getCurrentCart(userId);
    if (cart.items.length === 0) {
      throw new BadRequestException('Cannot place an order from an empty cart');
    }

    // Idempotency: a retried request cannot create a second order. The key is
    // scoped to the caller, so another customer using the same string is
    // irrelevant here rather than a spurious conflict.
    const existing = await this.prisma.payment.findFirst({
      where: { userId, idempotencyKey: parsed.idempotencyKey },
      include: { order: true },
    });

    if (existing !== null && existing.order.status !== 'CANCELLED' && existing.order.status !== 'REFUNDED') {
      return this.getOrderById(existing.order.id, userId);
    }

    const items = cart.items.map(snapshotItem);
    const totals = recomputeOrderTotals(
      items,
      cart.coupon ?? null,
    );

    // The order, its items and the stock reservation are written in one
    // transaction: either the order exists with its stock held, or nothing
    // happened at all. That is what stops a failed checkout leaking a
    // reservation, and a successful one from overselling.
    const order = await this.prisma.$transaction(async (tx) => {
      // The fulfillment store is taken from the cart row — the cart is scoped to
      // a store when its first item is added — and re-validated here. It is never
      // accepted from the client, and it must be an active store.
      const cartRecord = await tx.cart.findUnique({
        where: { id: cart.id },
        select: {
          storeId: true,
          couponId: true,
          store: { select: { id: true, isActive: true } },
        },
      });

      if (
        cartRecord === null ||
        cartRecord.storeId === null ||
        cartRecord.store === null ||
        !cartRecord.store.isActive
      ) {
        throw new BadRequestException(
          'A valid fulfilment store must be selected before checkout',
        );
      }

      const created = await tx.order.create({
        data: {
          orderNumber: generateOrderNumber(),
          userId,
          storeId: cartRecord.storeId,
          couponId: cartRecord.couponId,
          status: 'PENDING_PAYMENT',
          paymentStatus: 'PENDING',
          currency: cart.currency,
          subtotalInPaise: totals.subtotalInPaise,
          discountInPaise: totals.discountInPaise,
          taxInPaise: totals.taxInPaise,
          shippingInPaise: totals.shippingInPaise,
          totalInPaise: totals.totalInPaise,
          shippingAddress: parsed.shippingAddress as any,
          billingAddress: parsed.billingAddress as any,
          notes: parsed.notes ?? null,
          items: {
            create: items.map((item) => ({
              variantId: item.variantId,
              quantity: item.quantity,
              unitPriceInPaise: item.unitPriceInPaise,
              productTitle: item.productTitle,
              variantTitle: item.variantTitle,
              sku: item.sku,
              totalInPaise: toPaise(item.unitPriceInPaise * item.quantity),
            })),
          },
        } as any,
        include: {
          items: { orderBy: { createdAt: 'asc' } },
          payments: true,
          statusHistory: { orderBy: { createdAt: 'asc' } },
          coupon: true,
        },
      });

      // Hold stock for every line before the order is committed. Throwing here
      // rolls the whole transaction back, including the order row above.
      for (const item of items) {
        await reserveOrderLine(tx, created.id, cartRecord.storeId, {
          variantId: item.variantId,
          variantTitle: item.variantTitle,
          quantity: item.quantity,
        });
      }

      // Payment record created now, in MANUAL PENDING state. The client may
      // choose Cash on Delivery or a future gateway; the payment record is the
      // idempotent anchor for that intent.
      await tx.payment.create({
        data: {
          orderId: created.id,
          userId,
          provider: 'MANUAL',
          method: 'CASH_ON_DELIVERY',
          status: 'PENDING',
          currency: cart.currency,
          amountInPaise: totals.totalInPaise,
          idempotencyKey: parsed.idempotencyKey,
        },
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: created.id,
          fromStatus: null,
          toStatus: 'PENDING_PAYMENT',
          reason: 'Order placed',
        },
      });

      return created;
    });

    return this.getOrderById(order.id, userId);
  }

  // -----------------------------------------------------------------------
  // Own orders: list and detail
  // -----------------------------------------------------------------------

  async listOwnOrders(userId: string, query: OrderListQuery): Promise<OrdersResponse> {
    const page = query.page;
    const perPage = query.limit;
    const skip = (page - 1) * perPage;

    const where: Prisma.OrderWhereInput = {
      userId,
      status: query.status,
    };

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          items: { orderBy: { createdAt: 'asc' } },
          payments: { orderBy: { createdAt: 'asc' } },
          statusHistory: { orderBy: { createdAt: 'asc' } },
          coupon: true,
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      items: orders.map(this.toOrderResponse),
      meta: {
        page,
        perPage,
        total,
        totalPages: Math.max(1, Math.ceil(total / perPage)),
        hasNextPage: skip + perPage < total,
        hasPreviousPage: page > 1,
      },
    };
  }

  async getOrderById(orderId: string, userId: string): Promise<OrderResponse> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: {
        items: { orderBy: { createdAt: 'asc' } },
        payments: { orderBy: { createdAt: 'asc' } },
        statusHistory: { orderBy: { createdAt: 'asc' } },
        coupon: true,
      },
    });

    if (order === null) {
      throw new NotFoundException('No order found for the given id');
    }

    return this.toOrderResponse(order);
  }

  // -----------------------------------------------------------------------
  // Cancel
  // -----------------------------------------------------------------------

  async cancelOrder(orderId: string, userId: string, reason: string): Promise<OrderResponse> {
    const parsed = { reason: reason.trim() };
    if (parsed.reason.length < 1) {
      throw new BadRequestException('Cancel reason is required');
    }
    if (parsed.reason.length > 500) {
      throw new BadRequestException('Cancel reason is too long');
    }

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });

    if (order === null) {
      throw new NotFoundException('No order found for the given id');
    }

    if (!canTransitionOrder(order.status as any, 'CANCELLED')) {
      throw new ConflictException(`This order cannot be cancelled in its current status`);
    }

    if (order.status === 'CANCELLED' || order.status === 'REFUNDED') {
      throw new ConflictException('This order is already final');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'CANCELLED',
          paymentStatus: order.paymentStatus === 'CAPTURED' ? order.paymentStatus : order.paymentStatus,
          cancelledAt: new Date(),
          cancelReason: parsed.reason,
        },
        include: {
          items: { orderBy: { createdAt: 'asc' } },
          payments: { orderBy: { createdAt: 'asc' } },
          statusHistory: { orderBy: { createdAt: 'asc' } },
          coupon: true,
        },
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: orderId,
          fromStatus: order.status as any,
          toStatus: 'CANCELLED',
          reason: parsed.reason,
        },
      });

      // Give the reserved stock back. The ledger makes this idempotent, so a
      // repeated cancellation cannot release the same reservation twice.
      await releaseOrderReservations(tx, orderId, 'Order cancelled');

      return result;
    });

    // Best-effort push — never fails the cancellation (see NotificationsService).
    await this.notificationsService.sendOrderStatusPush({
      userId: order.userId,
      orderId,
      orderNumber: order.orderNumber,
      status: 'CANCELLED',
      reason: parsed.reason,
    });

    return this.toOrderResponse(updated);
  }

  // -----------------------------------------------------------------------
  // Mapping
  // -----------------------------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toOrderResponse(order: any): OrderResponse {
    const totals = {
      subtotalInPaise: isPaise(order.subtotalInPaise)
        ? order.subtotalInPaise
        : 0,
      discountInPaise: isPaise(order.discountInPaise)
        ? order.discountInPaise
        : 0,
      taxInPaise: isPaise(order.taxInPaise) ? order.taxInPaise : 0,
      shippingInPaise: isPaise(order.shippingInPaise)
        ? order.shippingInPaise
        : 0,
      totalInPaise: isPaise(order.totalInPaise)
        ? order.totalInPaise
        : 0,
    };

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      currency: order.currency as 'INR',
      subtotalInPaise: toPaise(totals.subtotalInPaise),
      discountInPaise: toPaise(totals.discountInPaise),
      taxInPaise: toPaise(totals.taxInPaise),
      shippingInPaise: toPaise(totals.shippingInPaise),
      totalInPaise: toPaise(totals.totalInPaise),
      coupon:
        order.coupon === null
          ? null
          : {
              id: order.coupon.id,
              code: order.coupon.code,
              type: order.coupon.type,
              valueInPaise: toPaise(order.coupon.value),
              discountDescription:
                order.coupon.type === 'PERCENTAGE'
                  ? 'percentage'
                  : order.coupon.type === 'FIXED_AMOUNT'
                    ? 'fixed amount'
                    : 'free shipping',
            },
      items: order.items.map((item: any) => ({
        id: item.id,
        productTitle: item.productTitle,
        variantTitle: item.variantTitle,
        sku: item.sku,
        quantity: item.quantity,
        unitPriceInPaise: toPaise(item.unitPriceInPaise),
        discountInPaise: toPaise(item.discountInPaise),
        taxInPaise: toPaise(item.taxInPaise),
        totalInPaise: toPaise(item.totalInPaise),
      })),
      payments: order.payments.map((payment: any) => ({
        id: payment.id,
        provider: payment.provider,
        providerPaymentId: payment.providerPaymentId,
        method: payment.method,
        status: payment.status,
        currency: payment.currency as 'INR',
        amountInPaise: toPaise(payment.amountInPaise),
        refundedInPaise: toPaise(payment.refundedInPaise),
        failureReason: payment.failureReason,
        capturedAt: payment.capturedAt?.toISOString() ?? null,
        refundedAt: payment.refundedAt?.toISOString() ?? null,
      })),
      statusHistory: order.statusHistory.map((entry: any) => ({
        id: entry.id,
        fromStatus: entry.fromStatus as any,
        toStatus: entry.toStatus as any,
        reason: entry.reason,
        changedByUserId: entry.changedByUserId,
        createdAt: entry.createdAt.toISOString(),
      })),
      shippingAddress: order.shippingAddress,
      billingAddress: order.billingAddress,
      notes: order.notes,
      placedAt: order.placedAt?.toISOString() ?? null,
      cancelledAt: order.cancelledAt?.toISOString() ?? null,
      deliveredAt: order.deliveredAt?.toISOString() ?? null,
      cancelReason: order.cancelReason,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };
  }
}
