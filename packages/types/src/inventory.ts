import type { InventoryMovementType } from './index';

/** Inventory entry as seen by the API. */
export interface InventoryEntry {
  id: string;
  variantId: string;
  storeId: string;
  quantityOnHand: number;
  quantityReserved: number;
  availableQuantity: number;
  reorderLevel: number;
  lastCountedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Full inventory detail with variant and store info. */
export interface InventoryDetail extends InventoryEntry {
  variant: {
    id: string;
    title: string;
    sku: string | null;
  };
  store: {
    id: string;
    name: string;
    code: string;
  };
  product: {
    id: string;
    title: string;
    slug: string;
  };
}

/** A single inventory movement/ledger entry. */
export interface InventoryMovement {
  id: string;
  inventoryId: string;
  variantId: string;
  storeId: string;
  type: InventoryMovementType;
  quantityDelta: number;
  quantityAfter: number;
  reason: string | null;
  referenceType: string | null;
  referenceId: string | null;
  performedByUserId: string | null;
  createdAt: string;
}

/** Inventory movement with variant and store details. */
export interface InventoryMovementDetail extends InventoryMovement {
  variant: {
    id: string;
    title: string;
    sku: string | null;
  };
  store: {
    id: string;
    name: string;
    code: string;
  };
  performedBy: {
    id: string;
    /** Null for phone-first identities that have no email on file. */
    email: string | null;
    firstName: string;
    lastName: string | null;
  } | null;
}

/** Paginated inventory list. */
export interface PaginatedInventory {
  items: InventoryEntry[];
  meta: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

/** Paginated movements list. */
export interface PaginatedInventoryMovements {
  items: InventoryMovementDetail[];
  meta: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}
