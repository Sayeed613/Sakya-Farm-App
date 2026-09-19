import { z } from 'zod';

import { paiseSchema, uuidSchema } from './primitives';

/**
 * Payment request validation.
 *
 * Security boundary: none of these schemas accept an amount, a currency, a
 * customer id, an order-ownership claim, or a payment outcome. Amounts are
 * read from the server-side order total; outcomes arrive via provider-signed
 * webhooks. A request field that could move money is a field that must not
 * exist.
 */

// --- Create intent -----------------------------------------------------------

/**
 * Create an online payment intent for one of the caller's orders.
 * CASH_ON_DELIVERY is excluded: checkout already creates that payment.
 */
export const createPaymentIntentSchema = z.object({
  orderId: uuidSchema,
  method: z.enum(['UPI', 'CARD', 'NET_BANKING', 'WALLET', 'OTHER']),
  /** Caller-generated key so a retried request cannot double-charge. */
  idempotencyKey: z.string().trim().min(1, 'Idempotency key is required').max(128, 'Idempotency key is too long'),
});

export type CreatePaymentIntentRequest = z.infer<typeof createPaymentIntentSchema>;

// --- Params ------------------------------------------------------------------

export const paymentIdParamSchema = z.object({ id: uuidSchema });
export type PaymentIdParam = z.infer<typeof paymentIdParamSchema>;

export const paymentOrderIdParamSchema = z.object({ orderId: uuidSchema });
export type PaymentOrderIdParam = z.infer<typeof paymentOrderIdParamSchema>;

export const paymentWebhookProviderParamSchema = z.object({
  provider: z.string().trim().min(1, 'Provider is required').max(50, 'Provider is too long'),
});
export type PaymentWebhookProviderParam = z.infer<typeof paymentWebhookProviderParamSchema>;

// --- Demo simulation (non-production only) ------------------------------------

/**
 * Simulate a provider outcome for a MOCK payment in a demo build.
 *
 * This is the demo harness's only money-shaped field, and it is deliberately
 * outcome-only: the endpoint refuses to run in production (checked in the
 * service), only moves payments the caller owns, and routes through the same
 * `processWebhookEvent` state machine a real gateway event takes — amounts,
 * currencies and payment ids are still read from server state.
 */
export const simulatePaymentSchema = z.object({
  outcome: z.enum(['success', 'failure']),
});
export type SimulatePaymentRequest = z.infer<typeof simulatePaymentSchema>;

// --- Cancel ------------------------------------------------------------------

export const cancelPaymentSchema = z.object({
  reason: z.string().trim().min(1, 'Cancel reason is required').max(500).optional(),
});
export type CancelPaymentRequest = z.infer<typeof cancelPaymentSchema>;

// --- Refund ------------------------------------------------------------------

export const refundPaymentSchema = z.object({
  /** Partial amount in paise. Omitted means refund the remaining balance in full. */
  amountInPaise: paiseSchema.optional(),
  reason: z.string().trim().min(1, 'Refund reason is required').max(500),
});
export type RefundPaymentRequest = z.infer<typeof refundPaymentSchema>;

// --- Webhook event (MOCK provider test contract) ------------------------------

/**
 * Normalised webhook event accepted by the MOCK provider adapter in
 * non-production environments. Real gateways define their own payload shape
 * inside their adapter; this schema exists so tests exercise the real HTTP +
 * signature + idempotency path with a deterministic body.
 */
export const mockWebhookEventSchema = z.object({
  type: z.enum(['authorized', 'captured', 'failed', 'cancelled', 'refunded']),
  providerPaymentId: z.string().trim().min(1).max(200),
  amountInPaise: paiseSchema.optional(),
  currency: z.literal('INR').optional(),
  failureReason: z.string().trim().max(500).nullish(),
  refundedInPaise: paiseSchema.optional(),
});

export type MockWebhookEvent = z.infer<typeof mockWebhookEventSchema>;
