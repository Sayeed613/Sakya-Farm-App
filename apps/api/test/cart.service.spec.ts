import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addCartItemSchema } from '@sakya/validation';
import { Prisma } from '../src/generated/prisma/client';
import { CartService } from '../src/modules/cart/cart.service';
import { PrismaService } from '../src/database/prisma.service';

/** Commerce config the service reads; matches the production defaults. */
function configMock() {
  return {
    get: (key: string) =>
      key === 'commerce'
        ? {
            taxRatePercent: 5,
            shippingFeeInPaise: 4900,
            freeShippingThresholdInPaise: 59900,
            codFeeInPaise: 0,
            maxQuantityPerLine: 10,
            maxCartLines: 25,
            returnWindowDays: 7,
            pendingOrderExpiryMinutes: 120,
          }
        : undefined,
  } as unknown as ConfigService;
}

const VARIANT_ID = '00000000-0000-4000-8000-000000000001';
const STORE_ID = '00000000-0000-4000-8000-000000000002';

function variant(id: string, title = '500 g', price = 2400, available = true) {
  return {
    id,
    priceInPaise: price,
    isAvailable: available,
    sku: 'SKU-1',
    title,
    product: { title: 'Mango', status: 'ACTIVE' as const, isAvailable: true },
  } as unknown as Prisma.ProductVariantGetPayload<true>;
}

function cart(id = 'cart-1', userId = 'user-1') {
  return {
    id,
    userId,
    anonymousId: null as string | null,
    status: 'ACTIVE' as const,
    currency: 'INR',
    expiresAt: null as Date | null,
    store: { id: 'store-1', currency: 'INR' } as unknown as Prisma.StoreModel,
    storeId: STORE_ID as string | null,
    couponId: null as string | null,
    coupon: null as Prisma.CouponGetPayload<true> | null,
    items: [] as Array<Prisma.CartItemGetPayload<true> & { variant: Prisma.ProductVariantGetPayload<true>; product: { title: string } }>,
  } as unknown as Prisma.CartGetPayload<true>;
}

function makeItems(storeId: string, ...specs: Array<{ id: string; variantId: string; quantity: number; unitPriceInPaise: number }>) {
  return specs.map((spec) => ({
    id: spec.id,
    cartId: 'cart-1',
    variantId: spec.variantId,
    storeId,
    quantity: spec.quantity,
    unitPriceInPaise: spec.unitPriceInPaise,
    createdAt: new Date(),
    updatedAt: new Date(),
    variant: variant(spec.variantId, '500 g', spec.unitPriceInPaise, true) as any,
  }));
}

