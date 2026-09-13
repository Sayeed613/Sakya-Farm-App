import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { checkoutSchema, type OrderListQuery } from '@sakya/validation';
import type { OrderIdParam } from '@sakya/validation';
import type {
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

/** Placeholder constants — documented so they are recognisable as such. */
const TAX_RATE_PERCENT = 0;
const SHIPPING_IN_PAISE = 0;
const FREE_SHIPPING_THRESHOLD_IN_PAISE = Infinity;

function snapshotItem(item: any) {
  const unitPrice = toPaise(item.unitPriceInPaise);
  return {
    id: item.id,
    quantity: item.quantity,
    unitPriceInPaise: unitPrice,
    productTitle: item.variant.product.title ?? 'Unknown product',
    variantTitle: item.variant.title ?? 'Unknown variant',
    sku: item.variant.sku,
  };
}

function recomputeOrderTotals(items: any[], coupon: any) {
  const subtotal = sumPaise(...items.map((item) => multiplyPaise(item.unitPriceInPaise, item.quantity)));

  let discount: Paise = toPaise(0);
  if (coupon !== null && items.length > 0) {
    if (coupon.type === 'PERCENTAGE') {
      // Coupon value is stored in basis points (100 = 1%); percentageOf expects a percent.
      discount = percentageOf(subtotal, coupon.value / 100);
    } else if (coupon.type === 'FIXED_AMOUNT') {
      discount = toPaise(Math.min(coupon.value, subtotal));
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

    // Idempotency: a retried request cannot create a second order.
    const existing = await this.prisma.payment.findFirst({
      where: { idempotencyKey: parsed.idempotencyKey, order: { userId } },
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

    // The order and its items are created in one transaction so the snapshot is
    // atomic with the totals written into the order row.
    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          userId,
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
            create: items.map((item: any) => ({
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

      // Reserve inventory is intentionally deferred to a later increment: this
      // release keeps checkout usable without an inventory module being required
      // first, and the reservation will be added under the same totals contract.

      // Payment record created now, in MANUAL PENDING state. The client may
      // choose Cash on Delivery or a future gateway; the payment record is the
      // idempotent anchor for that intent.
      await tx.payment.create({
        data: {
          orderId: created.id,
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

      return result;
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
