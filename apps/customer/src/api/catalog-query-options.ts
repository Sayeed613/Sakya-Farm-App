import { onlineManager, queryOptions, type QueryClient } from '@tanstack/react-query';

import { catalogApi } from './catalog';

/**
 * Shared CATALOGUE query options — the category-listing counterpart to
 * `product-detail-query.ts`, plus the two Home listing keys.
 *
 * WHY THIS MODULE EXISTS: three surfaces now need the exact same query
 * definitions — the screens that render them, the root layout's boot warm-up
 * (so Home's data is in flight while the icon font loads), and the category
 * prefetcher that warms a listing before the tap lands. One definition per
 * key means a screen can never join a request that used a different fetcher
 * or staleTime.
 *
 * KEYS ARE UNCHANGED: every key here is the exact literal the call sites
 * already used (`['catalog','category',slug]`, `['catalog','products',
 * 'home-all']`, `['catalog','categories']`), so this module can be adopted
 * incrementally without invalidating anything or changing request counts.
 */

/** Category listing staleness — matches the shared 60s listing window. */
export const CATEGORY_LISTING_STALE_TIME_MS = 60_000;

/** The one category-listing cache key (unchanged literal). */
export function categoryProductsKey(slug: string) {
  return ['catalog', 'category', slug] as const;
}

/**
 * Shared options for one category's product listing. The category screen
 * spreads these, so a prefetch and the screen observe the same entry and
 * coalesce into one request.
 */
export function categoryProductsQueryOptions(slug: string) {
  return queryOptions({
    queryKey: categoryProductsKey(slug),
    queryFn: () => catalogApi.listCategoryProducts(slug),
    staleTime: CATEGORY_LISTING_STALE_TIME_MS,
    enabled: Boolean(slug),
  });
}

/**
 * Home's products listing — the exact options Home/Fresh/Fresh-today use.
 * Exported so the root layout can warm it at boot without duplicating the
 * fetcher or drifting the key.
 */
export function homeProductsQueryOptions() {
  return queryOptions({
    queryKey: ['catalog', 'products', 'home-all'],
    queryFn: () => catalogApi.listProducts({ limit: 100 }),
    staleTime: 60_000,
  });
}

/** Home's category tree — same options the category strip observes. */
export function homeCategoriesQueryOptions() {
  return queryOptions({
    queryKey: ['catalog', 'categories'],
    queryFn: catalogApi.listCategories,
    staleTime: 5 * 60_000,
  });
}

/**
 * Warm one category listing without blocking the tap — mirrors
 * `prefetchProductDetail`'s contract exactly:
 *
 * - fire-and-forget: callers push the route immediately and never await;
 * - swallows fetch errors (prefetchQuery handles them internally), so a
 *   failure leaves the screen's own query to run as before;
 * - skips entirely when offline, so no paused request fires later;
 * - touches ONLY this category's key — never cart, never mutations.
 */
export function prefetchCategoryProducts(
  queryClient: QueryClient,
  slug: string,
): Promise<void> {
  if (slug.length === 0 || !onlineManager.isOnline()) {
    return Promise.resolve();
  }
  try {
    return queryClient.prefetchQuery(categoryProductsQueryOptions(slug));
  } catch {
    return Promise.resolve();
  }
}

/**
 * Warm Home's two boot queries (products + categories) in parallel. Used by
 * the root layout while the icon font loads, so the very first Home paint has
 * a head start instead of starting its requests only after the font gate
 * lifts. Same coalescing guarantee: if a screen mounts and observes the same
 * key, it joins this request rather than issuing a second one.
 */
export function prefetchHomeCatalog(queryClient: QueryClient): Promise<void> {
  if (!onlineManager.isOnline()) {
    return Promise.resolve();
  }
  try {
    return Promise.all([
      queryClient.prefetchQuery(homeProductsQueryOptions()),
      queryClient.prefetchQuery(homeCategoriesQueryOptions()),
    ]).then(() => undefined);
  } catch {
    return Promise.resolve();
  }
}
