import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { PrismaClient } from '../src/generated/prisma/client';
import {
  MAX_DELIVERY_ATTEMPTS,
  NotificationsService,
} from '../src/modules/notifications/notifications.service';
import { NotificationWorkerService } from '../src/modules/notifications/notification-worker.service';
import * as incrementMetricModule from '../src/observability/business-metrics';

/**
 * Step 12 — background notification delivery, proven against PostgreSQL.
 *
 * The unit specs pin the business ladder (enqueue-only hot paths, retry
 * classification, commit/rollback boundaries); this suite pins the claims that
 * CANNOT come from a mock:
 *
 * - two API instances (two SEPARATE PrismaClient pools, like two containers
 *   behind a load balancer) claim DISJOINT notification sets — no row is ever
 *   delivered twice, and with more queued rows than one worker's batch size
 *   both instances must participate;
 * - a leased row is invisible to the other instance until the lease lapses,
 *   then a fresh instance reclaims it (crash recovery);
 * - the retry lifecycle (requeue-with-backoff / FAILED / attempt cap) moves
 *   real rows through the real schema.
 *
 * The external provider (Expo) is stubbed at `global.fetch`: delivery latency
 * is the thing under test, but the network is not part of this suite.
 *
 * Runs only when `RUN_DB_E2E=1` and a disposable `DATABASE_URL` is configured
 * (same convention as the other DB e2e specs).
 */

const runDatabaseE2e = process.env.RUN_DB_E2E === '1';

// Fixture ids — fixed email keeps reruns idempotent; everything this suite
// creates is scoped to this one user, so cleanup never touches stranger rows.
const USER_EMAIL = 'notification-worker-e2e@sakyafarms.example';
const DEVICE_TOKEN = 'EXPONENT_PUSH_TOKEN:notif-worker-e2e';

/** Shape the private `claim()` returns (worker-internal, asserted here). */
interface ClaimRow {
  id: string;
  userId: string;
  title: string;
  body: string;
  data: unknown;
  attempts: number;
  reclaimed: boolean;
}
interface Claimable {
  claim: (workerId: string) => Promise<ClaimRow[]>;
}

/** One tick's summary log, as emitted by `processQueuedNotifications`. */
interface TickSummary {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  superseded: number;
  reclaimed: number;
}

