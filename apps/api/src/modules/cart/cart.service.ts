import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { addCartItemSchema, applyCouponSchema, updateCartItemSchema } from '@sakya/validation';
import type {
  AddCartItemRequest,
  AppliedCouponResponse,
  CartItemResponse,
  CartResponse,
  CurrencyCode,
  Paise,
  UpdateCartItemRequest,
} from '@sakya/types';
import { multiplyPaise, percentageOf, subtractPaise, sumPaise, toPaise } from '@sakya/utils';
import { PrismaService } from '../../database/prisma.service';

/** Placeholder constants for tax and shipping. Documented so they are recognisable as such. */
const TAX_RATE_PERCENT = 0;
const SHIPPING_IN_PAISE = 0;
const FREE_SHIPPING_THRESHOLD_IN_PAISE = Infinity;

/** Coupon-type-aware interpretation of a coupon's `value` column. */
function describeCouponValue(
  type: string,
  valueInPaise: number,
): { discountDescription: string; effectiveDiscountInPaise: number } {
  if (type === 'PERCENTAGE') {
    return { discountDescription: 'percentage', effectiveDiscountInPaise: valueInPaise };
  }
  if (type === 'FIXED_AMOUNT') {
    return { discountDescription: 'fixed amount', effectiveDiscountInPaise: valueInPaise };
  }
  // FREE_SHIPPING: value is ignored and must be 0 by schema convention.
  return { discountDescription: 'free shipping', effectiveDiscountInPaise: 0 };
}

function toCartItemResponse(item: {
  id: string;
  variantId: string;
  quantity: number;
  unitPriceInPaise: number;
  variant: { title: string | null; sku: string | null; isAvailable: boolean | null; product: { title: string | null } };
}): CartItemResponse {
  const unitPrice = toPaise(item.unitPriceInPaise);
  return {
    id: item.id,
    variantId: item.variantId,
    productTitle: item.variant.product.title ?? 'Unknown product',
    variantTitle: item.variant.title ?? 'Unknown variant',
    sku: item.variant.sku,
    quantity: item.quantity,
    unitPriceInPaise: unitPrice,
    lineTotalInPaise: multiplyPaise(unitPrice, item.quantity),
    isAvailable: item.variant.isAvailable ?? false,
  };
}

/**
 * Resolve the current cart for the caller.
 *
 * A user has at most one active cart. We create it on first access so the client
 * never has to request a separate "create cart" endpoint.
 */
