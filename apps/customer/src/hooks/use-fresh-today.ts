import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { catalogApi } from '../api/catalog';
import type { ProductListItem } from '@sakya/types';

/**
 * "Fresh today" — the variable-reward rail.
 *
 * Deterministically rotates a selection from the catalog by day-of-year, so
 * the rail changes every day (a reason to open the app) but stays stable
 * within the day (no confusing flicker on refetch). Shares the EXACT
 * 'home-all' query key useHomeCatalog/useHomeDiscovery use — zero extra API
 * cost; TanStack Query serves it from cache.
 */

const STALE_MS = 60_000;
const SELECTION_SIZE = 8;

/** Day-of-year in UTC — stable across timezones within a day enough for a rail. */
function dayOfYear(): number {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), 0, 0);
  return Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - start) / 86_400_000);
}

export function useFreshToday() {
  const products = useQuery({
    queryKey: ['catalog', 'products', 'home-all'],
    queryFn: () => catalogApi.listProducts({ limit: 100 }),
    staleTime: STALE_MS,
  });

  return useMemo(() => {
    const items = (products.data?.items ?? []).filter(
      (product: ProductListItem) => product.isAvailable && product.availableVariantCount > 0,
    );

    // Deterministic daily shuffle: rotate by day, then take every Nth so the
    // mix spans categories rather than clustering one shelf.
    const day = dayOfYear();
    const rotated = items.slice(day % Math.max(items.length, 1)).concat(items.slice(0, day % Math.max(items.length, 1)));
    const picked: ProductListItem[] = [];
    const seen = new Set<string>();
    for (let i = 0; picked.length < Math.min(SELECTION_SIZE, items.length) && i < rotated.length; i += 1) {
      const product = rotated[i];
      if (!product || seen.has(product.id)) continue;
      seen.add(product.id);
      picked.push(product);
    }

    return {
      products: picked,
      isLoading: products.isPending,
      isError: products.isError,
    };
  }, [products.data, products.isPending, products.isError]);
}
