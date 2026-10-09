import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import type { AppConfig } from '../../config/configuration';

import {
  ORDER_EXPIRY_JOB,
  ORDER_EXPIRY_LEASE_MS,
  releaseJobLock,
  tryAcquireJobLock,
} from '../../common/job-lock';
import { PrismaService } from '../../database/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { releaseOrderReservations } from '../inventory/order-reservations';

/**
 * Pending-order expiry.
 *
 * A PENDING_PAYMENT order holds a stock reservation. If the customer never
 * completes payment, the reservation would hold stock forever. Every few
 * minutes this job sweeps stale PENDING_PAYMENT orders — but it is built so
 * it can NEVER cancel an order whose money has arrived:
 *
 *  1. COD orders are skipped outright. They are PENDING_PAYMENT by design
 *     until delivery — and the exclusion matches on the payment METHOD, not
 *     just the presence of a row.
 *  2. Any order holding a CAPTURED payment is skipped, and if
 *     the order is somehow still PENDING_PAYMENT with money attached (a
 *     webhook that landed between states), the sweep AUTO-HEALS it: the
 *     order is advanced through the same payment-captured transition the
 *     webhook uses. This is the belt to the webhook's braces.
 *  3. Before cancelling a gateway order (Razorpay), the sweep ASKS THE
 *     GATEWAY. The database cannot see a capture whose webhook is still in
 *     flight, so `reconcilePayment` queries Razorpay authoritatively — and
 *     CAPTURES an authorization only the gateway knows about, so an
 *     almost-paid order is driven to captured instead of stranded. If money
 *     is found, the event is applied through the real state machine and the
 *     order is left alone. An unreachable gateway skips the order
 *     this run — a stale order sweeps next tick, a wrongly cancelled paid
 *     order cannot be undone by waiting.
 *  4. If the gateway was unreachable but the database itself holds
 *     AUTHORIZED money, the order still survives this run: an authorization
 *     is real money in flight, and the next sweep retries the reconcile.
 *
 * Interval-based `Cron` from @nestjs/schedule. OVERLAP SAFETY is two-layered:
 *
 *  1. the whole sweep runs under a DATABASE job lock (`job_locks` row claimed
 *     by an atomic conditional UPDATE with a lease) — an overlapping tick on
 *     this instance, on another instance, or after a crash retry, finds the
 *     lock held and skips. No process-local state is trusted.
 *  2. even if two runs ever did process the same order (a lease outliving its
 *     holder mid-flight), the per-order transition is a conditional UPDATE on
 *     `status = PENDING_PAYMENT' inside one transaction together with the
 *     status-history row and the ledger-idempotent reservation release — so
 *     the second run's update matches zero rows and becomes a no-op. Overlap
 *     degrades to duplicate work, never to a double expiry.
 */
