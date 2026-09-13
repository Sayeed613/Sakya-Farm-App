import type { CurrencyCode, Paise } from './money';
import type { PaymentMethod, PaymentStatus } from './statuses';

/**
 * Payment contracts shared by the API and any client of it.
 *
 * Money is always integer paise. The client never sends amounts, currency, or
 * payment outcomes: `amountInPaise` below is always read from the server-side
 * order total, and status changes originate from provider-signed webhooks or
 * privileged actors — never from a client claim that "payment succeeded".
 */

/** Provider names the API recognises. Adding a gateway = adding a name + adapter. */
export const PAYMENT_PROVIDER_NAMES = ['MANUAL', 'MOCK'] as const;
export type PaymentProviderName = (typeof PAYMENT_PROVIDER_NAMES)[number];

/** Online payment methods a new intent may request. COD already exists from checkout. */
export const ONLINE_PAYMENT_METHODS = ['UPI', 'CARD', 'NET_BANKING', 'WALLET', 'OTHER'] as const;
export type OnlinePaymentMethod = (typeof ONLINE_PAYMENT_METHODS)[number];

/** One payment attempt against an order, as returned by the API. */
export interface PaymentDetail {
  id: string;
  orderId: string;
  provider: string;
  providerPaymentId: string | null;
  method: PaymentMethod;
  status: PaymentStatus;
  currency: CurrencyCode;
  amountInPaise: Paise;
  refundedInPaise: Paise;
  failureReason: string | null;
  capturedAt: string | null;
  refundedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Response for `POST /payments/intent`. Amount mirrors the order total. */
export interface PaymentIntentResponse {
  payment: PaymentDetail;
  /** Provider-specific client data (e.g. a mock reference). Never contains secrets. */
  intent: Record<string, unknown>;
}

/** Refund outcome. Partial refunds keep the payment open for the remainder. */
export interface PaymentRefundResponse {
  payment: PaymentDetail;
}
