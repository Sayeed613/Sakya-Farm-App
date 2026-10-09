import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

import { PrismaService } from '../../database/prisma.service';
import {
  NotificationsService,
  type ClaimedNotification,
} from './notifications.service';
import { incrementMetric } from '../../observability/business-metrics';

/**
 * Background delivery worker for queued notifications.
 *
 * Commerce paths (payment webhooks, cancels, delivery, admin/store transitions,
 * the expiry sweep) only INSERT a durable `QUEUED` notification row — they
 * never talk to Expo. This worker drains that queue:
 *
 *   claim (atomic) → deliver → SENT / requeue-with-backoff / FAILED
 *
 * CLAIMING IS THE CONCURRENCY MECHANISM — database-based, never process-local:
 * one statement selects up to `CLAIM_BATCH_SIZE` rows with
 * `FOR UPDATE SKIP LOCKED`, stamps `claimed_by`/`claimed_at`, increments
 * `attempts`, and returns them. PostgreSQL's row locks plus SKIP LOCKED make
 * concurrent workers take DISJOINT sets, so no notification is sent twice by
 * two live workers. `claimed_at` is a lease (`CLAIM_LEASE_MS`): a worker that
 * crashes mid-send leaves an expired claim that the next tick reclaims
 * (at-least-once delivery — see report for semantics).
 *
 * The cron only *ticks*; correctness lives entirely in the SQL above, so any
 * number of API instances may run this tick simultaneously.
 */
@Injectable()
export class NotificationWorkerService implements OnModuleInit {
  private readonly logger = new Logger(NotificationWorkerService.name);

  /**
   * One tick sends at most this many notifications, sequentially. Kept small
   * against the lease: worst case batch × 10s provider timeout must stay well
   * under CLAIM_LEASE_MS, or a slow-but-healthy send could be reclaimed.
   */
  static readonly CLAIM_BATCH_SIZE = 5;

  /** Lease on a claimed row; a claim older than this is reclaimable. */
  static readonly CLAIM_LEASE_MS = 120_000;

  /**
   * Tests drive `processQueuedNotifications()` directly; the cron is disabled
   * there so no test ever fires real provider traffic (set in vitest config).
   * Production default (unset) = enabled.
   */
  private readonly enabled = process.env.NOTIFICATIONS_WORKER_DISABLED !== '1';

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.logger.log(
      this.enabled
        ? `notification worker active: every 10s, batch=${NotificationWorkerService.CLAIM_BATCH_SIZE}, lease=${NotificationWorkerService.CLAIM_LEASE_MS}ms`
        : 'notification worker cron disabled (NOTIFICATIONS_WORKER_DISABLED); manual ticks only',
    );
  }

  @Cron('*/10 * * * * *')
  async processQueuedNotifications(): Promise<void> {
    if (!this.enabled) return;

    // Identity of this run — diagnostics only, appears in claimed_by.
    const workerId = `${hostname()}/${process.pid}/${randomUUID()}`;
    const startedAt = Date.now();
    const summary = {
      claimed: 0,
      sent: 0,
      retried: 0,
      failed: 0,
      superseded: 0,
      reclaimed: 0,
    };

    try {
      const claimed = await this.claim(workerId);
      summary.claimed = claimed.length;

      for (const row of claimed) {
        if (row.reclaimed) summary.reclaimed += 1;
        try {
          const outcome = await this.notifications.deliverClaimed(row, workerId);
          if (outcome === 'SENT') summary.sent += 1;
          else if (outcome === 'RETRY') {
            summary.retried += 1;
            incrementMetric('notificationRetries');
          }
          else if (outcome === 'FAILED') {
            summary.failed += 1;
            incrementMetric('notificationPermanentFailures');
          }
          else summary.superseded += 1;
        } catch (error) {
          // Unexpected (non-provider) failure — e.g. a database blip during
          // the state transition. The claim is deliberately left to lapse:
          // the lease, not a tight loop, schedules the next attempt.
          this.logger.warn(
            { notificationId: row.id, error: error instanceof Error ? error.message : String(error) },
            'notification delivery attempt errored; claim will lapse',
          );
        }
      }

      if (summary.claimed > 0) {
        this.logger.log({ ...summary, durationMs: Date.now() - startedAt }, 'notification worker tick');
      }
    } catch (error) {
      // A dead database must not crash the process; the next tick retries.
      this.logger.error(
        { error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - startedAt },
        'notification worker tick failed',
      );
    }
  }

  /**
   * Atomically claim the next batch of deliverable rows.
   *
   * Eligible: QUEUED, due (`next_attempt_at <= now()`), and either unclaimed
   * or holding a LEASE THAT LAPSED. The inner select locks only rows it can
   * take (`SKIP LOCKED`), so two workers never receive the same id; the update
   * stamps the claim and burns one attempt in the same statement.
   * `reclaimed` reports rows whose previous claim had expired (crash recovery)
   * for observability.
   */
  private async claim(
    workerId: string,
  ): Promise<Array<ClaimedNotification & { reclaimed: boolean }>> {
    const batchSize = NotificationWorkerService.CLAIM_BATCH_SIZE;
    const leaseMs = NotificationWorkerService.CLAIM_LEASE_MS;

    return this.prisma.$queryRaw<
      Array<ClaimedNotification & { reclaimed: boolean }>
    >`
      WITH candidates AS (
        SELECT id, claimed_at AS previous_claim
        FROM notifications
        WHERE status = 'QUEUED'
          AND next_attempt_at <= now()
          AND (
            claimed_at IS NULL
            OR claimed_at < now() - ${leaseMs}::int * interval '1 millisecond'
          )
        ORDER BY created_at
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE notifications n
      SET claimed_by = ${workerId},
          claimed_at = now(),
          attempts = n.attempts + 1,
          updated_at = now()
      FROM candidates c
      WHERE n.id = c.id
      RETURNING
        n.id,
        n.user_id AS "userId",
        n.title,
        n.body,
        n.data,
        n.attempts,
        (c.previous_claim IS NOT NULL) AS reclaimed
    `;
  }
}