async function resolveCurrentCart(prisma: PrismaService, userId: string) {
  const cart = await prisma.cart.findFirst({
    where: { userId, status: 'ACTIVE' },
    include: {
      items: {
        where: { quantity: { gt: 0 } },
        orderBy: { createdAt: 'asc' },
        include: { variant: { include: { product: { select: { title: true, status: true, isAvailable: true } } } } },
      },
      coupon: true,
    },
  });

  if (cart === null) {
    const created = await prisma.cart.create({
      data: { userId, status: 'ACTIVE', currency: 'INR' },
      include: {
        items: { include: { variant: { include: { product: { select: { title: true, status: true, isAvailable: true } } } } } },
        coupon: true,
      },
    });
    return created;
  }

  if (cart.status !== 'ACTIVE') {
    throw new ConflictException('The current cart is no longer active');
  }

  return cart;
}

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  // -----------------------------------------------------------------------
  // Totals: always recomputed, never stored from client input
  // -----------------------------------------------------------------------

  /**
   * Recompute every total from the cart's items, coupon and placeholder constants.
   *
   * Even though `CartItem.unitPriceInPaise` is a snapshot, the authoritative total
   * is recomputed here on every read. This means:
   * - a client cannot inflate a line total by sending one;
   * - a catalog price change after an item is added does not silently change the
   *   cart total (the seat at the price the customer saw is preserved);
   * - coupons, tax and shipping are applied by the server, not by the client.
   */
  private recomputeTotals(
    items: CartItemResponse[],
    coupon: AppliedCouponResponse | null,
  ): {
    subtotalInPaise: Paise;
    discountInPaise: Paise;
    taxInPaise: Paise;
    shippingInPaise: Paise;
    totalInPaise: Paise;
  } {
    const subtotalInPaise = sumPaise(...items.map((item) => item.lineTotalInPaise));

    let discountInPaise: Paise = toPaise(0);
    if (coupon !== null && items.length > 0) {
      const interpreted = describeCouponValue(coupon.type, coupon.valueInPaise);
      if (coupon.type === 'PERCENTAGE') {
        // Coupon value is stored in basis points (100 = 1%); percentageOf expects a percent.
        discountInPaise = percentageOf(subtotalInPaise, interpreted.effectiveDiscountInPaise / 100);
      } else if (coupon.type === 'FIXED_AMOUNT') {
        discountInPaise = toPaise(Math.min(interpreted.effectiveDiscountInPaise, subtotalInPaise));
      }
      // FREE_SHIPPING: discount is 0 here; shipping becomes 0 below.
    }

    const afterDiscount = subtractPaise(subtotalInPaise, discountInPaise);
    const taxInPaise = percentageOf(afterDiscount, TAX_RATE_PERCENT);
    const shippingInPaise: Paise =
      afterDiscount >= FREE_SHIPPING_THRESHOLD_IN_PAISE ? toPaise(0) : toPaise(SHIPPING_IN_PAISE);

    return {
      subtotalInPaise,
      discountInPaise,
      taxInPaise,
      shippingInPaise,
      totalInPaise: subtractPaise(sumPaise(subtotalInPaise, taxInPaise, shippingInPaise), discountInPaise),
    };
  }

  // -----------------------------------------------------------------------
  // Current cart read
  // -----------------------------------------------------------------------

  async getCurrentCart(userId: string): Promise<CartResponse> {
    const record = await resolveCurrentCart(this.prisma, userId);
    const items = record.items.map(toCartItemResponse);
    const coupon =
      record.coupon === null
        ? null
        : ({
            id: record.coupon.id,
            code: record.coupon.code,
            type: record.coupon.type,
            valueInPaise: record.coupon.value,
          } as AppliedCouponResponse);

    const totals = this.recomputeTotals(items, coupon);

    return {
      id: record.id,
      anonymousId: record.anonymousId,
      status: record.status,
      currency: record.currency as CurrencyCode,
      expiresAt: record.expiresAt?.toISOString() ?? null,
      items,
      ...totals,
      coupon,
    };
  }

  // -----------------------------------------------------------------------
  // Items: add / update / remove / clear
  // -----------------------------------------------------------------------

  async addItem(userId: string, body: AddCartItemRequest): Promise<CartResponse> {
    const parsed = addCartItemSchema.parse(body);

    const cart = await this.ensureUserCart(userId);
    const store = await this.ensureCartStore(cart.id, parsed.storeId);
    const variant = await this.assertVariantAvailable(parsed.variantId, store.id);

    const existing = await this.prisma.cartItem.findFirst({
      where: { cartId: cart.id, variantId: parsed.variantId, storeId: store.id },
    });

    if (existing !== null) {
      await this.prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: { increment: parsed.quantity } },
      });
    } else {
      await this.prisma.cartItem.create({
        data: {
          cartId: cart.id,
          variantId: parsed.variantId,
          storeId: store.id,
          quantity: parsed.quantity,
          unitPriceInPaise: variant.priceInPaise,
        },
      });
    }

    return this.getCurrentCart(userId);
  }

  async updateItem(
    userId: string,
    itemId: string,
    body: UpdateCartItemRequest,
  ): Promise<CartResponse> {
    const parsed = updateCartItemSchema.parse(body);
    await this.assertCartItemBelongsToUser(userId, itemId);
    await this.prisma.cartItem.update({
      where: { id: itemId },
      data: { quantity: parsed.quantity },
    });
    return this.getCurrentCart(userId);
  }

  async removeItem(userId: string, itemId: string): Promise<CartResponse> {
    await this.assertCartItemBelongsToUser(userId, itemId);
    await this.prisma.cartItem.delete({ where: { id: itemId } });
    return this.getCurrentCart(userId);
  }

  async clearCart(userId: string): Promise<CartResponse> {
    const cart = await this.ensureUserCart(userId);
    await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    // Keep the coupon removed when the cart is cleared; re-applying is explicit.
    if (cart.coupon !== null) {
      await this.prisma.cart.update({
        where: { id: cart.id },
        data: { couponId: null },
      });
    }
    return this.getCurrentCart(userId);
  }

  // -----------------------------------------------------------------------
  // Coupons: apply / remove
  // -----------------------------------------------------------------------

  async applyCoupon(userId: string, body: { code: string }): Promise<CartResponse> {
    const parsed = applyCouponSchema.parse(body);
    const cart = await this.ensureUserCart(userId);

    const coupon = await this.assertCouponUsable(parsed.code, cart.id);

    await this.prisma.cart.update({
      where: { id: cart.id },
      data: { coupon: { connect: { id: coupon.id } } },
    });

    return this.getCurrentCart(userId);
  }

  async removeCoupon(userId: string): Promise<CartResponse> {
    const cart = await this.ensureUserCart(userId);
    if (cart.coupon === null) {
      throw new NotFoundException('No coupon applied to this cart');
    }
    await this.prisma.cart.update({
      where: { id: cart.id },
      data: { couponId: null },
    });
    return this.getCurrentCart(userId);
  }

  // -----------------------------------------------------------------------
  // Internal assertions
  // -----------------------------------------------------------------------

  private async ensureUserCart(userId: string) {
    const cart = await this.prisma.cart.findFirst({
      where: { userId, status: 'ACTIVE' },
      include: { coupon: true },
    });

    if (cart === null) {
      return this.prisma.cart.create({
        data: { userId, status: 'ACTIVE', currency: 'INR' },
        include: { coupon: true },
      });
    }

    if (cart.status !== 'ACTIVE') {
      throw new ConflictException('The current cart is no longer active');
    }

    return cart;
  }

  private async ensureCartStore(cartId: string, storeId: string) {
    const cart = await this.prisma.cart.findUnique({
      where: { id: cartId },
      include: { store: true },
    });

    if (cart?.store?.id === storeId) {
      return cart.store!;
    }

    // Create the cart scoped to the requested store if it is not yet scoped.
    const updated = await this.prisma.cart.update({
      where: { id: cartId },
      data: { store: { connect: { id: storeId } } },
      include: { store: true },
    });
    return updated.store!;
  }

  private async assertVariantAvailable(variantId: string, _storeId: string) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId },
      select: {
        id: true,
        priceInPaise: true,
        isAvailable: true,
        sku: true,
        title: true,
        product: { select: { title: true, status: true, isAvailable: true } },
      },
    });

    if (variant === null) {
      throw new NotFoundException('No variant found for the given id');
    }

    if (variant.product.status !== 'ACTIVE' || !variant.product.isAvailable || !variant.isAvailable) {
      throw new BadRequestException('The requested variant is not available for sale');
    }

    return variant;
  }

  private async assertCartItemBelongsToUser(userId: string, itemId: string) {
    const item = await this.prisma.cartItem.findFirst({
      where: { id: itemId },
      include: { cart: { select: { userId: true, status: true } } },
    });

    if (item === null) {
      throw new NotFoundException('No cart item found for the given id');
    }

    if (item.cart.userId !== userId) {
      throw new BadRequestException('That cart item does not belong to you');
    }

    if (item.cart.status !== 'ACTIVE') {
      throw new ConflictException('The cart this item belongs to is no longer active');
    }

    return item;
  }

  private async assertCouponUsable(code: string, cartId: string) {
    const coupon = await this.prisma.coupon.findFirst({
      where: { code, isActive: true },
      select: { id: true, code: true, type: true, value: true, minOrderInPaise: true, usageLimit: true, redeemedCount: true, perUserLimit: true },
    });

    if (coupon === null) {
      throw new NotFoundException('No active coupon found for that code');
    }

    const cart = await this.prisma.cart.findUnique({
      where: { id: cartId },
      include: { items: { where: { quantity: { gt: 0 } } } },
    });

    if (cart === null) {
      throw new NotFoundException('Cart not found');
    }

    const itemTotal = sumPaise(...cart.items.map((item) => toPaise(item.unitPriceInPaise * item.quantity)));
    if (itemTotal < coupon.minOrderInPaise) {
      throw new BadRequestException('The cart total does not meet the coupon minimum');
    }

    if (coupon.usageLimit !== null && coupon.redeemedCount >= coupon.usageLimit) {
      throw new ConflictException('This coupon has reached its usage limit');
    }

    const alreadyRedeemed = await this.prisma.couponRedemption.count({
      where: { couponId: coupon.id, userId: cart.userId! },
    });
    if (alreadyRedeemed >= coupon.perUserLimit) {
      throw new ConflictException('This coupon has already been used by you');
    }

    return coupon;
  }
}