describe.skipIf(!runDatabaseE2e)('Notification worker (seeded PostgreSQL)', () => {
  let dbA: PrismaClient;
  let dbB: PrismaClient;
  let userId: string;

  /** orderNumbers actually POSTed to the (stubbed) Expo endpoint, in order. */
  let delivered: string[];
  const fetchMock = vi.fn();

  /** Rows owned by the fixture user — safe while `userId` is set. */
  async function cleanupRows(): Promise<void> {
    await dbA.notification.deleteMany({ where: { userId } });
    await dbA.devicePushToken.deleteMany({ where: { userId } });
  }

  async function cleanup(): Promise<void> {
    await cleanupRows();
    await dbA.user.deleteMany({ where: { email: USER_EMAIL } });
  }

  /** A fresh QUEUED row for this suite's user. */
  async function seedQueued(orderNumber: string): Promise<string> {
    const row = await dbA.notification.create({
      data: {
        userId,
        channel: 'PUSH',
        status: 'QUEUED',
        title: 'Order update',
        body: 'Background delivery test',
        data: { orderNumber },
      },
    });
    return row.id;
  }

  function readRow(id: string) {
    return dbA.notification.findUniqueOrThrow({ where: { id } });
  }

  /** Worker whose cron is enabled (vitest config disables it globally). */
  function makeWorker(client: PrismaClient): NotificationWorkerService {
    const notifications = new NotificationsService(client as never, {} as never);
    return new NotificationWorkerService(client as never, notifications);
  }

  /** Watch one worker's logger for its per-tick summary lines. */
  function watchSummaries(worker: NotificationWorkerService) {
    const logger = (worker as unknown as { logger: { log: (...args: unknown[]) => void } })
      .logger;
    const spy = vi.spyOn(logger, 'log');
    return () =>
      spy.mock.calls
        .filter((call) => call[1] === 'notification worker tick')
        .map((call) => call[0] as TickSummary);
  }

  /** Successful Expo response that records which orderNumber was sent. */
  function expoAccepts(): void {
    let ticket = 0;
    fetchMock.mockImplementation(async (_url: unknown, init?: { body?: string }) => {
      const batch = JSON.parse(init?.body ?? '[]') as Array<{
        data?: { orderNumber?: string };
      }>;
      for (const message of batch) delivered.push(message.data?.orderNumber ?? 'unknown');
      ticket += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ status: 'ok', id: `ticket-${ticket}` }] }),
      };
    });
  }

  /** Non-OK Expo response (still records the attempt). */
  function expoRejects(status: number): void {
    fetchMock.mockImplementation(async (_url: unknown, init?: { body?: string }) => {
      const batch = JSON.parse(init?.body ?? '[]') as Array<{
        data?: { orderNumber?: string };
      }>;
      for (const message of batch) delivered.push(message.data?.orderNumber ?? 'unknown');
      return { ok: false, status, json: async () => ({ error: 'stubbed' }) };
    });
  }

  beforeAll(async () => {
    const connection = { connectionString: process.env.DATABASE_URL };
    dbA = new PrismaClient({ adapter: new PrismaPg(connection) });
    dbB = new PrismaClient({ adapter: new PrismaPg(connection) });

    // Resolve the fixture user FIRST so every cleanup below is scoped by id
    // (an undefined `userId` in a where-clause would match every row).
    const user = await dbA.user.upsert({
      where: { email: USER_EMAIL },
      update: {},
      create: {
        email: USER_EMAIL,
        firstName: 'Worker',
        lastName: 'E2E',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });
    userId = user.id;

    await cleanupRows();

    // Safety rail: the worker's claim query is intentionally global (it drains
    // the whole queue). If any stranger QUEUED row existed, this suite could
    // deliver it — fail loudly instead.
    expect(await dbA.notification.count({ where: { status: 'QUEUED' } })).toBe(0);

    await dbA.devicePushToken.upsert({
      where: { token: DEVICE_TOKEN },
      update: { userId, deactivatedAt: null },
      create: { userId, token: DEVICE_TOKEN, platform: 'ANDROID', deviceName: 'E2E Device' },
    });

    // The cron is disabled in vitest config; workers built here run their
    // ticks manually. `enabled` is read at construction time, so stub first.
    vi.stubEnv('NOTIFICATIONS_WORKER_DISABLED', '0');

    // External provider is never contacted from a test: delivery outcomes are
    // scripted per test through `fetchMock`.
    vi.stubGlobal('fetch', fetchMock);
  }, 90_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await cleanup();
    await dbA.$disconnect();
    await dbB.$disconnect();
  }, 90_000);

  beforeEach(async () => {
    delivered = [];
    fetchMock.mockReset();
    await dbA.notification.deleteMany({ where: { userId } });
  });

  it('D/K. two independent instances drain one queue concurrently: disjoint claims, every row delivered exactly once', async () => {
    // More rows than one worker's batch (5) forces BOTH instances to claim —
    // a single instance cannot drain 8 rows in one tick.
    const orderNumbers = Array.from({ length: 8 }, (_, index) => `NW-TEST-D-${index}`);
    for (const orderNumber of orderNumbers) await seedQueued(orderNumber);

    expoAccepts();
    const workerA = makeWorker(dbA);
    const workerB = makeWorker(dbB);
    const summariesA = watchSummaries(workerA);
    const summariesB = watchSummaries(workerB);

    await Promise.all([
      workerA.processQueuedNotifications(),
      workerB.processQueuedNotifications(),
    ]);

    const claimsA = summariesA().reduce((sum, tick) => sum + tick.claimed, 0);
    const claimsB = summariesB().reduce((sum, tick) => sum + tick.claimed, 0);

    // Both instances participated (8 rows, batch of 5 each) and, together,
    // claimed every row exactly once — no overlap, no orphan.
    expect(claimsA + claimsB).toBe(orderNumbers.length);
    expect(Math.min(claimsA, claimsB)).toBeGreaterThanOrEqual(
      orderNumbers.length - NotificationWorkerService.CLAIM_BATCH_SIZE,
    );

    // Delivery happened once per row: the stubbed provider saw each
    // orderNumber exactly once (this is the "not sent twice" proof).
    expect([...delivered].sort()).toEqual([...orderNumbers].sort());

    for (const orderNumber of orderNumbers) {
      const row = await dbA.notification.findFirstOrThrow({
        where: { data: { path: ['orderNumber'], equals: orderNumber } },
      });
      expect(row.status).toBe('SENT');
      expect(row.attempts).toBe(1);
      expect(row.claimedBy).toBeNull(); // claim released on success
      expect(row.claimedAt).toBeNull();
      expect(row.sentAt).not.toBeNull();
      expect(row.providerMessageId).not.toBeNull();
    }

    // Observability: each instance logged its own successful tick.
    for (const summaries of [summariesA, summariesB]) {
      for (const tick of summaries()) {
        expect(tick.sent).toBe(tick.claimed);
        expect(tick.failed).toBe(0);
        expect(tick.superseded).toBe(0);
      }
    }
  });

  it('C/D/I/J. a leased row is invisible to the second instance until the lease lapses, then it is reclaimed and delivered', async () => {
    const id = await seedQueued('NW-TEST-LEASE');

    // C: an instance claims the row atomically — attempt burned, lease stamped.
    const crashedWorker = makeWorker(dbA);
    const claimed = await (crashedWorker as unknown as Claimable).claim(
      'e2e-crashed-instance',
    );
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.id).toBe(id);
    expect(claimed[0]?.attempts).toBe(1);

    const leased = await readRow(id);
    expect(leased.status).toBe('QUEUED');
    expect(leased.claimedBy).toBe('e2e-crashed-instance');
    expect(leased.claimedAt).not.toBeNull();

    // D: while the lease is live, the other instance's tick skips the row —
    // no delivery attempt, no state change.
    expoAccepts();
    const liveWorker = makeWorker(dbB);
    await liveWorker.processQueuedNotifications();
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await readRow(id)).claimedBy).toBe('e2e-crashed-instance');

    // I: simulate the crash — the holder never releases, the lease simply runs
    // out (backdated here instead of sleeping 2 minutes).
    await dbA.notification.update({
      where: { id },
      data: { claimedAt: new Date(Date.now() - NotificationWorkerService.CLAIM_LEASE_MS - 1_000) },
    });

    const takeoverWorker = makeWorker(dbB);
    await takeoverWorker.processQueuedNotifications();

    expect(delivered).toEqual(['NW-TEST-LEASE']);
    const reclaimed = await readRow(id);
    expect(reclaimed.status).toBe('SENT');
    expect(reclaimed.attempts).toBe(2); // the reclaim burned the second attempt
    expect(reclaimed.claimedBy).toBeNull();

    // J: a SENT row is never processed again.
    const afterWorker = makeWorker(dbA);
    await afterWorker.processQueuedNotifications();
    expect(delivered).toEqual(['NW-TEST-LEASE']);
    expect((await readRow(id)).attempts).toBe(2);
  });

  it('F. a transient provider failure requeues the row with backoff and records the reason', async () => {
    const id = await seedQueued('NW-TEST-RETRY');

    expoRejects(503);
    const worker = makeWorker(dbA);
    await worker.processQueuedNotifications();

    expect(delivered).toEqual(['NW-TEST-RETRY']); // attempted exactly once
    const row = await readRow(id);
    expect(row.status).toBe('QUEUED'); // still durable, still queued
    expect(row.attempts).toBe(1);
    expect(row.claimedBy).toBeNull(); // claim released for the next attempt
    expect(row.claimedAt).toBeNull();
    expect(row.failureReason).toContain('503');
    // Backoff for attempt 1 is RETRY_BASE_MS (30s): not due immediately.
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 20_000);

    await worker.processQueuedNotifications();
    expect(delivered).toEqual(['NW-TEST-RETRY']); // backoff prevented a hot loop
  });

  it('H. a permanent provider failure becomes FAILED immediately with the reason preserved', async () => {
    const id = await seedQueued('NW-TEST-PERMANENT');

    expoRejects(400);
    const worker = makeWorker(dbA);
    await worker.processQueuedNotifications();

    const row = await readRow(id);
    expect(row.status).toBe('FAILED');
    expect(row.attempts).toBe(1); // permanent failures never burn extra attempts
    expect(row.failureReason).toContain('400');
    expect(row.claimedBy).toBeNull();

    // A FAILED row is terminal: the next tick must not touch it.
    expoAccepts();
    await worker.processQueuedNotifications();
    // Only the first (rejected) attempt was ever sent — no re-delivery.
    expect(delivered).toEqual(['NW-TEST-PERMANENT']);
    expect((await readRow(id)).status).toBe('FAILED');
  });

  it('G. the attempt cap turns a persistently transient failure into FAILED', async () => {
    const id = await seedQueued('NW-TEST-CAP');
    // Simulate four prior transient attempts: the next claim is attempt 5.
    await dbA.notification.update({
      where: { id },
      data: { attempts: MAX_DELIVERY_ATTEMPTS - 1 },
    });

    expoRejects(503);
    const worker = makeWorker(dbA);
    await worker.processQueuedNotifications();

    const row = await readRow(id);
    expect(row.status).toBe('FAILED');
    expect(row.attempts).toBe(MAX_DELIVERY_ATTEMPTS); // claim burned the cap attempt
    expect(row.failureReason).toContain(`after ${MAX_DELIVERY_ATTEMPTS} attempts`);
    expect(row.failureReason).toContain('503'); // root cause preserved
  });

  // -------------------------------------------------------------------------
  // Observability: notificationRetries / notificationPermanentFailures at the
  // real worker tick path (side effects only).
  //
  // The unit `deliverClaimed` specs already prove the OUTCOME ladder
  // (RETRY vs FAILED); this test proves the COUNTER is wired to that real
  // path by the worker tick — the link the unit specs cannot show without
  // turning the whole tick into a mock.
  // -------------------------------------------------------------------------

  describe('notificationRetries + notificationPermanentFailures counters at the real worker tick path', () => {
    let incrementMetricSpy: MockInstance;

    beforeEach(() => {
      // Spy on the real counter so we can prove the worker tick increments it
      // without changing the worker's behaviour (the spy is a pass-through).
      incrementMetricSpy = vi.spyOn(incrementMetricModule, 'incrementMetric');
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('increments notificationRetries exactly once when a transient provider failure is requeued', async () => {
      const id = await seedQueued('NW-TEST-RETRY-COUNTER');

      expoRejects(503);
      const worker = makeWorker(dbA);
      await worker.processQueuedNotifications();

      // The worker classified the provider failure as transient and requeued.
      const row = await readRow(id);
      expect(row.status).toBe('QUEUED');
      expect(row.failureReason).toContain('503');

      // One counter increment for the one retry that happened.
      expect(incrementMetricSpy).toHaveBeenCalledTimes(1);
      expect(incrementMetricSpy).toHaveBeenCalledWith('notificationRetries');
    });

    it('increments notificationPermanentFailures exactly once when a permanent provider rejection fails the row', async () => {
      const id = await seedQueued('NW-TEST-PERMANENT-COUNTER');

      expoRejects(400);
      const worker = makeWorker(dbA);
      await worker.processQueuedNotifications();

      // The worker classified the provider failure as permanent and failed the row.
      const row = await readRow(id);
      expect(row.status).toBe('FAILED');
      expect(row.failureReason).toContain('400');

      // One counter increment for the one permanent failure that happened.
      expect(incrementMetricSpy).toHaveBeenCalledTimes(1);
      expect(incrementMetricSpy).toHaveBeenCalledWith('notificationPermanentFailures');
    });

    it('increments neither retry nor permanent-failure counter for a successful delivery', async () => {
      const id = await seedQueued('NW-TEST-SENT-COUNTER');

      expoAccepts();
      const worker = makeWorker(dbA);
      await worker.processQueuedNotifications();

      // Delivery succeeded — no failure counters should fire.
      const row = await readRow(id);
      expect(row.status).toBe('SENT');

      expect(incrementMetricSpy).not.toHaveBeenCalledWith('notificationRetries');
      expect(incrementMetricSpy).not.toHaveBeenCalledWith('notificationPermanentFailures');
    });
  });
});

