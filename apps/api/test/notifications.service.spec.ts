import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { PrismaService } from '../src/database/prisma.service';
import { NotificationsService, orderPushCopy } from '../src/modules/notifications/notifications.service';
import * as incrementMetricModule from '../src/observability/business-metrics';

/**
 * Unit tests for the push pipeline on a mocked Prisma:
 * - the device registry (upsert/delete/list, ownership enforced)
 * - orderPushCopy's per-status mapping
 * - sendOrderStatusPush's guarantee: a provider failure never throws.
 */

function createPrismaMock() {
  return {
    devicePushToken: {
      upsert: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
    },
    user: { findUnique: vi.fn() },
    notification: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
  };
}

function createService(prisma: ReturnType<typeof createPrismaMock>): NotificationsService {
  const config = { get: vi.fn(() => null), getOrThrow: vi.fn(() => false) } as unknown as ConfigService;
  return new NotificationsService(prisma as unknown as PrismaService, config);
}

describe('device registry', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: NotificationsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = createService(prisma);
  });

  it('registers a new device', async () => {
    prisma.devicePushToken.upsert.mockResolvedValue({
      id: 'device-1',
      platform: 'ANDROID',
      deviceName: 'Pixel',
      createdAt: new Date('2026-09-18T10:00:00Z'),
    });

    const response = await service.registerDevice('user-1', {
      token: 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]',
      platform: 'ANDROID',
      deviceName: 'Pixel',
    });

    expect(response.device.id).toBe('device-1');
    expect(prisma.devicePushToken.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ userId: 'user-1' }),
      }),
    );
  });

  it('deletes only the caller\u2019s own device', async () => {
    prisma.devicePushToken.findFirst.mockResolvedValue(null);
    await expect(service.deleteDevice('user-1', 'device-1')).rejects.toThrow(NotFoundException);
  });

  it('lists only active devices', async () => {
    prisma.devicePushToken.findMany.mockResolvedValue([]);
    await service.listDevices('user-1');
    expect(prisma.devicePushToken.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deactivatedAt: null }) }),
    );
  });
});

describe('orderPushCopy', () => {
  it('maps customer-relevant statuses to copy', () => {
    expect(orderPushCopy('CONFIRMED', null, 'Asha')?.title).toContain('confirmed');
    expect(orderPushCopy('OUT_FOR_DELIVERY', null, 'Asha')?.title).toContain('Out for delivery');
    expect(orderPushCopy('DELIVERED', null, 'Asha')).not.toBeNull();
  });

  it('shows the operator reason on cancellation', () => {
    const copy = orderPushCopy('CANCELLED', 'Out of stock', 'Asha');
    expect(copy?.body).toContain('Out of stock');
  });

  it('returns null for statuses that should not notify', () => {
    expect(orderPushCopy('PENDING_PAYMENT', null, 'Asha')).toBeNull();
    expect(orderPushCopy('REFUNDED', null, 'Asha')).toBeNull();
    expect(orderPushCopy('FAILED', null, 'Asha')).toBeNull();
  });
});

