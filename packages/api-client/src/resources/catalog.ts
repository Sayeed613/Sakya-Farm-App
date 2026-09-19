import type {
  CatalogVariant,
  CategorySummary,
  Paginated,
  ProductDetail,
  ProductListItem,
} from '@sakya/types';
import {
  categoryProductsQuerySchema,
  categorySlugParamSchema,
  productIdParamSchema,
  productListQuerySchema,
  productSlugParamSchema,
  type CategoryProductsQuery,
  type ProductListQuery,
} from '@sakya/validation';

import type { HttpClient } from '../http';
import { toQueryValues } from '../query';
import { parseInput } from '../schema';

/**
 * Catalog reads. Every route here is `@Public()` on the API, so browsing works
 * before a customer has an account.
 *
 * Filter/sort/pagination inputs are optional and are put through the *same* Zod
 * schemas the API uses, so the client inherits the API's defaults
 * (`page: 1`, `limit: 20`, `sort: 'newest'`, `availability: 'all'`) and its
 * bounds rather than inventing its own.
 *
 * Every method is `async` on purpose: input is validated with `parseInput`, which
 * throws, and a method that returned a promise *after* validating would throw
 * synchronously instead of rejecting. Callers then need two error paths
 * (`try/catch` and `.catch`) instead of one. Here, everything a method can fail
 * with arrives as a rejection.
 */

export type ProductListQueryInput = Partial<ProductListQuery>;
export type CategoryProductsQueryInput = Partial<CategoryProductsQuery>;

export interface CatalogResource {
  /** Active categories with the number of products linked to each. */
  listCategories(): Promise<CategorySummary[]>;

  /** Paginated catalogue, filterable by category, search, availability and sort. */
  listProducts(query?: ProductListQueryInput): Promise<Paginated<ProductListItem>>;

  /** One product with its images and variants. */
  getProduct(slug: string): Promise<ProductDetail>;

  /** Every variant of one product, in display order. */
  listVariants(productId: string): Promise<CatalogVariant[]>;

  /** Products in one category, paginated exactly as `listProducts` is. */
  listCategoryProducts(
    categorySlug: string,
    query?: CategoryProductsQueryInput,
  ): Promise<Paginated<ProductListItem>>;
}

export function createCatalogResource(http: HttpClient): CatalogResource {
  return {
    async listCategories(): Promise<CategorySummary[]> {
      return http.request<CategorySummary[]>('/categories');
    },

    async listProducts(query: ProductListQueryInput = {}): Promise<Paginated<ProductListItem>> {
      const parsed = parseInput(productListQuerySchema, query, 'Catalog filters');

      return http.request<Paginated<ProductListItem>>('/products', {
        query: toQueryValues(parsed),
      });
    },

    async getProduct(slug: string): Promise<ProductDetail> {
      const parsed = parseInput(productSlugParamSchema, { slug }, 'Product slug');

      return http.request<ProductDetail>(`/products/${encodeURIComponent(parsed.slug)}`);
    },

    async listVariants(productId: string): Promise<CatalogVariant[]> {
      const parsed = parseInput(productIdParamSchema, { id: productId }, 'Product id');

      return http.request<CatalogVariant[]>(`/products/${encodeURIComponent(parsed.id)}/variants`);
    },

    async listCategoryProducts(
      categorySlug: string,
      query: CategoryProductsQueryInput = {},
    ): Promise<Paginated<ProductListItem>> {
      const parsedSlug = parseInput(categorySlugParamSchema, { slug: categorySlug }, 'Category slug');
      const parsedQuery = parseInput(categoryProductsQuerySchema, query, 'Category filters');

      return http.request<Paginated<ProductListItem>>(
        `/categories/${encodeURIComponent(parsedSlug.slug)}/products`,
        { query: toQueryValues(parsedQuery) },
      );
    },
  };
}
