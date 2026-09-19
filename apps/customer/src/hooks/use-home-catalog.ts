import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { catalogApi } from '../api/catalog';
import {
  DUPLICATE_HANDLE_PAIRS,
  EXCLUDED_HANDLES,
  HOME_SECTIONS,
  type HomeRailDef,
  type HomeSectionDef,
} from '../config/home-sections';
import type { CategorySummary, ProductListItem } from '@sakya/types';

/**
 * Home catalog hook — the single data source for every Home section.
 *
 * One products request (limit 100 covers the whole catalogue within the API's
 * own MAX_PAGE_SIZE) plus one categories request, grouped client-side into the
 * rails the section registry declares. No rail triggers its own request, so
 * Home costs exactly two API calls regardless of section count.
 *
 * Data rules applied here, per the known catalog quirks:
 * - duplicate collection pairs are collapsed to the primary handle;
 * - excluded handles never appear, in any section;
 * - a rail renders only when its category exists AND has purchasable products;
 * - display names come from `category.name`, never the handle.
 */

export interface HomeRail {
  railId: string;
  title: string;
  handle: string;
  products: ProductListItem[];
  seeAll: boolean;
}

export interface HomeData {
  sections: Array<
    | { kind: 'rails'; section: HomeSectionDef; rails: HomeRail[] }
    | { kind: 'bestsellers'; section: HomeSectionDef; rails: HomeRail[] }
    | { kind: 'health-goals'; section: HomeSectionDef; rails: HomeRail[] }
  >;
  categories: CategorySummary[];
  /** All available products, for the icon strip's category set. */
  stripCategories: CategorySummary[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

const ALL_PRODUCTS_STALE_MS = 60_000;

export function useHomeCatalog(): HomeData {
  const products = useQuery({
    queryKey: ['catalog', 'products', 'home-all'],
    queryFn: () => catalogApi.listProducts({ limit: 100 }),
    staleTime: ALL_PRODUCTS_STALE_MS,
  });

  const categories = useQuery({
    queryKey: ['catalog', 'categories'],
    queryFn: catalogApi.listCategories,
    staleTime: 5 * 60_000,
  });

  return useMemo(() => {
    const items = products.data?.items ?? [];
    const categoryList = categories.data ?? [];

    // Group products into EVERY linked collection (deduped), not just the
    // primary one: the migrated catalog marks mega-collections ("All", "All
    // Fresh") as primary, while real merchandising collections (Pickles,
    // Oils, Leafy Greens…) ride as secondary links. Grouping by primary alone
    // would empty every rail.
    const byCategory = new Map<string, ProductListItem[]>();
    for (const product of items) {
      if (!product.isAvailable || product.availableVariantCount === 0) continue;
      for (const ref of product.categories) {
        if (EXCLUDED_HANDLES.has(ref.slug)) continue;
        const bucket = byCategory.get(ref.slug);
        if (bucket) {
          if (!bucket.some((existing) => existing.id === product.id)) bucket.push(product);
        } else {
          byCategory.set(ref.slug, [product]);
        }
      }
    }

    const droppedHandles = new Set(DUPLICATE_HANDLE_PAIRS.map(([, drop]) => drop));

    const categoryByHandle = new Map(categoryList.map((category) => [category.slug, category]));

    const buildRail = (def: HomeRailDef): HomeRail | null => {
      if (!def.handle || droppedHandles.has(def.handle)) return null;
      const category = categoryByHandle.get(def.handle);
      // A rail needs its real category (for the display name) and products.
      if (!category) return null;
      const railProducts = byCategory.get(def.handle) ?? [];
      if (railProducts.length === 0) return null;
      return {
        railId: def.id,
        title: category.name, // Display name, never the handle.
        handle: def.handle,
        products: railProducts,
        seeAll: def.seeAll === true,
      };
    };

    const sections = HOME_SECTIONS.flatMap((section) => {
      const rails = section.rails
        .map(buildRail)
        .filter((rail): rail is HomeRail => rail !== null);
      if (rails.length === 0) return [];
      return [{ kind: section.type === 'bestsellers' ? 'bestsellers' : section.type === 'health-goals' ? 'health-goals' : 'rails', section, rails } as const];
    });

    // Icon strip: every non-excluded collection that actually has products,
    // in the API's display order, capped to keep the strip scrollable-fast.
    const stripCategories = categoryList
      .filter(
        (category) =>
          !EXCLUDED_HANDLES.has(category.slug) &&
          (byCategory.get(category.slug)?.length ?? 0) > 0,
      )
      .slice(0, 14);

    return {
      sections,
      categories: categoryList,
      stripCategories,
      isLoading: products.isPending || categories.isPending,
      isError: products.isError || categories.isError,
      refetch: () => {
        void products.refetch();
        void categories.refetch();
      },
    };
  }, [products.data, products.isPending, products.isError, categories.data, categories.isPending, categories.isError, products.refetch, categories.refetch]);
}
