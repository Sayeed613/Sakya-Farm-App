import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useCallback } from 'react';

import { prefetchCategoryProducts } from '../api/catalog-query-options';

/**
 * Open a category listing while its cache warms on the way.
 *
 * The exact mirror of `useOpenProduct` for categories: the prefetch starts
 * first (fire-and-forget) and the route push happens immediately after, so
 * navigation is never gated on the network. Because the category screen
 * observes `categoryProductsQueryOptions(slug)` — the same shared options
 * this prefetch uses — it joins the request this started instead of issuing a
 * second one, and if the prefetch fails or is skipped offline, the screen's
 * own query simply runs as before.
 *
 * Use this instead of a bare `router.push('/(shop)/categories/…')` anywhere a
 * category listing is opened.
 */
export function useOpenCategory(): (slug: string) => void {
  const queryClient = useQueryClient();
  return useCallback(
    (slug: string) => {
      void prefetchCategoryProducts(queryClient, slug);
      router.push(`/(shop)/categories/${slug}`);
    },
    [queryClient],
  );
}
