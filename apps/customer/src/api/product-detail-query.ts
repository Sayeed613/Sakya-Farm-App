import { onlineManager, queryOptions, type QueryClient } from '@tanstack/react-query';

import { catalogApi } from './catalog';

/**
 * Product-detail queries — ONE namespace, ONE staleness rule, ONE prefetch path.
 *
 * Every surface that shows a full product (detail screen, quick view, variant
 * picker, notify-me control, add-to-cart detail fetch) resolves through
 * `productDetailQueryOptions(slug)`, so the same product can never land in two
 * cache entries, and a request started by any of them (or by `prefetch*`) is
 * joined by the others instead of duplicated.
 *
 * STALENESS: 120s matches what all five call sites already used before this
 * module existed (detail screen, quick view, variant picker, notify-me, and
 * use-product-add's first-add fetch), so nothing gets slower or faster by
 * centralizing it. 120s reflects how often a catalogue price/availability
 * actually changes, sits well above the 60s listing staleness, and is finite —
 * product data is never cached forever (gcTime stays at React Query's 5-minute
 * default, so untouched details are garbage-collected).
 */
export const PRODUCT_DETAIL_STALE_TIME_MS = 120_000;

/**
 * Hard cap on "likely next product" prefetches per trigger. Kept structurally
 * in `prefetchProductDetails` so a future caller cannot accidentally warm the
 * whole catalogue by passing a big array.
 */
export const RELATED_PREFETCH_LIMIT = 3;

/** The one product-detail cache key. */
export function productDetailKey(slug: string) {
  return ['catalog', 'product', slug] as const;
}

/** Shared query options for a product detail — key, fetcher and staleTime in one place. */
export function productDetailQueryOptions(slug: string) {
  return queryOptions({
    queryKey: productDetailKey(slug),
    queryFn: () => catalogApi.getProduct(slug),
    staleTime: PRODUCT_DETAIL_STALE_TIME_MS,
  });
}

/**
 * Warm one product's detail cache without blocking anything.
 *
 * - Fire-and-forget by contract: call sites push navigation immediately and
 *   never await this, so a slow or failing prefetch cannot delay a tap.
 * - Never produces an uncaught rejection: `QueryClient.prefetchQuery` swallows
 *   fetch errors internally (`.then(noop).catch(noop)` in query-core), and a
 *   failed prefetch leaves the query in error state so the detail screen's own
 *   observer retries normally on navigation.
 * - Respects offline: when the app is offline no request is scheduled at all
 *   (rather than leaving a paused fetch to fire later), and the detail screen
 *   falls back to its regular online-aware query when the user navigates.
 * - Touches ONLY the product-detail key: no listing keys, no cart keys, no
 *   mutations — it is a plain read prefetch.
 */
export function prefetchProductDetail(queryClient: QueryClient, slug: string): Promise<void> {
  if (slug.length === 0 || !onlineManager.isOnline()) {
    return Promise.resolve();
  }
  try {
    return queryClient.prefetchQuery(productDetailQueryOptions(slug));
  } catch {
    // prefetchQuery only throws for programmer errors (e.g. a broken client);
    // a prefetch must never break the interaction that triggered it.
    return Promise.resolve();
  }
}

/**
 * Prefetch at most `limit` DISTINCT slugs, in order — the "likely next
 * products" warmer used by the detail screen's related rail. Everything past
 * the cap is silently skipped so the helper stays bounded no matter what it is
 * handed.
 */
export function prefetchProductDetails(
  queryClient: QueryClient,
  slugs: string[],
  limit: number = RELATED_PREFETCH_LIMIT,
): Promise<void> {
  const seen = new Set<string>();
  const jobs: Array<Promise<void>> = [];
  for (const slug of slugs) {
    if (slug.length === 0 || seen.has(slug) || jobs.length >= limit) continue;
    seen.add(slug);
    jobs.push(prefetchProductDetail(queryClient, slug));
  }
  return Promise.all(jobs).then(() => undefined);
}
