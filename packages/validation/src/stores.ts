import { z } from 'zod';

import { uuidSchema } from './primitives';
import type { RoleCode } from '@sakya/types';

// --- Store CRUD -------------------------------------------------------------

export const createStoreSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, 'Store code must be at least 2 characters')
    .max(50, 'Store code is too long')
    .regex(/^[A-Z0-9][A-Z0-9_-]*$/, 'Store code must be uppercase alphanumeric with hyphens or underscores'),
  name: z.string().trim().min(2).max(200),
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().max(254).optional(),
  line1: z.string().trim().max(200).optional(),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  postalCode: z.string().trim().max(20).optional(),
  country: z.string().trim().max(100).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  timezone: z.string().max(50).optional(),
  operatingHours: z.record(z.string(), z.array(z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time format'))).optional(),
});

export type CreateStoreRequest = z.infer<typeof createStoreSchema>;

export const updateStoreSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().max(254).optional(),
  line1: z.string().trim().max(200).optional(),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  postalCode: z.string().trim().max(20).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  operatingHours: z.record(z.string(), z.array(z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time format'))).optional(),
  isActive: z.boolean().optional(),
});

export type UpdateStoreRequest = z.infer<typeof updateStoreSchema>;

// --- Store staff ------------------------------------------------------------

export const assignStoreStaffSchema = z.object({
  userId: uuidSchema,
  role: z.enum(['STORE_MANAGER', 'STORE_STAFF']),
});

export type AssignStoreStaffRequest = z.infer<typeof assignStoreStaffSchema>;

export const updateStoreStaffSchema = z.object({
  role: z.enum(['STORE_MANAGER', 'STORE_STAFF']).optional(),
  isActive: z.boolean().optional(),
});

export type UpdateStoreStaffRequest = z.infer<typeof updateStoreStaffSchema>;

// --- Store list query ------------------------------------------------------

export const storeListQuerySchema = z.object({
  page: z.coerce.number().int('Page must be a whole number').min(1, 'Page starts at 1').default(1),
  limit: z.coerce
    .number()
    .int('Limit must be a whole number')
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit cannot exceed 100')
    .default(20),
  isActive: z.enum(['true', 'false']).optional(),
  city: z.string().trim().max(100).optional(),
  search: z.string().trim().min(1, 'Search cannot be empty').max(120).optional(),
});

export type StoreListQuery = z.infer<typeof storeListQuerySchema>;

// --- Store staff list query ------------------------------------------------

export const storeStaffListQuerySchema = z.object({
  page: z.coerce.number().int('Page must be a whole number').min(1, 'Page starts at 1').default(1),
  limit: z.coerce
    .number()
    .int('Limit must be a whole number')
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit cannot exceed 100')
    .default(20),
  role: z.enum(['STORE_MANAGER', 'STORE_STAFF']).optional(),
  isActive: z.enum(['true', 'false']).optional(),
});

export type StoreStaffListQuery = z.infer<typeof storeStaffListQuerySchema>;

// --- Store order list query -------------------------------------------------

export const storeOrderListQuerySchema = z.object({
  page: z.coerce.number().int('Page must be a whole number').min(1, 'Page starts at 1').default(1),
  limit: z.coerce
    .number()
    .int('Limit must be a whole number')
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit cannot exceed 100')
    .default(20),
  status: z.enum(['PENDING_PAYMENT', 'CONFIRMED', 'PROCESSING', 'PACKED', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'REFUNDED', 'FAILED']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  search: z.string().trim().min(1, 'Search cannot be empty').max(120).optional(),
});

export type StoreOrderListQuery = z.infer<typeof storeOrderListQuerySchema>;

// --- Store inventory list query ---------------------------------------------

export const storeInventoryListQuerySchema = z.object({
  page: z.coerce.number().int('Page must be a whole number').min(1, 'Page starts at 1').default(1),
  limit: z.coerce
    .number()
    .int('Limit must be a whole number')
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit cannot exceed 100')
    .default(20),
  lowStock: z.enum(['true', 'false']).optional(),
  search: z.string().trim().min(1, 'Search cannot be empty').max(120).optional(),
});

export type StoreInventoryListQuery = z.infer<typeof storeInventoryListQuerySchema>;

// --- Param schemas ---------------------------------------------------------
// Note: storeIdParamSchema and StoreIdParam are defined in inventory.ts
// to avoid re-export conflicts. Use those instead.
export const storeStaffIdParamSchema = z.object({ storeId: uuidSchema, userId: uuidSchema });
export type StoreStaffIdParam = z.infer<typeof storeStaffIdParamSchema>;
export const storeOrderIdParamSchema = z.object({ orderId: uuidSchema });
export type StoreOrderIdParam = z.infer<typeof storeOrderIdParamSchema>;
export const storeInventoryIdParamSchema = z.object({ inventoryId: uuidSchema });
export type StoreInventoryIdParam = z.infer<typeof storeInventoryIdParamSchema>;

export { storeIdParamSchema, type StoreIdParam } from './inventory';

// --- Order status update for store ------------------------------------------

export const storeOrderStatusUpdateSchema = z.object({
  status: z.enum(['CONFIRMED', 'PROCESSING', 'PACKED', 'READY_FOR_PICKUP']),
  reason: z.string().trim().max(500).optional(),
});

export type StoreOrderStatusUpdateRequest = z.infer<typeof storeOrderStatusUpdateSchema>;
