import type { IncomingHttpHeaders } from 'node:http';

/**
 * Provider abstraction boundary.
 *
 * Business logic in `PaymentsService` depends ONLY on this interface — never on
 * a gateway SDK. Adding Razorpay, Stripe, or any other provider means adding one
 * file that implements `PaymentProvider` plus one registration line in the
 * module. No service, controller, or order code changes.
 *
 * Two invariants are enforced by construction:
 *  1. Signature verification lives inside the adapter (`verifyWebhookSignature`).
 *     The service never sees an unverified event.
 *  2. Adapters translate provider payloads into `ProviderWebhookEvent`. The
 *     service only understands this normalised shape, so provider quirks (field
 *     names, amount units, status vocabularies) cannot leak into money logic.
 */

/** Normalised outcome of a provider webhook, after signature verification. */
export type ProviderWebhookOutcome = 'authorized' | 'captured' | 'failed' | 'cancelled' | 'refunded';

export interface ProviderWebhookEvent {
  /** Normalised outcome. */
  type: ProviderWebhookOutcome;
  /** Provider-side payment identifier. Idempotency anchor with `provider`. */
  providerPaymentId: string;
  /** Amount claimed by the provider, in paise. Must equal the stored amount. */
  amountInPaise?: number;
  /** Currency claimed by the provider. Must equal the stored currency. */
  currency?: string;
  /** Failure reason supplied by the provider, when `type` is `failed`. */
  failureReason?: string | null;
  /** Total refunded so far, in paise, when `type` is `refunded`. */
  refundedInPaise?: number;
  /** Verbatim provider payload, stored in `providerPayload` for audit. */
  rawPayload: Record<string, unknown>;
}

/** Client-facing data for a created intent. Never contains secrets. */
export type IntentClientData = Record<string, unknown>;

export interface IntentView {
  paymentId: string;
  provider: string;
  providerPaymentId: string | null;
  amountInPaise: number;
  currency: string;
  method: string;
}

export interface PaymentProvider {
  /** Must equal the `Payment.provider` column value for rows it owns. */
  readonly name: string;

  /**
   * Verify the webhook's authenticity using the provider's own mechanism
   * (HMAC, asymmetric signature, ...). Returns false for anything that cannot
   * be proven genuine. The webhook controller maps false -> 401 and the service
   * is never invoked.
   */
  verifyWebhookSignature(
    rawBody: Buffer | string,
    headers: IncomingHttpHeaders,
  ): boolean | Promise<boolean>;

  /**
   * Translate a verified provider payload into the normalised event. Throws on
   * anything unrecognised — the controller maps that to a 400 with no state
   * change. Unit conversion (e.g. rupees -> paise) happens here, once.
   */
  parseWebhookEvent(rawBody: unknown): ProviderWebhookEvent;

  /** Build the client-facing portion of an intent response. */
  buildIntentResponse(view: IntentView): IntentClientData;
}
