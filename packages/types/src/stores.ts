import type { RoleCode } from './roles';
import type { OrderStatus, ShipmentStatus, DeliveryAssignmentStatus } from './statuses';
import type { Paise } from './money';

/** A store as seen by the API. */
export interface StoreSummary {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Full store detail with address and operating hours. */
export interface StoreDetail extends StoreSummary {
  line1: string | null;
  line2: string | null;
  postalCode: string | null;
  country: string;
  latitude: number | null;
  longitude: number | null;
  timezone: string;
  operatingHours: Record<string, [string, string]> | null;
}

/** Store with staff count for list views. */
export interface StoreListEntry extends StoreSummary {
  staffCount: number;
  orderCount: number;
}

/** A store staff membership. */
export interface StoreStaffSummary {
  id: string;
  storeId: string;
  userId: string;
  role: RoleCode;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string | null;
    phone: string | null;
  };
}

/** Full store staff detail with store info. */
export interface StoreStaffDetail extends StoreStaffSummary {
  store: {
    id: string;
    code: string;
    name: string;
  };
}

/** Paginated stores list. */
export interface PaginatedStores {
  items: StoreListEntry[];
  meta: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

/** Paginated store staff list. */
export interface PaginatedStoreStaff {
  items: StoreStaffSummary[];
  meta: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

// --- Store order types ------------------------------------------------------

/** Order as seen by store staff, with fulfillment status. */
export interface StoreOrderSummary {
  id: string;
  orderNumber: string;
  customer: {
    id: string;
    email: string;
    firstName: string;
    lastName: string | null;
    phone: string | null;
  };
  status: OrderStatus;
  paymentStatus: string;
  currency: string;
  subtotalInPaise: Paise;
  discountInPaise: Paise;
  taxInPaise: Paise;
  shippingInPaise: Paise;
  totalInPaise: Paise;
  shippingAddress: any;
  notes: string | null;
  placedAt: string | null;
  createdAt: string;
}

/** Full store order detail with items and delivery info. */
export interface StoreOrderDetail extends StoreOrderSummary {
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
    status: string;
    amountInPaise: Paise;
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
  shipment: {
    id: string;
    carrier: string | null;
    trackingNumber: string | null;
    trackingUrl: string | null;
    status: ShipmentStatus;
  } | null;
  deliveryAssignment: {
    id: string;
    deliveryPartnerUserId: string;
    deliveryPartner: {
      id: string;
      firstName: string;
      lastName: string | null;
      phone: string | null;
    };
    status: DeliveryAssignmentStatus;
    assignedAt: string;
  } | null;
}

/** Paginated store orders list. */
export interface PaginatedStoreOrders {
  items: StoreOrderSummary[];
  meta: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

// --- Store inventory types --------------------------------------------------

/** Store inventory entry for store-facing views. */
export interface StoreInventoryEntry {
  id: string;
  variantId: string;
  storeId: string;
  quantityOnHand: number;
  quantityReserved: number;
  availableQuantity: number;
  reorderLevel: number;
  variant: {
    id: string;
    title: string;
    sku: string | null;
  };
  product: {
    id: string;
    title: string;
    slug: string;
  };
}

/** Paginated store inventory list. */
export interface PaginatedStoreInventory {
  items: StoreInventoryEntry[];
  meta: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

// --- Request types ---------------------------------------------------------

/** Create store request body. */
export interface CreateStoreRequest {
  code: string;
  name: string;
  phone?: string;
  email?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  operatingHours?: Record<string, [string, string]>;
}

/** Update store request body. */
export interface UpdateStoreRequest {
  name?: string;
  phone?: string;
  email?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  operatingHours?: Record<string, [string, string]>;
  isActive?: boolean;
}

/** Assign staff to store request body. */
export interface AssignStoreStaffRequest {
  userId: string;
  role: RoleCode;
}

/** Update store staff request body. */
export interface UpdateStoreStaffRequest {
  role?: RoleCode;
  isActive?: boolean;
}

/** Store order list query parameters. */
export interface StoreOrderListQuery {
  page: number;
  limit: number;
  status?: OrderStatus;
  from?: string;
  to?: string;
  search?: string;
}

/** Store inventory list query parameters. */
export interface StoreInventoryListQuery {
  page: number;
  limit: number;
  lowStock?: boolean;
  search?: string;
}
