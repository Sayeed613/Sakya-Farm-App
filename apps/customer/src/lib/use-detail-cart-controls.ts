import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { cartQueryOptions, CART_QUERY_KEY } from '../api/cart-query';
import { cartApi } from '../api/cart';
import { createCartMutations } from './cart-mutations';
import { captureError } from './sentry';
import type { ProductDetail } from '@sakya/types';
import { useAuthStore } from '../stores/auth-store';
import { useGuestCartStore } from '../stores/guest-cart-store';

/**
 * Cart controls for the PRODUCT DETAIL screen.
 *
 * The detail screen renders its own stepper next to "Add to cart", driven by
 * the SELECTED variant (which can change via the variant selector), so it
 * needs per-variant semantics rather than the card-level "first line owns the
 * stepper" rule in `useProductAdd`.
 *
 * AUTHENTICATED: every action goes through the shared cart mutation
 * controller — one lock per product, keyed by slug — then writes the SERVER
 * response into `['cart']`.
 *
 * GUEST: quantities live in the guest store (merged into the server cart at
 * sign-in), exactly as before.
 *
 * REACTIVE: the server cart is read through `useQuery`, not
 * `queryClient.getQueryData`. This screen has no other `['cart']` observer
 * (the View Cart pill is deliberately not rendered here), so a plain
 * `getQueryData` read would never re-render after a mutation — and the old
 * `invalidateQueries` call had no active query to refetch. Subscribing is what
 * makes the stepper actually move after a successful write, while still sharing
 * the ONE cache entry every other cart consumer uses.
 */
export function useDetailCartControls(
  detail: ProductDetail | null,
  selectedVariantId: string | null,
) {
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((state) => state.session !== null);

  // Guest store subscription: re-renders this hook whenever lines change.
  const guestLines = useGuestCartStore((state) => state.lines);
  const addGuestLine = useGuestCartStore((state) => state.addLine);
  const setGuestQuantity = useGuestCartStore((state) => state.setQuantity);
  const rememberGuestPrice = useGuestCartStore((state) => state.rememberPrice);

  // Server cart subscription — the same cache entry the product cards, the
  // View Cart pill and the cart screen read.
  const serverCart = useQuery(cartQueryOptions(isAuthenticated));

  const mutations = useMemo(
    () =>
      createCartMutations({
        gateway: cartApi,
        // Replace with the authoritative response instead of invalidating:
        // the previous `invalidateQueries` kicked off a follow-up GET after
        // every tap, which the response already makes unnecessary.
        apply: (cart) => queryClient.setQueryData(CART_QUERY_KEY, cart),
      }),
    [queryClient],
  );

  // Same key the cards lock on, so the card and this screen cannot mutate one
  // product at the same time. Available exactly when a variant is selectable.
  const lockKey = detail?.slug ?? null;

  return useMemo(() => {
    const variants = detail?.variants ?? [];
    const selected = variants.find((variant) => variant.id === selectedVariantId) ?? null;

    const guestLine =
      selected !== null ? guestLines.find((line) => line.variantId === selected.id) : undefined;
    const serverLine =
      selected !== null
        ? serverCart.data?.items.find((item) => item.variantId === selected.id)
        : undefined;

    const quantity = isAuthenticated ? (serverLine?.quantity ?? 0) : (guestLine?.quantity ?? 0);

    /**
     * Drops the tap when this product already has a mutation in flight,
     * otherwise runs it under the lock. Failures release the lock (the
     * controller's `finally`) and write nothing to the cache, so the control
     * stays usable and the quantity shown remains the last server-confirmed
     * value.
     */
    const guarded = async (fn: () => Promise<void>): Promise<boolean> => {
      if (lockKey === null) return false;
      try {
        const result = await mutations.runExclusive(lockKey, fn);
        return result.ran;
      } catch (error) {
        // Lock released and nothing written by the controller's `finally`, so
        // the stepper stays tappable and still shows the last confirmed
        // quantity. Reported to the app's error sink (no-console is an error
        // rule in src/, and there is no cart error toast to show).
        captureError(error, {
          component: 'ProductDetailScreen',
          product: detail?.slug ?? null,
        });
        return false;
      }
    };

    /** Signed-in mutation: add/update/remove, then apply the response. */
    const serverApply = (nextQuantity: number): Promise<unknown> =>
      guarded(async () => {
        if (selected === null) return;
        await mutations.upsertLine(selected.id, serverLine?.id ?? null, nextQuantity);
      });

    // Plain functions (NOT useCallback — this whole block runs inside useMemo
    // and calling hooks there is illegal). Identity churn is acceptable: the
    // consumers pass them straight into Pressable onPress props.
    const add = async () => {
      if (selected === null) return;
      if (isAuthenticated) {
        await serverApply(quantity + 1);
        return;
      }
      rememberGuestPrice(selected.id, selected.priceInPaise);
      addGuestLine(selected.id, 1, {
        productTitle: detail?.title ?? '',
        variantTitle: selected.title,
        imageUrl: detail?.primaryImageUrl ?? null,
        slug: detail?.slug ?? '',
      });
    };

    const increment = async () => {
      if (selected === null) return;
      if (isAuthenticated) {
        await serverApply(quantity + 1);
        return;
      }
      rememberGuestPrice(selected.id, selected.priceInPaise);
      setGuestQuantity(selected.id, quantity + 1);
    };

    const decrement = async () => {
      if (selected === null || quantity === 0) return;
      if (isAuthenticated) {
        await serverApply(quantity - 1);
        return;
      }
      setGuestQuantity(selected.id, quantity - 1);
    };

    return { quantity, add, increment, decrement };
  }, [
    detail,
    selectedVariantId,
    guestLines,
    serverCart.data,
    isAuthenticated,
    mutations,
    lockKey,
    addGuestLine,
    setGuestQuantity,
    rememberGuestPrice,
  ]);
}
