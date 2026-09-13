import type {
  IntentView,
  PaymentProvider,
  ProviderWebhookEvent,
} from './payment-provider.interface';

/**
 * Cash-on-delivery adapter.
 *
 * COD has no gateway and therefore no webhooks: signature verification always
 * fails, so `POST /payments/webhook/manual` is a 401 by construction. The
 * checkout-created MANUAL payment stays PENDING until fulfilment observes cash
 * collection — a client claim can never confirm it.
 */
export class ManualProvider implements PaymentProvider {
  readonly name = 'MANUAL';

  verifyWebhookSignature(_rawBody: Buffer | string, _headers: unknown): boolean {
    return false;
  }

  parseWebhookEvent(_rawBody: unknown): ProviderWebhookEvent {
    throw new Error('The MANUAL provider does not emit webhooks');
  }

  buildIntentResponse(view: IntentView): Record<string, unknown> {
    return {
      method: 'CASH_ON_DELIVERY',
      payableOnDeliveryInPaise: view.amountInPaise,
      currency: view.currency,
    };
  }
}
