import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { catalogApi } from '../api/catalog';
import {
  DISCOVERY_SECTIONS,
  type DiscoverySectionDef,
  type DiscoveryTileDef,
} from '../config/home-discovery';
import { DUPLICATE_HANDLE_PAIRS, EXCLUDED_HANDLES } from '../config/home-sections';
import { buildCollagePhotosByHandle } from '../lib/collage-photos';
import type { CategorySummary } from '@sakya/types';

/**
 * Discovery-grid data hook — the second half of Home's data layer.
 *
 * Shares the EXACT query keys useHomeCatalog and useFreshCatalog use, so the
 * whole screen still costs the same two API calls regardless of how many
 * discovery grids render. TanStack Query dedupes and serves everything from
 * the same cache within the staleTime window.
 *
 * A tile renders only when its handle maps to a real category AND has at least
 * one purchasable product — the same rule the rail system applies, so no tile
 * can dead-end into an empty listing. Sections whose tiles all drop are
 * hidden entirely (e.g. Non-Veg Pickles while their catalog is empty).
 */

export interface DiscoveryTile {
  handle: string;
  /** Display name from the API's category record — never the handle. */
  name: string;
  /** Real purchasable count, shown as the tile badge. */
  count: number;
  /**
   * Up to 4 REAL product photos from this category, for the tile's 2×2
   * collage. Never a reused icon artwork — the tile shows what it sells.
   */
  images: import('react-native').ImageSourcePropType[];
}

export interface DiscoverySection {
  def: DiscoverySectionDef;
  tiles: DiscoveryTile[];
}

export interface HomeDiscoveryData {
  sections: DiscoverySection[];
  /** Category records by handle, for banner targets and the strip. */
  categoryByHandle: Map<string, CategorySummary>;
  /**
   * Purchasable products per category handle — the same grouped view the
   * rails use, exposed so Home can compose editorial product sections from
   * collection groups WITHOUT any extra API calls (same cached query).
   */
  productsByHandle: Map<string, import('@sakya/types').ProductListItem[]>;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

const ALL_PRODUCTS_STALE_MS = 60_000;

export function useHomeDiscovery(): HomeDiscoveryData {
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

    const categoryByHandle = new Map(categoryList.map((category) => [category.slug, category]));

    // Purchasable counts per handle: a product counts for every collection it
    // links to (the migrated catalog marks mega-collections primary while the
    // real merchandising collections ride as secondary links).
    const purchasableByHandle = new Map<string, number>();
    for (const product of items) {
      if (!product.isAvailable || product.availableVariantCount === 0) continue;
      const seen = new Set<string>();
      for (const ref of product.categories) {
        if (seen.has(ref.slug)) continue;
        seen.add(ref.slug);
        purchasableByHandle.set(ref.slug, (purchasableByHandle.get(ref.slug) ?? 0) + 1);
      }
    }

    const photosByHandle = buildCollagePhotosByHandle(items);

    // Products grouped by EVERY linked (non-excluded) collection, deduped by
    // id — the same rule the rails apply. Editorial rails compose from this.
    const productsByHandle = new Map<string, import('@sakya/types').ProductListItem[]>();
    for (const product of items) {
      if (!product.isAvailable || product.availableVariantCount === 0) continue;
      const seen = new Set<string>();
      for (const ref of product.categories) {
        if (seen.has(ref.slug) || EXCLUDED_HANDLES.has(ref.slug)) continue;
        seen.add(ref.slug);
        const bucket = productsByHandle.get(ref.slug);
        if (bucket) {
          if (!bucket.some((existing) => existing.id === product.id)) bucket.push(product);
        } else {
          productsByHandle.set(ref.slug, [product]);
        }
      }
    }

    const droppedHandles = new Set(DUPLICATE_HANDLE_PAIRS.map(([, drop]) => drop));

    const buildTiles = (tiles: DiscoveryTileDef[]): DiscoveryTile[] => {
      const list: DiscoveryTile[] = [];
      const seenHandles = new Set<string>();
      for (const tile of tiles) {
        if (droppedHandles.has(tile.handle)) continue;
        if (seenHandles.has(tile.handle)) continue;
        const category = categoryByHandle.get(tile.handle);
        const count = purchasableByHandle.get(tile.handle) ?? 0;
        if (!category || count === 0) continue;
        seenHandles.add(tile.handle);
        list.push({
          handle: tile.handle,
          name: category.name,
          count,
          images: (photosByHandle.get(tile.handle) ?? []).map((uri) => ({ uri })),
        });
      }
      return list;
    };

    const sections: DiscoverySection[] = DISCOVERY_SECTIONS.flatMap((def) => {
      const tiles = buildTiles(def.tiles);
      if (tiles.length === 0) return [];
      return [{ def, tiles }];
    });

    return {
      sections,
      categoryByHandle,
      productsByHandle,
      isLoading: products.isPending || categories.isPending,
      isError: products.isError || categories.isError,
      refetch: () => {
        void products.refetch();
        void categories.refetch();
      },
    };
  }, [products.data, products.isPending, products.isError, categories.data, categories.isPending, categories.isError, products.refetch, categories.refetch]);
}
