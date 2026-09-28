import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrderExpiryService } from './order-expiry.service';
import { releaseOrderReservations } from '../inventory/order-reservations';

vi.mock('../inventory/order-reservations', () => ({
  releaseOrderReservations: vi.fn(),
}));

/**
 * The expiry sweep cancels orders, so its contract is money-safety-critical.
 * These tests pin the behaviours that make it safe:
 *
 *  1. aged COD orders are never touched;
 *  2. an aged order that somehow holds CAPTURED money is auto-healed
 *     (advanced through the real payment state machine), never cancelled;
 *  3. a gateway order the gateway says was PAID is not cancelled (webhook
 *     in flight at sweep time);
 *  4. an unreachable gateway skips the order (cancel can wait; a wrong
 *     cancellation cannot be undone);
 *  5. a genuinely unpaid online order is cancelled and its reservation
 *     released, as before.
 */

type TestPayment = {
  id: string;
  provider: string;
  providerPaymentId: string | null;
  providerOrderId: string | null;
  status: string;
};

type TestOrder = {
  id: string;
  orderNumber: string;
  userId: string;
  status: string;
  createdAt: Date;
  payments: TestPayment[];
};

const CUTOFF = new Date(Date.now() - 120 * 60 * 1000);

function codOrder(): TestOrder {
  return {
    id: 'cod-order',
    orderNumber: 'ORD-COD',
    userId: 'user-cod',
    status: 'PENDING_PAYMENT',
    createdAt: new Date(CUTOFF.getTime() - 60_000),
    payments: [
      { id: 'p1', provider: 'MANUAL', providerPaymentId: null, providerOrderId: null, status: 'PENDING' },
    ],
  };
}

function unpaidOnlineOrder(): TestOrder {
  return {
    id: 'online-order',
    orderNumber: 'ORD-UPI',
    userId: 'user-online',
    status: 'PENDING_PAYMENT',
    createdAt: new Date(CUTOFF.getTime() - 60_000),
    payments: [
      { id: 'p2', provider: 'RAZORPAY', providerPaymentId: 'pay_1', providerOrderId: 'order_1', status: 'PENDING' },
    ],
  };
}

function capturedOnlineOrder(): TestOrder {
  return {
    ...unpaidOnlineOrder(),
    id: 'captured-order',
    orderNumber: 'ORD-PAID',
    userId: 'user-paid',
    payments: [
      { id: 'p3', provider: 'RAZORPAY', providerPaymentId: 'pay_captured', providerOrderId: 'order_paid', status: 'CAPTURED' },
    ],
  };
}

function setup(orders: TestOrder[]) {
  // Mirrors the Prisma filter: status + createdAt + `payments: { none:
  // { method: 'CASH_ON_DELIVERY', status: 'PENDING' } }`. A MANUAL PENDING
  // payment stands in for the COD anchor in the test data.
  const findMany = vi.fn(async (args: { where: Record<string, any> }) =>
    orders
      .filter(
        (order) =>
          order.status === args.where.status &&
          order.createdAt < (args.where.createdAt as { lt: Date }).lt &&
          !order.payments.some(
            (payment) =>
              payment.status === 'PENDING' &&
              payment.provider !== 'RAZORPAY' &&
              (args.where.payments as { none: { method: string } }).none.method === 'CASH_ON_DELIVERY',
          ),
      )
      .map(({ id, orderNumber, userId, payments }) => ({ id, orderNumber, userId, payments })),
  );

  const updateMany = vi.fn(async ({ where }: { where: { id: string; status: string } }) => {
    const order = orders.find((candidate) => candidate.id === where.id && candidate.status === where.status);
    if (order === undefined) return { count: 0 };
    order.status = 'CANCELLED';
    return { count: 1 };
  });

  const statusHistoryCreate = vi.fn();
  const tx = {
    order: { updateMany },
    orderStatusHistory: { create: statusHistoryCreate },
  };

  const prisma = {
    order: { findMany },
    $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<void>) => callback(tx)),
  };
  const config = { get: vi.fn(() => 120) };
  const processWebhookEvent = vi.fn(async () => ({}));
  const reconcilePayment =
    vi.fn<() => Promise<{ type: string } | null>>(async () => null);
  const paymentsService = { processWebhookEvent, reconcilePayment };
  const service = new OrderExpiryService(prisma as never, config as never, paymentsService as never);

  return {
    service,
    orders,
    findMany,
    updateMany,
    statusHistoryCreate,
    processWebhookEvent,
    reconcilePayment,
  };
}

