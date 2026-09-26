import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { journeyApi } from '../api/journey';
import { useAuthStore } from '../stores/auth-store';

/**
 * The ONE wishlist.
 *
 * There used to be two: a local `wishlist-store` behind the quick-view heart,
 * and the server book (`/wishlist`) behind the Wishlist screen and the product
 * page. Hearting from the quick view wrote to the local store, so the item
 * never appeared in the Wishlist screen — the two surfaces silently disagreed.
 *
 * Every heart now reads and writes the server book through this hook, so the
 * quick view, the product page and the Wishlist screen stay in lockstep.
 */
export function useWishlist(): {
  isSaved: (slug: string) => boolean;
  /** Returns 'saved' | 'removed' | 'auth-required' | 'failed'. */
  toggle: (slug: string) => Promise<'saved' | 'removed' | 'auth-required' | 'failed'>;
} {
  const session = useAuthStore((state) => state.session);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['wishlist'],
    queryFn: journeyApi.listWishlist,
    enabled: session !== null,
    staleTime: 30_000,
  });

  const isSaved = useCallback(
    (slug: string) => query.data?.items.some((item) => item.productSlug === slug) ?? false,
    [query.data],
  );

  const toggle = useCallback(
    async (slug: string): Promise<'saved' | 'removed' | 'auth-required' | 'failed'> => {
      if (session === null) return 'auth-required';

      const saved = queryClient
        .getQueryData<{ items: Array<{ productSlug: string }> }>(['wishlist'])
        ?.items.some((item) => item.productSlug === slug) ?? false;

      try {
        if (saved) {
          await journeyApi.removeWishlistItem(slug);
        } else {
          await journeyApi.addWishlistItem(slug);
        }
        // The server response is the truth; let every reader re-read it.
        await queryClient.invalidateQueries({ queryKey: ['wishlist'] });
        return saved ? 'removed' : 'saved';
      } catch {
        // Adding can fail because it is already saved (or vice versa); the
        // failure is surfaced rather than guessed at.
        await queryClient.invalidateQueries({ queryKey: ['wishlist'] });
        return 'failed';
      }
    },
    [session, queryClient],
  );

  return { isSaved, toggle };
}
