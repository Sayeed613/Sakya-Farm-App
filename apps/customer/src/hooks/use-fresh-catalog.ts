import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { catalogApi } from '../api/catalog';
import { EXCLUDED_PRODUCT_SLUGS, FRESH_SIDEBAR_HANDLES } from '../config/home-sections';
import type { CategorySummary, ProductListItem } from '@sakya/types';

/**
 * Sakya Fresh catalog hook.
 *
 * Deliberately shares Home's exact query keys (`['catalog','products',
 * 'home-all']`, `['catalog','categories']`) so navigating Home → Fresh costs
 * zero requests: TanStack Query dedupes and serves the cached payload within
 * the same staleTime window. Same two API calls for the whole app's listing
 * surfaces.
 *
 * SCOPE: Fresh is fruits & vegetables only — its sidebar lists the produce
 * collections (plus "All Fresh"), never pantry/heritage rails. The dev
 * fixture `checkout-test-mango` is filtered from every surface.
 *
 * DIFFERENCE FROM HOME RAILS: products are NOT pre-filtered to available-only.
 * Fresh is a browsing surface — sold-out items stay visible with a Notify Me
 * state instead of disappearing (Home hides them from its rails).
 */
export function useFreshCatalog() {
  const products = useQuery({
    queryKey: ['catalog', 'products', 'home-all'],
    queryFn: () => catalogApi.listProducts({ limit: 100 }),
    staleTime: 60_000,
  });

  const categories = useQuery({
    queryKey: ['catalog', 'categories'],
    queryFn: catalogApi.listCategories,
    staleTime: 5 * 60_000,
  });

  return useMemo(() => {
    // Full catalog minus dev fixtures, availability untouched: the grid
    // renders sold-out cards with Notify Me.
    const items: ProductListItem[] = (products.data?.items ?? []).filter(
      (product) => !EXCLUDED_PRODUCT_SLUGS.has(product.slug),
    );

    // Fresh's sidebar categories: ONLY the produce collections that actually
    // have purchasable products, in the registry's display order.
    const purchasableByCategory = new Map<string, number>();
    for (const product of items) {
      if (!product.isAvailable || product.availableVariantCount === 0) continue;
      const seen = new Set<string>();
      for (const ref of product.categories) {
        if (seen.has(ref.slug)) continue;
        seen.add(ref.slug);
        purchasableByCategory.set(ref.slug, (purchasableByCategory.get(ref.slug) ?? 0) + 1);
      }
    }

    const categoryBySlug = new Map((categories.data ?? []).map((category) => [category.slug, category]));
    const categoryList: CategorySummary[] = FRESH_SIDEBAR_HANDLES.flatMap(
      (handle) => {
        const category = categoryBySlug.get(handle);
        if (!category) return [];
        if ((purchasableByCategory.get(handle) ?? 0) === 0) return [];
        return [category];
      },
    );

    // The produce scope: everything linked to ANY Fresh sidebar collection.
    // "All Fresh" (no category selected) shows this list — never pantry or
    // heritage products, even though they share the same fetched catalog.
    const freshHandleSet = new Set<string>(FRESH_SIDEBAR_HANDLES);
    const produceProducts = items.filter((product) =>
      product.categories.some((ref) => freshHandleSet.has(ref.slug)),
    );

    return {
      products: items,
      produceProducts,
      categories: categoryList,
      isLoading: products.isPending || categories.isPending,
      isError: products.isError || categories.isError,
      refetch: () => {
        void products.refetch();
        void categories.refetch();
      },
    };
  }, [products.data, products.isPending, products.isError, categories.data, categories.isPending, categories.isError, products.refetch, categories.refetch]);
}

/**
 * Products of one Fresh category (or all when `handle` is null), including
 * sold-out. A product belongs when ANY of its category links matches — the
 * migrated catalog marks mega-collections primary, so matching only the
 * primary link would empty real collections.
 */
export function filterByCategory(
  products: ProductListItem[],
  handle: string | null,
): ProductListItem[] {
  if (handle === null) return products;
  return products.filter((product) =>
    product.categories.some((ref) => ref.slug === handle),
  );
}