describe('in-app inbox', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: NotificationsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = createService(prisma);
  });

  it('lists the caller\u2019s notifications with pagination meta and unread count', async () => {
    const now = new Date('2026-09-18T10:00:00Z');
    prisma.notification.findMany.mockResolvedValue([
      { id: 'n-2', title: 'Out for delivery', body: 'On the way', data: { orderId: 'o-1' }, createdAt: now, readAt: null },
      { id: 'n-1', title: 'Confirmed', body: 'Thanks!', data: { orderId: 'o-1' }, createdAt: now, readAt: now },
    ]);
    prisma.notification.count.mockResolvedValueOnce(11).mockResolvedValueOnce(1);

    const page = await service.listNotifications('user-1', 2, 10);

    expect(page.items).toHaveLength(2);
    expect(page.items[0]).toMatchObject({ id: 'n-2', readAt: null, createdAt: now.toISOString() });
    expect(page.meta).toMatchObject({ page: 2, perPage: 10, total: 11, totalPages: 2, hasNextPage: false, hasPreviousPage: true });
    expect(page.unreadCount).toBe(1);
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' }, skip: 10, take: 10 }),
    );
  });

  it('marks one notification read only for the owner and only once', async () => {
    prisma.notification.findFirst.mockResolvedValue({ id: 'n-1', userId: 'user-1', readAt: null });
    await service.markNotificationRead('user-1', 'n-1');
    expect(prisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'n-1' }, data: expect.objectContaining({ readAt: expect.any(Date) }) }),
    );

    // Already read -> idempotent no-op.
    prisma.notification.update.mockClear();
    prisma.notification.findFirst.mockResolvedValue({ id: 'n-1', userId: 'user-1', readAt: new Date() });
    await service.markNotificationRead('user-1', 'n-1');
    expect(prisma.notification.update).not.toHaveBeenCalled();

    // Someone else's notification -> 404.
    prisma.notification.findFirst.mockResolvedValue(null);
    await expect(service.markNotificationRead('user-1', 'n-9')).rejects.toThrow(NotFoundException);
  });

  it('marks everything read scoped to the caller', async () => {
    await service.markAllNotificationsRead('user-1');
    expect(prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', readAt: null } }),
    );
  });

  it('queues the durable inbox row without touching delivery (Step 12)', async () => {
    prisma.user.findUnique.mockResolvedValue({ firstName: 'Asha' });
    prisma.notification.create.mockResolvedValue({ id: 'n-1' });
    const fetchSpy = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      await service.sendOrderStatusPush({
        userId: 'user-1',
        orderId: 'order-1',
        orderNumber: 'SKY-1',
        status: 'CONFIRMED',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    // The row IS the notification: QUEUED for the worker, nothing else.
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'QUEUED', channel: 'PUSH' }),
      }),
    );
    expect(prisma.devicePushToken.findMany).not.toHaveBeenCalled();
    expect(prisma.notification.updateMany).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('sendOrderStatusPush enqueue isolation (critical paths)', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: NotificationsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = createService(prisma);
  });

  it('never performs provider I/O and never throws — the webhook/cancel path', async () => {
    prisma.user.findUnique.mockResolvedValue({ firstName: 'Asha' });
    prisma.notification.create.mockResolvedValue({ id: 'n-1' });
    const fetchSpy = vi.fn(() => Promise.reject(new Error('expo down')));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      await expect(
        service.sendOrderStatusPush({
          userId: 'user-1',
          orderId: 'order-1',
          orderNumber: 'SKY-1',
          status: 'CONFIRMED',
        }),
      ).resolves.toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    expect(prisma.notification.updateMany).not.toHaveBeenCalled();
  });

  it('swallows a standalone enqueue failure instead of failing the caller (legacy best-effort path)', async () => {
    prisma.user.findUnique.mockResolvedValue({ firstName: 'Asha' });
    prisma.notification.create.mockRejectedValue(new Error('database blip'));

    await expect(
      service.sendOrderStatusPush({
        userId: 'user-1',
        orderId: 'order-1',
        orderNumber: 'SKY-1',
        status: 'CONFIRMED',
      }),
    ).resolves.toBeUndefined();
  });

  it('still skips statuses with no customer-facing copy and missing users', async () => {
    prisma.user.findUnique.mockResolvedValue({ firstName: 'Asha' });
    await service.sendOrderStatusPush({
      userId: 'user-1',
      orderId: 'order-1',
      orderNumber: 'SKY-1',
      status: 'PENDING_PAYMENT',
    });
    expect(prisma.notification.create).not.toHaveBeenCalled();

    prisma.user.findUnique.mockResolvedValue(null);
    await service.sendOrderStatusPush({
      userId: 'user-ghost',
      orderId: 'order-1',
      orderNumber: 'SKY-1',
      status: 'CONFIRMED',
    });
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // Observability: notificationQueueFailures at the durable enqueue failure path
  // ---------------------------------------------------------------------

  describe('notificationQueueFailures counter', () => {
    let incrementMetricSpy: MockInstance;

    beforeEach(() => {
      incrementMetricSpy = vi.spyOn(incrementMetricModule, 'incrementMetric');
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('increments notificationQueueFailures exactly once when a standalone enqueue fails (still swallowed, legacy path)', async () => {
      prisma.user.findUnique.mockResolvedValue({ firstName: 'Asha' });
      prisma.notification.create.mockRejectedValue(new Error('database blip'));

      await expect(
        service.sendOrderStatusPush({
          userId: 'user-1',
          orderId: 'order-1',
          orderNumber: 'SKY-1',
          status: 'CONFIRMED',
        }),
      ).resolves.toBeUndefined();

      expect(incrementMetricSpy).toHaveBeenCalledTimes(1);
      expect(incrementMetricSpy).toHaveBeenCalledWith('notificationQueueFailures');
    });

    it('does not increment notificationQueueFailures when an enqueue succeeds', async () => {
      prisma.user.findUnique.mockResolvedValue({ firstName: 'Asha' });
      prisma.notification.create.mockResolvedValue({ id: 'n-1' });

      await service.sendOrderStatusPush({
        userId: 'user-1',
        orderId: 'order-1',
        orderNumber: 'SKY-1',
        status: 'CONFIRMED',
      });

      expect(incrementMetricSpy).not.toHaveBeenCalledWith('notificationQueueFailures');
    });

    it('does not increment notificationQueueFailures on a standalone enqueue that does not run (missing user / no push copy)', async () => {
      // No failure happened — the enqueue was never attempted.
      prisma.user.findUnique.mockResolvedValue(null);

      await service.sendOrderStatusPush({
        userId: 'user-ghost',
        orderId: 'order-1',
        orderNumber: 'SKY-1',
        status: 'CONFIRMED',
      });

      expect(incrementMetricSpy).not.toHaveBeenCalledWith('notificationQueueFailures');
    });

    it('increments notificationQueueFailures exactly once when a transactional outbox enqueue fails (distinct tx client)', async () => {
      // Transactional mode: the client argument is a distinct object, so the
      // enqueue is transactional and a failure propagates with the counter set.
      const tx = {
        user: { findUnique: vi.fn().mockResolvedValue({ firstName: 'Asha' }) },
        notification: { create: vi.fn().mockRejectedValue(new Error('database blip')) },
      };

      await expect(
        service.sendOrderStatusPush(
          { userId: 'user-1', orderId: 'order-1', orderNumber: 'SKY-1', status: 'CONFIRMED' },
          tx as never,
        ),
      ).rejects.toThrow('database blip');

      expect(incrementMetricSpy).toHaveBeenCalledTimes(1);
      expect(incrementMetricSpy).toHaveBeenCalledWith('notificationQueueFailures');
    });
  });

});

describe('sendOrderStatusPush — transactional outbox mode (Step 12 correction)', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: NotificationsService;
  // A distinct client object standing in for Prisma.TransactionClient — the
  // active business transaction the call sites now pass.
  let tx: { user: { findUnique: ReturnType<typeof vi.fn> }; notification: { create: ReturnType<typeof vi.fn> } };

  beforeEach(() => {
    prisma = createPrismaMock();
    service = createService(prisma);
    tx = {
      user: { findUnique: vi.fn() },
      notification: { create: vi.fn() },
    };
  });

  it('writes the QUEUED intent on the caller\u2019s transaction client, never the root client', async () => {
    tx.user.findUnique.mockResolvedValue({ firstName: 'Asha' });
    tx.notification.create.mockResolvedValue({ id: 'n-1' });

    await service.sendOrderStatusPush(
      { userId: 'user-1', orderId: 'order-1', orderNumber: 'SKY-1', status: 'CONFIRMED' },
      tx as never,
    );

    expect(tx.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'QUEUED', channel: 'PUSH' }),
      }),
    );
    // The root client was not used — the row lives or dies with the tx.
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('propagates an intent-write failure so the surrounding transaction rolls back, and counts notificationQueueFailures', async () => {
    const incrementMetricSpy = vi.spyOn(incrementMetricModule, 'incrementMetric');

    tx.user.findUnique.mockResolvedValue({ firstName: 'Asha' });
    tx.notification.create.mockRejectedValue(new Error('database blip'));

    // Swallowing here would commit business state WITHOUT its durable intent
    // — the exact crash gap this correction closes.
    await expect(
      service.sendOrderStatusPush(
        { userId: 'user-1', orderId: 'order-1', orderNumber: 'SKY-1', status: 'CONFIRMED' },
        tx as never,
      ),
    ).rejects.toThrow('database blip');

    expect(incrementMetricSpy).toHaveBeenCalledTimes(1);
    expect(incrementMetricSpy).toHaveBeenCalledWith('notificationQueueFailures');

    vi.restoreAllMocks();
  });


  it('performs no provider I/O inside the transaction', async () => {
    tx.user.findUnique.mockResolvedValue({ firstName: 'Asha' });
    tx.notification.create.mockResolvedValue({ id: 'n-1' });
    const fetchSpy = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      await service.sendOrderStatusPush(
        { userId: 'user-1', orderId: 'order-1', orderNumber: 'SKY-1', status: 'CONFIRMED' },
        tx as never,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prisma.devicePushToken.findMany).not.toHaveBeenCalled();
  });
});

