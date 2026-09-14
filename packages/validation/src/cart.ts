import { z } from 'zod';

import { couponCodeSchema, quantitySchema, uuidSchema } from './primitives';

// ---------------------------------------------------------------------------
// Cart item body validation
// ---------------------------------------------------------------------------

export const addCartItemSchema = z.object({
  variantId: uuidSchema,
  storeId: uuidSchema,
  quantity: quantitySchema,
});

export type AddCartItemRequest = z.infer<typeof addCartItemSchema>;

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
