import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { PaymentDetail, PaymentIntentResponse, PaymentRefundResponse } from '@sakya/types';
import {
  cancelPaymentSchema,
  createPaymentIntentSchema,
  paymentIdParamSchema,
  paymentOrderIdParamSchema,
  refundPaymentSchema,
  type CancelPaymentRequest,
  type CreatePaymentIntentRequest,
  type PaymentIdParam,
  type PaymentOrderIdParam,
  type RefundPaymentRequest,
} from '@sakya/validation';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PaymentsService } from './payments.service';

/**
 * Authenticated payment endpoints.
 *
 * There is deliberately NO client-driven confirm/mark-paid endpoint: payment
 * state advances only via provider-signed webhooks, owner cancellation of an
 * open payment, or privileged refunds. A mobile client saying "I paid" changes
 * nothing.
 *
 *   POST   /payments/intent          create an online intent   (orders:write)
 *   GET    /payments/orders/:orderId list attempts for my order (orders:read:own)
 *   POST   /payments/:id/cancel      cancel my open payment    (orders:cancel)
 *   POST   /payments/:id/refund      refund captured money     (payments:refund, ADMIN+)
 */
@Controller('payments')
@UseGuards(PermissionsGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Permissions('orders:write')
  @Post('intent')
  async createIntent(
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(createPaymentIntentSchema)) body: CreatePaymentIntentRequest,
  ): Promise<PaymentIntentResponse> {
    return this.paymentsService.createIntent(userId, body);
  }

  @Permissions('orders:read:own')
  @Get('orders/:orderId')
  async listForOrder(
    @CurrentUser('id') userId: string,
    @Param(new ZodValidationPipe(paymentOrderIdParamSchema)) params: PaymentOrderIdParam,
  ): Promise<PaymentDetail[]> {
    return this.paymentsService.listForOrder(userId, params.orderId);
  }

  @Permissions('orders:cancel')
  @Post(':id/cancel')
  async cancel(
    @CurrentUser('id') userId: string,
    @Param(new ZodValidationPipe(paymentIdParamSchema)) params: PaymentIdParam,
    @Body(new ZodValidationPipe(cancelPaymentSchema)) body: CancelPaymentRequest,
  ): Promise<PaymentDetail> {
    return this.paymentsService.cancelPayment(userId, params.id, body.reason);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Permissions('payments:refund')
  @Post(':id/refund')
  async refund(
    @Param(new ZodValidationPipe(paymentIdParamSchema)) params: PaymentIdParam,
    @Body(new ZodValidationPipe(refundPaymentSchema)) body: RefundPaymentRequest,
  ): Promise<PaymentRefundResponse> {
    return this.paymentsService.refundPayment(params.id, body);
  }
}
