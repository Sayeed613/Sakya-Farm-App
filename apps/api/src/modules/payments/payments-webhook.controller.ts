import { Controller, HttpCode, HttpStatus, Param, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { IncomingHttpHeaders } from 'node:http';
import type { PaymentDetail } from '@sakya/types';
import type { Request } from 'express';

import { RAW_BODY_ATTRIBUTE } from '../../app.setup';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { paymentWebhookProviderParamSchema, type PaymentWebhookProviderParam } from '@sakya/validation';
import { PaymentsService } from './payments.service';

/**
 * Provider webhook entrypoint.
 *
 * `@Public()` by necessity — gateways cannot hold user JWTs. Authentication is
 * the provider signature, verified INSIDE the adapter before the service ever
 * runs. Unverified calls are 401 with no state change; unparsable verified
 * calls are 400 with no state change. Retries are safe (idempotent service).
 *
 * The exact request bytes are verified, not a reserialization: `configureApp`
 * stashes the raw buffer on the request via the JSON parser's `verify` hook,
 * so key order and whitespace match what the provider signed.
 */
@Controller('payments/webhook')
export class PaymentsWebhookController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Public()
  @Post(':provider')
  @HttpCode(HttpStatus.OK)
  async handle(
    @Param(new ZodValidationPipe(paymentWebhookProviderParamSchema)) params: PaymentWebhookProviderParam,
    @Req() request: Request,
  ): Promise<PaymentDetail> {
    const adapter = this.paymentsService.getAdapter(params.provider);

    const rawBody = PaymentsWebhookController.rawBodyOf(request);
    const verified = await adapter.verifyWebhookSignature(rawBody, request.headers as IncomingHttpHeaders);
    if (!verified) {
      // No detail: signature failures must not oracle provider configuration.
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const event = adapter.parseWebhookEvent(rawBody);
    return this.paymentsService.processWebhookEvent(params.provider, event);
  }

  private static rawBodyOf(request: Request): Buffer {
    const raw = (request as Request & Record<string, unknown>)[RAW_BODY_ATTRIBUTE];
    if (Buffer.isBuffer(raw)) {
      return raw;
    }
    if (typeof raw === 'string') {
      return Buffer.from(raw, 'utf8');
    }
    // No raw bytes captured (e.g. a unit test calling the handler directly):
    // fall back to the parsed body so the adapter contract stays testable.
    const body = request.body as unknown;
    if (Buffer.isBuffer(body)) {
      return body;
    }
    if (typeof body === 'string') {
      return Buffer.from(body, 'utf8');
    }
    return Buffer.from(JSON.stringify(body ?? {}), 'utf8');
  }
}
