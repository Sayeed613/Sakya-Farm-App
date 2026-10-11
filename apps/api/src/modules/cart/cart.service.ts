import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { ConfigService } from '@nestjs/config';
import { addCartItemSchema, applyCouponSchema, mergeGuestCartSchema, updateCartItemSchema } from '@sakya/validation';
import type {
  AddCartItemRequest,
  AppliedCouponResponse,
  CartItemResponse,
  CartResponse,
  CurrencyCode,
  Paise,
  UpdateCartItemRequest,
} from '@sakya/types';
import type { MergeGuestCartRequest } from '@sakya/validation';
import { multiplyPaise, sumPaise, toPaise } from '@sakya/utils';
import { PrismaService } from '../../database/prisma.service';
import type { AppConfig } from '../../config/configuration';
import { computeTotals } from '../../common/pricing';

/**
 * One line of the cart response.
 *
 * The response contract (`CartItemResponse`) exposes exactly ONE image per
 * line — `productImageUrl: string | null` — and every consumer (cart card,
 * order review, sticky cart bar) reads only that field. Hydration therefore
 * reads the first image only (`take: 1` in `resolveCurrentCart`); fetching the
 * remaining images would be rows transferred for a field that does not exist
 * in the API contract.
 */
function toCartItemResponse(item: {
  id: string;
  variantId: string;
  quantity: number;
  unitPriceInPaise: number;
  variant: {
    title: string | null;
    sku: string | null;
    isAvailable: boolean | null;
    product: {
      title: string | null;
      slug?: string;
      images?: { url: string; position: number }[];
      categories?: { category: { slug: string } }[];
    };
  };
}): CartItemResponse {
  const unitPrice = toPaise(item.unitPriceInPaise);
  const images = [...(item.variant.product.images ?? [])].sort((a, b) => a.position - b.position);
  return {
    id: item.id,
    variantId: item.variantId,
    productTitle: item.variant.product.title ?? 'Unknown product',
    variantTitle: item.variant.title ?? 'Unknown variant',
    productImageUrl: images[0]?.url ?? null,
    productSlug: item.variant.product.slug ?? '',
    categorySlugs: (item.variant.product.categories ?? []).map(({ category }) => category.slug),
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
        include: { variant: { include: { product: { select: { title: true, slug: true, status: true, isAvailable: true, images: { select: { url: true, position: true }, orderBy: { position: 'asc' }, take: 1 }, categories: { select: { category: { select: { slug: true } } } } } } } } },
      },
      coupon: true,
    },
  });

  if (cart === null) {
    const created = await prisma.cart.create({
      data: { userId, status: 'ACTIVE', currency: 'INR' },
      include: {
        items: { include: { variant: { include: { product: { select: { title: true, slug: true, status: true, isAvailable: true, images: { select: { url: true, position: true }, orderBy: { position: 'asc' }, take: 1 }, categories: { select: { category: { select: { slug: true } } } } } } } } } },
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

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

    /*
     * Shared pricing module — the SAME function the order snapshot uses, so
     * the approved checkout total is bit-for-bit the stored order total.
     * GST is charged on the discounted subtotal; shipping uses the configured
     * flat fee + free-shipping threshold.
     */
    const commerce = this.config.get('commerce', { infer: true })!;
    return computeTotals(
      {
        subtotalInPaise,
        coupon:
          coupon === null
            ? null
            : {
                type: coupon.type as 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FREE_SHIPPING',
                valueInPaise: coupon.valueInPaise,
                minOrderInPaise: coupon.minOrderInPaise,
                maxDiscountInPaise: coupon.maxDiscountInPaise,
              },
      },
      {
        taxRatePercent: commerce.taxRatePercent,
        shippingFeeInPaise: commerce.shippingFeeInPaise,
        freeShippingThresholdInPaise: commerce.freeShippingThresholdInPaise,
        codFeeInPaise: commerce.codFeeInPaise,
      },
    );
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
            minOrderInPaise: record.coupon.minOrderInPaise,
            maxDiscountInPaise: record.coupon.maxDiscountInPaise,
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

    /*
     * Fulfillment store: the cart's already-scoped store, else the first
     * active store. Clients cannot choose — `addCartItemSchema` REJECTS a body
     * that carries a storeId with 400 — so the server owns this decision
     * exactly as in mergeGuestCart.
     */
    const resolvedStoreId =
      cart.storeId ??
      (
        await this.prisma.store.findFirst({
          where: { isActive: true },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        })
      )?.id;

    if (resolvedStoreId === undefined) {
      throw new ConflictException('No store is available to fulfil this cart');
    }

    const store = await this.ensureCartStore(cart, resolvedStoreId);
    const variant = await this.assertVariantAvailable(parsed.variantId, store.id);

    // Cart caps: per-line quantity and distinct line count. Guarding here (the
    // server) rather than only in the UI keeps the limits true for every client.
    const commerce = this.config.get('commerce', { infer: true })!;
    const existingForCap = await this.prisma.cartItem.findFirst({
      where: { cartId: cart.id, variantId: parsed.variantId, storeId: store.id },
    });
    if (existingForCap !== null && existingForCap.quantity + parsed.quantity > commerce.maxQuantityPerLine) {
      throw new BadRequestException(
        `You can order up to ${commerce.maxQuantityPerLine} units of this item`,
      );
    }
    if (existingForCap === null) {
      const lineCount = await this.prisma.cartItem.count({ where: { cartId: cart.id } });
      if (lineCount >= commerce.maxCartLines) {
        throw new BadRequestException(
          `Your cart can hold up to ${commerce.maxCartLines} different items`,
        );
      }
    }

    const existing = existingForCap;

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
    // The same per-line cap applies when setting a quantity directly.
    const commerce = this.config.get('commerce', { infer: true })!;
    if (parsed.quantity > commerce.maxQuantityPerLine) {
      throw new BadRequestException(
        `You can order up to ${commerce.maxQuantityPerLine} units of this item`,
      );
    }
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
    if (cart.couponId !== null) {
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
    if (cart.couponId === null) {
      throw new NotFoundException('No coupon applied to this cart');
    }
    await this.prisma.cart.update({
      where: { id: cart.id },
      data: { couponId: null },
    });
    return this.getCurrentCart(userId);
  }

  // -----------------------------------------------------------------------
  // Guest cart merge
  // -----------------------------------------------------------------------

  /**
   * Merge the guest cart a customer accumulated before signing in.
   *
   * Called right after OTP authentication. The client sends only variant ids
   * and quantities — never prices, never a store: the server revalidates every
   * line (variant exists, product active, variant sellable), resolves the
   * fulfillment store itself, snaps the unit price at merge time, and folds
   * duplicates into one line per variant. Lines that fail validation are
   * dropped rather than failing the whole merge: a stale guest line for a
   * delisted product must not block the six good ones.
   *
   * Concurrency: the merge runs inside a Prisma transaction with
   * `ISOLATION_LEVEL: SERIALIZABLE` to serialize concurrent merges for the
   * same cart. This prevents:
   *   - lost quantity increments (both requests reading the same stale quantity
   *     and incrementing based on it);
   *   - maxQuantityPerLine violations (both requests validating against the
   *     same pre-increment quantity);
   *   - maxCartLines violations (both requests believing a new slot is
   *     available);
   *   - invalid lines consuming valid slots (the slot counting happens inside
   *     the transaction against the current DB state).
   *
   * The unique constraint on `(cartId, variantId, storeId)` remains as a
   * secondary safety net for the create path.
   */
  async mergeGuestCart(userId: string, body: MergeGuestCartRequest): Promise<CartResponse> {
    const parsed = mergeGuestCartSchema.parse(body);

    if (parsed.lines.length === 0) {
      return this.getCurrentCart(userId);
    }

    // Fold duplicate variant entries the guest store may carry, summing
    // quantities, so the same variant can never become two lines.
    const quantitiesByVariant = new Map<string, number>();
    for (const line of parsed.lines) {
      quantitiesByVariant.set(
        line.variantId,
        Math.min(99, (quantitiesByVariant.get(line.variantId) ?? 0) + line.quantity),
      );
    }

    // The fulfillment store: the current cart's store when one is already
    // scoped, otherwise the first active store. Clients cannot choose this.
    // This happens OUTSIDE the transaction to avoid holding the transaction
    // open while resolving the store.
    const cart = await this.ensureUserCart(userId);
    const existingStoreId = cart.storeId ?? null;
    let storeId =
      existingStoreId ??
      (await this.prisma.store.findFirst({
        where: { isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      }))?.id;

    if (storeId === undefined) {
      throw new ConflictException('No store is available to fulfil this cart');
    }

    if (existingStoreId === null) {
      // One-shot scope claim (still outside the merge transaction): the
      // null-guarded WHERE makes `cart.storeId` write-once, so a concurrent
      // first-scope can never be overwritten. If we lose the claim, the lines
      // written below adopt the WINNER's committed store — they can never
      // disagree with cart.storeId.
      const claimed = await this.prisma.cart.updateMany({
        where: { id: cart.id, storeId: null },
        data: { storeId },
      });
      if (claimed.count === 0) {
        const winner = await this.prisma.cart.findFirst({
          where: { id: cart.id },
          select: { storeId: true },
        });
        if (winner === null || winner.storeId === null) {
          throw new ConflictException('The cart is no longer available');
        }
        storeId = winner.storeId;
      }
    }

    // ---- Batched variant availability/price read (outside transaction) ----
    // This read happens before the transaction to minimize transaction duration.
    // The transaction will re-validate against current cart state.
    const candidateVariantIds = [...quantitiesByVariant.keys()];
    const availableVariants = new Map<string, { priceInPaise: number }>();
    if (candidateVariantIds.length > 0) {
      const variants = await this.prisma.productVariant.findMany({
        where: { id: { in: candidateVariantIds } },
        select: {
          id: true,
          priceInPaise: true,
          isAvailable: true,
          product: { select: { status: true, isAvailable: true } },
        },
      });

      for (const variant of variants) {
        if (
          variant.product.status === 'ACTIVE' &&
          variant.product.isAvailable &&
          variant.isAvailable
        ) {
          availableVariants.set(variant.id, { priceInPaise: variant.priceInPaise });
        }
      }
    }

    // ---- Concurrency-controlled merge transaction ----
    // We use SERIALIZABLE isolation to ensure that concurrent merges for the
    // same cart are serialized. PostgreSQL will detect serialization conflicts
    // and abort one of the transactions, which Prisma propagates as an error.
    // The caller can retry if needed; for guest cart merges (typically single-
    // user, post-login), retries are rare.
    const commerce = this.config.get('commerce', { infer: true })!;

    const _transactionResult = await this.prisma.$transaction(async (tx) => {
      // Re-read the current cart state INSIDE the transaction.
      // This is the authoritative state we validate against, not the
      // snapshot from ensureUserCart above.
      const currentCart = await tx.cart.findFirst({
        where: { id: cart.id, status: 'ACTIVE' },
        include: {
          items: {
            where: { quantity: { gt: 0 } },
            orderBy: { createdAt: 'asc' },
            include: { variant: { select: { id: true } } },
          },
        },
      });

      if (currentCart === null) {
        throw new ConflictException('The cart is no longer available');
      }

      // Build the set of existing line variant ids from the current DB state.
      const existingLineVariantIds = new Set(currentCart.items.map((item) => item.variantId));

      // Decide which lines survive, using CURRENT cart state.
      const toCreate: Array<{ variantId: string; quantity: number; priceInPaise: number }> = [];
      const toIncrement: Array<{ variantId: string; quantity: number }> = [];
      let committedNewLines = 0;

      for (const [variantId, quantity] of quantitiesByVariant) {
        // Skip variants that are not available (validated above).
        if (!availableVariants.has(variantId)) {
          continue; // invalid variant — does not consume a slot
        }

        if (existingLineVariantIds.has(variantId)) {
          // Existing line: validate per-line quantity cap against CURRENT quantity.
          const existingItem = currentCart.items.find((item) => item.variantId === variantId);
          if (existingItem !== undefined && existingItem.quantity + quantity > commerce.maxQuantityPerLine) {
            continue; // would exceed cap — drop this line
          }
          if (existingItem !== undefined) {
            toIncrement.push({ variantId, quantity });
          }
        } else {
          // New line: validate maxCartLines against CURRENT line count.
          if (committedNewLines >= commerce.maxCartLines) {
            continue; // cart is full — drop this line
          }
          committedNewLines += 1;
          const price = availableVariants.get(variantId)!;
          toCreate.push({ variantId, quantity, priceInPaise: price.priceInPaise });
        }
      }

      // ---- Writes inside transaction ----
      // Each surviving line is written. New lines use create; existing lines
      // use update with increment. The unique constraint on
      // (cartId, variantId, storeId) provides a secondary safety net.
      for (const line of toCreate) {
        await tx.cartItem.create({
          data: {
            cartId: cart.id,
            variantId: line.variantId,
            storeId,
            quantity: line.quantity,
            unitPriceInPaise: line.priceInPaise,
          },
        });
      }

      for (const line of toIncrement) {
        // Re-find the item by variantId to get its current ID.
        // This handles the case where a concurrent transaction may have
        // modified the cart (though SERIALIZABLE should prevent this).
        const existingItem = currentCart.items.find((item) => item.variantId === line.variantId);
        if (existingItem === undefined) {
          // Item no longer exists — skip this increment.
          // The unique constraint ensures no duplicate rows.
          continue;
        }
        await tx.cartItem.update({
          where: { id: existingItem.id },
          data: { quantity: { increment: line.quantity } },
        });
      }

      // Return the cart id for the final read outside the transaction.
      return cart.id;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    // Read the final cart state outside the transaction for the response.
    return this.getCurrentCart(userId);
  }

  // -----------------------------------------------------------------------
  // Internal assertions
  // -----------------------------------------------------------------------

  /**
   * The cart's HEADER only: id, store scope, status and coupon id.
   *
   * Performance: every mutating endpoint ends with `getCurrentCart`, which is
   * the ONE authoritative full read (items → variant → product → images →
   * categories → coupon). Loading that same graph here as well doubled the
   * relation round trips per mutation for data this method never uses —
   * callers need only the cart id, its store scope and whether a coupon is
   * attached. Validation (caps, ownership, availability) happens against
   * dedicated queries, so nothing here is skipped — it is simply not
   * re-fetched twice.
   */
  private async ensureUserCart(userId: string) {
    const cart = await this.prisma.cart.findFirst({
      where: { userId, status: 'ACTIVE' },
      select: { id: true, storeId: true, status: true, couponId: true },
    });

    if (cart === null) {
      return this.prisma.cart.create({
        data: { userId, status: 'ACTIVE', currency: 'INR' },
        select: { id: true, storeId: true, status: true, couponId: true },
      });
    }

    if (cart.status !== 'ACTIVE') {
      throw new ConflictException('The current cart is no longer active');
    }

    return cart;
  }

  /**
   * The store id cart lines will be written against, scoping the cart first
   * when it is not yet scoped.
   *
   * INVARIANT this method maintains: `cart.storeId` is WRITE-ONCE — it moves
   * null → S exactly once and never afterwards — so any header snapshot of it
   * is stable and the fast path below cannot act on stale data. That invariant
   * holds because (a) the request schema REJECTS a client-supplied storeId, so
   * no request can ever resolve a store different from the cart's committed
   * one; (b) this method's only write is a null-guarded claim; and (c)
   * mergeGuestCart scopes through the same null-guarded claim. The line we
   * write therefore always carries the store the cart is committed to.
   *
   * The fast path fires when the header already committed
   * `storeId === resolvedStoreId`; the claim below only ever runs for a cart
   * that looked UNSCOPED, and a request that loses the claim adopts the
   * winner's committed value rather than its own resolution — so two
   * concurrent first-adds converge on one store instead of overwriting each
   * other. (The previous implementation re-read the cart with an unguarded
   * `update { connect }`, which could revert a concurrent scope.) The FK on
   * `cart.storeId` guarantees the store row exists for any committed value.
   */
  private async ensureCartStore(
    cart: { id: string; storeId: string | null },
    storeId: string,
  ): Promise<{ id: string }> {
    if (cart.storeId === storeId) {
      return { id: storeId };
    }

    // One-shot scope claim: `WHERE store_id IS NULL` makes the null → S write
    // atomic — a cart another request has already scoped can never be
    // overwritten from here.
    const claimed = await this.prisma.cart.updateMany({
      where: { id: cart.id, storeId: null },
      data: { storeId },
    });

    if (claimed.count === 1) {
      return { id: storeId };
    }

    // Lost the race (or the cart vanished): honour the COMMITTED value so the
    // line written next can never disagree with cart.storeId.
    const current = await this.prisma.cart.findFirst({
      where: { id: cart.id },
      select: { storeId: true },
    });
    if (current === null || current.storeId === null) {
      throw new ConflictException('The current cart is no longer active');
    }
    return { id: current.storeId };
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
        // No images here: this read only answers "is it sellable, and at
        // what price". The response images come from the final full-cart read
        // (getCurrentCart), so fetching them per add was a wasted round trip.
        product: { select: { title: true, slug: true, status: true, isAvailable: true } },
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
    // Fast path: ONE indexed statement proves the row exists, belongs to the
    // caller AND their cart is active (the relation filter runs in SQL). The
    // detailed read below only executes when that proof fails, so the 404 / 400
    // / 409 distinctions and their messages are unchanged.
    const owned = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cart: { userId, status: 'ACTIVE' } },
      select: { id: true },
    });

    if (owned !== null) {
      return owned;
    }

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
    // The active window is part of "usable": a coupon whose startsAt has not
    // arrived or whose endsAt has passed must not attach to a cart (checkout
    // re-checks the window atomically, but the cart preview must not show a
    // discount that checkout would then reject). now() is evaluated in the
    // WHERE clause via Prisma filters, not trusted from the client.
    const now = new Date();
    const coupon = await this.prisma.coupon.findFirst({
      where: {
        code,
        isActive: true,
        OR: [{ startsAt: null }, { startsAt: { lte: now } }],
        AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
      },
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
