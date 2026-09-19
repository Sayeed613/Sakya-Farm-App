import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PrismaService } from '../src/database/prisma.service';
import { NotificationsService, orderPushCopy } from '../src/modules/notifications/notifications.service';

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

  it('persists the inbox row even when the customer has no push devices', async () => {
    prisma.user.findUnique.mockResolvedValue({ firstName: 'Asha' });
    prisma.devicePushToken.findMany.mockResolvedValue([]);
    prisma.notification.create.mockResolvedValue({ id: 'n-1' });

    await service.sendOrderStatusPush({
      userId: 'user-1',
      orderId: 'order-1',
      orderNumber: 'SKY-1',
      status: 'CONFIRMED',
    });

    // Row written first, then marked SENT with no delivery attempt.
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    expect(prisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SENT' }) }),
    );
  });
});

describe('sendOrderStatusPush failure isolation', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: NotificationsService;
  const fetchMock = vi.fn();

  beforeEach(() => {
    prisma = createPrismaMock();
    service = createService(prisma);
    fetchMock.mockReset();
  });

  it('records FAILED without throwing when the provider is unreachable', async () => {
    prisma.user.findUnique.mockResolvedValue({ firstName: 'Asha' });
    prisma.devicePushToken.findMany.mockResolvedValue([{ token: 'ExponentPushToken[x]' }]);
    prisma.notification.create.mockResolvedValue({ id: 'n-1' });
    fetchMock.mockRejectedValue(new Error('network down'));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      await expect(
        service.sendOrderStatusPush({
          userId: 'user-1',
          orderId: 'order-1',
          orderNumber: 'SKY-1',
          status: 'CONFIRMED',
        }),
      ).resolves.toBeUndefined();
      // Notification row persisted, then marked FAILED with the reason.
      expect(prisma.notification.create).toHaveBeenCalledTimes(1);
      expect(prisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FAILED', failureReason: expect.any(String) }),
        }),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('skips delivery (but keeps the inbox row) when no devices are registered', async () => {
    prisma.user.findUnique.mockResolvedValue({ firstName: 'Asha' });
    prisma.devicePushToken.findMany.mockResolvedValue([]);
    prisma.notification.create.mockResolvedValue({ id: 'n-1' });

    await expect(
      service.sendOrderStatusPush({
        userId: 'user-1',
        orderId: 'order-1',
        orderNumber: 'SKY-1',
        status: 'CONFIRMED',
      }),
    ).resolves.toBeUndefined();
    // No fetch happened: the tokens list was empty.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
