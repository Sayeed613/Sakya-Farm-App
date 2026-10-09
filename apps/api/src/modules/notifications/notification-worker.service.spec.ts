import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationWorkerService } from './notification-worker.service';
import type {
  DeliveryOutcome,
  NotificationsService,
} from './notifications.service';

/**
 * Step 12 — the background delivery worker's orchestration.
 *
 * The CLAIM ITSELF (atomic, multi-instance, lease-based) is proven against
 * PostgreSQL in `test/notification-worker.e2e.spec.ts`; these tests pin the
 * worker-side behaviour around it: batch claiming, outcome accounting,
 * per-row error isolation, tick-level resilience and the observability
 * contract. Provider delivery is stubbed here — `deliverClaimed` has its own
 * suite in `test/notifications.service.spec.ts`.
 */

function createWorker(options?: { disabled?: boolean }) {
  vi.stubEnv(
    'NOTIFICATIONS_WORKER_DISABLED',
    options?.disabled === true ? '1' : '',
  );

  const prisma = { $queryRaw: vi.fn() };
  const deliverClaimed = vi.fn(
    async (): Promise<DeliveryOutcome> => 'SENT',
  );
  const notifications = { deliverClaimed } as unknown as NotificationsService;
  const worker = new NotificationWorkerService(prisma as never, notifications);
  const logger = (
    worker as unknown as {
      logger: {
        log: (...args: unknown[]) => void;
        warn: (...args: unknown[]) => void;
        error: (...args: unknown[]) => void;
      };
    }
  ).logger;

  return {
    worker,
    prisma,
    deliverClaimed,
    logger,
    logSpy: vi.spyOn(logger, 'log'),
    warnSpy: vi.spyOn(logger, 'warn'),
    errorSpy: vi.spyOn(logger, 'error'),
  };
}

const row = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  userId: 'user-1',
  title: 'Order confirmed 🌱',
  body: 'Thanks!',
  data: { orderId: 'order-1', orderNumber: 'SKY-1' },
  attempts: 1,
  reclaimed: false,
  ...overrides,
});

describe('NotificationWorkerService', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('claims a batch and delivers each row, accounting for outcomes', async () => {
    const ctx = createWorker();
    ctx.prisma.$queryRaw.mockResolvedValue([
      row('n-1'),
      row('n-2', { reclaimed: true }),
      row('n-3'),
      row('n-4'),
    ]);
    ctx.deliverClaimed
      .mockResolvedValueOnce('SENT')
      .mockResolvedValueOnce('RETRY')
      .mockResolvedValueOnce('FAILED')
      .mockResolvedValueOnce('SUPERSEDED');

    await ctx.worker.processQueuedNotifications();

    expect(ctx.deliverClaimed).toHaveBeenCalledTimes(4);
    // Every delivery is scoped to the run's worker id (owner-guarded writes).
    expect(ctx.deliverClaimed).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'n-1' }),
      expect.stringMatching(/\/\d+\/[0-9a-f-]{36}$/),
    );
    expect(ctx.logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        claimed: 4,
        sent: 1,
        retried: 1,
        failed: 1,
        superseded: 1,
        reclaimed: 1,
      }),
      'notification worker tick',
    );
  });

  it('does nothing and logs nothing when the queue is empty', async () => {
    const ctx = createWorker();
    ctx.prisma.$queryRaw.mockResolvedValue([]);

    await ctx.worker.processQueuedNotifications();

    expect(ctx.deliverClaimed).not.toHaveBeenCalled();
    expect(ctx.logSpy).not.toHaveBeenCalledWith(
      expect.anything(),
      'notification worker tick',
    );
  });

  it('one broken row does not stop the rest of the batch', async () => {
    const ctx = createWorker();
    ctx.prisma.$queryRaw.mockResolvedValue([row('n-1'), row('n-2')]);
    ctx.deliverClaimed
      .mockRejectedValueOnce(new Error('db blip'))
      .mockResolvedValueOnce('SENT');

    await ctx.worker.processQueuedNotifications();

    expect(ctx.deliverClaimed).toHaveBeenCalledTimes(2);
    expect(ctx.warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ notificationId: 'n-1' }),
      expect.anything(),
    );
    // The failed claim is left to lapse via its lease — no crash, no loop.
    expect(ctx.errorSpy).not.toHaveBeenCalled();
  });

  it('a failed claim query is logged and never crashes the tick', async () => {
    const ctx = createWorker();
    ctx.prisma.$queryRaw.mockRejectedValue(new Error('connection lost'));

    await expect(ctx.worker.processQueuedNotifications()).resolves.toBeUndefined();

    expect(ctx.errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'connection lost' }),
      'notification worker tick failed',
    );
  });

  it('is a no-op when NOTIFICATIONS_WORKER_DISABLED=1 (test safety switch)', async () => {
    const ctx = createWorker({ disabled: true });

    await ctx.worker.processQueuedNotifications();

    expect(ctx.prisma.$queryRaw).not.toHaveBeenCalled();
    expect(ctx.deliverClaimed).not.toHaveBeenCalled();
  });

  it('reports its mode on module init (worker started)', () => {
    const enabled = createWorker();
    enabled.worker.onModuleInit();
    expect(enabled.logSpy).toHaveBeenCalledWith(
      expect.stringContaining('notification worker active'),
    );

    const disabled = createWorker({ disabled: true });
    disabled.worker.onModuleInit();
    expect(disabled.logSpy).toHaveBeenCalledWith(
      expect.stringContaining('disabled'),
    );
  });
});
