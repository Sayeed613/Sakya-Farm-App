import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import type { AppConfig } from '../../config/configuration';

import { PrismaService } from '../../database/prisma.service';
import { releaseOrderReservations } from '../inventory/order-reservations';

/**
 * Pending-order expiry.
 *
 * A PENDING_PAYMENT online order holds a stock reservation. If the customer
 * never completes payment (or the demo sheet is abandoned), the reservation
 * would hold stock forever. COD orders are excluded because they have no online
 * payment window. Every few minutes this job:
 *
 *  1. finds PENDING_PAYMENT orders older than the configured window
 *  2. cancels them (state machine: PENDING_PAYMENT → CANCELLED)
 *  3. releases their reservations through the idempotent ledger
 *  4. lets the standard cancelled-order push inform the customer
 *
 * Interval-based `Cron` from @nestjs/schedule; the ledger's idempotency makes
 * overlapping runs harmless.
 */
@Injectable()
export class OrderExpiryService implements OnModuleInit {
  private readonly logger = new Logger(OrderExpiryService.name);
  private expiryMinutes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
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
        payments: { none: { method: 'CASH_ON_DELIVERY' } },
      },
      select: { id: true, orderNumber: true, userId: true },
      take: 50,
    });

    for (const order of stale) {
      try {
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
