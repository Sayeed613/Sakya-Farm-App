import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import type { AppConfig } from '../../config/configuration';

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
 * Interval-based `Cron` from @nestjs/schedule; the reservation ledger's
 * idempotency makes overlapping runs harmless.
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

  // Every 5 minutes, with jitter-friendly overlap tolerance (idempotent ledger).
  @Cron('*/5 * * * *')
  async expireStalePendingOrders(): Promise<void> {
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
          this.logger.log(
            { orderId: order.id },
            'aged pending order holds authorized money; not cancelled',
          );
          continue;
        }

        await this.prisma.$transaction(async (tx) => {
          const updated = await tx.order.updateMany({
            where: { id: order.id, status: 'PENDING_PAYMENT' },
            data: {
              status: 'CANCELLED',
              cancelledAt: new Date(),
              cancelReason: 'Payment was not completed in time',
            },
          });
          if (updated.count !== 1) return;

          await tx.orderStatusHistory.create({
            data: {
              orderId: order.id,
              fromStatus: 'PENDING_PAYMENT',
              toStatus: 'CANCELLED',
              reason: 'Payment window expired',
            },
          });

          await releaseOrderReservations(tx, order.id, 'Payment window expired');
        });

        this.logger.log({ orderId: order.id }, 'expired pending order cancelled');
      } catch (error) {
        // One bad order must not stop the sweep.
        this.logger.warn({ orderId: order.id, error }, 'expiry sweep failed for order');
      }
    }
  }
}
