import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrdersService } from '../src/modules/orders/orders.service';
import { PrismaService } from '../src/database/prisma.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { CartService } from '../src/modules/cart/cart.service';

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

function cart(userId = 'user-1', id = 'cart-1', items?: Array<{ id: string; variantId: string; quantity: number; unitPriceInPaise: number; variant: any }>, coupon: any = null) {
  return {
    id,
    userId,
    anonymousId: null as string | null,
    status: 'ACTIVE' as const,
    currency: 'INR',
    expiresAt: null as Date | null,
    items: items ?? [],
    coupon,
  } as unknown as ReturnType<CartService['getCurrentCart']>;
}

function variant(variantId: string, price = 2400) {
  return {
    id: variantId,
    priceInPaise: price,
    isAvailable: true,
    sku: 'SKU-1',
    title: '500 g',
    product: { title: 'Mango', status: 'ACTIVE' as const, isAvailable: true },
  };
}

function cartWithItems(...specs: Array<{ id: string; variantId: string; quantity: number; unitPriceInPaise: number; categorySlugs?: string[] }>) {
  return cart('user-1', 'cart-1', specs.map((spec) => ({
    id: spec.id,
    variantId: spec.variantId,
    quantity: spec.quantity,
    unitPriceInPaise: spec.unitPriceInPaise,
    categorySlugs: spec.categorySlugs ?? [],
    variant: variant(spec.variantId, spec.unitPriceInPaise),
  })));
}

describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let cartService: { getCurrentCart: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    prisma = createPrismaMock();
    cartService = {
      getCurrentCart: vi.fn(),
    };
    const testModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: configMock() },
        { provide: CartService, useValue: cartService },
        { provide: NotificationsService, useValue: { sendOrderStatusPush: vi.fn(async () => undefined) } },
      ],
    })
      .overrideProvider(PrismaService).useValue(prisma)
      .overrideProvider(CartService).useValue(cartService)
      .overrideProvider(NotificationsService).useValue({ sendOrderStatusPush: vi.fn(async () => undefined) })
      .compile();
    service = testModule.get(OrdersService) as OrdersService;
  });

  it('rejects checkout when the cart is empty', async () => {
    // Idempotency is checked before the cart, so a safe retry of a checkout
    // whose first attempt succeeded (and emptied the cart) still resolves to
    // the original order — the lookup must therefore run first here too.
    prisma.payment.findFirst.mockResolvedValue(null);
    cartService.getCurrentCart.mockResolvedValue(cart());

    await expect(
      service.checkout('user-1', {
        idempotencyKey: 'key-1',
        shippingAddress: { line1: 'Home', postalCode: '500001' },
        notes: null,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects fresh-produce checkout outside Bengaluru before creating an order', async () => {
    prisma.payment.findFirst.mockResolvedValue(null);
    cartService.getCurrentCart.mockResolvedValue(
      cartWithItems({
        id: 'i1',
        variantId: 'v1',
        quantity: 1,
        unitPriceInPaise: 2400,
        categorySlugs: ['leafy-greens'],
      }),
    );

    await expect(
      service.checkout('user-1', {
        idempotencyKey: 'fresh-outside-bengaluru',
        shippingAddress: { line1: 'Home', postalCode: '400001' },
        notes: null,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('places an order with server-computed totals and a MANUAL PENDING payment', async () => {
    cartService.getCurrentCart.mockResolvedValue(
      cartWithItems({ id: 'i1', variantId: 'v1', quantity: 2, unitPriceInPaise: 2400 })
    );
    prisma.payment.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
    prisma.cart.findUnique.mockResolvedValue({
      storeId: 'store-1',
      couponId: null,
      store: { id: 'store-1', isActive: true },
    });
    prisma.inventory.findUnique.mockResolvedValue({
      id: 'inv-1',
      variantId: 'v1',
      storeId: 'store-1',
      quantityOnHand: 10,
    });

    prisma.order.create.mockImplementation(async (args: any) => ({
      ...args,
      id: 'order-1',
      orderNumber: 'ORD-001',
      userId: 'user-1',
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
      currency: 'INR',
      subtotalInPaise: 4800,
      discountInPaise: 0,
      taxInPaise: 240,
      shippingInPaise: 4900,
      totalInPaise: 9940,
      shippingAddress: { line1: 'Home', postalCode: '500001' },
      billingAddress: undefined,
      notes: null,
      placedAt: null,
      cancelledAt: null,
      deliveredAt: null,
      cancelReason: null,
      createdAt: new Date('2026-09-12T00:00:00Z'),
      updatedAt: new Date('2026-09-12T00:00:00Z'),
      items: [
        {
          id: 'oi-1',
          productTitle: 'Mango',
          variantTitle: '500 g',
          sku: 'SKU-1',
          quantity: 2,
          unitPriceInPaise: 2400,
          discountInPaise: 0,
          taxInPaise: 0,
          totalInPaise: 4800,
        },
      ],
      payments: [],
      statusHistory: [],
      coupon: null,
    }) as any);

    prisma.order.findFirst.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'ORD-001',
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
      currency: 'INR',
      subtotalInPaise: 4800,
      discountInPaise: 0,
      taxInPaise: 240,
      shippingInPaise: 4900,
      totalInPaise: 9940,
      shippingAddress: { line1: 'Home', postalCode: '500001' },
      billingAddress: null,
      notes: null,
      placedAt: null,
      cancelledAt: null,
      deliveredAt: null,
      cancelReason: null,
      createdAt: new Date('2026-09-12T00:00:00Z'),
      updatedAt: new Date('2026-09-12T00:00:00Z'),
      items: [{
        id: 'oi-1',
        productTitle: 'Mango',
        variantTitle: '500 g',
        sku: 'SKU-1',
        quantity: 2,
        unitPriceInPaise: 2400,
        discountInPaise: 0,
        taxInPaise: 0,
        totalInPaise: 4800,
      }],
      payments: [{
        id: 'pay-1',
        provider: 'MANUAL',
        method: 'CASH_ON_DELIVERY',
        status: 'PENDING',
        currency: 'INR',
        amountInPaise: 4800,
        refundedInPaise: 0,
        failureReason: null,
        capturedAt: null,
        refundedAt: null,
        providerPaymentId: null,
      }],
      statusHistory: [],
      coupon: null,
    } as any);

    const result = await service.checkout('user-1', {
      idempotencyKey: 'key-1',
      shippingAddress: { line1: 'Home', postalCode: '500001' },
      billingAddress: undefined,
      notes: null,
    });

    expect(result.orderNumber).toBe('ORD-001');
    expect(result.status).toBe('PENDING_PAYMENT');
    expect(result.totalInPaise).toBe(9940);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.productTitle).toBe('Mango');
    expect(result.payments).toHaveLength(1);
    expect(result.payments[0]!.provider).toBe('MANUAL');
    expect(result.payments[0]!.status).toBe('PENDING');
    // Idempotency key is internal and must never leak to the client.
    expect((result.payments[0] as unknown as { idempotencyKey?: string }).idempotencyKey).toBeUndefined();
  });

  it('empties the server cart inside the checkout transaction', async () => {
    cartService.getCurrentCart.mockResolvedValue(
      cartWithItems({ id: 'i1', variantId: 'v1', quantity: 2, unitPriceInPaise: 2400 }),
    );
    prisma.payment.findFirst.mockResolvedValue(null);
    // The transaction callback receives the prisma mock itself, plus the two
    // cart-clearing writes the checkout must perform.
    const tx = {
      ...prisma,
      cartItem: {
        deleteMany: vi.fn(async () => ({ count: 1 })),
        count: vi.fn(async () => 5),
      },
      cart: { ...prisma.cart, update: vi.fn(async () => ({})) },
      coupon: {
        findUnique: vi.fn(async () => ({
          id: 'coupon-1',
          isActive: true,
          startsAt: null,
          endsAt: null,
          usageLimit: null,
          perUserLimit: 1,
        })),
        update: vi.fn(async () => ({})),
      },
      couponRedemption: {
        ...prisma.couponRedemption,
        count: vi.fn(async () => 0),
        create: vi.fn(async () => ({})),
      },
    };
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(tx));
    prisma.cart.findUnique.mockResolvedValue({
      storeId: 'store-1',
      couponId: 'coupon-1',
      store: { id: 'store-1', isActive: true },
    });
    prisma.inventory.findUnique.mockResolvedValue({
      id: 'inv-1',
      variantId: 'v1',
      storeId: 'store-1',
      quantityOnHand: 10,
    });
    prisma.order.create.mockImplementation(async (args: any) => ({
      ...args,
      id: 'order-1',
      orderNumber: 'ORD-CLEAR',
      userId: 'user-1',
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
      currency: 'INR',
      subtotalInPaise: 4800,
      discountInPaise: 0,
      taxInPaise: 240,
      shippingInPaise: 4900,
      totalInPaise: 9940,
      items: [],
      payments: [],
      statusHistory: [],
      coupon: null,
    }) as any);
    prisma.order.findFirst.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'ORD-CLEAR',
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
      currency: 'INR',
      subtotalInPaise: 4800,
      discountInPaise: 0,
      taxInPaise: 240,
      shippingInPaise: 4900,
      totalInPaise: 9940,
      shippingAddress: { line1: 'Home', postalCode: '500001' },
      billingAddress: null,
      notes: null,
      placedAt: null,
      cancelledAt: null,
      deliveredAt: null,
      cancelReason: null,
      createdAt: new Date('2026-09-12T00:00:00Z'),
      updatedAt: new Date('2026-09-12T00:00:00Z'),
      items: [],
      payments: [],
      statusHistory: [],
      coupon: null,
    } as any);

    await service.checkout('user-1', {
      idempotencyKey: 'key-clear',
      shippingAddress: { line1: 'Home', postalCode: '500001' },
      billingAddress: undefined,
      notes: null,
    });

    // Minimal cart cleanup only — pricing/stock assertions live elsewhere.
    expect(tx.cartItem.deleteMany).toHaveBeenCalledWith({ where: { cartId: 'cart-1' } });
    expect(tx.cart.update).toHaveBeenCalledWith({ where: { id: 'cart-1' }, data: { couponId: null } });
  });

  it('recomputes totals with a percentage coupon at checkout', async () => {
    cartService.getCurrentCart.mockResolvedValue({
      ...cartWithItems({ id: 'i1', variantId: 'v1', quantity: 1, unitPriceInPaise: 2400 }, {
        id: 'i2',
        variantId: 'v2',
        quantity: 1,
        unitPriceInPaise: 2400,
      }),
      coupon: { id: 'coupon-1', code: 'SAVE10', type: 'PERCENTAGE', valueInPaise: 1000 } as any,
    });
    prisma.payment.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
    prisma.cart.findUnique.mockResolvedValue({
      storeId: 'store-1',
      couponId: null,
      store: { id: 'store-1', isActive: true },
    });
    prisma.inventory.findUnique.mockResolvedValue({
      id: 'inv-1',
      variantId: 'v1',
      storeId: 'store-1',
      quantityOnHand: 10,
    });

    prisma.order.create.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'ORD-002',
      userId: 'user-1',
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
      currency: 'INR',
      subtotalInPaise: 4800,
      discountInPaise: 480,
      taxInPaise: 216,
      shippingInPaise: 4900,
      totalInPaise: 9436,
      shippingAddress: { line1: 'Home', postalCode: '500001' },
      billingAddress: undefined,
      notes: null,
      placedAt: null,
      cancelledAt: null,
      deliveredAt: null,
      cancelReason: null,
      createdAt: new Date('2026-09-12T00:00:00Z'),
      updatedAt: new Date('2026-09-12T00:00:00Z'),
      items: [
        {
          id: 'oi-1',
          productTitle: 'Mango',
          variantTitle: '500 g',
          sku: 'SKU-1',
          quantity: 1,
          unitPriceInPaise: 2400,
          discountInPaise: 0,
          taxInPaise: 0,
          totalInPaise: 2400,
        },
        {
          id: 'oi-2',
          productTitle: 'Mango',
          variantTitle: '500 g',
          sku: 'SKU-1',
          quantity: 1,
          unitPriceInPaise: 2400,
          discountInPaise: 0,
          taxInPaise: 0,
          totalInPaise: 2400,
        },
      ],
      payments: [],
      statusHistory: [],
      coupon: { id: 'coupon-1', code: 'SAVE10', type: 'PERCENTAGE', value: 1000 } as any,
    } as any);

    prisma.order.findFirst.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'ORD-002',
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
      currency: 'INR',
      subtotalInPaise: 4800,
      discountInPaise: 480,
      taxInPaise: 216,
      shippingInPaise: 4900,
      totalInPaise: 9436,
      shippingAddress: { line1: 'Home', postalCode: '500001' },
      billingAddress: null,
      notes: null,
      placedAt: null,
      cancelledAt: null,
      deliveredAt: null,
      cancelReason: null,
      createdAt: new Date('2026-09-12T00:00:00Z'),
      updatedAt: new Date('2026-09-12T00:00:00Z'),
      items: [
        {
          id: 'oi-1',
          productTitle: 'Mango',
          variantTitle: '500 g',
          sku: 'SKU-1',
          quantity: 1,
          unitPriceInPaise: 2400,
          discountInPaise: 0,
          taxInPaise: 0,
          totalInPaise: 2400,
        },
        {
          id: 'oi-2',
          productTitle: 'Mango',
          variantTitle: '500 g',
          sku: 'SKU-1',
          quantity: 1,
          unitPriceInPaise: 2400,
          discountInPaise: 0,
          taxInPaise: 0,
          totalInPaise: 2400,
        },
      ],
      payments: [],
      statusHistory: [],
      coupon: { id: 'coupon-1', code: 'SAVE10', type: 'PERCENTAGE', value: 1000 } as any,
    } as any);

    const result = await service.checkout('user-1', {
      idempotencyKey: 'key-2',
      shippingAddress: { line1: 'Home', postalCode: '500001' },
      billingAddress: undefined,
      notes: null,
    });

    expect(result.subtotalInPaise).toBe(4800);
    expect(result.discountInPaise).toBe(480);
    expect(result.taxInPaise).toBe(216);
    expect(result.shippingInPaise).toBe(4900);
    expect(result.totalInPaise).toBe(9436);
  });

  it('requires an active fulfilment store on the cart before checkout', async () => {
    cartService.getCurrentCart.mockResolvedValue(
      cartWithItems({ id: 'i1', variantId: 'v1', quantity: 1, unitPriceInPaise: 2400 }),
    );
    prisma.payment.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
    prisma.cart.findUnique.mockResolvedValue({
      storeId: 'store-1',
      couponId: null,
      store: { id: 'store-1', isActive: false },
    });

    await expect(
      service.checkout('user-1', {
        idempotencyKey: 'key-store',
        shippingAddress: { line1: 'Home', postalCode: '500001' },
        notes: null,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Nothing may be written when the store is rejected.
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it('refuses checkout when no stock is configured for the variant at the store', async () => {
    cartService.getCurrentCart.mockResolvedValue(
      cartWithItems({ id: 'i1', variantId: 'v1', quantity: 1, unitPriceInPaise: 2400 }),
    );
    prisma.payment.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
    prisma.cart.findUnique.mockResolvedValue({
      storeId: 'store-1',
      couponId: null,
      store: { id: 'store-1', isActive: true },
    });
    prisma.order.create.mockResolvedValue({ id: 'order-1' } as any);
    prisma.inventory.findUnique.mockResolvedValue(null);

    await expect(
      service.checkout('user-1', {
        idempotencyKey: 'key-nostock',
        shippingAddress: { line1: 'Home', postalCode: '500001' },
        notes: null,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('refuses checkout when the atomic reserve guard finds insufficient stock', async () => {
    cartService.getCurrentCart.mockResolvedValue(
      cartWithItems({ id: 'i1', variantId: 'v1', quantity: 5, unitPriceInPaise: 2400 }),
    );
    prisma.payment.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
    prisma.cart.findUnique.mockResolvedValue({
      storeId: 'store-1',
      couponId: null,
      store: { id: 'store-1', isActive: true },
    });
    prisma.order.create.mockResolvedValue({ id: 'order-1' } as any);
    prisma.inventory.findUnique.mockResolvedValue({
      id: 'inv-1',
      variantId: 'v1',
      storeId: 'store-1',
      quantityOnHand: 3,
    });
    // The conditional UPDATE matched no row: available < requested.
    prisma.$executeRaw.mockResolvedValue(0);

    await expect(
      service.checkout('user-1', {
        idempotencyKey: 'key-short',
        shippingAddress: { line1: 'Home', postalCode: '500001' },
        notes: null,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('reserves stock and records a RESERVATION movement when an order is placed', async () => {
    cartService.getCurrentCart.mockResolvedValue(
      cartWithItems({ id: 'i1', variantId: 'v1', quantity: 2, unitPriceInPaise: 2400 }),
    );
    prisma.payment.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
    prisma.cart.findUnique.mockResolvedValue({
      storeId: 'store-1',
      couponId: null,
      store: { id: 'store-1', isActive: true },
    });
    prisma.order.create.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'ORD-003',
      userId: 'user-1',
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
      currency: 'INR',
      subtotalInPaise: 4800,
      discountInPaise: 0,
      taxInPaise: 240,
      shippingInPaise: 4900,
      totalInPaise: 9940,
      shippingAddress: { line1: 'Home', postalCode: '500001' },
      billingAddress: null,
      notes: null,
      placedAt: null,
      cancelledAt: null,
      deliveredAt: null,
      cancelReason: null,
      createdAt: new Date('2026-09-12T00:00:00Z'),
      updatedAt: new Date('2026-09-12T00:00:00Z'),
      items: [],
      payments: [],
      statusHistory: [],
      coupon: null,
    } as any);
    prisma.order.findFirst.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'ORD-003',
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
      currency: 'INR',
      subtotalInPaise: 4800,
      discountInPaise: 0,
      taxInPaise: 240,
      shippingInPaise: 4900,
      totalInPaise: 9940,
      shippingAddress: { line1: 'Home', postalCode: '500001' },
      billingAddress: null,
      notes: null,
      placedAt: null,
      cancelledAt: null,
      deliveredAt: null,
      cancelReason: null,
      createdAt: new Date('2026-09-12T00:00:00Z'),
      updatedAt: new Date('2026-09-12T00:00:00Z'),
      items: [],
      payments: [],
      statusHistory: [],
      coupon: null,
    } as any);
    prisma.inventory.findUnique.mockResolvedValue({
      id: 'inv-1',
      variantId: 'v1',
      storeId: 'store-1',
      quantityOnHand: 10,
    });

    await service.checkout('user-1', {
      idempotencyKey: 'key-reserve',
      shippingAddress: { line1: 'Home', postalCode: '500001' },
      notes: null,
    });

    // The order must reference the fulfilment store it reserved against.
    expect(prisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ storeId: 'store-1' }),
      }),
    );

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.inventoryMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'RESERVATION',
          quantityDelta: 2,
          referenceType: 'ORDER',
          referenceId: 'order-1',
        }),
      }),
    );
  });

  // ---------------------------------------------------------------------
  // Concurrency regressions: one cart must never produce two orders, and a
  // coupon claim must be atomic with the order that consumes it.
  // ---------------------------------------------------------------------

  it('locks the cart row before creating the order', async () => {
    cartService.getCurrentCart.mockResolvedValue(
      cartWithItems({ id: 'i1', variantId: 'v1', quantity: 1, unitPriceInPaise: 2400 }),
    );
    prisma.payment.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
    prisma.cart.findUnique.mockResolvedValue({
      storeId: 'store-1',
      couponId: null,
      store: { id: 'store-1', isActive: true },
    });
    prisma.inventory.findUnique.mockResolvedValue({
      id: 'inv-1',
      variantId: 'v1',
      storeId: 'store-1',
      quantityOnHand: 10,
    });
    prisma.order.create.mockResolvedValue({ id: 'order-lock' } as any);
    prisma.order.findFirst.mockResolvedValue({
      id: 'order-lock',
      orderNumber: 'ORD-LOCK',
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
      currency: 'INR',
      subtotalInPaise: 2400,
      discountInPaise: 0,
      taxInPaise: 0,
      shippingInPaise: 0,
      totalInPaise: 2400,
      shippingAddress: {},
      billingAddress: null,
      notes: null,
      placedAt: null,
      cancelledAt: null,
      deliveredAt: null,
      cancelReason: null,
      createdAt: new Date('2026-09-12T00:00:00Z'),
      updatedAt: new Date('2026-09-12T00:00:00Z'),
      items: [],
      payments: [],
      statusHistory: [],
      coupon: null,
    } as any);

    await service.checkout('user-1', {
      idempotencyKey: 'key-lock',
      shippingAddress: { line1: 'Home', postalCode: '500001' },
      notes: null,
    });

    // `SELECT ... FOR UPDATE` on the cart row is what serialises concurrent
    // checkouts of the same cart — without it a double tap with two different
    // idempotency keys can create two orders from one cart.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.cartItem.count).toHaveBeenCalledTimes(1);
  });

  it('refuses a second checkout when a concurrent request already emptied the cart', async () => {
    cartService.getCurrentCart.mockResolvedValue(
      cartWithItems({ id: 'i1', variantId: 'v1', quantity: 1, unitPriceInPaise: 2400 }),
    );
    // Pre-check sees no payment for this key (the winner used a different one).
    prisma.payment.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
    // But by the time the lock is granted, the cart has been consumed.
    prisma.cartItem.count.mockResolvedValue(0);

    await expect(
      service.checkout('user-1', {
        idempotencyKey: 'key-loser',
        shippingAddress: { line1: 'Home', postalCode: '500001' },
        notes: null,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it('returns the concurrent winner under the lock instead of placing twice', async () => {
    cartService.getCurrentCart.mockResolvedValue(
      cartWithItems({ id: 'i1', variantId: 'v1', quantity: 1, unitPriceInPaise: 2400 }),
    );
    // First lookup (before the transaction) misses; the second (after the
    // lock) finds the payment the winning request committed while we waited.
    prisma.payment.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ order: { id: 'order-won', status: 'PENDING_PAYMENT' } });
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
    prisma.order.findFirst.mockResolvedValue({
      id: 'order-won',
      orderNumber: 'ORD-WON',
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
      currency: 'INR',
      subtotalInPaise: 2400,
      discountInPaise: 0,
      taxInPaise: 0,
      shippingInPaise: 0,
      totalInPaise: 2400,
      shippingAddress: {},
      billingAddress: null,
      notes: null,
      placedAt: null,
      cancelledAt: null,
      deliveredAt: null,
      cancelReason: null,
      createdAt: new Date('2026-09-12T00:00:00Z'),
      updatedAt: new Date('2026-09-12T00:00:00Z'),
      items: [],
      payments: [],
      statusHistory: [],
      coupon: null,
    } as any);

    const result = await service.checkout('user-1', {
      idempotencyKey: 'key-race',
      shippingAddress: { line1: 'Home', postalCode: '500001' },
      notes: null,
    });

    expect(result.id).toBe('order-won');
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it('rejects an idempotency key whose order was cancelled instead of double-placing', async () => {
    // The key already exists on a payment row, but its order ended CANCELLED.
    // (userId, idempotencyKey) is unique, so a second payment insert would
    // fail with P2002 anyway — surface an actionable conflict up front.
    prisma.payment.findFirst.mockResolvedValue({
      order: { id: 'order-cancelled', status: 'CANCELLED' },
    });

    await expect(
      service.checkout('user-1', {
        idempotencyKey: 'key-cancelled',
        shippingAddress: { line1: 'Home', postalCode: '500001' },
        notes: null,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects checkout when the applied coupon expired after apply time', async () => {
    cartService.getCurrentCart.mockResolvedValue({
      ...cartWithItems({ id: 'i1', variantId: 'v1', quantity: 1, unitPriceInPaise: 2400 }),
      coupon: { id: 'coupon-1', code: 'EXPIRED', type: 'FIXED_AMOUNT', valueInPaise: 500 } as any,
    });
    prisma.payment.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
    prisma.cart.findUnique.mockResolvedValue({
      storeId: 'store-1',
      couponId: 'coupon-1',
      store: { id: 'store-1', isActive: true },
    });
    // Re-validated inside the transaction: window already closed.
    prisma.coupon.findUnique.mockResolvedValue({
      id: 'coupon-1',
      isActive: true,
      startsAt: null,
      endsAt: new Date(Date.now() - 60_000),
      usageLimit: null,
      perUserLimit: 1,
    });

    await expect(
      service.checkout('user-1', {
        idempotencyKey: 'key-expired-coupon',
        shippingAddress: { line1: 'Home', postalCode: '500001' },
        notes: null,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.order.create).not.toHaveBeenCalled();
    expect(prisma.couponRedemption.create).not.toHaveBeenCalled();
  });

  it('rejects checkout when the coupon per-user limit was reached concurrently', async () => {
    cartService.getCurrentCart.mockResolvedValue({
      ...cartWithItems({ id: 'i1', variantId: 'v1', quantity: 1, unitPriceInPaise: 2400 }),
      coupon: { id: 'coupon-1', code: 'ONCE', type: 'FIXED_AMOUNT', valueInPaise: 500 } as any,
    });
    prisma.payment.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
    prisma.cart.findUnique.mockResolvedValue({
      storeId: 'store-1',
      couponId: 'coupon-1',
      store: { id: 'store-1', isActive: true },
    });
    prisma.coupon.findUnique.mockResolvedValue({
      id: 'coupon-1',
      isActive: true,
      startsAt: null,
      endsAt: null,
      usageLimit: null,
      perUserLimit: 1,
    });
    // Another of this customer's orders already consumed the only redemption.
    prisma.couponRedemption.count.mockResolvedValue(1);

    await expect(
      service.checkout('user-1', {
        idempotencyKey: 'key-peruser',
        shippingAddress: { line1: 'Home', postalCode: '500001' },
        notes: null,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.order.create).not.toHaveBeenCalled();
    expect(prisma.couponRedemption.create).not.toHaveBeenCalled();
  });

  it('rejects checkout when the coupon global usage limit is taken atomically', async () => {
    cartService.getCurrentCart.mockResolvedValue({
      ...cartWithItems({ id: 'i1', variantId: 'v1', quantity: 1, unitPriceInPaise: 2400 }),
      coupon: { id: 'coupon-1', code: 'LAST', type: 'FIXED_AMOUNT', valueInPaise: 500 } as any,
    });
    prisma.payment.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
    prisma.cart.findUnique.mockResolvedValue({
      storeId: 'store-1',
      couponId: 'coupon-1',
      store: { id: 'store-1', isActive: true },
    });
    prisma.coupon.findUnique.mockResolvedValue({
      id: 'coupon-1',
      isActive: true,
      startsAt: null,
      endsAt: null,
      usageLimit: 1,
      perUserLimit: 5,
    });
    prisma.inventory.findUnique.mockResolvedValue({
      id: 'inv-1',
      variantId: 'v1',
      storeId: 'store-1',
      quantityOnHand: 10,
    });
    prisma.order.create.mockResolvedValue({ id: 'order-claim' } as any);
    // The FIRST raw UPDATE is the coupon claim (it now runs before the order
    // insert); it matches NO row because a concurrent checkout took the last
    // allowed redemption between apply time and now.
    prisma.$executeRaw.mockResolvedValueOnce(0);

    await expect(
      service.checkout('user-1', {
        idempotencyKey: 'key-claim',
        shippingAddress: { line1: 'Home', postalCode: '500001' },
        notes: null,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    // The claim failed before any order row was written.
    expect(prisma.order.create).not.toHaveBeenCalled();
    expect(prisma.couponRedemption.create).not.toHaveBeenCalled();
    expect(prisma.cartItem.deleteMany).not.toHaveBeenCalled();
  });

  it('releases the reservation exactly once when an order is cancelled', async () => {
    prisma.order.findFirst.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'ORD-004',
      userId: 'user-1',
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
      currency: 'INR',
      subtotalInPaise: 4800,
      discountInPaise: 0,
      taxInPaise: 240,
      shippingInPaise: 4900,
      totalInPaise: 9940,
      shippingAddress: { line1: 'Home', postalCode: '500001' },
      billingAddress: null,
      notes: null,
      placedAt: null,
      cancelledAt: null,
      deliveredAt: null,
      cancelReason: null,
      createdAt: new Date('2026-09-12T00:00:00Z'),
      updatedAt: new Date('2026-09-12T00:00:00Z'),
      items: [],
      payments: [],
      statusHistory: [],
      coupon: null,
    } as any);

    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
    prisma.order.update.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'ORD-004',
      userId: 'user-1',
      status: 'CANCELLED',
      paymentStatus: 'PENDING',
      currency: 'INR',
      subtotalInPaise: 4800,
      discountInPaise: 0,
      taxInPaise: 240,
      shippingInPaise: 4900,
      totalInPaise: 9940,
      shippingAddress: { line1: 'Home', postalCode: '500001' },
      billingAddress: null,
      notes: null,
      placedAt: null,
      cancelledAt: new Date('2026-09-12T00:01:00Z'),
      deliveredAt: null,
      cancelReason: 'Changed mind',
      createdAt: new Date('2026-09-12T00:00:00Z'),
      updatedAt: new Date('2026-09-12T00:01:00Z'),
      items: [],
      payments: [],
      statusHistory: [],
      coupon: null,
    } as any);

    // The release reads the order's store and lines from inside the transaction.
    prisma.order.findUnique.mockResolvedValue({
      storeId: 'store-1',
      items: [{ variantId: 'v1', quantity: 2 }],
    } as any);
    prisma.inventory.findUnique.mockResolvedValue({
      id: 'inv-1',
      variantId: 'v1',
      storeId: 'store-1',
      quantityOnHand: 10,
    });
    prisma.inventoryMovement.findFirst.mockResolvedValue(null);
    prisma.inventory.updateMany.mockResolvedValue({ count: 1 });

    await service.cancelOrder('order-1', 'user-1', 'Changed mind');

    expect(prisma.inventory.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inv-1', quantityReserved: { gte: 2 } },
        data: { quantityReserved: { decrement: 2 } },
      }),
    );
    expect(prisma.inventoryMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'RESERVATION_RELEASE',
          quantityDelta: -2,
          referenceId: 'order-1',
        }),
      }),
    );
  });

  it('does not release a reservation twice when an order is cancelled repeatedly', async () => {
    prisma.order.findFirst.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'ORD-005',
      userId: 'user-1',
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
      currency: 'INR',
      subtotalInPaise: 4800,
      discountInPaise: 0,
      taxInPaise: 240,
      shippingInPaise: 4900,
      totalInPaise: 9940,
      shippingAddress: { line1: 'Home', postalCode: '500001' },
      billingAddress: null,
      notes: null,
      placedAt: null,
      cancelledAt: null,
      deliveredAt: null,
      cancelReason: null,
      createdAt: new Date('2026-09-12T00:00:00Z'),
      updatedAt: new Date('2026-09-12T00:00:00Z'),
      items: [],
      payments: [],
      statusHistory: [],
      coupon: null,
    } as any);

    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
    prisma.order.update.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'ORD-005',
      userId: 'user-1',
      status: 'CANCELLED',
      paymentStatus: 'PENDING',
      currency: 'INR',
      subtotalInPaise: 4800,
      discountInPaise: 0,
      taxInPaise: 240,
      shippingInPaise: 4900,
      totalInPaise: 9940,
      shippingAddress: { line1: 'Home', postalCode: '500001' },
      billingAddress: null,
      notes: null,
      placedAt: null,
      cancelledAt: new Date('2026-09-12T00:01:00Z'),
      deliveredAt: null,
      cancelReason: 'Changed mind',
      createdAt: new Date('2026-09-12T00:00:00Z'),
      updatedAt: new Date('2026-09-12T00:01:00Z'),
      items: [],
      payments: [],
      statusHistory: [],
      coupon: null,
    } as any);
    prisma.order.findUnique.mockResolvedValue({
      storeId: 'store-1',
      items: [{ variantId: 'v1', quantity: 2 }],
    } as any);
    prisma.inventory.findUnique.mockResolvedValue({
      id: 'inv-1',
      variantId: 'v1',
      storeId: 'store-1',
      quantityOnHand: 10,
    });
    // A RESERVATION_RELEASE for this order already exists in the ledger.
    prisma.inventoryMovement.findFirst.mockResolvedValue({ id: 'mov-1' } as any);

    await service.cancelOrder('order-1', 'user-1', 'Changed mind');

    expect(prisma.inventory.updateMany).not.toHaveBeenCalled();
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('is idempotent: a retried checkout returns the same order', async () => {
    cartService.getCurrentCart.mockResolvedValue(
      cartWithItems({ id: 'i1', variantId: 'v1', quantity: 2, unitPriceInPaise: 2400 }),
    );
    prisma.payment.findFirst.mockResolvedValue({
      id: 'payment-1',
      orderId: 'order-1',
      provider: 'MANUAL',
      providerPaymentId: null,
      method: 'CASH_ON_DELIVERY',
      status: 'PENDING',
      currency: 'INR',
      amountInPaise: 4800,
      refundedInPaise: 0,
      failureReason: null,
      capturedAt: null,
      refundedAt: null,
      idempotencyKey: 'key-1',
      createdAt: new Date('2026-09-12T00:00:00Z'),
      updatedAt: new Date('2026-09-12T00:00:00Z'),
      order: {
        id: 'order-1',
        userId: 'user-1',
        status: 'PENDING_PAYMENT',
      } as any,
    } as any);
    prisma.order.findFirst.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'ORD-001',
      userId: 'user-1',
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
      currency: 'INR',
      subtotalInPaise: 4800,
      discountInPaise: 0,
      taxInPaise: 240,
      shippingInPaise: 4900,
      totalInPaise: 9940,
      shippingAddress: { line1: 'Home', postalCode: '500001' },
      billingAddress: undefined,
      notes: null,
      placedAt: null,
      cancelledAt: null,
      deliveredAt: null,
      cancelReason: null,
      createdAt: new Date('2026-09-12T00:00:00Z'),
      updatedAt: new Date('2026-09-12T00:00:00Z'),
      items: [],
      payments: [],
      statusHistory: [],
      coupon: null,
    } as any);

    const result = await service.checkout('user-1', {
      idempotencyKey: 'key-1',
      shippingAddress: { line1: 'Home', postalCode: '500001' },
      billingAddress: undefined,
      notes: null,
    });

    expect(result.orderNumber).toBe('ORD-001');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns the original order on retry even after the cart was emptied', async () => {
    // Regression: checkout empties the cart in its transaction, so a retried
    // request (timeout, flaky network) arrives at an EMPTY cart. The
    // idempotency lookup must run first — otherwise the safe retry 400s and
    // looks like a failed checkout to the customer.
    cartService.getCurrentCart.mockResolvedValue(cart()); // no items
    prisma.payment.findFirst.mockResolvedValue({
      id: 'payment-1',
      orderId: 'order-1',
      idempotencyKey: 'key-1',
      order: {
        id: 'order-1',
        status: 'PENDING_PAYMENT',
      } as any,
    } as any);
    prisma.order.findFirst.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'ORD-RETRY',
      userId: 'user-1',
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
      currency: 'INR',
      subtotalInPaise: 4800,
      discountInPaise: 0,
      taxInPaise: 0,
      shippingInPaise: 4900,
      totalInPaise: 9700,
      shippingAddress: { line1: 'Home', postalCode: '500001' },
      billingAddress: null,
      notes: null,
      placedAt: null,
      cancelledAt: null,
      deliveredAt: null,
      cancelReason: null,
      createdAt: new Date('2026-09-12T00:00:00Z'),
      updatedAt: new Date('2026-09-12T00:00:00Z'),
      items: [],
      payments: [],
      statusHistory: [],
      coupon: null,
    } as any);

    const result = await service.checkout('user-1', {
      idempotencyKey: 'key-1',
      shippingAddress: { line1: 'Home', postalCode: '500001' },
      notes: null,
    });

    expect(result.orderNumber).toBe('ORD-RETRY');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(cartService.getCurrentCart).not.toHaveBeenCalled();
  });

  it('lists the caller own orders with pagination', async () => {
    prisma.order.findMany.mockResolvedValue([
      {
        id: 'order-1',
        orderNumber: 'ORD-001',
        userId: 'user-1',
        status: 'PENDING_PAYMENT',
        paymentStatus: 'PENDING',
        currency: 'INR',
        subtotalInPaise: 4800,
        discountInPaise: 0,
        taxInPaise: 0,
        shippingInPaise: 0,
        totalInPaise: 4800,
        shippingAddress: { line1: 'Home', postalCode: '500001' },
        billingAddress: null,
        notes: null,
        placedAt: null,
        cancelledAt: null,
        deliveredAt: null,
        cancelReason: null,
        createdAt: new Date('2026-09-12T00:00:00Z'),
        updatedAt: new Date('2026-09-12T00:00:00Z'),
        items: [],
        payments: [],
        statusHistory: [],
        coupon: null,
      } as any,
    ]);
    prisma.order.count.mockResolvedValue(1);

    const result = await service.listOwnOrders('user-1', { page: 1, limit: 20 });

    expect(result.items).toHaveLength(1);
    expect(result.meta.page).toBe(1);
    expect(result.meta.total).toBe(1);
  });

  it('returns 404 for an order that does not belong to the caller', async () => {
    prisma.order.findFirst.mockResolvedValue(null);

    await expect(
      service.getOrderById('order-1', 'user-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('cancels an order in PENDING_PAYMENT', async () => {
    prisma.order.findFirst.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'ORD-001',
      userId: 'user-1',
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
      currency: 'INR',
      subtotalInPaise: 4800,
      discountInPaise: 0,
      taxInPaise: 240,
      shippingInPaise: 4900,
      totalInPaise: 9940,
      shippingAddress: { line1: 'Home', postalCode: '500001' },
      billingAddress: undefined,
      notes: null,
      placedAt: null,
      cancelledAt: null,
      deliveredAt: null,
      cancelReason: null,
      createdAt: new Date('2026-09-12T00:00:00Z'),
      updatedAt: new Date('2026-09-12T00:00:00Z'),
      items: [],
      payments: [],
      statusHistory: [],
      coupon: null,
    } as any);

    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
    prisma.order.update.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'ORD-001',
      userId: 'user-1',
      status: 'CANCELLED',
      paymentStatus: 'PENDING',
      currency: 'INR',
      subtotalInPaise: 4800,
      discountInPaise: 0,
      taxInPaise: 240,
      shippingInPaise: 4900,
      totalInPaise: 9940,
      shippingAddress: { line1: 'Home', postalCode: '500001' },
      billingAddress: undefined,
      notes: null,
      placedAt: null,
      cancelledAt: new Date('2026-09-12T00:01:00Z'),
      deliveredAt: null,
      cancelReason: 'Changed mind',
      createdAt: new Date('2026-09-12T00:00:00Z'),
      updatedAt: new Date('2026-09-12T00:01:00Z'),
      items: [],
      payments: [],
      statusHistory: [],
      coupon: null,
    } as any);

    const result = await service.cancelOrder('order-1', 'user-1', 'Changed mind');

    expect(result.status).toBe('CANCELLED');
    expect(result.cancelReason).toBe('Changed mind');
  });

  it('rejects cancelling an order that is already final', async () => {
    prisma.order.findFirst.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'ORD-001',
      userId: 'user-1',
      status: 'DELIVERED',
      paymentStatus: 'CAPTURED',
      currency: 'INR',
      subtotalInPaise: 4800,
      discountInPaise: 0,
      taxInPaise: 240,
      shippingInPaise: 4900,
      totalInPaise: 9940,
      shippingAddress: { line1: 'Home', postalCode: '500001' },
      billingAddress: undefined,
      notes: null,
      placedAt: null,
      cancelledAt: null,
      deliveredAt: null,
      cancelReason: null,
      createdAt: new Date('2026-09-12T00:00:00Z'),
      updatedAt: new Date('2026-09-12T00:00:00Z'),
      items: [],
      payments: [],
      statusHistory: [],
      coupon: null,
    } as any);

    await expect(
      service.cancelOrder('order-1', 'user-1', 'Changed mind'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects cancelling an order whose status cannot transition to CANCELLED', async () => {
    prisma.order.findFirst.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'ORD-001',
      userId: 'user-1',
      status: 'DELIVERED',
      paymentStatus: 'CAPTURED',
      currency: 'INR',
      subtotalInPaise: 4800,
      discountInPaise: 0,
      taxInPaise: 240,
      shippingInPaise: 4900,
      totalInPaise: 9940,
      shippingAddress: { line1: 'Home', postalCode: '500001' },
      billingAddress: undefined,
      notes: null,
      placedAt: null,
      cancelledAt: null,
      deliveredAt: null,
      cancelReason: null,
      createdAt: new Date('2026-09-12T00:00:00Z'),
      updatedAt: new Date('2026-09-12T00:00:00Z'),
      items: [],
      payments: [],
      statusHistory: [],
      coupon: null,
    } as any);

    await expect(
      service.cancelOrder('order-1', 'user-1', 'Changed mind'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

type PrismaMock = ReturnType<typeof createPrismaMock>;

function createPrismaMock() {
  return {
    payment: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    cartItem: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      // Checkout re-counts the cart's lines AFTER taking the row lock so a
      // concurrent checkout that emptied it cannot place a second order.
      count: vi.fn(async () => 5),
    },
    order: {
      create: vi.fn(),
      findFirst: vi.fn(),
      // `findUnique` is what the reservation release reads the order's lines
      // with. Defaulting to `null` keeps the cancellation specs that throw
      // before the release path working unchanged.
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    orderStatusHistory: {
      create: vi.fn(),
    },
    cart: {
      update: vi.fn(),
      // The fulfilment store and coupon are read from the cart row during
      // checkout; the store lookup is what proves the store is active.
      findUnique: vi.fn(),
    },
    coupon: {
      // Checkout re-validates the applied coupon inside the transaction
      // (window + usage limit) before claiming a redemption.
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    },
    couponRedemption: {
      // Checkout's redemption guard reads this before recording the coupon;
      // null keeps the no-coupon specs on the plain path.
      findUnique: vi.fn().mockResolvedValue(null),
      // perUserLimit re-count inside the checkout transaction.
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(),
    },
    inventory: {
      findUnique: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    inventoryMovement: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    },
    // Conditional reserve (and the atomic coupon claim) are raw `UPDATE ...
    // WHERE` so check and increment are atomic. `1` means the row changed.
    $executeRaw: vi.fn().mockResolvedValue(1),
    // Checkout locks the cart row (`SELECT ... FOR UPDATE`) before creating
    // the order so concurrent checkouts of one cart serialise.
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn(),
  };
}

export { createPrismaMock, type PrismaMock };
