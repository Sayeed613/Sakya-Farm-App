import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PaymentsService, type PaymentRowView } from './payments.service';
import { ManualProvider } from './providers/manual.provider';
import { MockProvider } from './providers/mock.provider';

function row(overrides: Partial<PaymentRowView> = {}): PaymentRowView {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id: 'payment-id',
    orderId: 'order-id',
    provider: 'MOCK',
    providerPaymentId: null,
    method: 'UPI',
    status: 'PENDING',
    currency: 'INR',
    amountInPaise: 49900,
    refundedInPaise: 0,
    failureReason: null,
    capturedAt: null,
    refundedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function setup() {
  const orderFindFirst = vi.fn();
  const orderFindUnique = vi.fn();
  const orderUpdate = vi.fn();
  const orderStatusHistoryCreate = vi.fn();
  const paymentFindUnique = vi.fn();
  const paymentFindFirst = vi.fn();
  const paymentFindMany = vi.fn();
  const paymentCreate = vi.fn();
  const paymentUpdate = vi.fn();
  const paymentFindUniqueOrThrow = vi.fn();

  const tx = {
    payment: { update: paymentUpdate },
    order: { findUnique: orderFindUnique, update: orderUpdate },
    orderStatusHistory: { create: orderStatusHistoryCreate },
  };
  const prisma = {
    order: { findFirst: orderFindFirst, findUnique: orderFindUnique, update: orderUpdate },
    orderStatusHistory: { create: orderStatusHistoryCreate },
    payment: {
      findUnique: paymentFindUnique,
      findFirst: paymentFindFirst,
      findMany: paymentFindMany,
      create: paymentCreate,
      update: paymentUpdate,
      findUniqueOrThrow: paymentFindUniqueOrThrow,
    },
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  };

  const configService = { getOrThrow: vi.fn((): string => 'test'), get: vi.fn((): string => 'secret-1') };
  const providers = new Map<string, ManualProvider | MockProvider>([
    ['MANUAL', new ManualProvider()],
    ['MOCK', new MockProvider('secret-for-tests-1234567890')],
  ]);

  const service = new PaymentsService(
    prisma as never,
    configService as never,
    providers as unknown as Map<string, never>,
  );

  return {
    service,
    orderFindFirst,
    orderFindUnique,
    orderUpdate,
    orderStatusHistoryCreate,
    paymentFindUnique,
    paymentFindFirst,
    paymentCreate,
    paymentUpdate,
    paymentFindUniqueOrThrow,
  };
}

const ORDER = { id: 'order-id', userId: 'user-id', status: 'PENDING_PAYMENT', currency: 'INR', totalInPaise: 49900 };

describe('PaymentsService.createIntent', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('derives amount/currency from the server-side order', async () => {
    ctx.orderFindFirst.mockResolvedValue(ORDER);
    ctx.paymentFindUnique.mockResolvedValue(null);
    ctx.paymentFindFirst.mockResolvedValue(null);
    ctx.paymentCreate.mockImplementation(async (args: { data: Record<string, unknown> }) =>
      row({ id: 'new-payment', orderId: ORDER.id, ...(args.data as object) }),
    );

    const result = await ctx.service.createIntent('user-id', {
      orderId: ORDER.id,
      method: 'UPI',
      idempotencyKey: 'key-1',
    });

    const data = ctx.paymentCreate.mock.calls[0]?.[0].data as Record<string, unknown>;
    expect(data.amountInPaise).toBe(49900);
    expect(data.currency).toBe('INR');
    expect(result.payment.amountInPaise).toBe(49900);
    expect(result.payment.provider).toBe('MOCK');
  });

  it('rejects orders owned by another user', async () => {
    ctx.orderFindFirst.mockResolvedValue(null);
    await expect(
      ctx.service.createIntent('intruder', { orderId: ORDER.id, method: 'UPI', idempotencyKey: 'k' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(ctx.paymentCreate).not.toHaveBeenCalled();
  });

  it('returns the original payment on idempotency-key retry', async () => {
    ctx.orderFindFirst.mockResolvedValue(ORDER);
    ctx.paymentFindUnique.mockResolvedValue(row({ id: 'original' }));

    const result = await ctx.service.createIntent('user-id', {
      orderId: ORDER.id,
      method: 'UPI',
      idempotencyKey: 'same-key',
    });

    expect(result.payment.id).toBe('original');
    expect(ctx.paymentCreate).not.toHaveBeenCalled();
  });

  it('rejects a key already used for a different order', async () => {
    ctx.orderFindFirst.mockResolvedValue(ORDER);
    ctx.paymentFindUnique.mockResolvedValue(row({ id: 'other', orderId: 'other-order' }));
    await expect(
      ctx.service.createIntent('user-id', { orderId: ORDER.id, method: 'UPI', idempotencyKey: 'same-key' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects intents for terminal orders', async () => {
    ctx.orderFindFirst.mockResolvedValue({ ...ORDER, status: 'CANCELLED' });
    await expect(
      ctx.service.createIntent('user-id', { orderId: ORDER.id, method: 'UPI', idempotencyKey: 'k' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('PaymentsService cancel ownership', () => {
  let ctx2: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx2 = setup();
  });

  it('forbids cancelling a foreign payment', async () => {
    ctx2.paymentFindUnique.mockResolvedValue(row());
    ctx2.orderFindUnique.mockResolvedValue({ id: 'order-id', userId: 'someone-else' });
    await expect(ctx2.service.cancelPayment('user-id', 'payment-id')).rejects.toBeInstanceOf(ForbiddenException);
    expect(ctx2.paymentUpdate).not.toHaveBeenCalled();
  });

  it('refuses to cancel captured money', async () => {
    ctx2.paymentFindUnique.mockResolvedValue(row({ status: 'CAPTURED' }));
    ctx2.orderFindUnique.mockResolvedValue({ id: 'order-id', userId: 'user-id' });
    await expect(ctx2.service.cancelPayment('user-id', 'payment-id')).rejects.toBeInstanceOf(ConflictException);
  });

  it('cancels an open payment and mirrors CANCELLED onto the order', async () => {
    ctx2.paymentFindUnique.mockResolvedValue(row({ status: 'AUTHORIZED' }));
    ctx2.orderFindUnique.mockResolvedValue({ id: 'order-id', userId: 'user-id' });
    ctx2.paymentUpdate.mockImplementation(async (args: { data: Record<string, unknown> }) =>
      row({ status: 'CANCELLED', ...(args.data as object) }),
    );
    const result = await ctx2.service.cancelPayment('user-id', 'payment-id', 'changed my mind');
    expect(result.status).toBe('CANCELLED');
    expect(ctx2.orderUpdate).toHaveBeenCalledWith({
      where: { id: 'order-id' },
      data: { paymentStatus: 'CANCELLED' },
    });
  });
});


describe('PaymentsService webhooks', () => {
  let ctx3: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx3 = setup();
  });

  it('captures and advances the order to CONFIRMED', async () => {
    ctx3.paymentFindUnique.mockResolvedValue(row({ providerPaymentId: 'mock_1', status: 'AUTHORIZED' }));
    ctx3.paymentUpdate.mockImplementation(async () =>
      row({ providerPaymentId: 'mock_1', status: 'CAPTURED', capturedAt: new Date() }),
    );
    ctx3.orderFindUnique.mockResolvedValue({ id: 'order-id', status: 'PENDING_PAYMENT' });
    const result = await ctx3.service.processWebhookEvent('mock', {
      type: 'captured',
      providerPaymentId: 'mock_1',
      amountInPaise: 49900,
      currency: 'INR',
      rawPayload: { type: 'captured' },
    });
    expect(result.status).toBe('CAPTURED');
    expect(ctx3.orderStatusHistoryCreate).toHaveBeenCalledOnce();
  });

  it('acknowledges duplicates with no state change', async () => {
    const stored = row({ providerPaymentId: 'mock_1', status: 'CAPTURED' });
    ctx3.paymentFindUnique.mockResolvedValue(stored);
    ctx3.paymentFindUniqueOrThrow.mockResolvedValue(stored);
    const result = await ctx3.service.processWebhookEvent('MOCK', {
      type: 'captured',
      providerPaymentId: 'mock_1',
      rawPayload: { type: 'captured' },
    });
    expect(result.status).toBe('CAPTURED');
    expect(ctx3.orderUpdate).not.toHaveBeenCalled();
  });

  it('rejects amounts that disagree with stored payment', async () => {
    ctx3.paymentFindUnique.mockResolvedValue(row({ providerPaymentId: 'mock_1', status: 'PENDING' }));
    await expect(
      ctx3.service.processWebhookEvent('mock', {
        type: 'captured',
        providerPaymentId: 'mock_1',
        amountInPaise: 1,
        rawPayload: {},
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx3.paymentUpdate).not.toHaveBeenCalled();
  });

  it('rejects illegal transitions via webhook', async () => {
    ctx3.paymentFindUnique.mockResolvedValue(row({ providerPaymentId: 'mock_1', status: 'PENDING' }));
    await expect(
      ctx3.service.processWebhookEvent('mock', {
        type: 'refunded',
        providerPaymentId: 'mock_1',
        refundedInPaise: 49900,
        rawPayload: {},
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('404s unknown provider payments', async () => {
    ctx3.paymentFindUnique.mockResolvedValue(null);
    await expect(
      ctx3.service.processWebhookEvent('mock', {
        type: 'captured',
        providerPaymentId: 'ghost',
        rawPayload: {},
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
