import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import type { PaymentDetail } from '@sakya/types';
import {
  paymentIdParamSchema,
  simulatePaymentSchema,
  type PaymentIdParam,
  type SimulatePaymentRequest,
} from '@sakya/validation';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PaymentsService } from './payments.service';

/**
 * Demo-build payment simulation.
 *
 * The demo has no real gateway, but the customer payment experience must be
 * the REAL one: an intent is created, the provider "answers", and the state
 * machine — not the client's say-so — decides what the order shows. This
 * controller synthesises that provider answer.
 *
 *   POST /payments/:id/simulate   { outcome: 'success' | 'failure' }
 *
 * Hard rules (enforced in `PaymentsService.simulateOutcome`):
 * - refuses to run in production — the route 404s there, same as any
 *   unconfigured provider;
 * - only moves payments the caller owns, on the MOCK provider, still open;
 * - every simulated outcome travels through `processWebhookEvent`, exactly
 *   like a signed gateway webhook: transitions, order mirroring and the
 *   customer notification all behave as they would for real money.
 *
 * This file is the demo seam. When a real gateway adapter lands, this
 * controller is deleted and the customer flow re-points at the gateway SDK —
 * nothing else changes.
 */
@Controller('payments')
@UseGuards(PermissionsGuard)
export class PaymentsDemoController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Permissions('orders:write')
  @Post(':id/simulate')
  simulate(
    @CurrentUser('id') userId: string,
    @Param(new ZodValidationPipe(paymentIdParamSchema)) params: PaymentIdParam,
    @Body(new ZodValidationPipe(simulatePaymentSchema)) body: SimulatePaymentRequest,
  ): Promise<PaymentDetail> {
    return this.paymentsService.simulateOutcome(userId, params.id, body.outcome);
  }
}
