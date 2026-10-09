import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrderExpiryService } from './order-expiry.service';
import { NotificationsService } from '../notifications/notifications.service';
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
  method: string;
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
      { id: 'p1', provider: 'MANUAL', method: 'CASH_ON_DELIVERY', providerPaymentId: null, providerOrderId: null, status: 'PENDING' },
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
      // An online intent supersedes the MANUAL placeholder, so the fixture
      // carries both: the placeholder row CANCELLED by createIntent and the
      // live Razorpay row. Only CANCELLED-via-updateMany + PENDING-para checks
      // distinguish this from a COD anchor.
      { id: 'p1', provider: 'MANUAL', method: 'CASH_ON_DELIVERY', providerPaymentId: null, providerOrderId: null, status: 'CANCELLED' },
      { id: 'p2', provider: 'RAZORPAY', method: 'UPI', providerPaymentId: 'pay_1', providerOrderId: 'order_1', status: 'PENDING' },
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
      { id: 'p1', provider: 'MANUAL', method: 'CASH_ON_DELIVERY', providerPaymentId: null, providerOrderId: null, status: 'CANCELLED' },
      { id: 'p3', provider: 'RAZORPAY', method: 'UPI', providerPaymentId: 'pay_captured', providerOrderId: 'order_paid', status: 'CAPTURED' },
    ],
  };
}

