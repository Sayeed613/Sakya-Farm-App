import { z } from 'zod';

import { quantitySchema, slugSchema, uuidSchema } from './primitives';

// ---------------------------------------------------------------------------
// Serviceability
// ---------------------------------------------------------------------------

export const serviceabilityQuerySchema = z.object({
  pincode: z
    .string()
    .trim()
    .regex(/^[1-9][0-9]{5}$/, 'Enter a valid 6-digit pincode'),
});
export type ServiceabilityQuery = z.infer<typeof serviceabilityQuerySchema>;

/**
 * Checkout-body address shape. The serviceability check reads the pincode off
 * the address the client is about to check out with, so an undeliverable
 * address is rejected before any order exists.
 */
export const serviceabilityAddressSchema = z.object({
  postalCode: z
    .string()
    .trim()
    .regex(/^[1-9][0-9]{5}$/, 'Enter a valid 6-digit pincode'),
});
export type ServiceabilityAddress = z.infer<typeof serviceabilityAddressSchema>;

// ---------------------------------------------------------------------------
// Wishlist
// ---------------------------------------------------------------------------

export const wishlistAddSchema = z.object({
  productSlug: slugSchema,
});
export type WishlistAddRequest = z.infer<typeof wishlistAddSchema>;

export const wishlistRemoveParamSchema = z.object({
  productSlug: slugSchema,
});
export type WishlistRemoveParams = z.infer<typeof wishlistRemoveParamSchema>;

// ---------------------------------------------------------------------------
// Returns
// ---------------------------------------------------------------------------

/** Closed set of return reasons — drives both validation and admin analytics. */
export const RETURN_REASONS = [
  'DAMAGED',
  'WRONG_ITEM',
  'QUALITY',
  'NOT_AS_DESCRIBED',
  'EXPIRED_OR_SPOILED',
  'CHANGED_MIND',
] as const;
export const returnReasonSchema = z.enum(RETURN_REASONS);
export type ReturnReason = (typeof RETURN_REASONS)[number];

export const createReturnSchema = z.object({
  orderItemId: uuidSchema,
  reason: returnReasonSchema,
  comment: z.string().trim().max(500).optional(),
});
export type CreateReturnRequest = z.infer<typeof createReturnSchema>;

export const returnIdParamSchema = z.object({
  id: uuidSchema,
});
export type ReturnIdParams = z.infer<typeof returnIdParamSchema>;

// ---------------------------------------------------------------------------
// Stock alerts (Notify Me)
// ---------------------------------------------------------------------------

export const stockAlertSchema = z.object({
  variantId: uuidSchema,
});
export type StockAlertRequest = z.infer<typeof stockAlertSchema>;

// ---------------------------------------------------------------------------
// Account settings
// ---------------------------------------------------------------------------

export const notificationPrefsSchema = z
  .object({
    /** Order lifecycle pushes (placed → delivered). */
    orderUpdates: z.boolean(),
    /** Marketing / promotional pushes. */
    promotions: z.boolean(),
    /** Back-in-stock alerts for variants the customer subscribed to. */
    stockAlerts: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one preference is required');
export type NotificationPrefsRequest = z.infer<typeof notificationPrefsSchema>;

// ---------------------------------------------------------------------------
// Profile edit (PATCH /users/me outside complete-profile)
// ---------------------------------------------------------------------------

export const updateProfileFieldsSchema = z
  .object({
    firstName: z.string().trim().min(1, 'Name is required').max(80),
    lastName: z.string().trim().max(80).optional(),
    email: z.string().trim().toLowerCase().email('Enter a valid email').optional().nullable(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');
export type UpdateProfileFieldsRequest = z.infer<typeof updateProfileFieldsSchema>;

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export const createReviewSchema = z.object({
  productId: uuidSchema,
  rating: z.number().int('Rating must be a whole number').min(1).max(5),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().max(2000).optional(),
});
export type CreateReviewRequest = z.infer<typeof createReviewSchema>;

// ---------------------------------------------------------------------------
// Account deletion
// ---------------------------------------------------------------------------

export const deleteAccountSchema = z.object({
  /** The customer must type their phone number to confirm. */
  confirmPhone: z.string().trim().min(4).max(20),
  reason: z.string().trim().max(500).optional(),
});
export type DeleteAccountRequest = z.infer<typeof deleteAccountSchema>;

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

/** Closed event taxonomy — unknown names are rejected at the boundary. */
export const ANALYTICS_EVENT_NAMES = [
  'screen_view',
  'product_view',
  'search',
  'add_to_cart',
  'remove_from_cart',
  'begin_checkout',
  'coupon_applied',
  'payment_started',
  'payment_success',
  'payment_failed',
  'purchase',
  'wishlist_add',
  'wishlist_remove',
  'reorder',
  'notify_me',
  'order_status_seen',
] as const;
export const analyticsEventSchema = z.object({
  name: z.enum(ANALYTICS_EVENT_NAMES),
  props: z.record(z.string(), z.unknown()).optional(),
  sessionId: z.string().trim().max(64).optional(),
});
export type AnalyticsEventRequest = z.infer<typeof analyticsEventSchema>;

// ---------------------------------------------------------------------------
// Buy Again (reorder)
// ---------------------------------------------------------------------------

export const reorderSchema = z.object({
  orderId: uuidSchema,
});
export type ReorderRequest = z.infer<typeof reorderSchema>;

// ---------------------------------------------------------------------------
// Returns admin (support/ops) — kept minimal, customer app does not call these
// ---------------------------------------------------------------------------

export const adminReturnDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().trim().max(500).optional(),
});
export type AdminReturnDecisionRequest = z.infer<typeof adminReturnDecisionSchema>;
