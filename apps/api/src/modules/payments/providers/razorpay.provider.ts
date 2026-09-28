import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

import type {
  IntentView,
  PaymentProvider,
  ProviderWebhookEvent,
} from './payment-provider.interface';

const RAZORPAY_API = 'https://api.razorpay.com/v1';

type RazorpayEntity = Record<string, unknown>;

export class RazorpayProvider implements PaymentProvider {
  readonly name = 'RAZORPAY';

  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
    private readonly webhookSecret: string,
  ) {}

  async createOrder(input: {
    paymentId: string;
    orderId: string;
    amountInPaise: number;
    currency: string;
  }): Promise<{ providerOrderId: string; providerPayload: Record<string, unknown> }> {
    const response = await fetch(`${RAZORPAY_API}/orders`, {
      method: 'POST',
      headers: this.apiHeaders(),
      body: JSON.stringify({
        amount: input.amountInPaise,
        currency: input.currency,
        receipt: input.paymentId,
        notes: { orderId: input.orderId, paymentId: input.paymentId },
      }),
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || typeof payload.id !== 'string') {
      throw new Error('Razorpay could not create the payment order');
    }
    if (payload.amount !== input.amountInPaise || payload.currency !== input.currency) {
      throw new Error('Razorpay returned an order that does not match the requested amount');
    }
    return { providerOrderId: payload.id, providerPayload: payload };
  }

  verifyWebhookSignature(rawBody: Buffer | string, headers: IncomingHttpHeaders): boolean {
    const supplied = headerValue(headers['x-razorpay-signature']);
    if (supplied === null || !/^[a-f0-9]{64}$/i.test(supplied)) return false;
    const expected = createHmac('sha256', this.webhookSecret).update(rawBody).digest();
    const received = Buffer.from(supplied, 'hex');
    return received.length === expected.length && timingSafeEqual(received, expected);
  }

  parseWebhookEvent(rawBody: unknown): ProviderWebhookEvent {
    const payload = parsePayload(rawBody);
    const eventName = payload.event;
    let type: ProviderWebhookEvent['type'];
    if (eventName === 'payment.captured') type = 'captured';
    else if (eventName === 'payment.failed') type = 'failed';
    else if (eventName === 'payment.authorized') type = 'authorized';
    else throw new Error(`Unsupported Razorpay webhook event: ${String(eventName)}`);

    const data = isRecord(payload.payload) ? payload.payload : null;
    const entityContainer = data?.payment;
    const entity = isRecord(entityContainer) && isRecord(entityContainer.entity) ? entityContainer.entity : null;

    if (
      entity === null ||
      typeof entity.id !== 'string' ||
      typeof entity.order_id !== 'string' ||
      typeof entity.amount !== 'number' ||
      typeof entity.currency !== 'string'
    ) {
      throw new Error('Razorpay webhook does not contain a valid payment entity');
    }

    return {
      type,
      providerPaymentId: entity.id,
      providerOrderId: entity.order_id,
      retryableFailure: type === 'failed',
      amountInPaise: entity.amount,
      currency: entity.currency,
      failureReason: typeof entity.error_description === 'string' ? entity.error_description : null,
      rawPayload: payload,
    };
  }

  /**
   * Authoritative gateway status for one of our Razorpay orders.
   *
   * Scans every payment attempt Razorpay holds for the order and prefers a
   * capture over an authorization (list order is not relied upon). Anything
   * else — no attempts, `created`, `failed` — is "no decisive evidence of
   * money", i.e. null. Money-math fields are validated before use, mirroring
   * `parseWebhookEvent`.
   */
  async fetchPaymentStatus(providerOrderId: string): Promise<ProviderWebhookEvent | null> {
    const response = await fetch(`${RAZORPAY_API}/orders/${encodeURIComponent(providerOrderId)}/payments`, {
      headers: this.apiHeaders(),
    });
    if (response.status === 404) return null;
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !Array.isArray(payload.items)) {
      throw new Error('Razorpay did not return a payment list for this order');
    }

    const entities = payload.items.filter(isRecord);
    const captured = entities.find((entity) => entity.status === 'captured');
    const authorized = entities.find((entity) => entity.status === 'authorized');
    const decisive = captured ?? authorized;
    if (
      decisive === undefined ||
      typeof decisive.id !== 'string' ||
      typeof decisive.amount !== 'number' ||
      typeof decisive.currency !== 'string'
    ) {
      return null;
    }

    return {
      type: decisive.status === 'captured' ? 'captured' : 'authorized',
      providerPaymentId: decisive.id,
      providerOrderId,
      amountInPaise: decisive.amount,
      currency: decisive.currency,
      rawPayload: decisive,
    };
  }

  buildIntentResponse(view: IntentView): Record<string, unknown> {
    return {
      provider: this.name,
      key: this.keyId,
      order_id: view.providerOrderId,
      amount: view.amountInPaise,
      currency: view.currency,
    };
  }

  private apiHeaders(): Record<string, string> {
    const authorization = Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');
    return {
      Authorization: `Basic ${authorization}`,
      'Content-Type': 'application/json',
    };
  }
}

function parsePayload(rawBody: unknown): Record<string, unknown> {
  let parsed = rawBody;
  if (Buffer.isBuffer(rawBody) || typeof rawBody === 'string') {
    try {
      parsed = JSON.parse(rawBody.toString());
    } catch {
      throw new Error('Razorpay webhook body must be JSON');
    }
  }
  if (!isRecord(parsed)) throw new Error('Razorpay webhook body must be an object');
  return parsed;
}

function isRecord(value: unknown): value is RazorpayEntity {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function headerValue(value: string | string[] | undefined): string | null {
  const result = Array.isArray(value) ? value[0] : value;
  return typeof result === 'string' ? result : null;
}