import { z } from 'zod';

import { couponCodeSchema, quantitySchema, uuidSchema } from './primitives';

// ---------------------------------------------------------------------------
// Cart item body validation
// ---------------------------------------------------------------------------

export const addCartItemSchema = z
  .object({
    variantId: uuidSchema,
    quantity: quantitySchema,
    /**
     * DELIBERATELY NOT ACCEPTED — kept as a key only so a caller that sends
     * one gets an explicit 400 instead of a silently stripped field (silent
     * stripping would let the caller believe it had chosen a store while the
     * server chose otherwise).
     *
     * The contract, documented here and on the service since the endpoint
     * shipped: clients cannot choose the fulfilment store — there is no public
     * store endpoint to resolve one from — so the server owns the decision,
     * exactly as in merge-guest-cart. Enforcing it at the schema (rather than
     * trusting that callers simply omit the field) is what makes the cart's
     * store write-once and every line's storeId agree with cart.storeId.
     */
    storeId: z.uuid().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.storeId !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['storeId'],
        message:
          'Clients cannot choose a store; omit storeId and the server resolves the fulfilment store.',
      });
    }
  });

/**
 * The accepted request body: no client-chosen store (see the schema). The
 * `storeId` key exists in the schema solely to REJECT it, so it is omitted
 * from the public type — typed callers cannot even construct one.
 */
export type AddCartItemRequest = Omit<z.infer<typeof addCartItemSchema>, 'storeId'>;

export const updateCartItemSchema = z.object({
  quantity: quantitySchema,
});

export type UpdateCartItemRequest = z.infer<typeof updateCartItemSchema>;

export const applyCouponSchema = z.object({
  code: couponCodeSchema,
});

export type ApplyCouponRequest = z.infer<typeof applyCouponSchema>;

// ---------------------------------------------------------------------------
// Checkout body validation
// ---------------------------------------------------------------------------

/** Idempotency keys are opaque strings the client generates per intent. */
export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(1, 'Idempotency key is required')
  .max(128, 'Idempotency key is too long');

export const checkoutSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  shippingAddress: z
    .record(z.string(), z.unknown())
    .refine((value) => Object.keys(value).length > 0, 'Shipping address is required'),
  billingAddress: z.record(z.string(), z.unknown()).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export type CheckoutRequest = z.infer<typeof checkoutSchema>;

// ---------------------------------------------------------------------------
// Order query validation (paginates the caller's own orders)
// ---------------------------------------------------------------------------

export const orderListQuerySchema = z.object({
  page: z.coerce.number().int('Page must be a whole number').min(1, 'Page starts at 1').default(1),
  limit: z.coerce
    .number()
    .int('Limit must be a whole number')
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit cannot exceed 100')
    .default(20),
  status: z
    .enum([
      'PENDING_PAYMENT',
      'CONFIRMED',
      'PROCESSING',
      'PACKED',
      'READY_FOR_PICKUP',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'CANCELLED',
      'REFUNDED',
      'FAILED',
    ])
    .optional(),
});

export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

export const orderIdParamSchema = z.object({
  id: uuidSchema,
});

export type OrderIdParam = z.infer<typeof orderIdParamSchema>;

export const cancelReasonSchema = z
  .string()
  .trim()
  .min(1, 'Cancel reason is required')
  .max(500, 'Cancel reason is too long');

/**
 * Body of `POST /orders/:id/cancel`.
 *
 * `cancelReasonSchema` describes one field, not the request. Piping the whole
 * body through it rejected every cancel request with a 400, because the body is
 * an object and the schema expects a string.
 */
export const cancelOrderSchema = z.object({
  reason: cancelReasonSchema,
});

export type CancelOrderRequest = z.infer<typeof cancelOrderSchema>;
