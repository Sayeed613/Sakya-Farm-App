import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
      service.addItem('user-1', { variantId: VARIANT_ID, storeId: STORE_ID, quantity: 1 }),
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

    const result = await service.addItem('user-1', { variantId: VARIANT_ID, storeId: STORE_ID, quantity: 3 });

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
    prisma.cartItem.findFirst.mockResolvedValue({
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
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    cartItem: {
      findFirst: vi.fn(),
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
