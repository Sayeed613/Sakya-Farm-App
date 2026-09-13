import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  PaymentDetail,
  PaymentIntentResponse,
  PaymentMethod,
  PaymentRefundResponse,
  PaymentStatus,
} from '@sakya/types';
import { canTransitionOrder } from '@sakya/types';
import type { CreatePaymentIntentRequest, RefundPaymentRequest } from '@sakya/validation';

import { PrismaService } from '../../database/prisma.service';
import { toPaymentDetail } from './payments.mapper';
import { canTransitionPayment } from './payment-transitions';
import type { IntentView, PaymentProvider, ProviderWebhookEvent } from './providers/payment-provider.interface';

/** Injection token for the provider registry (name -> adapter). */
export const PAYMENT_PROVIDERS = 'PAYMENT_PROVIDERS';
export type PaymentProviderRegistry = Map<string, PaymentProvider>;

/** Orders in these states can never take a new payment intent. */
const TERMINAL_ORDER_STATUSES = new Set(['CANCELLED', 'REFUNDED', 'DELIVERED']);

/** Minimal structural view of a Payment row (avoids generated-client generics). */
export interface PaymentRowView {
  id: string;
  orderId: string;
  provider: string;
  providerPaymentId: string | null;
  method: string;
  status: string;
  currency: string;
  amountInPaise: number;
  refundedInPaise: number;
  failureReason: string | null;
  capturedAt: Date | null;
  refundedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Payment orchestration. Owns every write to `Payment.status` and the coupled
 * `Order.paymentStatus` / `Order.status` advances.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @Inject(PAYMENT_PROVIDERS) private readonly providers: PaymentProviderRegistry,
  ) {}

  /**
   * Create an online payment intent for one of the caller's orders.
   *
   * Idempotent on the caller-supplied key: a retry with the same key returns
   * the original payment instead of charging twice. The key is globally unique
   * (schema constraint), so a key that belongs to another order is a 409, not
   * a new payment. Amount/currency come from the stored order row only.
   */
  async createIntent(userId: string, body: CreatePaymentIntentRequest): Promise<PaymentIntentResponse> {
    const order = await this.prisma.order.findFirst({
      where: { id: body.orderId, userId },
      select: { id: true, userId: true, status: true, currency: true, totalInPaise: true },
    });

    if (order === null) {
      // Missing and foreign orders share one message so ids are not enumerable.
      throw new NotFoundException('No order found for the given id');
    }

    if (TERMINAL_ORDER_STATUSES.has(order.status)) {
      throw new ConflictException(`Cannot take payment for an order that is ${order.status}`);
    }

    const method = body.method as PaymentMethod;
    const providerName = this.providerForMethod(body.method);
    const provider = this.getAdapter(providerName);

    const existingByKey = await this.prisma.payment.findUnique({
      where: { idempotencyKey: body.idempotencyKey },
    });
    if (existingByKey !== null) {
      if (existingByKey.orderId !== order.id) {
        throw new ConflictException('This idempotency key was already used for a different order');
      }
      this.logger.debug(`Intent idempotent replay for order ${order.id}`);
      return this.toIntentResponse(existingByKey as PaymentRowView, provider);
    }

    // Reuse the checkout-created PENDING row when it matches provider+method.
    const reusable = await this.prisma.payment.findFirst({
      where: { orderId: order.id, provider: providerName, method, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });
    if (reusable !== null) {
      return this.toIntentResponse(reusable as PaymentRowView, provider);
    }

    try {
      const created = await this.prisma.payment.create({
        data: {
          orderId: order.id,
          provider: providerName,
          method,
          status: 'PENDING',
          currency: order.currency,
          amountInPaise: order.totalInPaise,
          idempotencyKey: body.idempotencyKey,
        },
      });
      return this.toIntentResponse(created as PaymentRowView, provider);
    } catch (error) {
      // Lost a race with an identical concurrent request: read back the winner.
      if (this.isUniqueViolation(error)) {
        const winner = await this.prisma.payment.findUnique({
          where: { idempotencyKey: body.idempotencyKey },
        });
        if (winner !== null && winner.orderId === order.id) {
          return this.toIntentResponse(winner as PaymentRowView, provider);
        }
      }
      throw error;
    }
  }

  /** Every payment attempt for one of the caller's orders, oldest first. */
  async listForOrder(userId: string, orderId: string): Promise<PaymentDetail[]> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      select: { id: true },
    });
    if (order === null) {
      throw new NotFoundException('No order found for the given id');
    }

    const rows = await this.prisma.payment.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => toPaymentDetail(row as PaymentRowView));
  }

  /** Adapter lookup shared with the webhook controller. */
  getAdapter(providerName: string): PaymentProvider {
    const adapter = this.providers.get(providerName.toUpperCase());
    if (adapter === undefined) {
      throw new BadRequestException(`Payment provider "${providerName}" is not configured`);
    }
    return adapter;
  }

  /** Cancel a still-open payment. Captured money is refunded, never cancelled. */
  async cancelPayment(userId: string, paymentId: string, reason?: string): Promise<PaymentDetail> {
    const payment = await this.getOwnedPaymentOrThrow(userId, paymentId);

    if (payment.status === 'CAPTURED' || payment.status === 'PARTIALLY_REFUNDED' || payment.status === 'REFUNDED') {
      throw new ConflictException('A captured payment cannot be cancelled; refund it instead');
    }
    if (payment.status === 'FAILED' || payment.status === 'CANCELLED') {
      throw new ConflictException(`This payment is already ${String(payment.status).toLowerCase()}`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'CANCELLED', failureReason: reason ?? payment.failureReason },
      });
      await tx.order.update({
        where: { id: payment.orderId },
        data: { paymentStatus: 'CANCELLED' },
      });
      return next;
    });

    return toPaymentDetail(updated as PaymentRowView);
  }

  /**
   * Refund captured money. Only CAPTURED/PARTIALLY_REFUNDED rows qualify.
   * Omitted amount refunds the remainder in full. Guarded by
   * `payments:refund` at the controller; money invariants re-checked here.
   */
  async refundPayment(paymentId: string, body: RefundPaymentRequest): Promise<PaymentRefundResponse> {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (payment === null) {
      throw new NotFoundException('No payment found for the given id');
    }
    if (payment.status !== 'CAPTURED' && payment.status !== 'PARTIALLY_REFUNDED') {
      throw new ConflictException(`Only captured payments can be refunded (current status: ${payment.status})`);
    }

    const remaining = payment.amountInPaise - payment.refundedInPaise;
    if (remaining <= 0) {
      throw new ConflictException('This payment has already been fully refunded');
    }

    const requested = body.amountInPaise ?? remaining;
    if (!Number.isSafeInteger(requested) || requested <= 0) {
      throw new BadRequestException('Refund amount must be a positive whole number of paise');
    }
    if (requested > remaining) {
      throw new BadRequestException(
        `Refund of ${requested} paise exceeds the refundable remainder of ${remaining} paise`,
      );
    }

    const nextRefunded = payment.refundedInPaise + requested;
    const nextStatus: PaymentStatus = nextRefunded >= payment.amountInPaise ? 'REFUNDED' : 'PARTIALLY_REFUNDED';

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: nextStatus,
          refundedInPaise: nextRefunded,
          refundedAt: new Date(),
          failureReason: body.reason,
        },
      });
      await tx.order.update({
        where: { id: payment.orderId },
        data: { paymentStatus: nextStatus },
      });
      return next;
    });

    this.logger.log(`Refunded ${requested} paise on payment ${payment.id} (${nextStatus})`);
    return { payment: toPaymentDetail(updated as PaymentRowView) };
  }

  /** Apply a verified provider event. Retries converge; mismatches change nothing. */
  async processWebhookEvent(providerName: string, event: ProviderWebhookEvent): Promise<PaymentDetail> {
    const provider = providerName.toUpperCase();
    const existing = await this.prisma.payment.findUnique({
      where: { provider_providerPaymentId: { provider, providerPaymentId: event.providerPaymentId } },
    });
    if (existing === null) {
      this.logger.warn(`Webhook for unknown ${provider} payment ${event.providerPaymentId}`);
      throw new NotFoundException('No payment matches this provider event');
    }
    if (event.amountInPaise !== undefined && event.amountInPaise !== existing.amountInPaise) {
      throw new BadRequestException('Provider amount does not match payment amount');
    }
    if (event.currency !== undefined && event.currency !== existing.currency) {
      throw new BadRequestException('Provider currency does not match payment currency');
    }
    const target = this.targetStatusForEvent(existing as PaymentRowView, event);
    if (this.isReplay(existing.status as PaymentStatus, target, existing.refundedInPaise, event)) {
      this.logger.debug(`Duplicate ${event.type} webhook for payment ${existing.id}; acknowledging`);
      await this.prisma.payment.update({
        where: { id: existing.id },
        data: { providerPayload: event.rawPayload as never },
      });
      const current = await this.prisma.payment.findUniqueOrThrow({ where: { id: existing.id } });
      return toPaymentDetail(current as PaymentRowView);
    }
    if (!canTransitionPayment(existing.status as PaymentStatus, target)) {
      throw new ConflictException(`Cannot move payment from ${existing.status} to ${target}`);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.payment.update({
        where: { id: existing.id },
        data: this.webhookPaymentPatch(existing as PaymentRowView, event, target) as never,
      });
      await this.mirrorToOrder(tx, existing.orderId, target, event);
      return next;
    });
    this.logger.log(`Payment ${existing.id} ${existing.status} -> ${target} via ${provider} webhook`);
    return toPaymentDetail(updated as PaymentRowView);
  }

  private webhookPaymentPatch(
    row: PaymentRowView,
    event: ProviderWebhookEvent,
    target: PaymentStatus,
  ): Record<string, unknown> {
    const base: Record<string, unknown> = { providerPayload: event.rawPayload as never };
    if (event.type === 'failed' || event.type === 'cancelled') {
      return { ...base, status: target, failureReason: event.failureReason ?? row.failureReason };
    }
    if (event.type === 'authorized') {
      return { ...base, status: target };
    }
    if (event.type === 'captured') {
      return { ...base, status: target, capturedAt: new Date() };
    }
    return {
      ...base,
      status: target,
      refundedInPaise: event.refundedInPaise ?? row.amountInPaise,
      refundedAt: new Date(),
      ...(event.failureReason ? { failureReason: event.failureReason } : {}),
    };
  }

  private targetStatusForEvent(row: PaymentRowView, event: ProviderWebhookEvent): PaymentStatus {
    if (event.type === 'refunded') {
      const total = event.refundedInPaise ?? row.amountInPaise;
      if (!Number.isSafeInteger(total) || total <= 0 || total > row.amountInPaise) {
        throw new BadRequestException('Invalid refunded total in provider event');
      }
      return total >= row.amountInPaise ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    }
    if (event.type === 'authorized') {
      return 'AUTHORIZED';
    }
    if (event.type === 'captured') {
      return 'CAPTURED';
    }
    if (event.type === 'failed') {
      return 'FAILED';
    }
    if (event.type === 'cancelled') {
      return 'CANCELLED';
    }
    throw new BadRequestException('Unknown webhook event type');
  }

  private isReplay(
    current: PaymentStatus,
    target: PaymentStatus,
    refundedSoFar: number,
    event: ProviderWebhookEvent,
  ): boolean {
    if (current === target) {
      return true;
    }
    if (event.type === 'refunded') {
      if (current === 'REFUNDED') {
        return true;
      }
      const total = event.refundedInPaise ?? Number.MAX_SAFE_INTEGER;
      if (current === 'PARTIALLY_REFUNDED' && total <= refundedSoFar) {
        return true;
      }
    }
    return false;
  }

  private async mirrorToOrder(
    tx: MirrorTransaction,
    orderId: string,
    target: PaymentStatus,
    event: ProviderWebhookEvent,
  ): Promise<void> {
    const orderPatch: Record<string, unknown> = { paymentStatus: target };
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true },
    });
    if (order !== null) {
      if (target === 'CAPTURED' && canTransitionOrder(order.status as never, 'CONFIRMED' as never)) {
        orderPatch.status = 'CONFIRMED';
        await tx.orderStatusHistory.create({
          data: {
            orderId: order.id,
            fromStatus: order.status as never,
            toStatus: 'CONFIRMED' as never,
            reason: 'Payment captured',
          },
        });
      } else if (target === 'FAILED' && canTransitionOrder(order.status as never, 'FAILED' as never)) {
        orderPatch.status = 'FAILED';
        await tx.orderStatusHistory.create({
          data: {
            orderId: order.id,
            fromStatus: order.status as never,
            toStatus: 'FAILED' as never,
            reason: event.failureReason ?? 'Payment failed',
          },
        });
      }
    }
    await tx.order.update({ where: { id: orderId }, data: orderPatch as never });
  }

  private toIntentResponse(row: PaymentRowView, provider: PaymentProvider): PaymentIntentResponse {
    const view: IntentView = {
      paymentId: row.id,
      provider: row.provider,
      providerPaymentId: row.providerPaymentId,
      amountInPaise: row.amountInPaise,
      currency: row.currency,
      method: row.method,
    };
    return { payment: toPaymentDetail(row), intent: provider.buildIntentResponse(view) };
  }

  private providerForMethod(method: string): string {
    void method;
    if (this.configService.getOrThrow<string>('app.env') === 'production') {
      throw new BadRequestException('Online payments are not enabled yet: no provider configured for production');
    }
    return 'MOCK';
  }

  private async getOwnedPaymentOrThrow(userId: string, paymentId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (payment === null) {
      throw new NotFoundException('No payment found for the given id');
    }
    const order = await this.prisma.order.findUnique({
      where: { id: payment.orderId },
      select: { id: true, userId: true },
    });
    if (order === null || order.userId !== userId) {
      throw new ForbiddenException('You do not have access to this payment');
    }
    return payment;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2002'
    );
  }
}

/** Structural subset of the Prisma transaction client used by mirrorToOrder. */
interface MirrorTransaction {
  order: {
    findUnique(args: unknown): Promise<{ id: string; status: string } | null>;
    update(args: unknown): Promise<unknown>;
  };
  orderStatusHistory: {
    create(args: unknown): Promise<unknown>;
  };
}


