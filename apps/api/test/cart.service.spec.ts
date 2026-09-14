import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../src/generated/prisma/client';
import { CartService } from '../src/modules/cart/cart.service';
import { PrismaService } from '../src/database/prisma.service';

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

    expect(result.subtotalInPaise).toBe(2 * 2400);
    expect(result.discountInPaise).toBe(0);
    expect(result.taxInPaise).toBe(0);
    expect(result.shippingInPaise).toBe(0);
    expect(result.totalInPaise).toBe(2 * 2400);
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
    expect(result.discountInPaise).toBe(240);
    expect(result.totalInPaise).toBe(2400 - 240);
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
    expect(result.totalInPaise).toBe(0);
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
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    productVariant: {
      findFirst: vi.fn(),
    },
    coupon: {
      findFirst: vi.fn(),
    },
    couponRedemption: {
      count: vi.fn(),
    },
  };
}

export { createPrismaMock, type PrismaMock };
