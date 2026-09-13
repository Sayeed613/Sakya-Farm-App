/**
 * Status vocabularies shared between the API, the database enums in
 * apps/api/prisma/schema.prisma, and future clients.
 *
 * Keep the member lists identical to the matching Prisma enum. A drift test
 * lives in apps/api/test to catch mismatches.
 */

// --- Catalog ---------------------------------------------------------------

export const PRODUCT_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/** Where a catalog record originally came from. Scraped data is `SHOPIFY`. */
export const SOURCE_PLATFORMS = ['SHOPIFY', 'MANUAL', 'OTHER'] as const;
export type SourcePlatform = (typeof SOURCE_PLATFORMS)[number];

// --- Identity --------------------------------------------------------------

export const USER_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

// --- Cart ------------------------------------------------------------------

export const CART_STATUSES = ['ACTIVE', 'CONVERTED', 'ABANDONED', 'EXPIRED'] as const;
export type CartStatus = (typeof CART_STATUSES)[number];

// --- Orders ----------------------------------------------------------------

export const ORDER_STATUSES = [
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
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Legal order status transitions.
 *
 * Order status is never set directly from a request body: the API validates a
 * requested transition against this map and writes an OrderStatusHistory row.
 */
export const ORDER_STATUS_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING_PAYMENT: ['CONFIRMED', 'CANCELLED', 'FAILED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['PACKED', 'CANCELLED'],
  PACKED: ['READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'CANCELLED'],
  READY_FOR_PICKUP: ['DELIVERED', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'FAILED'],
  DELIVERED: ['REFUNDED'],
  CANCELLED: [],
  REFUNDED: [],
  FAILED: ['CANCELLED'],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_STATUS_TRANSITIONS[from].includes(to);
}

/** Statuses after which an order's totals and items are frozen. */
export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = ['CANCELLED', 'REFUNDED'];

// --- Payments --------------------------------------------------------------

export const PAYMENT_STATUSES = [
  'PENDING',
  'AUTHORIZED',
  'CAPTURED',
  'FAILED',
  'CANCELLED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_METHODS = [
  'CASH_ON_DELIVERY',
  'UPI',
  'CARD',
  'NET_BANKING',
  'WALLET',
  'OTHER',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

// --- Fulfilment ------------------------------------------------------------

export const SHIPMENT_STATUSES = [
  'PENDING',
  'READY',
  'DISPATCHED',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'FAILED',
  'RETURNED',
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const DELIVERY_ASSIGNMENT_STATUSES = [
  'UNASSIGNED',
  'ASSIGNED',
  'ACCEPTED',
  'REJECTED',
  'PICKED_UP',
  'DELIVERED',
  'FAILED',
] as const;
export type DeliveryAssignmentStatus = (typeof DELIVERY_ASSIGNMENT_STATUSES)[number];

// --- Inventory -------------------------------------------------------------

/**
 * Inventory is a ledger: every change in stock is recorded as a movement with a
 * signed quantity delta, never as a silent overwrite of the current quantity.
 */
export const INVENTORY_MOVEMENT_TYPES = [
  'PURCHASE',
  'SALE',
  'RETURN_IN',
  'RETURN_OUT',
  'ADJUSTMENT',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'DAMAGE',
  'EXPIRY',
  'STOCKTAKE',
  'RESERVATION',
  'RESERVATION_RELEASE',
] as const;
export type InventoryMovementType = (typeof INVENTORY_MOVEMENT_TYPES)[number];

// --- Engagement ------------------------------------------------------------

export const COUPON_TYPES = ['PERCENTAGE', 'FIXED_AMOUNT', 'FREE_SHIPPING'] as const;
export type CouponType = (typeof COUPON_TYPES)[number];

export const REVIEW_STATUSES = ['PENDING', 'PUBLISHED', 'REJECTED', 'HIDDEN'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const NOTIFICATION_CHANNELS = ['EMAIL', 'SMS', 'PUSH', 'IN_APP', 'WHATSAPP'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_STATUSES = ['QUEUED', 'SENT', 'FAILED', 'READ', 'CANCELLED'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const ADDRESS_TYPES = ['SHIPPING', 'BILLING', 'BOTH'] as const;
export type AddressType = (typeof ADDRESS_TYPES)[number];
