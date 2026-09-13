import { z } from 'zod';

import { paiseSchema, slugSchema, uuidSchema } from './primitives';

/**
 * Admin request validation schemas.
 *
 * These follow the same conventions as the rest of the validation package:
 * schemas are shared between the API and (later) client apps, so the rules
 * cannot drift. Prices are always integer paise, never floats.
 */

// --- Admin product list query ------------------------------------------------

export const ADMIN_PRODUCT_SORT_OPTIONS = [
  'newest',
  'oldest',
  'title_asc',
  'title_desc',
  'price_asc',
  'price_desc',
] as const;
export type AdminProductSortOption = (typeof ADMIN_PRODUCT_SORT_OPTIONS)[number];

export const adminProductListQuerySchema = z.object({
  page: z.coerce.number().int('Page must be a whole number').min(1, 'Page starts at 1').default(1),
  limit: z.coerce
    .number()
    .int('Limit must be a whole number')
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit cannot exceed 100')
    .default(20),
  search: z.string().trim().min(1, 'Search cannot be empty').max(120).optional(),
  category: slugSchema.optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
  availability: z.enum(['all', 'available', 'unavailable']).default('all'),
  sort: z.enum(ADMIN_PRODUCT_SORT_OPTIONS).default('newest'),
});

export type AdminProductListQuery = z.infer<typeof adminProductListQuerySchema>;

// --- Admin product create/update ---------------------------------------------

export const adminProductImageSchema = z.object({
  url: z.string().url('Image URL must be a valid URL'),
  altText: z.string().trim().max(500).nullish(),
  position: z.number().int().nonnegative().default(0),
});

export const adminVariantInputSchema = z.object({
  title: z.string().trim().min(1, 'Variant title is required').max(200),
  sku: z.string().trim().min(1).max(100).nullish(),
  barcode: z.string().trim().min(1).max(100).nullish(),
  priceInPaise: paiseSchema,
  compareAtPriceInPaise: paiseSchema.nullish(),
  costInPaise: paiseSchema.nullish(),
  weightGrams: z.number().int().nonnegative().nullish(),
  requiresShipping: z.boolean().default(true),
  isAvailable: z.boolean().default(false),
  position: z.number().int().nonnegative().default(0),
  optionValues: z.record(z.string(), z.string()).default({}),
});

export const adminCreateProductSchema = z.object({
  title: z.string().trim().min(1, 'Product title is required').max(300),
  slug: slugSchema.optional(),
  description: z.string().trim().max(10_000).nullish(),
  descriptionHtml: z.string().trim().max(50_000).nullish(),
  vendor: z.string().trim().max(200).nullish(),
  productType: z.string().trim().max(200).nullish(),
  tags: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).default('DRAFT'),
  isAvailable: z.boolean().default(false),
  publishedAt: z.coerce.date().nullish(),
  categoryIds: z.array(uuidSchema).max(20).default([]),
  images: z.array(adminProductImageSchema).max(50).default([]),
  variants: z.array(adminVariantInputSchema).min(1, 'A product must have at least one variant'),
});

export type AdminCreateProductRequest = z.infer<typeof adminCreateProductSchema>;

export const adminUpdateProductSchema = z.object({
  title: z.string().trim().min(1, 'Product title is required').max(300).optional(),
  slug: slugSchema.optional(),
  description: z.string().trim().max(10_000).nullish(),
  descriptionHtml: z.string().trim().max(50_000).nullish(),
  vendor: z.string().trim().max(200).nullish(),
  productType: z.string().trim().max(200).nullish(),
  tags: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
  isAvailable: z.boolean().optional(),
  publishedAt: z.coerce.date().nullish(),
  categoryIds: z.array(uuidSchema).max(20).optional(),
  images: z.array(adminProductImageSchema).max(50).optional(),
});

export type AdminUpdateProductRequest = z.infer<typeof adminUpdateProductSchema>;

// --- Admin variant create/update ---------------------------------------------

export const adminCreateVariantSchema = adminVariantInputSchema;
export type AdminCreateVariantRequest = z.infer<typeof adminCreateVariantSchema>;

