import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

import { mockWebhookEventSchema } from '@sakya/validation';

import type {
  IntentView,
  PaymentProvider,
  ProviderWebhookEvent,
} from './payment-provider.interface';

/**
 * Deterministic HMAC test adapter.
 *
 * Lets integration tests exercise the REAL webhook path — HTTP route, raw-body
 * signature check, idempotent processing — without a gateway account and
 * without "faking success": unsigned or forged bodies still fail verification.
 *
 * Wire format: `POST /payments/webhook/mock` with the normalised JSON event as
 * the body and header `x-mock-signature: hex(hmac_sha256(secret, raw_body))`.
 *
 * Registered only when `NODE_ENV !== 'production'`. There is no production path
 * that consults this adapter.
 */
export const MOCK_WEBHOOK_SIGNATURE_HEADER = 'x-mock-signature';

export class MockProvider implements PaymentProvider {
  readonly name = 'MOCK';

  constructor(private readonly webhookSecret: string) {}

  verifyWebhookSignature(rawBody: Buffer | string, headers: IncomingHttpHeaders): boolean {
    if (this.webhookSecret.length === 0) {
      return false;
    }

    const header = headers[MOCK_WEBHOOK_SIGNATURE_HEADER];
    const signature = Array.isArray(header) ? header[0] : header;
    if (typeof signature !== 'string' || signature.length === 0) {
      return false;
    }

    const expected = createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');

    const receivedBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    if (receivedBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(receivedBuffer, expectedBuffer);
  }

  parseWebhookEvent(rawBody: unknown): ProviderWebhookEvent {
    let payload: unknown = rawBody;
    if (typeof rawBody === 'string' || Buffer.isBuffer(rawBody)) {
      try {
        payload = JSON.parse(rawBody.toString('utf8'));
      } catch {
        throw new Error('Mock webhook body must be JSON');
      }
    }

    const parsed = mockWebhookEventSchema.safeParse(payload);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
      throw new Error(`Invalid mock webhook event: ${detail}`);
    }

    const event = parsed.data;
    return {
      type: event.type,
      providerPaymentId: event.providerPaymentId,
      amountInPaise: event.amountInPaise,
      currency: event.currency,
      failureReason: event.failureReason ?? null,
      refundedInPaise: event.refundedInPaise,
      rawPayload:
        typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : { value: payload },
    };
  }

  buildIntentResponse(view: IntentView): Record<string, unknown> {
    return {
      provider: 'MOCK',
      mockReference: view.providerPaymentId ?? view.paymentId,
      amountInPaise: view.amountInPaise,
      currency: view.currency,
    };
  }
}

/** Test helper: sign a mock webhook body the same way a provider would. */
export function signMockWebhookBody(body: string | Buffer, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}
