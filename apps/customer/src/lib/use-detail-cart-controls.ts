import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { cartApi } from '../api/cart';
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
 * AUTHENTICATED: every action hits the server cart, then refreshes the
 * `['cart']` cache — identical to the card path, so the View Cart pill and
 * the cart screen stay in step.
 *
 * GUEST: quantities live in the guest store (merged into the server cart at
 * sign-in), exactly as before.
 *
 * REACTIVE: quantity derives from subscribed store state (the guest store via
 * the hook, or the React Query cache for the server cart) — the stepper
 * appears the moment a line exists. The old implementation read
 * `useGuestCartStore.getState()` during render, which never re-renders, so a
 * signed-in customer never saw the stepper replace the ADD button.
 */
export function useDetailCartControls(detail: ProductDetail | null, selectedVariantId: string | null) {
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((state) => state.session !== null);

  // Guest store subscription: re-renders this hook whenever lines change.
  const guestLines = useGuestCartStore((state) => state.lines);
  const addGuestLine = useGuestCartStore((state) => state.addLine);
  const setGuestQuantity = useGuestCartStore((state) => state.setQuantity);
  const rememberGuestPrice = useGuestCartStore((state) => state.rememberPrice);

  // Server cart subscription (cache updates after every mutation below).
  const serverCart = queryClient.getQueryData<{
    items: Array<{ id: string; variantId: string; quantity: number }>;
  }>(['cart']);

  return useMemo(() => {
    const variants = detail?.variants ?? [];
    const selected = variants.find((variant) => variant.id === selectedVariantId) ?? null;

    const guestLine =
      selected !== null ? guestLines.find((line) => line.variantId === selected.id) : undefined;
    const serverLine =
      selected !== null && serverCart !== undefined
        ? serverCart.items.find((item) => item.variantId === selected.id)
        : undefined;

    const quantity = isAuthenticated ? (serverLine?.quantity ?? 0) : (guestLine?.quantity ?? 0);

    /** Signed-in mutation: POST/PATCH/DELETE then refresh the cache. */
    const serverApply = async (variantId: string, nextQuantity: number) => {
      const cart = queryClient.getQueryData<{
        items: Array<{ id: string; variantId: string; quantity: number }>;
      }>(['cart']);
      const line = cart?.items.find((item) => item.variantId === variantId);
      if (nextQuantity <= 0) {
        if (line !== undefined) await cartApi.removeItem(line.id);
      } else if (line === undefined) {
        await cartApi.addItem({ variantId, quantity: nextQuantity });
      } else {
        await cartApi.updateItem(line.id, { quantity: nextQuantity });
      }
      await queryClient.invalidateQueries({ queryKey: ['cart'] });
    };

    // Plain functions (NOT useCallback — this whole block runs inside useMemo
    // and calling hooks there is illegal). Identity churn is acceptable: the
    // consumers pass them straight into Pressable onPress props.
    const add = async () => {
      if (selected === null) return;
      if (isAuthenticated) {
        await serverApply(selected.id, quantity + 1);
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
        await serverApply(selected.id, quantity + 1);
        return;
      }
      rememberGuestPrice(selected.id, selected.priceInPaise);
      setGuestQuantity(selected.id, quantity + 1);
    };

    const decrement = async () => {
      if (selected === null || quantity === 0) return;
      if (isAuthenticated) {
        await serverApply(selected.id, quantity - 1);
        return;
      }
      setGuestQuantity(selected.id, quantity - 1);
    };

    return { quantity, add, increment, decrement };
  }, [detail, selectedVariantId, guestLines, serverCart, isAuthenticated, queryClient, addGuestLine, setGuestQuantity, rememberGuestPrice]);
}