export const adminUpdateVariantSchema = adminVariantInputSchema.partial();
export type AdminUpdateVariantRequest = z.infer<typeof adminUpdateVariantSchema>;

// --- Admin category CRUD -----------------------------------------------------

export const adminCategoryListQuerySchema = z.object({
  page: z.coerce.number().int('Page must be a whole number').min(1, 'Page starts at 1').default(1),
  limit: z.coerce
    .number()
    .int('Limit must be a whole number')
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit cannot exceed 100')
    .default(20),
  search: z.string().trim().min(1, 'Search cannot be empty').max(120).optional(),
  isActive: z.enum(['true', 'false']).optional(),
});

export type AdminCategoryListQuery = z.infer<typeof adminCategoryListQuerySchema>;

export const adminCreateCategorySchema = z.object({
  name: z.string().trim().min(1, 'Category name is required').max(200),
  slug: slugSchema.optional(),
  description: z.string().trim().max(2_000).nullish(),
  parentId: uuidSchema.nullish(),
  position: z.number().int().nonnegative().default(0),
  isActive: z.boolean().default(true),
  sourceCollectionId: z.string().trim().max(200).nullish(),
});

export type AdminCreateCategoryRequest = z.infer<typeof adminCreateCategorySchema>;

export const adminUpdateCategorySchema = z.object({
  name: z.string().trim().min(1, 'Category name is required').max(200).optional(),
  slug: slugSchema.optional(),
  description: z.string().trim().max(2_000).nullish(),
  parentId: uuidSchema.nullish(),
  position: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional(),
  sourceCollectionId: z.string().trim().max(200).nullish(),
});

export type AdminUpdateCategoryRequest = z.infer<typeof adminUpdateCategorySchema>;

// --- Admin order list query --------------------------------------------------

export const adminOrderListQuerySchema = z.object({
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
  paymentStatus: z
    .enum(['PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'CANCELLED', 'PARTIALLY_REFUNDED', 'REFUNDED'])
    .optional(),
  search: z.string().trim().min(1, 'Search cannot be empty').max(120).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type AdminOrderListQuery = z.infer<typeof adminOrderListQuerySchema>;

// --- Admin customer/user list query ------------------------------------------

export const adminCustomerListQuerySchema = z.object({
  page: z.coerce.number().int('Page must be a whole number').min(1, 'Page starts at 1').default(1),
  limit: z.coerce
    .number()
    .int('Limit must be a whole number')
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit cannot exceed 100')
    .default(20),
  search: z.string().trim().min(1, 'Search cannot be empty').max(120).optional(),
  status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional(),
});

export type AdminCustomerListQuery = z.infer<typeof adminCustomerListQuerySchema>;

export const adminUserListQuerySchema = adminCustomerListQuerySchema;
export type AdminUserListQuery = z.infer<typeof adminUserListQuerySchema>;

// --- Admin user update -------------------------------------------------------

export const adminUpdateUserSchema = z.object({
  status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional(),
  roles: z.array(z.enum(['CUSTOMER', 'STORE_MANAGER', 'STORE_STAFF', 'DELIVERY_PARTNER', 'SUPPORT_AGENT', 'ADMIN', 'SUPER_ADMIN'])).max(10).optional(),
});

export type AdminUpdateUserRequest = z.infer<typeof adminUpdateUserSchema>;

// --- Shared param schemas ----------------------------------------------------

export const adminProductIdParamSchema = z.object({ id: uuidSchema });
export type AdminProductIdParam = z.infer<typeof adminProductIdParamSchema>;

export const adminVariantIdParamSchema = z.object({ id: uuidSchema });
export type AdminVariantIdParam = z.infer<typeof adminVariantIdParamSchema>;

export const adminCategoryIdParamSchema = z.object({ id: uuidSchema });
export type AdminCategoryIdParam = z.infer<typeof adminCategoryIdParamSchema>;

export const adminOrderIdParamSchema = z.object({ id: uuidSchema });
export type AdminOrderIdParam = z.infer<typeof adminOrderIdParamSchema>;

export const adminUserIdParamSchema = z.object({ id: uuidSchema });
export type AdminUserIdParam = z.infer<typeof adminUserIdParamSchema>;