describe('deliverClaimed — the worker delivery pass', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: NotificationsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = createService(prisma);
  });

  const claimed = (overrides: Record<string, unknown> = {}) => ({
    id: 'n-1',
    userId: 'user-1',
    title: 'Order confirmed 🌱',
    body: 'Thanks!',
    data: { orderId: 'order-1', orderNumber: 'SKY-1', status: 'CONFIRMED' },
    attempts: 1,
    ...overrides,
  });

  const guard = { id: 'n-1', status: 'QUEUED' as const, claimedBy: 'worker-1' };

  function stubFetch(impl: () => Promise<unknown>) {
    const spy = vi.fn(impl);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = spy as unknown as typeof fetch;
    return { spy, restore: () => { globalThis.fetch = originalFetch; } };
  }

  it('E. accepted delivery marks the row SENT with the provider ticket id', async () => {
    prisma.devicePushToken.findMany.mockResolvedValue([{ token: 'ExponentPushToken[x]' }]);
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });
    const fetchStub = stubFetch(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ status: 'ok', id: 'ticket-1' }] }),
      }),
    );
    try {
      const outcome = await service.deliverClaimed(claimed(), 'worker-1');
      expect(outcome).toBe('SENT');
    } finally {
      fetchStub.restore();
    }
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: guard,
      data: expect.objectContaining({
        status: 'SENT',
        sentAt: expect.any(Date),
        providerMessageId: 'ticket-1',
        claimedBy: null,
        claimedAt: null,
        failureReason: null,
      }),
    });
  });

  it('F. transient provider failure requeues with exponential backoff and the reason', async () => {
    prisma.devicePushToken.findMany.mockResolvedValue([{ token: 'ExponentPushToken[x]' }]);
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });
    const fetchStub = stubFetch(() => Promise.reject(new Error('network down')));
    try {
      const outcome = await service.deliverClaimed(claimed({ attempts: 1 }), 'worker-1');
      expect(outcome).toBe('RETRY');
    } finally {
      fetchStub.restore();
    }
    const call = prisma.notification.updateMany.mock.calls[0]?.[0] as {
      where: unknown;
      data: { status?: string; nextAttemptAt: Date; claimedBy: string | null; failureReason: string };
    };
    expect(call.where).toEqual(guard);
    expect(call.data.status).toBeUndefined(); // stays QUEUED
    expect(call.data.claimedBy).toBeNull(); // released for the next tick
    expect(call.data.failureReason).toContain('network down');
    expect(call.data.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 25_000);
    expect(call.data.nextAttemptAt.getTime()).toBeLessThanOrEqual(Date.now() + 35_000);
  });

  it('G. the attempt cap turns persistent transient failures into FAILED', async () => {
    prisma.devicePushToken.findMany.mockResolvedValue([{ token: 'ExponentPushToken[x]' }]);
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });
    const fetchStub = stubFetch(() => Promise.reject(new Error('still down')));
    try {
      const outcome = await service.deliverClaimed(
        claimed({ attempts: 5 }) as Parameters<NotificationsService['deliverClaimed']>[0],
        'worker-1',
      );
      expect(outcome).toBe('FAILED');
    } finally {
      fetchStub.restore();
    }
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: guard,
      data: expect.objectContaining({
        status: 'FAILED',
        failureReason: expect.stringContaining('after 5 attempts'),
        claimedBy: null,
        claimedAt: null,
      }),
    });
  });

  it('H. a permanent provider rejection fails immediately without burning retries', async () => {
    prisma.devicePushToken.findMany.mockResolvedValue([{ token: 'ExponentPushToken[x]' }]);
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });
    const fetchStub = stubFetch(() =>
      Promise.resolve({ ok: false, status: 400, json: async () => ({}) }),
    );
    try {
      const outcome = await service.deliverClaimed(claimed({ attempts: 1 }), 'worker-1');
      expect(outcome).toBe('FAILED');
    } finally {
      fetchStub.restore();
    }
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: guard,
      data: expect.objectContaining({
        status: 'FAILED',
        failureReason: expect.stringContaining('400'),
      }),
    });
  });

  it('marks SENT without provider I/O when the user has no active devices', async () => {
    prisma.devicePushToken.findMany.mockResolvedValue([]);
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });

    const outcome = await service.deliverClaimed(claimed(), 'worker-1');

    expect(outcome).toBe('SENT');
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: guard,
      data: expect.objectContaining({ status: 'SENT', sentAt: expect.any(Date) }),
    });
  });

  it('J. a row another worker has taken over is left untouched (SUPERSEDED)', async () => {
    prisma.devicePushToken.findMany.mockResolvedValue([]);
    // The guarded UPDATE matched nothing: our lease lapsed mid-flight.
    prisma.notification.updateMany.mockResolvedValue({ count: 0 });

    const outcome = await service.deliverClaimed(claimed(), 'worker-1');

    expect(outcome).toBe('SUPERSEDED');
  });
});
