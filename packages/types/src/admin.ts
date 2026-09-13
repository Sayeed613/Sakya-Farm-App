import type { CurrencyCode, OrderStatus, Paise, PaymentStatus, ProductStatus, RoleCode, UserStatus } from './index';

/**
 * Admin-only response contracts.
 *
 * These are deliberately narrower than the database rows but wider than the
 * public catalog contracts: admins need cost prices, source metadata and stock
 * levels that customers never see. Password hashes and refresh tokens are
 * never included in any response.
 */

// --- Admin products ----------------------------------------------------------

/** Admin view of a product, including source metadata and stock. */
export interface AdminProductSummary {
  id: string;
  slug: string;
  title: string;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  status: ProductStatus;
  isAvailable: boolean;
  publishedAt: string | null;
  sourcePlatform: string;
  sourceProductId: string | null;
  sourceHandle: string | null;
  variantCount: number;
  imageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminProductDetail extends AdminProductSummary {
  description: string | null;
  descriptionHtml: string | null;
  variants: AdminVariantResponse[];
  images: AdminImageResponse[];
  categories: AdminCategoryRef[];
}

export interface AdminVariantResponse {
  id: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  priceInPaise: Paise;
  compareAtPriceInPaise: Paise | null;
  costInPaise: Paise | null;
  currency: CurrencyCode;
  weightGrams: number | null;
  requiresShipping: boolean;
  isAvailable: boolean;
  position: number;
  optionValues: Record<string, string> | null;
  sourceVariantId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminImageResponse {
  id: string;
  url: string;
  altText: string | null;
  position: number;
  sourceImageId: string | null;
}

export interface AdminCategoryRef {
  slug: string;
  name: string;
  isPrimary: boolean;
  position: number;
}

// --- Admin categories --------------------------------------------------------

export interface AdminCategorySummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  parentSlug: string | null;
  position: number;
  isActive: boolean;
  productCount: number;
  sourceCollectionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminCategoryDetail extends AdminCategorySummary {
  parentId: string | null;
}

// --- Admin orders ------------------------------------------------------------

export interface AdminOrderSummary {
  id: string;
  orderNumber: string;
  customer: {
    id: string;
    email: string;
    firstName: string;
    lastName: string | null;
  };
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  currency: CurrencyCode;
  subtotalInPaise: Paise;
  discountInPaise: Paise;
  taxInPaise: Paise;
  shippingInPaise: Paise;
  totalInPaise: Paise;
  placedAt: string | null;
  createdAt: string;
}

export interface AdminOrderDetail extends AdminOrderSummary {
  storeId: string | null;
  couponId: string | null;
  notes: string | null;
  cancelledAt: string | null;
  deliveredAt: string | null;
  cancelReason: string | null;
  shippingAddress: Record<string, unknown>;
  billingAddress: Record<string, unknown> | null;
  items: Array<{
    id: string;
    productTitle: string;
    variantTitle: string;
    sku: string | null;
    quantity: number;
    unitPriceInPaise: Paise;
    discountInPaise: Paise;
    taxInPaise: Paise;
    totalInPaise: Paise;
  }>;
  payments: Array<{
    id: string;
    provider: string;
    method: string;
    status: PaymentStatus;
    amountInPaise: Paise;
    refundedInPaise: Paise;
    failureReason: string | null;
  }>;
  statusHistory: Array<{
    id: string;
    fromStatus: OrderStatus | null;
    toStatus: OrderStatus;
    reason: string | null;
    changedByUserId: string | null;
    createdAt: string;
  }>;
}

// --- Admin customers ---------------------------------------------------------

export interface AdminCustomerSummary {
  id: string;
  email: string;
  phone: string | null;
  firstName: string;
  lastName: string | null;
  status: UserStatus;
  emailVerifiedAt: string | null;
  phoneVerifiedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  orderCount: number;
  totalSpentInPaise: Paise;
}

export interface AdminCustomerDetail extends AdminCustomerSummary {
  roles: RoleCode[];
}

// --- Admin users -------------------------------------------------------------

export interface AdminUserSummary {
  id: string;
  email: string;
  phone: string | null;
  firstName: string;
  lastName: string | null;
  status: UserStatus;
  roles: RoleCode[];
  createdAt: string;
  updatedAt: string;
}

export interface AdminUserDetail extends AdminUserSummary {
  emailVerifiedAt: string | null;
  phoneVerifiedAt: string | null;
  lastLoginAt: string | null;
}

/** Response for a role assignment update. */
export interface AdminRoleAssignmentResponse {
  userId: string;
  roles: RoleCode[];
}
