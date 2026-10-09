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
} from '@sakya/types';
import {
  isBengaluruPincode,
  containsFreshProduce,
  isPaise,
  multiplyPaise,
  sumPaise,
  toPaise,
} from '@sakya/utils';
import { canTransitionOrder } from '@sakya/types';
import type { Prisma } from '../../generated/prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import type { AppConfig } from '../../config/configuration';
import { computeTotals } from '../../common/pricing';
import { incrementMetric } from '../../observability/business-metrics';
import { CartService } from '../cart/cart.service';
import { NotificationsService } from '../notifications/notifications.service';
import { reserveOrderLine, releaseOrderReservations } from '../inventory/order-reservations';

/** Commerce configuration (GST, shipping, COD fee) is injected via ConfigService
 * and the totals come from the SHARED pricing module (src/common/pricing.ts) —
 * the same function the cart preview uses. The approved checkout total is
 * therefore bit-for-bit the stored order total.
 */

/** Human-readable, collision-resistant order number. */
function generateOrderNumber(): string {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `ORD-${day}-${randomBytes(4).toString('hex').toUpperCase()}`;
}

/** Snapshot a cart line into an order line. */
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
  pricing: { taxRatePercent: number; shippingFeeInPaise: number; freeShippingThresholdInPaise: number | null; codFeeInPaise: number },
  isCod: boolean,
) {
  const subtotal = sumPaise(...items.map((item) => multiplyPaise(item.unitPriceInPaise, item.quantity)));

  return computeTotals(
    {
      subtotalInPaise: subtotal,
      coupon:
        coupon === null
          ? null
          : {
              type: coupon.type as 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FREE_SHIPPING',
              valueInPaise: coupon.valueInPaise,
              minOrderInPaise: coupon.minOrderInPaise,
              maxDiscountInPaise: coupon.maxDiscountInPaise,
            },
      isCod,
    },
    pricing,
  );
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly cartService: CartService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // -----------------------------------------------------------------------
  // Checkout: place an order from the current cart
  // -----------------------------------------------------------------------

  async checkout(userId: string, body: CheckoutRequest): Promise<OrderResponse> {
    const parsed = checkoutSchema.parse(body);

    // Idempotency FIRST: a retried request cannot create a second order, and
    // the retry must succeed even though the successful first attempt already
    // emptied the cart. Checking the cart first would turn every safe retry
    // (timeout, flaky network) into a 400 that looks like a failed checkout.
    // The key is scoped to the caller, so another customer using the same
    // string is irrelevant here rather than a spurious conflict.
    const existing = await this.prisma.payment.findFirst({
      where: { userId, idempotencyKey: parsed.idempotencyKey },
      include: { order: true },
    });

    if (existing !== null) {
      if (
        existing.order.status !== 'CANCELLED' &&
        existing.order.status !== 'REFUNDED'
      ) {
        return this.getOrderById(existing.order.id, userId);
      }
      // The key is attached to a payment row and the schema enforces
      // (userId, idempotencyKey) uniqueness, so a cancelled/refunded order's
      // key can never seed a second order — the insert below would lose a
      // P2002 anyway. Fail here with a message that says what to do instead
      // of surfacing a raw column conflict.
      throw new ConflictException(
        'This checkout attempt was already used. Start checkout again to place a new order.',
      );
    }

    const cart = await this.cartService.getCurrentCart(userId);
    if (cart.items.length === 0) {
      throw new BadRequestException('Cannot place an order from an empty cart');
    }

    const items = cart.items.map(snapshotItem);

    // All categories except fresh produce ship nationwide. Fresh produce is
    // restricted to Bengaluru PIN codes and rejected before an order exists.
    const commerce = this.config.get('commerce', { infer: true })!;
    const shippingPincode = String(
      (parsed.shippingAddress as Record<string, unknown>).postalCode ?? '',
    );
    if (!/^[1-9][0-9]{5}$/.test(shippingPincode)) {
      throw new BadRequestException('A valid 6-digit delivery pincode is required');
    }

    const totals = recomputeOrderTotals(
      items,
      cart.coupon ?? null,
      {
        taxRatePercent: commerce.taxRatePercent,
        shippingFeeInPaise: commerce.shippingFeeInPaise,
        freeShippingThresholdInPaise: commerce.freeShippingThresholdInPaise,
        codFeeInPaise: commerce.codFeeInPaise,
      },
      // COD is the only real method in this build; the demo online flow rides
      // the same MANUAL payment, so the fee applies to the COD anchor only.
      true,
    );

    const hasFreshProduce = containsFreshProduce(
      cart.items.flatMap((item) => item.categorySlugs),
    );
    if (hasFreshProduce && !isBengaluruPincode(shippingPincode)) {
      throw new BadRequestException(
        'Fresh fruits and vegetables are currently delivered within Bengaluru only.',
      );
    }

    // The order, its items and the stock reservation are written in one
    // transaction: either the order exists with its stock held, or nothing
    // happened at all. That is what stops a failed checkout leaking a
    // reservation, and a successful one from overselling.
    // Observability flag: distinguishes a genuinely new order from an
    // idempotent replay (the winner path) inside the same transaction.
    let createdNewOrder = false;
    const order = await this.prisma.$transaction(async (tx) => {
      // Serialize concurrent checkouts of the SAME cart: `FOR UPDATE` makes a
      // second request (double tap, retry storm, scripted duplicate) wait here
      // until the first commits. Everything after this lock sees the winner's
      // committed cart, so one cart can only ever produce one order — the
      // idempotency-key pre-check above alone does NOT stop a duplicate that
      // uses a different key.
      await tx.$queryRaw`SELECT "id" FROM "carts" WHERE "id" = ${cart.id}::uuid FOR UPDATE`;

      // Replay check AGAIN under the lock: a concurrent attempt with the same
      // key commits its payment row while we waited, and its order is the one
      // this request must return.
      const winner = await tx.payment.findFirst({
        where: { userId, idempotencyKey: parsed.idempotencyKey },
        select: { order: { select: { id: true, status: true } } },
      });
      if (
        winner !== null &&
        winner.order.status !== 'CANCELLED' &&
        winner.order.status !== 'REFUNDED'
      ) {
        return winner.order;
      }

      // The lock is only held for the duration of this transaction, so re-read
      // the cart's line count here: if a concurrent checkout (different key)
      // consumed the cart while we waited, the snapshot `items` above is stale
      // and must not be turned into a second order.
      const remainingItems = await tx.cartItem.count({
        where: { cartId: cart.id, quantity: { gt: 0 } },
      });
      if (remainingItems === 0) {
        incrementMetric('checkoutFailures');
        throw new ConflictException(
          'This cart was just checked out. Refresh to review your orders.',
        );
      }

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

      /*
       * Claim the coupon redemption atomically WITH the order. Apply-time
       * checks (usageLimit, perUserLimit, active window) are reads that can
       * go stale between apply and checkout, so every one of them is
       * re-enforced HERE, inside the transaction, BEFORE any order row is
       * written:
       *
       * - the active window and isActive are re-checked by a conditional
       *   UPDATE that also guards usageLimit — the increment only happens
       *   while the coupon is still valid AND still under its limit, so two
       *   concurrent checkouts can never take the last allowed redemption
       *   twice (a read-then-increment would);
       * - perUserLimit is re-counted against this user's committed
       *   redemptions before the insert.
       *
       * Any failure throws BEFORE the order insert: nothing is created, and
       * the transaction rollback also undoes the claimed increment.
       */
      let claimedCouponId: string | null = null;
      if (cartRecord.couponId !== null) {
        const coupon = await tx.coupon.findUnique({
          where: { id: cartRecord.couponId },
          select: {
            id: true,
            isActive: true,
            startsAt: true,
            endsAt: true,
            usageLimit: true,
            perUserLimit: true,
          },
        });
        const now = new Date();
        if (
          coupon === null ||
          !coupon.isActive ||
          (coupon.startsAt !== null && coupon.startsAt > now) ||
          (coupon.endsAt !== null && coupon.endsAt < now)
        ) {
          throw new ConflictException(
            'The applied coupon is no longer valid. Remove it and try again.',
          );
        }

        const userRedemptions = await tx.couponRedemption.count({
          where: { couponId: coupon.id, userId },
        });
        if (userRedemptions >= coupon.perUserLimit) {
          throw new ConflictException(
            'The applied coupon has already been used by you. Remove it and try again.',
          );
        }

        // Atomic claim: check and increment in ONE statement. `claimed !== 1`
        // means the window closed or the global limit was taken by a
        // concurrent checkout between apply and now.
        const claimed = await tx.$executeRaw`
          UPDATE "coupons"
          SET "redeemed_count" = "redeemed_count" + 1,
              "updated_at" = now()
          WHERE "id" = ${coupon.id}::uuid
            AND "is_active" = true
            AND ("usage_limit" IS NULL OR "redeemed_count" < "usage_limit")
            AND ("starts_at" IS NULL OR "starts_at" <= now())
            AND ("ends_at" IS NULL OR "ends_at" >= now())
        `;
        if (claimed !== 1) {
          throw new ConflictException(
            'This coupon has reached its usage limit. Remove it and try again.',
          );
        }
        claimedCouponId = coupon.id;
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
      // Lines reserve in (variantId) order so two concurrent checkouts that
      // share variants always take the inventory row locks in the same order
      // and cannot deadlock against each other.
      const reservationOrder = [...items].sort((a, b) => a.variantId.localeCompare(b.variantId));
      for (const item of reservationOrder) {
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

      /*
       * Record the redemption against the order created above. The global
       * count was already CLAIMED atomically before the insert (see the
       * conditional UPDATE); this row is what ties the claim to this order
       * and enforces one redemption per order (unique (orderId)).
       */
      if (claimedCouponId !== null) {
        await tx.couponRedemption.create({
          data: {
            couponId: claimedCouponId,
            userId,
            orderId: created.id,
            discountInPaise: totals.discountInPaise,
          },
        });
      }

      // The server cart is consumed by this checkout: empty its lines and
      // detach the coupon in the SAME transaction, so a placed order can never
      // leave a stale cart behind. Pricing/stock above are untouched.
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      await tx.cart.update({
        where: { id: cart.id },
        data: { couponId: null },
      });

      createdNewOrder = true;
      return created;
    }, { maxWait: 10_000, timeout: 30_000 });

    // Business counter (never throws, no behaviour change): only a freshly
    // inserted order counts — an idempotent replay must not inflate it.
    if (createdNewOrder) incrementMetric('ordersCreated');

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

      // Give the coupon redemption back so the customer can re-use their
      // per-user allowance on a later order (idempotent: the redemption row's
      // unique (orderId) keeps this from double-decrementing).
      if (result.couponId !== null) {
        const alreadyRedeemed = await tx.couponRedemption.findUnique({
          where: { orderId },
          select: { id: true },
        });
        if (alreadyRedeemed !== null) {
          await tx.coupon.update({
            where: { id: result.couponId },
            data: { redeemedCount: { decrement: 1 } },
          });
          await tx.couponRedemption.delete({ where: { orderId } });
        }
      }

      // Outbox pairing: the CANCELLED intent is written on the SAME
      // transaction as the cancellation, so a crash between commit and
      // notification can never lose the durable record (Step 12 correction).
      // Nothing external is awaited here — the worker delivers later.
      await this.notificationsService.sendOrderStatusPush(
        {
          userId: order.userId,
          orderId,
          orderNumber: order.orderNumber,
          status: 'CANCELLED',
          reason: parsed.reason,
        },
        tx,
      );

      return result;
    });

    // Business counter: a customer-initiated cancellation completed.
    incrementMetric('ordersCancelled');

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
              minOrderInPaise: order.coupon.minOrderInPaise,
              maxDiscountInPaise: order.coupon.maxDiscountInPaise,
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