@Injectable()
export class OrderExpiryService implements OnModuleInit {
  private readonly logger = new Logger(OrderExpiryService.name);
  private expiryMinutes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly paymentsService: PaymentsService,
  ) {
    this.expiryMinutes = this.config.get('commerce.pendingOrderExpiryMinutes', { infer: true })!;
  }

  onModuleInit(): void {
    this.logger.log(`Pending-order expiry active: ${this.expiryMinutes} minutes`);
  }

  // Every 5 minutes; a run that overlaps the previous one (slow gateway, a
  // second instance, a crash-and-retry) skips via the database job lock.
  @Cron('*/5 * * * *')
  async expireStalePendingOrders(): Promise<void> {
    // Identity of THIS run: host + pid + nonce, so logs and the lock row say
    // which instance held the sweep. Contains no secrets.
    const owner = `${hostname()}/${process.pid}/${randomUUID()}`;

    // Database-level overlap guard: exactly one instance may sweep at a time.
    const acquired = await tryAcquireJobLock(
      this.prisma,
      ORDER_EXPIRY_JOB,
      owner,
      ORDER_EXPIRY_LEASE_MS,
    );
    if (!acquired) {
      this.logger.warn('order-expiry sweep skipped: job lock held by another instance');
      return;
    }

    const summary = {
      candidates: 0,
      expired: 0,
      skippedStateChanged: 0,
      autoHealedMoney: 0,
      paidAtGateway: 0,
      authorizedKept: 0,
      failed: 0,
    };
    const startedAt = Date.now();
    this.logger.log({ owner }, 'order-expiry sweep started');

    try {
      const cutoff = new Date(Date.now() - this.expiryMinutes * 60 * 1000);

      const stale = await this.prisma.order.findMany({
        where: {
          status: 'PENDING_PAYMENT',
          createdAt: { lt: cutoff },
          // COD orders are legitimately pending until delivery: never expire
          // them. Matching on the METHOD (not merely the existence of a payment
          // row) keeps the exclusion exact even as new methods appear.
          payments: { none: { method: 'CASH_ON_DELIVERY', status: 'PENDING' } },
        },
        select: {
          id: true,
          orderNumber: true,
          userId: true,
          payments: {
            select: {
              id: true,
              provider: true,
              providerPaymentId: true,
              providerOrderId: true,
              status: true,
            },
          },
        },
        take: 50,
      });
      summary.candidates = stale.length;

      for (const order of stale) {
        try {
          // 1. CAPTURED money recorded locally: auto-heal through the real
          //    state machine and never cancel.
          const captured = order.payments.find((payment) => payment.status === 'CAPTURED');

          if (captured !== undefined) {
            // Money already reached us after the query snapshot (or a webhook
            // landed between states). Auto-heal: advance the order exactly the
            // way a captured webhook would, and never cancel it.
            await this.paymentsService.processWebhookEvent(captured.provider, {
              type: 'captured',
              providerPaymentId: captured.providerPaymentId ?? `reconciled-${captured.id}`,
              amountInPaise: undefined,
              currency: undefined,
              rawPayload: { reconciled: true, orderId: order.id },
            });
            summary.autoHealedMoney += 1;
            this.logger.log(
              { orderId: order.id },
              'aged pending order had money attached; advanced instead of cancelled',
            );
            continue;
          }

          // 2. Before cancelling a gateway order, ask the gateway. The DB
          //    cannot see a capture whose webhook is still in flight — and
          //    reconcile also CAPTURES an authorization only the gateway knows
          //    about, so an almost-paid order is driven to captured instead of
          //    being left authorized-but-unconfirmed.
          const gatewayOrder = order.payments.find(
            (payment) => payment.providerOrderId !== null && payment.providerOrderId !== '',
          );
          if (gatewayOrder !== undefined) {
            const reconciled = await this.paymentsService.reconcilePayment(
              gatewayOrder as unknown as Parameters<PaymentsService['reconcilePayment']>[0],
            );
            if (reconciled !== null) {
              summary.paidAtGateway += 1;
              this.logger.log(
                { orderId: order.id },
                `aged pending order was paid at the gateway (${reconciled.type}); not cancelled`,
              );
              continue;
            }
          }

          // 3. Gateway unreachable, but the DB already holds AUTHORIZED money:
          //    never cancel it. Re-apply the authorization event (a no-op when
          //    already mirrored) so the order survives this run and the next
          //    sweep retries the reconcile/capture.
          const authorized = order.payments.find((payment) => payment.status === 'AUTHORIZED');
          if (authorized !== undefined) {
            await this.paymentsService.processWebhookEvent(authorized.provider, {
              type: 'authorized',
              providerPaymentId: authorized.providerPaymentId ?? `reconciled-${authorized.id}`,
              amountInPaise: undefined,
              currency: undefined,
              rawPayload: { reconciled: true, orderId: order.id },
            });
            summary.authorizedKept += 1;
            this.logger.log(
              { orderId: order.id },
              'aged pending order holds authorized money; not cancelled',
            );
            continue;
          }

          let expiredHere = false;
          await this.prisma.$transaction(async (tx) => {
            // Atomic claim: the second run (or a webhook that already moved
            // the order) matches zero rows and the whole transaction is a
            // no-op — cancel, history row and reservation release land together
            // or not at all.
            const updated = await tx.order.updateMany({
              where: { id: order.id, status: 'PENDING_PAYMENT' },
              data: {
                status: 'CANCELLED',
                cancelledAt: new Date(),
                cancelReason: 'Payment was not completed in time',
              },
            });
            if (updated.count !== 1) {
              summary.skippedStateChanged += 1;
              return;
            }

            await tx.orderStatusHistory.create({
              data: {
                orderId: order.id,
                fromStatus: 'PENDING_PAYMENT',
                toStatus: 'CANCELLED',
                reason: 'Payment window expired',
              },
            });

            await releaseOrderReservations(tx, order.id, 'Payment window expired');
            expiredHere = true;
          });

          if (expiredHere) {
            summary.expired += 1;
            this.logger.log({ orderId: order.id }, 'expired pending order cancelled');
          }
        } catch (error) {
          // One bad order must not stop the sweep.
          summary.failed += 1;
          this.logger.warn({ orderId: order.id, error }, 'expiry sweep failed for order');
        }
      }

      this.logger.log(
        { ...summary, durationMs: Date.now() - startedAt },
        'order-expiry sweep finished',
      );
    } catch (error) {
      // Infrastructure failure (selection/query level): log and rethrow — the
      // cron layer reports it, and the finally below still frees the lock.
      this.logger.error(
        { owner, error, durationMs: Date.now() - startedAt },
        'order-expiry sweep failed',
      );
      throw error;
    } finally {
      try {
        const released = await releaseJobLock(this.prisma, ORDER_EXPIRY_JOB, owner);
        if (!released) {
          this.logger.warn({ owner }, 'order-expiry lock not released: lease already taken over');
        }
      } catch (error) {
        // Never mask the sweep's own outcome. The lease lapses on its own, so
        // a failed release delays the next tick instead of wedging the job.
        this.logger.warn({ owner, error }, 'order-expiry lock release failed; lease will lapse');
      }
    }
  }
}
