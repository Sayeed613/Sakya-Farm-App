import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { catalogApi } from '../api/catalog';
import { cdnImageUri } from '../lib/cdn-image';

/**
 * Title → product-photo lookup, for ORDER screens.
 *
 * Order lines are immutable snapshots of title/price (order_items) and carry
 * no image column, so the only honest client-side source is the live
 * catalogue: an exact title match against the SAME cached home query
 * (`['catalog','products','home-all']`) — zero extra API traffic whenever the
 * catalogue is already warm. A title the catalogue no longer carries
 * (renamed, archived, or a fixture like the removed test product) resolves to
 * null and the caller renders its placeholder instead.
 */
export function useProductImageByTitle(): (title: string) => string | null {
  const products = useQuery({
    queryKey: ['catalog', 'products', 'home-all'],
    queryFn: () => catalogApi.listProducts({ limit: 100 }),
    staleTime: 60_000,
  });

  return useMemo(() => {
    const byTitle = new Map<string, string>();
    for (const product of products.data?.items ?? []) {
      const image = product.primaryImageUrl ?? product.imageUrls[0] ?? null;
      if (image === null) continue;
      // First product wins a duplicate title; titles are unique in practice.
      if (!byTitle.has(product.title)) byTitle.set(product.title, image);
    }

    return (title: string): string | null => {
      const raw = byTitle.get(title);
      return raw === undefined ? null : cdnImageUri(raw, 220);
    };
  }, [products.data]);
}
