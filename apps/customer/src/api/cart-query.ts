import { cartApi } from './cart';

/**
 * The ONE cart cache entry.
 *
 * Every cart consumer — product cards, the quick view, the related rail, the
 * product screen, the View Cart pill and `useCartSummary` — reads and writes
 * this key. Defining it in one place matters because the call sites had
 * drifted: the same query was observed with a 15s staleTime in some components
 * and 30s in others, so observers disagreed about when the cart was stale and a
 * mount in one component could trigger a refetch the others would not have
 * asked for.
 *
 * This is deliberately a shared key + options, NOT a new data layer: React
 * Query already gives every observer one cache entry and one in-flight request
 * per key, so N product cards are N cheap subscriptions to a single fetch —
 * each card still has to re-render for its own quantity anyway.
 */
export const CART_QUERY_KEY = ['cart'] as const;

/**
 * Shared read options for the server cart.
 *
 * `enabled` gates guests, who have no server cart to fetch — they read the
 * guest store instead.
 */
export function cartQueryOptions(enabled: boolean) {
  return {
    queryKey: CART_QUERY_KEY,
    queryFn: cartApi.getCart,
    enabled,
    /** One window for every observer, so they agree on when to refetch. */
    staleTime: 30_000,
  } as const;
}
