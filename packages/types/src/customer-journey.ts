// ---------------------------------------------------------------------------
// Customer journey: serviceability, wishlist, returns, alerts, settings
// ---------------------------------------------------------------------------

/** Result of checking a pincode against the serviceability zones. */
export interface ServiceabilityResponse {
  serviceable: boolean;
  pincode: string;
  /** Present only when serviceable. */
  zone: {
    id: string;
    name: string;
    storeId: string;
    minDeliveryDays: number;
    maxDeliveryDays: number;
    codAvailable: boolean;
    shippingFeeInPaise: number;
    freeShippingThresholdInPaise: number | null;
  } | null;
  /** Copy-ready promise, e.g. "Delivers in 2–9 days". Null when unserviceable. */
  etaLabel: string | null;
}

export interface WishlistItemResponse {
  id: string;
  productSlug: string;
  productTitle: string;
  imageUrl: string | null;
  /** Minimum available-variant price; null when nothing is purchasable. */
  priceInPaise: number | null;
  compareAtPriceInPaise: number | null;
  isAvailable: boolean;
  /** Variant id of the cheapest available variant, for move-to-cart. */
  defaultVariantId: string | null;
  addedAt: string;
}

export interface WishlistResponse {
  items: WishlistItemResponse[];
}

export const RETURN_STATUSES = ['REQUESTED', 'APPROVED', 'REJECTED', 'REFUNDED', 'CLOSED'] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

export interface ReturnRequestResponse {
  id: string;
  orderId: string;
  orderNumber: string;
  orderItemId: string;
  productTitle: string;
  variantTitle: string;
  quantity: number;
  status: ReturnStatus;
  reason: string;
  comment: string | null;
  refundInPaise: number;
  decisionNote: string | null;
  requestedAt: string;
  decidedAt: string | null;
  completedAt: string | null;
}

export interface ReturnsListResponse {
  returns: ReturnRequestResponse[];
}

/** Copy-ready explanation of what a customer can/cannot return and why. */
export interface ReturnEligibilityResponse {
  eligible: boolean;
  reason: string;
  /** Days after delivery a return may be requested. */
  windowDays: number;
}

export interface StockAlertResponse {
  variantId: string;
  active: boolean;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface NotificationPrefs {
  orderUpdates: boolean;
  promotions: boolean;
  stockAlerts: boolean;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  orderUpdates: true,
  promotions: true,
  stockAlerts: true,
};

// ---------------------------------------------------------------------------
// Reorder
// ---------------------------------------------------------------------------

export interface ReorderLineResult {
  variantId: string;
  productTitle: string;
  variantTitle: string;
  added: boolean;
  /** Why a line could not be added; null when added. */
  unavailableReason: string | null;
}

export interface ReorderResponse {
  orderId: string;
  addedCount: number;
  skippedCount: number;
  lines: ReorderLineResult[];
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

/** One published review as rendered on the product page. */
export interface ReviewItemResponse {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  authorFirstName: string;
  createdAt: string;
}

export interface ProductReviewsResponse {
  items: ReviewItemResponse[];
  count: number;
  /** 1.0–5.0 average, null when no reviews exist yet. */
  averageRating: number | null;
}

/** Copy-ready eligibility for writing a review of a product. */
export interface ReviewEligibilityResponse {
  eligible: boolean;
  reason: string;
  /** The delivered order line backing the review; null when ineligible. */
  orderItemId: string | null;
}

/** The caller's own just-submitted review (enters moderation). */
export interface ReviewResponse {
  id: string;
  rating: number;
  status: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Invoice
// ---------------------------------------------------------------------------

export interface InvoiceLineResponse {
  productTitle: string;
  variantTitle: string;
  sku: string | null;
  quantity: number;
  unitPriceInPaise: number;
  taxInPaise: number;
  totalInPaise: number;
}

/** Server-computed, print-ready invoice for one order. */
export interface InvoiceResponse {
  orderNumber: string;
  orderId: string;
  status: string;
  placedAt: string | null;
  billedTo: {
    name: string;
    phone: string;
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    postalCode: string;
  };
  lines: InvoiceLineResponse[];
  subtotalInPaise: number;
  discountInPaise: number;
  taxInPaise: number;
  shippingInPaise: number;
  totalInPaise: number;
  couponCode: string | null;
  paymentStatus: string;
  paymentMethod: string | null;
}
