import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PaymentsService, type PaymentRowView } from './payments.service';
import { ManualProvider } from './providers/manual.provider';
import { MockProvider } from './providers/mock.provider';
import { RazorpayProvider } from './providers/razorpay.provider';
import type { PaymentProvider, ProviderWebhookEvent } from './providers/payment-provider.interface';

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

function setup(withRazorpay = false) {
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
    payment: { create: paymentCreate, update: paymentUpdate, updateMany: vi.fn(async () => ({ count: 0 })) },
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
  const razorpay = new RazorpayProvider('rzp_test_key', 'key-secret', 'webhook-secret');
  const providers = new Map<string, PaymentProvider>([
    ['MANUAL', new ManualProvider()],
    ['MOCK', new MockProvider('secret-for-tests-1234567890')],
  ]);
  if (withRazorpay) providers.set('RAZORPAY', razorpay);

  const service = new PaymentsService(
    prisma as never,
    configService as never,
    { sendOrderStatusPush: vi.fn(async () => undefined) } as never,
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
    paymentFindMany,
    paymentCreate,
    paymentUpdate,
    paymentFindUniqueOrThrow,
    razorpay,
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

  it('creates a Razorpay order using server totals and persists its gateway id', async () => {
    ctx = setup(true);
    ctx.orderFindFirst.mockResolvedValue(ORDER);
    ctx.paymentFindUnique.mockResolvedValue(null);
    ctx.paymentFindFirst.mockResolvedValue(null);
    ctx.paymentCreate.mockImplementation(async (args: { data: Record<string, unknown> }) =>
      row({ id: 'new-payment', orderId: ORDER.id, ...(args.data as object) }),
    );
    vi.spyOn(ctx.razorpay, 'createOrder').mockResolvedValue({
      providerOrderId: 'order_gateway_1',
      providerPayload: { id: 'order_gateway_1' },
    });
    ctx.paymentUpdate.mockImplementation(async (args: { data: Record<string, unknown> }) =>
      row({ id: 'new-payment', orderId: ORDER.id, provider: 'RAZORPAY', ...(args.data as object) }),
    );

    const result = await ctx.service.createIntent('user-id', {
      orderId: ORDER.id,
      method: 'UPI',
      idempotencyKey: 'key-razorpay',
    });

    expect(ctx.razorpay.createOrder).toHaveBeenCalledWith({
      paymentId: 'new-payment',
      orderId: ORDER.id,
      amountInPaise: ORDER.totalInPaise,
      currency: ORDER.currency,
    });
    expect(ctx.paymentUpdate).toHaveBeenCalledWith({
      where: { id: 'new-payment' },
      data: {
        providerOrderId: 'order_gateway_1',
        providerPayload: { id: 'order_gateway_1' },
      },
    });
    expect(result.intent).toMatchObject({ provider: 'RAZORPAY', order_id: 'order_gateway_1' });
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

  it('matches Razorpay captures to the pending payment by gateway order id', async () => {
    ctx3.paymentFindFirst.mockResolvedValue(
      row({ provider: 'RAZORPAY', providerOrderId: 'order_test_1', method: 'UPI' }) as never,
    );
    ctx3.paymentUpdate.mockImplementation(async () =>
      row({
        provider: 'RAZORPAY',
        providerOrderId: 'order_test_1',
        providerPaymentId: 'pay_test_1',
        method: 'UPI',
        status: 'CAPTURED',
      }),
    );
    ctx3.orderFindUnique.mockResolvedValue({ id: 'order-id', status: 'PENDING_PAYMENT' });

    const result = await ctx3.service.processWebhookEvent('razorpay', {
      type: 'captured',
      providerPaymentId: 'pay_test_1',
      providerOrderId: 'order_test_1',
      amountInPaise: 49900,
      currency: 'INR',
      rawPayload: { event: 'payment.captured' },
    });

    expect(ctx3.paymentFindFirst).toHaveBeenCalledWith({
      where: { provider: 'RAZORPAY', providerOrderId: 'order_test_1' },
    });
    expect(ctx3.orderStatusHistoryCreate).toHaveBeenCalledOnce();
    expect(result.status).toBe('CAPTURED');
  });

  it('keeps a failed Razorpay attempt retryable until a later capture', async () => {
    ctx3.paymentFindFirst.mockResolvedValue(
      row({ provider: 'RAZORPAY', providerOrderId: 'order_test_1', method: 'CARD' }) as never,
    );
    ctx3.paymentUpdate
      .mockImplementationOnce(async () =>
        row({
          provider: 'RAZORPAY',
          providerOrderId: 'order_test_1',
          providerPaymentId: 'pay_failed',
          method: 'CARD',
          failureReason: 'Card declined',
          status: 'PENDING',
        }),
      )
      .mockImplementationOnce(async () =>
        row({
          provider: 'RAZORPAY',
          providerOrderId: 'order_test_1',
          providerPaymentId: 'pay_captured',
          method: 'CARD',
          status: 'CAPTURED',
        }),
      );
    ctx3.orderFindUnique.mockResolvedValue({ id: 'order-id', status: 'PENDING_PAYMENT' });

    const failed = await ctx3.service.processWebhookEvent('razorpay', {
      type: 'failed',
      providerPaymentId: 'pay_failed',
      providerOrderId: 'order_test_1',
      retryableFailure: true,
      failureReason: 'Card declined',
      rawPayload: { event: 'payment.failed' },
    });
    const captured = await ctx3.service.processWebhookEvent('razorpay', {
      type: 'captured',
      providerPaymentId: 'pay_captured',
      providerOrderId: 'order_test_1',
      amountInPaise: 49900,
      currency: 'INR',
      rawPayload: { event: 'payment.captured' },
    });

    expect(failed.status).toBe('PENDING');
    expect(captured.status).toBe('CAPTURED');
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

describe('PaymentsService reconciliation (pull-based capture)', () => {
  let ctx: ReturnType<typeof setup>;

  const gatewayEvent = (
    type: 'authorized' | 'captured',
    overrides: Partial<ProviderWebhookEvent> = {},
  ): ProviderWebhookEvent => ({
    type,
    providerPaymentId: 'pay_rzp_1',
    providerOrderId: 'order_rzp_1',
    amountInPaise: 49900,
    currency: 'INR',
    rawPayload: { status: type },
    ...overrides,
  });

  const gatewayRow = (status: string): PaymentRowView =>
    row({ provider: 'RAZORPAY', providerOrderId: 'order_rzp_1', method: 'UPI', status });

  beforeEach(() => {
    ctx = setup(true);
  });

  it('captures an authorized gateway payment and applies the captured event', async () => {
    const fetchStatus = vi
      .spyOn(ctx.razorpay, 'fetchPaymentStatus')
      .mockResolvedValueOnce(gatewayEvent('authorized'))
      .mockResolvedValueOnce(gatewayEvent('captured'));
    const capture = vi.spyOn(ctx.razorpay, 'capturePayment').mockResolvedValue(undefined);
    ctx.paymentFindFirst.mockResolvedValue(gatewayRow('PENDING'));
    ctx.paymentUpdate.mockImplementation(async () =>
      gatewayRow('CAPTURED') as never,
    );
    ctx.orderFindUnique.mockResolvedValue({ id: 'order-id', status: 'PENDING_PAYMENT' });

    const applied = await ctx.service.reconcilePayment(gatewayRow('PENDING'));

    expect(capture).toHaveBeenCalledWith({
      providerPaymentId: 'pay_rzp_1',
      amountInPaise: 49900,
      currency: 'INR',
    });
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    expect(applied?.type).toBe('captured');
    expect(ctx.paymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'CAPTURED', providerPaymentId: 'pay_rzp_1' }),
      }),
    );
    expect(ctx.orderStatusHistoryCreate).toHaveBeenCalledOnce();
  });

  it('still applies the authorization when the capture call fails (next reconcile retries)', async () => {
    const fetchStatus = vi
      .spyOn(ctx.razorpay, 'fetchPaymentStatus')
      .mockResolvedValueOnce(gatewayEvent('authorized'));
    vi.spyOn(ctx.razorpay, 'capturePayment').mockRejectedValue(new Error('capture refused'));
    ctx.paymentFindFirst.mockResolvedValue(gatewayRow('PENDING'));
    ctx.paymentUpdate.mockImplementation(async () => gatewayRow('AUTHORIZED') as never);
    ctx.orderFindUnique.mockResolvedValue({ id: 'order-id', status: 'PENDING_PAYMENT' });

    const applied = await ctx.service.reconcilePayment(gatewayRow('PENDING'));

    // One status read only: the failed capture short-circuits the re-read and
    // the AUTHORIZED money is still recorded (never dropped, never cancelled).
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    expect(applied?.type).toBe('authorized');
    expect(ctx.paymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'AUTHORIZED' }),
      }),
    );
  });

  it('re-drives an AUTHORIZED row from the list endpoint until captured', async () => {
    const authorizedRow = gatewayRow('AUTHORIZED');
    const capturedRow = gatewayRow('CAPTURED');
    ctx.orderFindFirst.mockResolvedValue({ id: 'order-id' });
    ctx.paymentFindMany
      .mockResolvedValueOnce([authorizedRow])
      .mockResolvedValueOnce([capturedRow]);
    vi.spyOn(ctx.razorpay, 'fetchPaymentStatus')
      .mockResolvedValueOnce(gatewayEvent('authorized'))
      .mockResolvedValueOnce(gatewayEvent('captured'));
    vi.spyOn(ctx.razorpay, 'capturePayment').mockResolvedValue(undefined);
    ctx.paymentFindFirst.mockResolvedValue(authorizedRow);
    ctx.paymentUpdate.mockImplementation(async () => capturedRow as never);
    ctx.orderFindUnique.mockResolvedValue({ id: 'order-id', status: 'PENDING_PAYMENT' });

    const attempts = await ctx.service.listForOrder('user-id', 'order-id');

    // The capture ran inside the read, and the caller sees the advanced row.
    expect(attempts.map((attempt) => attempt.status)).toEqual(['CAPTURED']);
  });
});