describe('OrderExpiryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('leaves an aged COD order pending', async () => {
    const { service, orders, findMany, updateMany } = setup([codOrder()]);

    await service.expireStalePendingOrders();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          payments: { none: { method: 'CASH_ON_DELIVERY', status: 'PENDING' } },
        }),
      }),
    );
    expect(orders.find(({ id }) => id === 'cod-order')?.status).toBe('PENDING_PAYMENT');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('still cancels an aged unpaid online order and releases its reservation', async () => {
    const { service, orders, updateMany, statusHistoryCreate } = setup([unpaidOnlineOrder()]);

    await service.expireStalePendingOrders();

    expect(orders.find(({ id }) => id === 'online-order')?.status).toBe('CANCELLED');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'online-order', status: 'PENDING_PAYMENT' } }),
    );
    expect(statusHistoryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'online-order',
        fromStatus: 'PENDING_PAYMENT',
        toStatus: 'CANCELLED',
      }),
    });
    expect(releaseOrderReservations).toHaveBeenCalledWith(
      expect.anything(),
      'online-order',
      'Payment window expired',
    );
  });

  it('never cancels an aged order whose payment is CAPTURED — it auto-heals through the real state machine', async () => {
    const { service, orders, processWebhookEvent, reconcilePayment } = setup([
      capturedOnlineOrder(),
    ]);

    await service.expireStalePendingOrders();

    expect(processWebhookEvent).toHaveBeenCalledWith(
      'RAZORPAY',
      expect.objectContaining({ type: 'captured', providerPaymentId: 'pay_captured' }),
    );
    expect(reconcilePayment).not.toHaveBeenCalled();
    expect(releaseOrderReservations).not.toHaveBeenCalled();
    expect(orders.find(({ id }) => id === 'captured-order')?.status).toBe('PENDING_PAYMENT');
  });

  it('does not cancel when the gateway reports the order was paid (webhook in flight)', async () => {
    const order = unpaidOnlineOrder();
    const { service, orders, reconcilePayment } = setup([order]);
    reconcilePayment.mockResolvedValueOnce({ type: 'captured' });

    await service.expireStalePendingOrders();

    expect(reconcilePayment).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'RAZORPAY', providerOrderId: 'order_1' }),
    );
    expect(releaseOrderReservations).not.toHaveBeenCalled();
    expect(orders.find(({ id }) => id === 'online-order')?.status).toBe('PENDING_PAYMENT');
  });

  it('skips cancellation when the gateway is unreachable, leaving the order for the next sweep', async () => {
    const order = unpaidOnlineOrder();
    const { service, orders, reconcilePayment } = setup([order]);
    reconcilePayment.mockRejectedValueOnce(new Error('gateway timeout'));

    await service.expireStalePendingOrders();

    // The service converts thrown errors into "no answer"; either way the
    // order must survive this run.
    expect(orders.find(({ id }) => id === 'online-order')?.status).toBe('PENDING_PAYMENT');
  });

  it('cancels when the gateway reports no decisive payment on the order', async () => {
    const order = unpaidOnlineOrder();
    const { service, orders, reconcilePayment } = setup([order]);

    await service.expireStalePendingOrders();

    expect(reconcilePayment).toHaveBeenCalledOnce();
    expect(orders.find(({ id }) => id === 'online-order')?.status).toBe('CANCELLED');
    expect(releaseOrderReservations).toHaveBeenCalledWith(
      expect.anything(),
      'online-order',
      'Payment window expired',
    );
  });
});