function setup(orders: TestOrder[]) {
  // Mirrors the Prisma filter: status + createdAt + `payments: { none:
  // { method: 'CASH_ON_DELIVERY', status: 'PENDING' } }`. The COD anchor is a
  // live MANUAL/CASH_ON_DELIVERY PENDING row; an online order's placeholder is
  // CANCELLED by createIntent, so the sweep still sees it.
  const findMany = vi.fn(async (args: { where: Record<string, any> }) =>
    orders
      .filter(
        (order) =>
          order.status === args.where.status &&
          order.createdAt < (args.where.createdAt as { lt: Date }).lt &&
          !order.payments.some(
            (payment) =>
              payment.method === 'CASH_ON_DELIVERY' &&
              payment.status === 'PENDING' &&
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

  // In-memory job lock mirroring the conditional-UPDATE claim the real
  // database performs (the real functions are driven in job-lock.spec.ts).
  // The state is shared across services in a test = the database two API
  // instances would share.
  const lockRows = new Map<string, { owner: string; expiresAt: Date }>();
  const jobLock = {
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { name: string; expiresAt?: { lt: Date }; owner?: string };
        data: { owner?: string; acquiredAt?: Date; expiresAt: Date };
      }) => {
        const row = lockRows.get(where.name);
        if (row === undefined) return { count: 0 };
        if (where.expiresAt !== undefined && row.expiresAt >= where.expiresAt.lt) {
          return { count: 0 };
        }
        if (where.owner !== undefined && row.owner !== where.owner) return { count: 0 };
        if (data.owner !== undefined) row.owner = data.owner;
        row.expiresAt = data.expiresAt;
        return { count: 1 };
      },
    ),
    findUnique: vi.fn(async ({ where }: { where: { name: string } }) => {
      const row = lockRows.get(where.name);
      return row === undefined
        ? null
        : { name: where.name, owner: row.owner, expiresAt: row.expiresAt };
    }),
    create: vi.fn(
      async ({ data }: { data: { name: string; owner: string; expiresAt: Date } }) => {
        if (lockRows.has(data.name)) {
          const error = new Error('unique violation') as Error & { code: string };
          error.code = 'P2002';
          throw error;
        }
        lockRows.set(data.name, { owner: data.owner, expiresAt: data.expiresAt });
        return data;
      },
    ),
  };

  const prisma = {
    order: { findMany },
    $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<void>) => callback(tx)),
    jobLock,
  };
  const config = { get: vi.fn(() => 120) };
  const processWebhookEvent = vi.fn(async () => ({}));
  const reconcilePayment =
    vi.fn<() => Promise<{ type: string } | null>>(async () => null);
  const paymentsService = { processWebhookEvent, reconcilePayment };
  const makeService = () =>
    new OrderExpiryService(prisma as never, config as never, paymentsService as never);
  const service = makeService();

  return {
    service,
    makeService,
    orders,
    findMany,
    updateMany,
    statusHistoryCreate,
    processWebhookEvent,
    reconcilePayment,
    lockRows,
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

  it('never cancels AUTHORIZED money: reconcile runs first, the authorization guard then keeps the order', async () => {
    const order = unpaidOnlineOrder();
    order.payments[1] = {
      id: 'p2',
      provider: 'RAZORPAY',
      method: 'UPI',
      providerPaymentId: 'pay_1',
      providerOrderId: 'order_1',
      status: 'AUTHORIZED',
    };
    // Default reconcile mock answers "no decisive outcome" (gateway
    // unreachable or nothing to capture this tick).
    const { service, orders, reconcilePayment, processWebhookEvent } = setup([order]);

    await service.expireStalePendingOrders();

    expect(reconcilePayment).toHaveBeenCalledOnce();
    expect(processWebhookEvent).toHaveBeenCalledWith(
      'RAZORPAY',
      expect.objectContaining({ type: 'authorized', providerPaymentId: 'pay_1' }),
    );
    expect(orders.find(({ id }) => id === 'online-order')?.status).toBe('PENDING_PAYMENT');
    expect(releaseOrderReservations).not.toHaveBeenCalled();
  });

  it('skips the whole sweep when the database job lock is held by another instance', async () => {
    const { service, findMany, updateMany, lockRows } = setup([unpaidOnlineOrder()]);
    lockRows.set('order-expiry', {
      owner: 'other-instance',
      expiresAt: new Date(Date.now() + 60_000),
    });

    await service.expireStalePendingOrders();

    // The loser never even selects candidates, let alone touches an order.
    expect(findMany).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    // Owner-scoped release: this run never held the lock, so it stays held.
    expect(lockRows.get('order-expiry')?.owner).toBe('other-instance');
  });

  it('releases the job lock after a successful sweep so the next tick can claim it', async () => {
    const { service, lockRows } = setup([unpaidOnlineOrder()]);

    await service.expireStalePendingOrders();

    const row = lockRows.get('order-expiry');
    expect(row).toBeDefined();
    expect(row!.expiresAt.getTime()).toBe(0); // free immediately, no lease wait
  });

  it('releases the job lock and rethrows when the sweep itself fails', async () => {
    const { service, findMany, lockRows } = setup([unpaidOnlineOrder()]);
    findMany.mockRejectedValueOnce(new Error('database unreachable'));

    await expect(service.expireStalePendingOrders()).rejects.toThrow('database unreachable');

    expect(lockRows.get('order-expiry')!.expiresAt.getTime()).toBe(0);
  });

  it('two overlapping sweeps process the same order exactly once', async () => {
    const shared = setup([unpaidOnlineOrder()]);
    const runA = shared.makeService();
    const runB = shared.makeService();
    const warnOf = (instance: object) =>
      vi.spyOn(
        (instance as unknown as { logger: { warn: (...args: unknown[]) => void } }).logger,
        'warn',
      );
    const warnA = warnOf(runA);
    const warnB = warnOf(runB);

    await Promise.all([runA.expireStalePendingOrders(), runB.expireStalePendingOrders()]);

    expect(shared.orders.find(({ id }) => id === 'online-order')?.status).toBe('CANCELLED');
    // The lock loser never selected; the winner expired exactly once.
    expect(shared.findMany).toHaveBeenCalledTimes(1);
    expect(shared.statusHistoryCreate).toHaveBeenCalledTimes(1);
    expect(releaseOrderReservations).toHaveBeenCalledTimes(1);
    const lockSkips = [...warnA.mock.calls, ...warnB.mock.calls].filter((call) =>
      String(call[0]).includes('job lock held'),
    );
    expect(lockSkips).toHaveLength(1);
  });

  it('counts an order whose state changed under the sweep as skipped, not expired', async () => {
    const { service, statusHistoryCreate, updateMany } = setup([unpaidOnlineOrder()]);
    // A webhook wins the race between selection and claim: the conditional
    // UPDATE matches zero rows, so the run must count a skip — no history row,
    // no release, and the log must not claim a cancellation.
    updateMany.mockImplementationOnce(async () => ({ count: 0 }));
    const logSpy = vi.spyOn(
      (service as unknown as { logger: { log: (...args: unknown[]) => void } }).logger,
      'log',
    );

    await service.expireStalePendingOrders();

    expect(statusHistoryCreate).not.toHaveBeenCalled();
    expect(releaseOrderReservations).not.toHaveBeenCalled();
    expect(logSpy.mock.calls.some((call) => call[1] === 'order-expiry sweep started')).toBe(true);
    const finished = logSpy.mock.calls.find(
      (call) => call[1] === 'order-expiry sweep finished',
    );
    expect(finished).toBeDefined();
    expect(finished![0]).toMatchObject({
      candidates: 1,
      expired: 0,
      skippedStateChanged: 1,
      failed: 0,
    });
  });

  it('K. completes with the push provider hanging — delivery is off the expiry path', async () => {
    const { service, orders, processWebhookEvent } = setup([capturedOnlineOrder()]);

    // Route the auto-heal through the REAL enqueue path production uses (via
    // PaymentsService -> NotificationsService), against an in-memory database.
    const notificationCreate = vi.fn(async (args: { data: Record<string, unknown> }) => ({
      id: 'n-1',
      ...args.data,
    }));
    const notifyPrisma = {
      user: { findUnique: vi.fn(async () => ({ firstName: 'Asha' })) },
      notification: { create: notificationCreate },
    };
    const notifications = new NotificationsService(notifyPrisma as never, {} as never);
    processWebhookEvent.mockImplementation(async () => {
      await notifications.sendOrderStatusPush({
        userId: 'user-1',
        orderId: 'captured-order',
        orderNumber: 'ORD-PAID',
        status: 'CONFIRMED',
      });
      return {};
    });

    // A provider that never answers: if the sweep waited on delivery, the
    // race below would reject and fail the test.
    const fetchSpy = vi.fn(() => new Promise(() => undefined));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        service.expireStalePendingOrders(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('expiry blocked on the push provider')),
            5_000,
          );
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      globalThis.fetch = originalFetch;
    }

    // Delivery never ran on the sweep; the durable QUEUED row did.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(notificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'QUEUED' }) }),
    );
    // Money-safety outcome unchanged: the captured order was auto-healed, not cancelled.
    expect(orders.find(({ id }) => id === 'captured-order')?.status).toBe('PENDING_PAYMENT');
  });
});
