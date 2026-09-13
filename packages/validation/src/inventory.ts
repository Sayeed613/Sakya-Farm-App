import { z } from 'zod';

import { paiseSchema, uuidSchema } from './primitives';
import type { InventoryMovementType } from '@sakya/types';

/** Movement types that add stock (positive delta). */
export const INCOMING_MOVEMENT_TYPES = [
  'PURCHASE',
  'RETURN_IN',
  'TRANSFER_IN',
  'DAMAGE',
  'EXPIRY',
  'STOCKTAKE',
] as const;
export type IncomingMovementType = (typeof INCOMING_MOVEMENT_TYPES)[number];

/** Movement types that remove stock (negative delta). */
export const OUTGOING_MOVEMENT_TYPES = [
  'SALE',
  'RETURN_OUT',
  'TRANSFER_OUT',
] as const;
export type OutgoingMovementType = (typeof OUTGOING_MOVEMENT_TYPES)[number];

/** Reservation types. */
export const RESERVATION_MOVEMENT_TYPES = [
  'RESERVATION',
  'RESERVATION_RELEASE',
] as const;
export type ReservationMovementType = (typeof RESERVATION_MOVEMENT_TYPES)[number];

// --- Inventory list query ------------------------------------------------

export const inventoryListQuerySchema = z.object({
  page: z.coerce.number().int('Page must be a whole number').min(1, 'Page starts at 1').default(1),
  limit: z.coerce
    .number()
    .int('Limit must be a whole number')
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit cannot exceed 100')
    .default(20),
  storeId: uuidSchema.optional(),
  variantId: uuidSchema.optional(),
  productId: uuidSchema.optional(),
  lowStock: z.enum(['true', 'false']).optional(),
  search: z.string().trim().min(1, 'Search cannot be empty').max(120).optional(),
});

export type InventoryListQuery = z.infer<typeof inventoryListQuerySchema>;

// --- Movement list query -------------------------------------------------

export const inventoryMovementListQuerySchema = z.object({
  page: z.coerce.number().int('Page must be a whole number').min(1, 'Page starts at 1').default(1),
  limit: z.coerce
    .number()
    .int('Limit must be a whole number')
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit cannot exceed 100')
    .default(50),
  inventoryId: uuidSchema.optional(),
  variantId: uuidSchema.optional(),
  storeId: uuidSchema.optional(),
  type: z.enum([
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
  ]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type InventoryMovementListQuery = z.infer<typeof inventoryMovementListQuerySchema>;

// --- Stock operations ----------------------------------------------------

export const receiveStockSchema = z.object({
  quantity: z.number().int('Quantity must be a whole number').positive('Quantity must be positive'),
  reason: z.string().trim().max(500).optional(),
  referenceType: z.string().max(50).optional(),
  referenceId: uuidSchema.optional(),
});

export type ReceiveStockRequest = z.infer<typeof receiveStockSchema>;

export const adjustStockSchema = z.object({
  quantityDelta: z.number().int('Quantity delta must be a whole number'),
  reason: z.string().trim().min(1, 'Reason is required').max(500),
  referenceType: z.string().max(50).optional(),
  referenceId: uuidSchema.optional(),
});

export type AdjustStockRequest = z.infer<typeof adjustStockSchema>;

export const reserveStockSchema = z.object({
  quantity: z.number().int('Quantity must be a whole number').positive('Quantity must be positive'),
  orderId: uuidSchema.optional(),
  reason: z.string().trim().max(500).optional(),
});

export type ReserveStockRequest = z.infer<typeof reserveStockSchema>;

export const releaseStockSchema = z.object({
  quantity: z.number().int('Quantity must be a whole number').positive('Quantity must be positive'),
  orderId: uuidSchema.optional(),
  reason: z.string().trim().max(500).optional(),
});

export type ReleaseStockRequest = z.infer<typeof releaseStockSchema>;

export const deductStockSchema = z.object({
  quantity: z.number().int('Quantity must be a whole number').positive('Quantity must be positive'),
  orderId: uuidSchema.optional(),
  reason: z.string().trim().max(500).optional(),
});

export type DeductStockRequest = z.infer<typeof deductStockSchema>;

// --- Param schemas -------------------------------------------------------

export const inventoryIdParamSchema = z.object({ id: uuidSchema });
export type InventoryIdParam = z.infer<typeof inventoryIdParamSchema>;

export const variantIdParamSchema = z.object({ variantId: uuidSchema });
export type VariantIdParam = z.infer<typeof variantIdParamSchema>;

export const storeIdParamSchema = z.object({ storeId: uuidSchema });
export type StoreIdParam = z.infer<typeof storeIdParamSchema>;

// --- Movement type validation --------------------------------------------

export const movementTypeSchema = z.enum([
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
]);