// ---------------------------------------------------------------------------
// Step 12 correction — transactional outbox pairing (the commit-to-notification
// crash gap). This suite lives in the SAME file as the worker suite on
// purpose: the worker's claim query is global, and vitest parallelises FILES
// (separate processes) while serialising tests within one file — a concurrent
// file's QUEUED rows would be claimed across suites against the shared
// database, corrupting both suites' assertions.
// ---------------------------------------------------------------------------

describe.skipIf(!runDatabaseE2e)('Notification outbox transaction pairing (seeded PostgreSQL)', () => {
  // Fixture ids — fixed email keeps reruns idempotent; every row this suite
  // creates is scoped to this one user/order prefix, so cleanup is a prefix match.
  const USER_EMAIL = 'notification-outbox-e2e@sakyafarms.example';
  const STORE_ID = '0d700000-0000-4000-8000-000000000001';
  const DEVICE_TOKEN = 'EXPONENT_PUSH_TOKEN:outbox-e2e';
  const ORDER_PREFIX = 'OUTBOX-TEST-';

  let db: PrismaClient;
  let userId: string;

  /** orderNumbers actually POSTed to the stubbed Expo endpoint, in order. */
  let delivered: string[];
  const fetchMock = vi.fn();

  /** Rows owned by the fixture user/order prefix — safe while `userId` is set. */
  async function cleanupRows(): Promise<void> {
    await db.notification.deleteMany({ where: { userId } });
    await db.devicePushToken.deleteMany({ where: { userId } });
    await db.order.deleteMany({ where: { orderNumber: { startsWith: ORDER_PREFIX } } });
  }

  async function cleanup(): Promise<void> {
    await cleanupRows();
    await db.user.deleteMany({ where: { email: USER_EMAIL } });
  }

  /** One PENDING_PAYMENT order; `orderNumber` doubles as this test's key. */
  async function seedOrder(orderNumber: string): Promise<string> {
    const id = randomUUID();
    await db.order.create({
      data: {
        id,
        orderNumber,
        userId,
        storeId: STORE_ID,
        status: 'PENDING_PAYMENT',
        paymentStatus: 'PENDING',
        subtotalInPaise: 3000,
        totalInPaise: 3000,
        shippingAddress: {},
      },
    });
    return id;
  }

  function readOrder(id: string) {
    return db.order.findUniqueOrThrow({ where: { id } });
  }

  function intentsFor(orderNumber: string) {
    return db.notification.findMany({
      where: { data: { path: ['orderNumber'], equals: orderNumber } },
    });
  }

  /**
   * THE pattern under test: business mutation + durable intent on one real
   * transaction. `afterEnqueue` runs after the intent is scheduled — tests
   * use it to throw before commit.
   */
  async function cancelWithOutbox(
    orderId: string,
    orderNumber: string,
    afterEnqueue?: () => void,
  ): Promise<void> {
    const notifications = new NotificationsService(db as never, {} as never);
    await db.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'Outbox e2e' },
      });
      await notifications.sendOrderStatusPush(
        {
          userId,
          orderId,
          orderNumber,
          status: 'CANCELLED',
          reason: 'Outbox e2e',
        },
        tx,
      );
      afterEnqueue?.();
    });
  }

  /** Worker whose cron is enabled (vitest config disables it globally). */
  function makeWorker(): NotificationWorkerService {
    const notifications = new NotificationsService(db as never, {} as never);
    return new NotificationWorkerService(db as never, notifications);
  }

  function expoAccepts(): void {
    let ticket = 0;
    fetchMock.mockImplementation(async (_url: unknown, init?: { body?: string }) => {
      const batch = JSON.parse(init?.body ?? '[]') as Array<{
        data?: { orderNumber?: string };
      }>;
      for (const message of batch) delivered.push(message.data?.orderNumber ?? 'unknown');
      ticket += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ status: 'ok', id: `ticket-${ticket}` }] }),
      };
    });
  }

  function expoRejects(status: number): void {
    fetchMock.mockImplementation(async (_url: unknown, init?: { body?: string }) => {
      const batch = JSON.parse(init?.body ?? '[]') as Array<{
        data?: { orderNumber?: string };
      }>;
      for (const message of batch) delivered.push(message.data?.orderNumber ?? 'unknown');
      return { ok: false, status, json: async () => ({ error: 'stubbed' }) };
    });
  }

  beforeAll(async () => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

    // Resolve the fixture user FIRST so every cleanup below is scoped by id
    // (an undefined `userId` in a where-clause would match every row).
    const user = await db.user.upsert({
      where: { email: USER_EMAIL },
      update: {},
      create: {
        email: USER_EMAIL,
        firstName: 'Outbox',
        lastName: 'E2E',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });
    userId = user.id;

    await cleanupRows();

    // Safety rail: the worker's claim query is global — fail loudly rather
    // than deliver a stranger's row.
    expect(await db.notification.count({ where: { status: 'QUEUED' } })).toBe(0);

    await db.store.upsert({
      where: { id: STORE_ID },
      update: { isActive: true },
      create: { id: STORE_ID, code: 'OUTBOX-TEST', name: 'Outbox Test Store', isActive: true },
    });

    // A registered device for the fixture user, so delivery attempts in
    // tests C/D actually reach the (stubbed) provider.
    await db.devicePushToken.upsert({
      where: { token: DEVICE_TOKEN },
      update: { userId, deactivatedAt: null },
      create: { userId, token: DEVICE_TOKEN, platform: 'ANDROID', deviceName: 'Outbox E2E' },
    });

    // The cron is disabled in vitest config; tests tick manually.
    vi.stubEnv('NOTIFICATIONS_WORKER_DISABLED', '0');
    vi.stubGlobal('fetch', fetchMock);
  }, 90_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await cleanup();
    await db.$disconnect();
  }, 90_000);

  beforeEach(async () => {
    delivered = [];
    fetchMock.mockReset();
    await db.notification.deleteMany({ where: { userId } });
    await db.order.deleteMany({ where: { orderNumber: { startsWith: ORDER_PREFIX } } });
  });

  it('A. committed business transaction also commits the QUEUED notification intent', async () => {
    const orderNumber = `${ORDER_PREFIX}A`;
    const id = await seedOrder(orderNumber);

    await cancelWithOutbox(id, orderNumber);

    // Both halves committed together…
    const order = await readOrder(id);
    expect(order.status).toBe('CANCELLED');

    const intents = await intentsFor(orderNumber);
    expect(intents).toHaveLength(1);
    expect(intents[0]?.status).toBe('QUEUED');
    expect(intents[0]?.attempts).toBe(0);
    expect(intents[0]?.claimedBy).toBeNull();
  });

  it('B. a crash AFTER scheduling the intent but BEFORE commit rolls back BOTH rows', async () => {
    const orderNumber = `${ORDER_PREFIX}B`;
    const id = await seedOrder(orderNumber);

    await expect(
      cancelWithOutbox(id, orderNumber, () => {
        // The intent is already written on this transaction — now "crash".
        throw new Error('crash before commit');
      }),
    ).rejects.toThrow('crash before commit');

    // Neither the business state nor the intent survived: no crash window
    // where a committed order has a lost notification.
    const order = await readOrder(id);
    expect(order.status).toBe('PENDING_PAYMENT');
    expect(await intentsFor(orderNumber)).toHaveLength(0);
  });

  it('C. provider failure after commit leaves the committed business state untouched', async () => {
    const orderNumber = `${ORDER_PREFIX}C`;
    const id = await seedOrder(orderNumber);
    await cancelWithOutbox(id, orderNumber);

    // Expo has a bad day: the worker's delivery attempt fails transiently.
    expoRejects(503);
    await makeWorker().processQueuedNotifications();

    // Business outcome is still the committed one — a push failure can never
    // resurrect a CANCELLED order…
    const order = await readOrder(id);
    expect(order.status).toBe('CANCELLED');

    // …and the intent survives for retry, with the reason recorded.
    const intents = await intentsFor(orderNumber);
    expect(intents).toHaveLength(1);
    expect(intents[0]?.status).toBe('QUEUED');
    expect(intents[0]?.attempts).toBe(1);
    expect(intents[0]?.failureReason).toContain('503');
    expect(delivered).toEqual([orderNumber]); // attempted exactly once
  });

  it('D/E. the worker later delivers the committed intent — and never twice', async () => {
    const orderNumber = `${ORDER_PREFIX}D`;
    const id = await seedOrder(orderNumber);
    await cancelWithOutbox(id, orderNumber);

    expoAccepts();
    await makeWorker().processQueuedNotifications();

    // D: the row that survived the commit was claimed and delivered.
    expect(delivered).toEqual([orderNumber]);
    const intents = await intentsFor(orderNumber);
    expect(intents[0]?.status).toBe('SENT');
    expect(intents[0]?.sentAt).not.toBeNull();
    expect(intents[0]?.providerMessageId).not.toBeNull();

    // E: a SENT row is terminal — a second tick does not resend it.
    await makeWorker().processQueuedNotifications();
    expect(delivered).toEqual([orderNumber]);
    expect((await intentsFor(orderNumber))[0]?.attempts).toBe(1);
  });
});