describe('CartService', () => {
  let service: CartService;
  let prisma: ReturnType<typeof createPrismaMock>;

  beforeEach(async () => {
    prisma = createPrismaMock();
    const testModule = await Test.createTestingModule({
      providers: [
        CartService,
        { provide: PrismaService, useValue: prisma },
        // Commerce rules (tax, shipping, caps) come from configuration.
        { provide: ConfigService, useValue: configMock() },
      ],
    }).overrideProvider(PrismaService).useValue(prisma).compile();
    service = testModule.get(CartService);
  });

  it('creates an active cart on first access for a user', async () => {
    prisma.cart.findFirst.mockResolvedValue(null);
    prisma.cart.create.mockResolvedValue(cart());

    const result = await service.getCurrentCart('user-1');

    expect(result.status).toBe('ACTIVE');
    expect(result.items).toHaveLength(0);
    expect(result.subtotalInPaise).toBe(0);
    expect(result.totalInPaise).toBe(0);
  });

  it('returns the existing active cart for a returning user', async () => {
    prisma.cart.findFirst.mockResolvedValue(cart('cart-2'));

    const result = await service.getCurrentCart('user-1');

    expect(result.id).toBe('cart-2');
    expect(prisma.cart.create).not.toHaveBeenCalled();
  });

  it('recomputes subtotal, discount, tax, shipping and total from items', async () => {
    prisma.cart.findFirst.mockResolvedValue({
      ...cart(),
      items: makeItems('store-1', { id: 'i1', variantId: 'v1', quantity: 2, unitPriceInPaise: 2400 }),
      coupon: null,
    });

    const result = await service.getCurrentCart('user-1');

    // Real commerce defaults from the config mock: 5% GST on the discounted
    // subtotal, ₹49 shipping below the free threshold (₹599).
    const subtotal = 2 * 2400;
    const tax = Math.round(subtotal * 0.05);
    const shipping = 4900;
    expect(result.subtotalInPaise).toBe(subtotal);
    expect(result.discountInPaise).toBe(0);
    expect(result.taxInPaise).toBe(tax);
    expect(result.shippingInPaise).toBe(shipping);
    expect(result.totalInPaise).toBe(subtotal + tax + shipping);
  });

  it('recomputes line totals from the stored unit price, not from any client value', async () => {
    prisma.cart.findFirst.mockResolvedValue({
      ...cart(),
      items: makeItems('store-1', { id: 'i1', variantId: 'v1', quantity: 3, unitPriceInPaise: 2400 }),
      coupon: null,
    });

    const result = await service.getCurrentCart('user-1');

    expect(result.items[0]!.lineTotalInPaise).toBe(3 * 2400);
    expect(result.items[0]!.unitPriceInPaise).toBe(2400);
  });

  it('rejects adding an unavailable variant', async () => {
    prisma.cart.findFirst.mockResolvedValue(cart());
    prisma.cart.create.mockResolvedValue(cart());
    prisma.cart.update.mockResolvedValue({ store: { id: 'store-1', currency: 'INR' } } as any);
    prisma.productVariant.findFirst.mockResolvedValue({
      id: 'v1',
      priceInPaise: 2400,
      isAvailable: false,
      sku: 'SKU-1',
      title: '500 g',
      product: { title: 'Mango', status: 'ACTIVE', isAvailable: true },
    });

    await expect(
      service.addItem('user-1', { variantId: VARIANT_ID, quantity: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('increments quantity when the same variant is added again', async () => {
    prisma.cart.findFirst.mockResolvedValue(cart());
    prisma.cart.create.mockResolvedValue(cart());
    prisma.cart.update.mockResolvedValue({ store: { id: 'store-1', currency: 'INR' } } as any);
    prisma.productVariant.findFirst.mockResolvedValue(variant('v1', '500 g', 2400, true));
    prisma.cartItem.findFirst.mockResolvedValue({ id: 'existing-item', cartId: 'cart-1', variantId: 'v1', storeId: 'store-1', quantity: 2, unitPriceInPaise: 2400 });

    prisma.cartItem.update.mockImplementation(
      async (args: { where: { id: string }; data: { quantity: { increment: number } } }) => ({
        id: args.where.id,
        quantity: 2 + args.data.quantity.increment,
        unitPriceInPaise: 2400,
      }) as any,
    );
    prisma.cart.findFirst.mockResolvedValue({
      ...cart(),
      items: makeItems('store-1', { id: 'existing-item', variantId: 'v1', quantity: 5, unitPriceInPaise: 2400 }),
      coupon: null,
    });

    const result = await service.addItem('user-1', { variantId: VARIANT_ID, quantity: 3 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.quantity).toBe(5);
  });

  it('removes an item and returns the recomputed cart', async () => {
    prisma.cartItem.findFirst.mockResolvedValue({
      id: 'item-1',
      cartId: 'cart-1',
      variantId: 'v1',
      storeId: 'store-1',
      quantity: 2,
      unitPriceInPaise: 2400,
      cart: { userId: 'user-1', status: 'ACTIVE' },
    });
    prisma.cartItem.delete.mockResolvedValue(undefined);
    prisma.cart.findFirst.mockResolvedValue({
      ...cart(),
      items: [],
      coupon: null,
    });

    const result = await service.removeItem('user-1', 'item-1');
    expect(result.items).toHaveLength(0);
    expect(result.subtotalInPaise).toBe(0);
  });

  it('clears the cart and removes the coupon', async () => {
    prisma.cart.findFirst
      .mockResolvedValueOnce({
        ...cart(),
        items: makeItems('store-1', { id: 'i1', variantId: 'v1', quantity: 1, unitPriceInPaise: 2400 }),
        couponId: 'coupon-1',
        coupon: { id: 'coupon-1', code: 'SAVE10', type: 'PERCENTAGE', value: 1000 } as any,
      })
      .mockResolvedValue({
        ...cart(),
        items: [],
        coupon: null,
      });
    prisma.cartItem.deleteMany.mockResolvedValue({ count: 1 });
    prisma.cart.update.mockResolvedValue({ id: 'cart-1', coupon: null } as any);

    const result = await service.clearCart('user-1');
    expect(result.items).toHaveLength(0);
    expect(result.coupon).toBeNull();
  });

  it('applies a percentage coupon and recomputes the total', async () => {
    prisma.cart.findFirst
      .mockResolvedValueOnce({
        ...cart(),
        items: makeItems('store-1', { id: 'i1', variantId: 'v1', quantity: 1, unitPriceInPaise: 2400 }),
        coupon: null,
      })
      .mockResolvedValue({
        ...cart(),
        items: makeItems('store-1', { id: 'i1', variantId: 'v1', quantity: 1, unitPriceInPaise: 2400 }),
        coupon: { id: 'coupon-1', code: 'SAVE10', type: 'PERCENTAGE', value: 1000 } as any,
      });
    prisma.cart.findUnique.mockResolvedValue({
      ...cart(),
      items: makeItems('store-1', { id: 'i1', variantId: 'v1', quantity: 1, unitPriceInPaise: 2400 }),
    });
    prisma.coupon.findFirst.mockResolvedValue({
      id: 'coupon-1',
      code: 'SAVE10',
      type: 'PERCENTAGE',
      value: 1000,
      minOrderInPaise: 0,
      usageLimit: null,
      redeemedCount: 0,
      perUserLimit: 1,
    });
    prisma.couponRedemption.count.mockResolvedValue(0);
    prisma.cart.update.mockResolvedValue({ id: 'cart-1', coupon: { id: 'coupon-1', code: 'SAVE10', type: 'PERCENTAGE', value: 1000 } } as any);

    const result = await service.applyCoupon('user-1', { code: 'save10' });

    expect(result.coupon).not.toBeNull();
    expect(result.coupon!.code).toBe('SAVE10');
    // Real pricing: 10% off 2400, 5% GST on the discounted 2160, shipping
    // below the free threshold.
    expect(result.discountInPaise).toBe(240);
    expect(result.taxInPaise).toBe(108);
    expect(result.shippingInPaise).toBe(4900);
    expect(result.totalInPaise).toBe(2400 - 240 + 108 + 4900);
  });

  it('caps a fixed-amount coupon at the cart subtotal', async () => {
    prisma.cart.findFirst
      .mockResolvedValueOnce({
        ...cart(),
        items: makeItems('store-1', { id: 'i1', variantId: 'v1', quantity: 1, unitPriceInPaise: 200 }),
        coupon: null,
      })
      .mockResolvedValue({
        ...cart(),
        items: makeItems('store-1', { id: 'i1', variantId: 'v1', quantity: 1, unitPriceInPaise: 200 }),
        coupon: { id: 'coupon-1', code: 'FLAT500', type: 'FIXED_AMOUNT', value: 500 } as any,
      });
    prisma.cart.findUnique.mockResolvedValue({
      ...cart(),
      items: makeItems('store-1', { id: 'i1', variantId: 'v1', quantity: 1, unitPriceInPaise: 200 }),
    });
    prisma.coupon.findFirst.mockResolvedValue({
      id: 'coupon-1',
      code: 'FLAT500',
      type: 'FIXED_AMOUNT',
      value: 500,
      minOrderInPaise: 0,
      usageLimit: null,
      redeemedCount: 0,
      perUserLimit: 1,
    });
    prisma.couponRedemption.count.mockResolvedValue(0);
    prisma.cart.update.mockResolvedValue({ id: 'cart-1', coupon: { id: 'coupon-1', code: 'FLAT500', type: 'FIXED_AMOUNT', value: 500 } } as any);

    const result = await service.applyCoupon('user-1', { code: 'flat500' });

    expect(result.discountInPaise).toBe(200);
    // The discount zeroes the goods; the shipping charge remains.
    expect(result.taxInPaise).toBe(0);
    expect(result.shippingInPaise).toBe(4900);
    expect(result.totalInPaise).toBe(4900);
  });

  it('rejects a coupon code that does not exist', async () => {
    prisma.cart.findFirst.mockResolvedValue(cart());
    prisma.coupon.findFirst.mockResolvedValue(null);

    await expect(
      service.applyCoupon('user-1', { code: 'nope' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects removing a coupon when none is applied', async () => {
    prisma.cart.findFirst.mockResolvedValue(cart());

    await expect(service.removeCoupon('user-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('raises ConflictException when the cart is no longer active', async () => {
    prisma.cart.findFirst.mockResolvedValue({
      ...cart(),
      status: 'CONVERTED',
      items: [],
      coupon: null,
    } as any);

    await expect(service.getCurrentCart('user-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('raises BadRequestException when a cart item belongs to another user', async () => {
    // First call is the single-statement ownership fast path (misses here
    // because of the mocked relation filter), the second is the detailed read
    // that produces the 400.
    prisma.cartItem.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        id: 'item-1',
        cartId: 'cart-1',
        variantId: 'v1',
        storeId: 'store-1',
        quantity: 1,
        unitPriceInPaise: 2400,
        cart: { userId: 'other-user', status: 'ACTIVE' },
      } as any);

    await expect(service.removeItem('user-1', 'item-1')).rejects.toBeInstanceOf(BadRequestException);
  });


  // ---- Step 6: mergeGuestCart tests ----

  it('merges multiple guest lines into an empty cart (dedupe, server price, cleanup)', async () => {
    const v1 = '00000000-0000-4000-8000-000000000001';
    const v2 = '00000000-0000-4000-8000-000000000002';
    
    // Track calls to cartItem.create
    const createdItems: Array<{ variantId: string; quantity: number; unitPriceInPaise: number }> = [];    prisma.cart.findFirst
      .mockResolvedValueOnce({
        ...cart(),
        storeId: STORE_ID,
        items: [],
      })
      // Inside transaction: cart is still empty (we're creating new items)
      .mockResolvedValueOnce({
        ...cart(),
        storeId: STORE_ID,
        items: [],
      })
      // Final read in getCurrentCart after transaction completes.
      .mockResolvedValue({
        ...cart(),
        storeId: STORE_ID,
        items: makeItems(STORE_ID, {
          id: 'item-v1',
          variantId: v1,
          quantity: 3,
          unitPriceInPaise: 2400,
        }, {
          id: 'item-v2',
          variantId: v2,
          quantity: 1,
          unitPriceInPaise: 3200,
        }),
      });

    prisma.productVariant.findMany.mockResolvedValue([
      { id: v1, priceInPaise: 2400, isAvailable: true, product: { status: 'ACTIVE', isAvailable: true } },
      { id: v2, priceInPaise: 3200, isAvailable: true, product: { status: 'ACTIVE', isAvailable: true } },
    ] as any);
    
    prisma.cartItem.create.mockImplementation(
      async ({ data }: { data: { variantId: string; quantity: number; unitPriceInPaise: number } }) => {
        createdItems.push({ variantId: data.variantId, quantity: data.quantity, unitPriceInPaise: data.unitPriceInPaise });
        return {
          id: `item-${data.variantId}`,
          ...data,
          cartId: 'cart-1',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
    );
    
    // Mock $transaction to execute callback with delegated mocks
    prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        cart: { findFirst: prisma.cart.findFirst },
        cartItem: {
          create: prisma.cartItem.create,
          update: prisma.cartItem.update,
        },
      };
      return await callback(tx);
    });

    const result = await service.mergeGuestCart('user-1', {
      lines: [
        { variantId: v1, quantity: 2 },
        { variantId: v1, quantity: 1 },
        { variantId: v2, quantity: 1 },
      ],
    });

    // After transaction, cart should have the created items
    expect(createdItems).toHaveLength(2);
    expect(createdItems[0]!.variantId).toBe(v1);
    expect(createdItems[0]!.quantity).toBe(3); // deduped: 2+1
    expect(createdItems[0]!.unitPriceInPaise).toBe(2400);
    expect(createdItems[1]!.variantId).toBe(v2);
    expect(createdItems[1]!.quantity).toBe(1);
    expect(createdItems[1]!.unitPriceInPaise).toBe(3200);
    
    expect(result.items).toHaveLength(2);
    expect(result.items[0]!.variantId).toBe(v1);
    expect(result.items[0]!.quantity).toBe(3);
    expect(result.items[0]!.unitPriceInPaise).toBe(2400);
    expect(result.items[1]!.variantId).toBe(v2);
    expect(result.items[1]!.quantity).toBe(1);
    expect(result.items[1]!.unitPriceInPaise).toBe(3200);
    expect(result.totalInPaise).toBeGreaterThan(0);
    expect(prisma.cartItem.create).toHaveBeenCalledTimes(2);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('dedupes duplicate guest lines into a single line with summed quantity', async () => {
    const v1 = '00000000-0000-4000-8000-000000000001';    prisma.cart.findFirst
      .mockResolvedValueOnce({
        ...cart(),
        storeId: STORE_ID,
        items: [],
      })
      // Inside transaction: cart is still empty
      .mockResolvedValueOnce({
        ...cart(),
        storeId: STORE_ID,
        items: [],
      })
      // Final read in getCurrentCart after transaction completes.
      .mockResolvedValue({
        ...cart(),
        storeId: STORE_ID,
        items: makeItems(STORE_ID, {
          id: 'item-v1',
          variantId: v1,
          quantity: 3,
          unitPriceInPaise: 2400,
        }),
      });

    prisma.productVariant.findMany.mockResolvedValue([
      { id: v1, priceInPaise: 2400, isAvailable: true, product: { status: 'ACTIVE', isAvailable: true } },
    ] as any);

    prisma.cartItem.create.mockImplementation(
      async ({ data }: { data: { variantId: string; quantity: number; unitPriceInPaise: number } }) => ({
        id: `item-${data.variantId}`,
        ...data,
        cartId: 'cart-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

    prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        cart: { findFirst: prisma.cart.findFirst },
        cartItem: {
          create: prisma.cartItem.create,
          update: prisma.cartItem.update,
        },
      };
      return await callback(tx);
    });

    const result = await service.mergeGuestCart('user-1', {
      lines: [
        { variantId: v1, quantity: 1 },
        { variantId: v1, quantity: 1 },
        { variantId: v1, quantity: 1 },
      ],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.quantity).toBe(3); // deduped: 1+1+1
    expect(result.items[0]!.unitPriceInPaise).toBe(2400);
    expect(prisma.cartItem.create).toHaveBeenCalledTimes(1);
    expect(prisma.cartItem.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ quantity: 3 }),
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('enforces per-line quantity cap and per-cart line cap (drops the offending line)', async () => {
    const v1 = '00000000-0000-4000-8000-000000000001';
    
    prisma.cart.findFirst
      .mockResolvedValueOnce({
        ...cart(),
        storeId: STORE_ID,
        items: [],
      })
      .mockResolvedValue({
        ...cart(),
        storeId: STORE_ID,
        items: makeItems(STORE_ID, {
          id: 'existing-item',
          variantId: v1,
          quantity: 8,
          unitPriceInPaise: 2400,
        }),
      });
    
    prisma.productVariant.findMany.mockResolvedValue([
      { id: v1, priceInPaise: 2400, isAvailable: true, product: { status: 'ACTIVE', isAvailable: true } },
    ] as any);
    
    prisma.cartItem.update.mockImplementation(
      async ({ where, data }: { where: { id: string }; data: { quantity: { increment: number } } }) => ({
        id: where.id,
        quantity: 8 + data.quantity.increment,
        unitPriceInPaise: 2400,
      }),
    );
    
    prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        cart: { findFirst: prisma.cart.findFirst },
        cartItem: {
          create: prisma.cartItem.create,
          update: prisma.cartItem.update,
        },
      };
      return await callback(tx);
    });

    const result = await service.mergeGuestCart('user-1', {
      lines: [{ variantId: v1, quantity: 3 }],
    });

    // Line should be dropped because 8+3 > maxQuantityPerLine (10)
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.quantity).toBe(8);
    expect(prisma.cartItem.update).not.toHaveBeenCalled();
    expect(prisma.productVariant.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('drops an unknown / unavailable variant and keeps the valid ones', async () => {
    const existingVariant = '00000000-0000-4000-8000-000000000002';
    const unknownVariant = 'ffffffff-ffff-4000-8000-000000000000';
    const newValidVariant = '00000000-0000-4000-8000-000000000003';    prisma.cart.findFirst
      .mockResolvedValueOnce({
        ...cart(),
        storeId: STORE_ID,
        items: makeItems(STORE_ID, {
          id: 'existing-item',
          variantId: existingVariant,
          quantity: 1,
          unitPriceInPaise: 2400,
        }),
      })
      // Inside transaction: cart has existing item
      .mockResolvedValueOnce({
        ...cart(),
        storeId: STORE_ID,
        items: makeItems(STORE_ID, {
          id: 'existing-item',
          variantId: existingVariant,
          quantity: 1,
          unitPriceInPaise: 2400,
        }),
      })
      // Final read in getCurrentCart after transaction completes.
      .mockResolvedValue({
        ...cart(),
        storeId: STORE_ID,
        items: [
          ...makeItems(STORE_ID, {
            id: 'existing-item',
            variantId: existingVariant,
            quantity: 5,
            unitPriceInPaise: 2400,
          }),
          ...makeItems(STORE_ID, {
            id: 'item-new',
            variantId: newValidVariant,
            quantity: 4,
            unitPriceInPaise: 3200,
          }),
        ],
      });

    prisma.productVariant.findMany.mockResolvedValue([
      { id: existingVariant, priceInPaise: 2400, isAvailable: true, product: { status: 'ACTIVE', isAvailable: true } },
      { id: newValidVariant, priceInPaise: 3200, isAvailable: true, product: { status: 'ACTIVE', isAvailable: true } },
    ] as any);
    
    prisma.cartItem.create.mockImplementation(
      async ({ data }: { data: { variantId: string; quantity: number; unitPriceInPaise: number } }) => ({
        id: `item-${data.variantId}`,
        ...data,
        cartId: 'cart-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
    
    prisma.cartItem.update.mockImplementation(
      async ({ where, data }: { where: { id: string }; data: { quantity: { increment: number } } }) => ({
        id: where.id,
        quantity: 1 + data.quantity.increment,
        unitPriceInPaise: 2400,
      }),
    );
    
    prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        cart: { findFirst: prisma.cart.findFirst },
        cartItem: {
          create: prisma.cartItem.create,
          update: prisma.cartItem.update,
        },
      };
      return await callback(tx);
    });

    const result = await service.mergeGuestCart('user-1', {
      lines: [
        { variantId: existingVariant, quantity: 4 },
        { variantId: unknownVariant, quantity: 99 },
        { variantId: newValidVariant, quantity: 4 },
      ],
    });

    expect(result.items).toHaveLength(2);
    expect(result.items[0]!.variantId).toBe(existingVariant);
    expect(result.items[0]!.quantity).toBe(5); // 1+4
    expect(result.items[1]!.variantId).toBe(newValidVariant);
    expect(result.items[1]!.quantity).toBe(4);
    expect(prisma.cartItem.create).toHaveBeenCalledTimes(1);
    expect(prisma.cartItem.update).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('returns a clean empty cart when every guest line is rejected', async () => {
    const unavailableVariant = '00000000-0000-4000-8000-000000000001';
    
    prisma.cart.findFirst
      .mockResolvedValueOnce({
        ...cart(),
        storeId: STORE_ID,
        items: [],
      })
      .mockResolvedValue({
        ...cart(),
        storeId: STORE_ID,
        items: [],
      });
    
    prisma.productVariant.findMany.mockResolvedValue([
      { id: unavailableVariant, priceInPaise: 2400, isAvailable: false, product: { status: 'ACTIVE', isAvailable: true } },
    ] as any);
    
    prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        cart: { findFirst: prisma.cart.findFirst },
        cartItem: {
          create: prisma.cartItem.create,
          update: prisma.cartItem.update,
        },
      };
      return await callback(tx);
    });

    const result = await service.mergeGuestCart('user-1', {
      lines: [{ variantId: unavailableVariant, quantity: 5 }],
    });

    expect(result.items).toHaveLength(0);
    expect(result.totalInPaise).toBe(0);
    expect(prisma.cartItem.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('no-op when the guest body carries zero lines', async () => {
    prisma.cart.findFirst
      .mockResolvedValueOnce({
        ...cart(),
        storeId: STORE_ID,
        items: [],
      })
      .mockResolvedValue({
        ...cart(),
        storeId: STORE_ID,
        items: [],
      });

    const result = await service.mergeGuestCart('user-1', { lines: [] });

    expect(result.items).toHaveLength(0);
    expect(prisma.productVariant.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // ---- Concurrency tests ----

  it('uses a transaction for the merge operation', async () => {
    const v1 = '00000000-0000-4000-8000-000000000001';
    prisma.cart.findFirst
      .mockResolvedValueOnce({
        ...cart(),
        storeId: STORE_ID,
        items: [],
      })
      .mockResolvedValue({
        ...cart(),
        storeId: STORE_ID,
        items: [],
      });
    prisma.productVariant.findMany.mockResolvedValue([
      { id: v1, priceInPaise: 2400, isAvailable: true, product: { status: 'ACTIVE', isAvailable: true } },
    ] as any);
    prisma.cartItem.create.mockImplementation(
      async ({ data }: { data: { variantId: string; quantity: number; unitPriceInPaise: number } }) => ({
        id: `item-${data.variantId}`,
        ...data,
        cartId: 'cart-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

    await service.mergeGuestCart('user-1', {
      lines: [{ variantId: v1, quantity: 1 }],
    });

    // Verify that $transaction was called (the merge runs inside a transaction).
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // The transaction callback should have been invoked.
    const transactionCall = prisma.$transaction.mock.calls[0];
    expect(transactionCall).toBeDefined();
    if (transactionCall) {
      expect(transactionCall).toHaveLength(2);
      expect(typeof transactionCall[0]).toBe('function'); // callback
      expect(transactionCall[1]).toHaveProperty('isolationLevel');
    }
  });

  it('re-reads cart state inside the transaction for validation', async () => {
    const v1 = '00000000-0000-4000-8000-000000000001';
    // First call: ensureUserCart (outside transaction)
    prisma.cart.findFirst
      .mockResolvedValueOnce({
        ...cart(),
        storeId: STORE_ID,
        items: [],
      })
      // Second call: inside transaction, current cart state with existing item
      .mockResolvedValueOnce({
        ...cart(),
        storeId: STORE_ID,
        items: makeItems(STORE_ID, {
          id: 'item-v1',
          variantId: v1,
          quantity: 5,
          unitPriceInPaise: 2400,
        }),
      })
      // Final read in getCurrentCart after transaction completes.
      .mockResolvedValueOnce({
        ...cart(),
        storeId: STORE_ID,
        items: makeItems(STORE_ID, {
          id: 'item-v1',
          variantId: v1,
          quantity: 8,
          unitPriceInPaise: 2400,
        }),
      });
    prisma.productVariant.findMany.mockResolvedValue([
      { id: v1, priceInPaise: 2400, isAvailable: true, product: { status: 'ACTIVE', isAvailable: true } },
    ] as any);
    prisma.cartItem.update.mockImplementation(
      async ({ where, data }: { where: { id: string }; data: { quantity: { increment: number } } }) => ({
        id: where.id,
        quantity: 5 + data.quantity.increment,
        unitPriceInPaise: 2400,
      }),
    );
    
    prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        cart: { findFirst: prisma.cart.findFirst },
        cartItem: {
          create: prisma.cartItem.create,
          update: prisma.cartItem.update,
        },
      };
      return await callback(tx);
    });

    const result = await service.mergeGuestCart('user-1', {
      lines: [{ variantId: v1, quantity: 3 }],
    });

    // The transaction should have been used.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // The update should have incremented by 3 (from 5 to 8).
    expect(prisma.cartItem.update).toHaveBeenCalledTimes(1);
    expect(prisma.cartItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { quantity: { increment: 3 } },
      }),
    );
    // Final cart should reflect the incremented quantity.
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.quantity).toBe(8);
  });

  // ---- Cart performance: query-shape regressions --------------------------
  //
  // Render production logs showed POST /cart/items ~3.3s / 21 queries and
  // PATCH /cart/items/:id ~1.6s / 11 queries. The dominant cost was reading
  // the full cart graph (cart → items → variant → product → images →
  // categories → coupon) up to three times per mutation. These tests pin the
  // shapes that keep each mutation to ONE full read (the authoritative
  // response) plus header/validation reads.

  it('addItem reads a header-only cart before writing, then one full cart after', async () => {
    const header = { id: 'cart-1', storeId: STORE_ID, status: 'ACTIVE', couponId: null };
    prisma.cart.findFirst
      .mockResolvedValueOnce(header)
      .mockResolvedValue({ ...cart(), storeId: STORE_ID, items: [], coupon: null });
    prisma.productVariant.findFirst.mockResolvedValue(variant('v1', '500 g', 2400, true));
    prisma.cartItem.findFirst.mockResolvedValue({
      id: 'existing-item',
      cartId: 'cart-1',
      variantId: 'v1',
      storeId: STORE_ID,
      quantity: 2,
      unitPriceInPaise: 2400,
    });
    prisma.cartItem.update.mockResolvedValue({} as any);

    await service.addItem('user-1', { variantId: VARIANT_ID, quantity: 1 });

    // Header read + availability + line lookup + write + final full read —
    // and nothing else (relation fan-out inside each read is asserted below).
    expect(totalPrismaCalls(prisma)).toBe(5);

    const headerArgs = prisma.cart.findFirst.mock.calls[0]![0] as {
      select?: unknown;
      include?: unknown;
    };
    expect(headerArgs.select).toEqual({ id: true, storeId: true, status: true, couponId: true });
    expect(headerArgs.include).toBeUndefined();

    // Cart already scoped to the resolved store: no redundant cart.findUnique.
    expect(prisma.cart.findUnique).not.toHaveBeenCalled();

    // The availability check must not fetch images; the final read supplies them.
    const variantArgs = prisma.productVariant.findFirst.mock.calls[0]![0] as {
      select: { product: { images?: unknown } };
    };
    expect(variantArgs.select.product.images).toBeUndefined();
  });

  it('addItem creates a new line after the line-count cap check', async () => {
    const header = { id: 'cart-1', storeId: STORE_ID, status: 'ACTIVE', couponId: null };
    prisma.cart.findFirst
      .mockResolvedValueOnce(header)
      .mockResolvedValue({ ...cart(), storeId: STORE_ID, items: [], coupon: null });
    prisma.productVariant.findFirst.mockResolvedValue(variant('v1', '500 g', 2400, true));
    prisma.cartItem.findFirst.mockResolvedValue(null); // no existing line
    prisma.cartItem.count.mockResolvedValue(3); // under maxCartLines (25)
    prisma.cartItem.create.mockResolvedValue({} as any);

    await service.addItem('user-1', { variantId: VARIANT_ID, quantity: 2 });

    // The cap check still runs for new lines — it was not dropped for speed.
    expect(prisma.cartItem.count).toHaveBeenCalledWith({ where: { cartId: 'cart-1' } });
    expect(prisma.cartItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          variantId: VARIANT_ID,
          storeId: STORE_ID,
          quantity: 2,
          unitPriceInPaise: 2400,
        }),
      }),
    );
    expect(totalPrismaCalls(prisma)).toBe(6);
  });

  it('first add claims the cart scope with one null-guarded write (no re-read)', async () => {
    // Header says the cart has NO store yet: the fast path must be skipped and
    // the scope must be claimed atomically (`WHERE store_id IS NULL`) so a
    // concurrent first-add can never be overwritten. No cart.findUnique round
    // trip remains — the claim replaces the old re-read + connect pair.
    const header = { id: 'cart-1', storeId: null, status: 'ACTIVE', couponId: null };
    prisma.cart.findFirst
      .mockResolvedValueOnce(header)
      .mockResolvedValue({ ...cart(), storeId: null, items: [], coupon: null });
    prisma.store.findFirst.mockResolvedValue({ id: STORE_ID });
    prisma.cart.updateMany.mockResolvedValue({ count: 1 });
    prisma.productVariant.findFirst.mockResolvedValue(variant('v1', '500 g', 2400, true));
    prisma.cartItem.findFirst.mockResolvedValue({
      id: 'existing-item',
      cartId: 'cart-1',
      variantId: 'v1',
      storeId: STORE_ID,
      quantity: 2,
      unitPriceInPaise: 2400,
    });
    prisma.cartItem.update.mockResolvedValue({} as any);

    await service.addItem('user-1', { variantId: VARIANT_ID, quantity: 1 });

    // Server-side resolution: first active store (clients cannot choose one).
    expect(prisma.store.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
    // The claim only ever writes NULL → store: never an overwrite.
    expect(prisma.cart.updateMany).toHaveBeenCalledWith({
      where: { id: 'cart-1', storeId: null },
      data: { storeId: STORE_ID },
    });
    expect(prisma.cart.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a client-supplied storeId at the schema boundary (clients cannot choose a store)', () => {
    expect(() =>
      addCartItemSchema.parse({ variantId: VARIANT_ID, quantity: 1, storeId: STORE_ID }),
    ).toThrowError(/cannot choose a store/);
    // The accepted shape parses cleanly.
    expect(addCartItemSchema.parse({ variantId: VARIANT_ID, quantity: 1 })).toEqual({
      variantId: VARIANT_ID,
      quantity: 1,
    });
  });

  it('a storeId on the body never reaches the mutation path (rejected before any DB call)', async () => {
    await expect(
      service.addItem('user-1', { variantId: VARIANT_ID, quantity: 1, storeId: STORE_ID } as any),
    ).rejects.toThrowError(/cannot choose a store/);
    expect(totalPrismaCalls(prisma)).toBe(0);
  });

  it('adopts the committed store when a concurrent request claims the scope first', async () => {
    const WINNER_STORE_ID = '00000000-0000-4000-8000-000000000007';
    const header = { id: 'cart-1', storeId: null, status: 'ACTIVE', couponId: null };
    prisma.cart.findFirst
      .mockResolvedValueOnce(header) // header read: still unscoped
      .mockResolvedValue({ ...cart(), storeId: WINNER_STORE_ID, items: [], coupon: null });
    prisma.store.findFirst.mockResolvedValue({ id: STORE_ID }); // our resolution…
    prisma.cart.updateMany.mockResolvedValue({ count: 0 }); // …but we lose the claim
    prisma.productVariant.findFirst.mockResolvedValue(variant('v1', '500 g', 2400, true));
    prisma.cartItem.findFirst.mockResolvedValue(null);
    prisma.cartItem.count.mockResolvedValue(0);
    prisma.cartItem.create.mockResolvedValue({} as any);

    await service.addItem('user-1', { variantId: VARIANT_ID, quantity: 1 });

    expect(prisma.cart.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'cart-1', storeId: null } }),
    );
    // The line is written against the WINNER's committed store — never ours —
    // so cart.storeId and line.storeId cannot diverge. This is sequential
    // coverage of the lost-claim branch; the interleaving below sequences two
    // real calls through the same window.
    expect(prisma.cartItem.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ storeId: WINNER_STORE_ID }) }),
    );
  });

  it('interleaving: a line written after a concurrent first-scope uses the committed store', async () => {
    // HONEST SCOPE: the unit suite has no database, so this is NOT a real
    // multi-connection concurrency test. It is an ORDERING-CONTROLLED
    // interleaving of two REAL `addItem` calls through stateful mocks: request
    // B runs to completion in the middle of request A's flow — after A's header
    // read (which sees storeId: null) and before A's scope claim — the exact
    // window the fast path relies on. True DB-level concurrency (row locks,
    // two connections, blocking on a locked row) is only exercised by the
    // RUN_DB_E2E=1 suites; what this pins is the ORDERING CONTRACT of that
    // window, not the database enforcing it.
    //
    // WHAT IT MODELS: both requests target the SAME user's one active cart
    // (user-1). The cart mocks honour the service's real query shapes — the
    // header/final reads must carry `where: { userId, status: 'ACTIVE' }` (any
    // other user gets `null`, i.e. a different, empty cart), and the lost-claim
    // re-read must be the id-scoped `{ select: { storeId: true } }` query. B
    // runs inside A's window: it resolves Store B, wins the null-guarded claim
    // on the still-unscoped cart and writes its line to Store B. A then
    // resumes, resolves Store A, loses the claim (the cart is already scoped),
    // re-reads the committed store and writes its line to Store B as well.
    //
    // DELIBERATELY CHANGING STORE SELECTION: production resolves the FIRST
    // ACTIVE STORE (`orderBy createdAt asc`), so two back-to-back resolutions
    // return the SAME id unless the active-store set changed in between (a
    // store deactivated, another activated). The mock therefore returns a
    // DIFFERENT selection result for A's call than for B's — an unusual,
    // changing result that is required for the test to mean anything: with
    // identical resolutions, "the loser adopts the committed store" would be
    // indistinguishable from "the loser writes its own resolution". The two
    // requests add DIFFERENT variants so both genuinely create lines without
    // colliding on the real `(cartId, variantId, storeId)` unique key.
    const STORE_A_ID = '00000000-0000-4000-8000-00000000000a';
    const STORE_B_ID = '00000000-0000-4000-8000-00000000000b';
    const VARIANT_B_ID = '00000000-0000-4000-8000-000000000003';

    let dbCartStoreId: string | null = null; // the committed cart.storeId
    let current: 'A' | 'B' = 'A'; // which request is executing right now
    let bStarted = false;
    const lines: Array<{
      id: string;
      cartId: string;
      variantId: string;
      storeId: string;
      quantity: number;
      unitPriceInPaise: number;
    }> = [];
    const events: string[] = [];
    const claimResults: number[] = [];
    const claimTargets: string[] = [];
    const createdStores: string[] = [];

    prisma.cart.findFirst.mockImplementation(
      async (args: {
        where: { userId?: string; status?: string; id?: string };
        select?: Record<string, unknown>;
        include?: unknown;
      }) => {
        if (args.where.id !== undefined) {
          // Lost-claim re-read: id-scoped, storeId only.
          expect(args).toEqual({ where: { id: 'cart-1' }, select: { storeId: true } });
          events.push(`reread:${current}:${dbCartStoreId}`);
          return { storeId: dbCartStoreId };
        }
        // Header and final reads are user-scoped exactly as the service issues them.
        expect(args.where).toEqual({ userId: 'user-1', status: 'ACTIVE' });
        if (args.select !== undefined) {
          // Header read: the committed store as stored RIGHT NOW.
          events.push(`header:${current}:store=${dbCartStoreId ?? 'null'}`);
          return { id: 'cart-1', storeId: dbCartStoreId, status: 'ACTIVE', couponId: null };
        }
        // Final authoritative read (getCurrentCart): whatever is committed.
        return {
          ...cart(),
          storeId: dbCartStoreId,
          items: lines.map((line) => ({
            ...line,
            createdAt: new Date(),
            updatedAt: new Date(),
            variant: variant(line.variantId, '500 g', line.unitPriceInPaise, true),
          })),
          coupon: null,
        };
      },
    );
    prisma.cart.updateMany.mockImplementation(
      async ({
        where,
        data,
      }: {
        where: { id: string; storeId: string | null };
        data: { storeId: string };
      }) => {
        // The conditional claim, exactly as issued: `WHERE store_id IS NULL`.
        expect(where).toEqual({ id: 'cart-1', storeId: null });
        claimTargets.push(data.storeId);
        const won = dbCartStoreId === null;
        if (won) {
          dbCartStoreId = data.storeId;
        }
        claimResults.push(won ? 1 : 0);
        events.push(`claim:${current}:${won ? 1 : 0}`);
        return { count: won ? 1 : 0 };
      },
    );
    prisma.store.findFirst.mockImplementation(async () => {
      if (!bStarted) {
        bStarted = true;
        // ---- Request B runs ENTIRELY inside A's window ----
        // A has already read the header (storeId: null) and is paused here in
        // its store resolution, BEFORE its claim; B resolves Store B, claims
        // the null-scoped cart and writes its line to Store B.
        current = 'B';
        await service.addItem('user-1', { variantId: VARIANT_B_ID, quantity: 1 });
        current = 'A';
        // A's own (differing) resolution lands only after B has committed.
        events.push(`resolve:A:${STORE_A_ID}`);
        return { id: STORE_A_ID };
      }
      events.push(`resolve:B:${STORE_B_ID}`);
      return { id: STORE_B_ID };
    });
    prisma.productVariant.findFirst.mockImplementation(
      async ({ where }: { where: { id: string } }) => variant(where.id, '500 g', 2400, true),
    );
    prisma.cartItem.findFirst.mockImplementation(
      async ({ where }: { where: { cartId: string; variantId: string; storeId: string } }) =>
        // Same predicate as the service's cap lookup (cartId, variantId, storeId).
        lines.find(
          (line) =>
            line.cartId === where.cartId &&
            line.variantId === where.variantId &&
            line.storeId === where.storeId,
        ) ?? null,
    );
    prisma.cartItem.count.mockImplementation(
      async ({ where }: { where: { cartId: string } }) =>
        lines.filter((line) => line.cartId === where.cartId).length,
    );
    prisma.cartItem.create.mockImplementation(
      async ({
        data,
      }: {
        data: {
          cartId: string;
          variantId: string;
          storeId: string;
          quantity: number;
          unitPriceInPaise: number;
        };
      }) => {
        const line = { id: `line-${lines.length + 1}`, ...data };
        lines.push(line);
        createdStores.push(data.storeId);
        events.push(`line:${current}:${data.storeId}:${data.variantId}`);
        return line;
      },
    );

    const resultA = await service.addItem('user-1', { variantId: VARIANT_ID, quantity: 1 });

    // Claim results [1, 0]: B won the null-guarded claim, A lost it — and A
    // attempted its OWN resolution (Store A), so the loss is not a no-op.
    expect(claimResults).toEqual([1, 0]);
    expect(claimTargets).toEqual([STORE_B_ID, STORE_A_ID]);
    // The cart ends scoped to Store B: B's committed write is never overwritten.
    expect(dbCartStoreId).toBe(STORE_B_ID);
    // BOTH lines are on Store B — A's line follows the COMMITTED store, not
    // its own (differing) resolution, so cart.storeId and line.storeId cannot
    // diverge even when the two requests resolve different stores.
    expect(createdStores).toEqual([STORE_B_ID, STORE_B_ID]);
    // The exact ordering that produced those results (mock-level sequencing,
    // not database-enforced concurrency).
    expect(events).toEqual([
      'header:A:store=null',
      'header:B:store=null',
      `resolve:B:${STORE_B_ID}`,
      'claim:B:1',
      `line:B:${STORE_B_ID}:${VARIANT_B_ID}`,
      `resolve:A:${STORE_A_ID}`,
      'claim:A:0',
      `reread:A:${STORE_B_ID}`,
      `line:A:${STORE_B_ID}:${VARIANT_ID}`,
    ]);
    // A's authoritative response read sees both committed lines.
    expect(resultA.items).toHaveLength(2);
    expect(resultA.items.map((item) => item.variantId)).toEqual([VARIANT_B_ID, VARIANT_ID]);
  });

  it('updateItem proves ownership with a single filtered read on the happy path', async () => {
    prisma.cartItem.findFirst.mockResolvedValue({ id: 'item-1' });
    prisma.cartItem.update.mockResolvedValue({} as any);
    prisma.cart.findFirst.mockResolvedValue({ ...cart(), items: [], coupon: null });

    const result = await service.updateItem('user-1', 'item-1', { quantity: 4 });

    // One statement for ownership + cart-active proof, one for the write.
    expect(prisma.cartItem.findFirst).toHaveBeenCalledTimes(1);
    const args = prisma.cartItem.findFirst.mock.calls[0]![0] as {
      where: unknown;
      select?: unknown;
    };
    expect(args.select).toEqual({ id: true });
    expect(args.where).toEqual({ id: 'item-1', cart: { userId: 'user-1', status: 'ACTIVE' } });
    expect(prisma.cartItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: { quantity: 4 },
    });
    expect(result.items).toHaveLength(0);
  });

  it('updateItem enforces the per-line cap before writing', async () => {
    prisma.cartItem.findFirst.mockResolvedValue({ id: 'item-1' });

    await expect(
      service.updateItem('user-1', 'item-1', { quantity: 11 }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.cartItem.update).not.toHaveBeenCalled();
    expect(prisma.cart.findFirst).not.toHaveBeenCalled(); // no final read after a rejection
  });

  it('updateItem keeps 404 / 400 / 409 distinctions when the fast path misses', async () => {
    prisma.cartItem.findFirst.mockResolvedValueOnce(null).mockResolvedValue(null);
    await expect(service.updateItem('user-1', 'missing', { quantity: 2 })).rejects.toBeInstanceOf(
      NotFoundException,
    );

    prisma.cartItem.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ id: 'item-1', cart: { userId: 'someone-else', status: 'ACTIVE' } } as any);
    await expect(service.updateItem('user-1', 'item-1', { quantity: 2 })).rejects.toBeInstanceOf(
      BadRequestException,
    );

    prisma.cartItem.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ id: 'item-1', cart: { userId: 'user-1', status: 'CONVERTED' } } as any);
    await expect(service.updateItem('user-1', 'item-1', { quantity: 2 })).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(prisma.cartItem.update).not.toHaveBeenCalled();
  });

  it('removes an applied coupon', async () => {
    prisma.cart.findFirst
      .mockResolvedValueOnce({ ...cart(), couponId: 'coupon-1' })
      .mockResolvedValue({ ...cart(), coupon: null });
    prisma.cart.update.mockResolvedValue({} as any);

    const result = await service.removeCoupon('user-1');

    expect(result.coupon).toBeNull();
    expect(prisma.cart.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { couponId: null } }),
    );
  });
});

type PrismaMock = ReturnType<typeof createPrismaMock>;

// Minimal hand-rolled mocks to avoid pulling in a real DB.
function createPrismaMock() {
  return {
    cart: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    store: {
      findFirst: vi.fn(),
    },
    cartItem: {
      findFirst: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    productVariant: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    coupon: {
      findFirst: vi.fn(),
    },
    couponRedemption: {
      count: vi.fn(),
    },
    $transaction: vi.fn(),
  };
}

function totalPrismaCalls(prisma: ReturnType<typeof createPrismaMock>): number {
  let count = 0;
  for (const service of Object.values(prisma)) {
    if (service && typeof service === 'object') {
      for (const mock of Object.values(service as Record<string, unknown>)) {
        if (typeof mock === 'function') {
          count += (mock as ReturnType<typeof vi.fn>).mock.calls.length;
        }
      }
    }
  }
  return count;
}

export { createPrismaMock, totalPrismaCalls, type PrismaMock };
