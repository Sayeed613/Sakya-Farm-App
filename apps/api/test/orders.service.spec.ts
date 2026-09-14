import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrdersService } from '../src/modules/orders/orders.service';
import { PrismaService } from '../src/database/prisma.service';
import { CartService } from '../src/modules/cart/cart.service';

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

function cartWithItems(...specs: Array<{ id: string; variantId: string; quantity: number; unitPriceInPaise: number }>) {
  return cart('user-1', 'cart-1', specs.map((spec) => ({
    id: spec.id,
    variantId: spec.variantId,
    quantity: spec.quantity,
    unitPriceInPaise: spec.unitPriceInPaise,
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
        { provide: CartService, useValue: cartService },
      ],
    })
      .overrideProvider(PrismaService).useValue(prisma)
      .overrideProvider(CartService).useValue(cartService)
      .compile();
    service = testModule.get(OrdersService) as OrdersService;
  });

  it('rejects checkout when the cart is empty', async () => {
    cartService.getCurrentCart.mockResolvedValue(cart());

    await expect(
      service.checkout('user-1', {
        idempotencyKey: 'key-1',
        shippingAddress: { line1: 'Home' },
        notes: null,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('places an order with server-computed totals and a MANUAL PENDING payment', async () => {
    cartService.getCurrentCart.mockResolvedValue(
      cartWithItems({ id: 'i1', variantId: 'v1', quantity: 2, unitPriceInPaise: 2400 })
    );
    prisma.payment.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));

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
      taxInPaise: 0,
      shippingInPaise: 0,
      totalInPaise: 4800,
      shippingAddress: { line1: 'Home' },
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
      taxInPaise: 0,
      shippingInPaise: 0,
      totalInPaise: 4800,
      shippingAddress: { line1: 'Home' },
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
      shippingAddress: { line1: 'Home' },
      billingAddress: undefined,
      notes: null,
    });

    expect(result.orderNumber).toBe('ORD-001');
    expect(result.status).toBe('PENDING_PAYMENT');
    expect(result.totalInPaise).toBe(4800);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.productTitle).toBe('Mango');
    expect(result.payments).toHaveLength(1);
    expect(result.payments[0]!.provider).toBe('MANUAL');
    expect(result.payments[0]!.status).toBe('PENDING');
    // Idempotency key is internal and must never leak to the client.
    expect((result.payments[0] as unknown as { idempotencyKey?: string }).idempotencyKey).toBeUndefined();
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

    prisma.order.create.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'ORD-002',
      userId: 'user-1',
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
      currency: 'INR',
      subtotalInPaise: 4800,
      discountInPaise: 480,
      taxInPaise: 0,
      shippingInPaise: 0,
      totalInPaise: 4320,
      shippingAddress: { line1: 'Home' },
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
      taxInPaise: 0,
      shippingInPaise: 0,
      totalInPaise: 4320,
      shippingAddress: { line1: 'Home' },
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
      shippingAddress: { line1: 'Home' },
      billingAddress: undefined,
      notes: null,
    });

    expect(result.subtotalInPaise).toBe(4800);
    expect(result.discountInPaise).toBe(480);
    expect(result.totalInPaise).toBe(4320);
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
      taxInPaise: 0,
      shippingInPaise: 0,
      totalInPaise: 4800,
      shippingAddress: { line1: 'Home' },
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
      shippingAddress: { line1: 'Home' },
      billingAddress: undefined,
      notes: null,
    });

    expect(result.orderNumber).toBe('ORD-001');
    expect(prisma.$transaction).not.toHaveBeenCalled();
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
        shippingAddress: { line1: 'Home' },
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
      taxInPaise: 0,
      shippingInPaise: 0,
      totalInPaise: 4800,
      shippingAddress: { line1: 'Home' },
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
      taxInPaise: 0,
      shippingInPaise: 0,
      totalInPaise: 4800,
      shippingAddress: { line1: 'Home' },
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
      taxInPaise: 0,
      shippingInPaise: 0,
      totalInPaise: 4800,
      shippingAddress: { line1: 'Home' },
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
      taxInPaise: 0,
      shippingInPaise: 0,
      totalInPaise: 4800,
      shippingAddress: { line1: 'Home' },
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
    order: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    orderStatusHistory: {
      create: vi.fn(),
    },
    cart: {
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  };
}

export { createPrismaMock, type PrismaMock };
