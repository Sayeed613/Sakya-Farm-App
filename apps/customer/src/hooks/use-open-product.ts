import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useCallback } from 'react';

import { prefetchProductDetail } from '../api/product-detail-query';

/**
 * Open a product page while its detail cache warms on the way.
 *
 * The prefetch starts first (it is fire-and-forget) and the route push happens
 * immediately after, so navigation is never gated on the network. Because the
 * detail screen observes the exact same `productDetailQueryOptions(slug)`, it
 * joins the request this started — one network round trip covers press AND
 * page — and if the prefetch fails or is skipped offline, the screen's own
 * query simply runs as before.
 *
 * Use this instead of a bare `router.push('/(shop)/products/…')` anywhere a
 * product detail is opened.
 */
export function useOpenProduct(): (slug: string) => void {
  const queryClient = useQueryClient();
  return useCallback(
    (slug: string) => {
      void prefetchProductDetail(queryClient, slug);
      router.push(`/(shop)/products/${slug}`);
    },
    [queryClient],
  );
}
