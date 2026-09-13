import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@sakya/types';
import { z } from 'zod';

import { slugSchema, uuidSchema } from './primitives';

/**
 * Query contracts for the read-only catalog endpoints.
 *
 * Query strings arrive as text, so every numeric field is coerced and bounded
 * here rather than in the controller: an unbounded `limit` is a denial-of-service
 * vector, and a negative `page` produces a negative OFFSET.
 *
 * Sorting and availability are closed enums, never free text. The sort key is
 * mapped to a whitelist of SQL fragments inside the service, so a value that
 * reaches it can only be one of the options declared here.
 */

export const PRODUCT_SORT_OPTIONS = ['newest', 'title_asc', 'price_asc', 'price_desc'] as const;
export type ProductSortOption = (typeof PRODUCT_SORT_OPTIONS)[number];

export const AVAILABILITY_FILTERS = ['all', 'available', 'unavailable'] as const;
export type AvailabilityFilter = (typeof AVAILABILITY_FILTERS)[number];

/** Page size is capped so one request cannot pull the whole catalogue. */
export const productListQuerySchema = z.object({
  page: z.coerce.number().int('Page must be a whole number').min(1, 'Page starts at 1').default(1),
  limit: z.coerce
    .number()
    .int('Limit must be a whole number')
    .min(1, 'Limit must be at least 1')
    .max(MAX_PAGE_SIZE, `Limit cannot exceed ${MAX_PAGE_SIZE}`)
    .default(DEFAULT_PAGE_SIZE),
  /** Category slug to restrict the result set to. */
  category: slugSchema.optional(),
  /** Case-insensitive substring match against the title or description. */
  search: z.string().trim().min(1, 'Search cannot be empty').max(120).optional(),
  sort: z.enum(PRODUCT_SORT_OPTIONS).default('newest'),
  availability: z.enum(AVAILABILITY_FILTERS).default('all'),
});

export type ProductListQuery = z.infer<typeof productListQuerySchema>;

/** Products within a category: the slug comes from the path, not the query. */
export const categoryProductsQuerySchema = productListQuerySchema.omit({ category: true });
export type CategoryProductsQuery = z.infer<typeof categoryProductsQuerySchema>;

export const productSlugParamSchema = z.object({
  slug: slugSchema,
});

export const categorySlugParamSchema = z.object({
  slug: slugSchema,
});

export const productIdParamSchema = z.object({
  id: uuidSchema,
});

export type ProductSlugParam = z.infer<typeof productSlugParamSchema>;
export type CategorySlugParam = z.infer<typeof categorySlugParamSchema>;
export type ProductIdParam = z.infer<typeof productIdParamSchema>;
