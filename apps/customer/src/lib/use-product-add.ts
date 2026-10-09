import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

import { cartQueryOptions, CART_QUERY_KEY } from '../api/cart-query';
import { cartApi } from '../api/cart';
import { productDetailKey, productDetailQueryOptions } from '../api/product-detail-query';
import { selectProductLine, type CartLineView } from './cart-line';
import { createCartMutations } from './cart-mutations';
import type { ProductDetail, ProductListItem } from '@sakya/types';
import { captureError } from './sentry';
import { useAuthStore } from '../stores/auth-store';
import { useGuestCartStore } from '../stores/guest-cart-store';

/**
 * Bridges a product card to the guest or server cart.
 *
 * List items carry no variant ids (price lives on the variant), so the FIRST
 * add resolves the product detail once — reusing the same
 * `['catalog','product',slug]` cache the quick view and detail page use — and
 * adds the default available variant. Every later tap on a line that already
 * exists is pure arithmetic against the cart the server gave us, so no detail
 * fetch is needed to show or change a quantity.
 *
 * SAFETY: all four mutations (`add`, `addVariant`, `increment`, `decrement`)
 * run under ONE lock keyed by product slug. A tap that lands while the same
 * product's mutation is in flight is dropped instead of dispatched, and the
 * lock is released in `finally`, so a failed request never wedges the control.
 * Different products hold different keys and never wait on each other.
 *
 * SERVER AUTHORITY: only a server response reaches the `['cart']` cache.
 * Quantities are read from that cache (or the guest store) — never invented
 * here — and a rejected request writes nothing.
 */

/**
 * Client-side display snapshot for a guest cart line, from the catalog data
 * the customer actually saw. Display-only — the server re-resolves titles at
 * merge time, so this never affects what is ordered or priced.
 */
function displaySnapshot(
  detail: ProductDetail | null,
  variant: { id: string; title?: string },
): { productTitle: string; variantTitle: string; imageUrl: string | null; slug: string } | undefined {
  if (!detail) return undefined;
  const variantTitle =
    variant.title ?? detail.variants.find((candidate) => candidate.id === variant.id)?.title ?? '';
  return {
    productTitle: detail.title,
    variantTitle,
    imageUrl: detail.primaryImageUrl,
    slug: detail.slug,
  };
}

export function defaultVariantOfDetail(detail: ProductDetail) {
  return detail.variants.find((variant) => variant.isAvailable) ?? detail.variants[0] ?? null;
}

export function useProductAdd(
  product: ProductListItem,
  options?: { preferredVariantId?: string | null },
) {
  const queryClient = useQueryClient();
  const addLine = useGuestCartStore((state) => state.addLine);
  const setQuantity = useGuestCartStore((state) => state.setQuantity);
  const rememberPrice = useGuestCartStore((state) => state.rememberPrice);
  const lines = useGuestCartStore((state) => state.lines);
  const isAuthenticated = useAuthStore((state) => state.session !== null);
  const preferredVariantId = options?.preferredVariantId ?? null;

  const serverCart = useQuery(cartQueryOptions(isAuthenticated));

  /**
   * Every line we could possibly own, in cart order. Server lines carry
   * `productSlug`, guest lines carry it in their display snapshot when one was
   * captured — which is what lets the stepper resolve WITHOUT the detail.
   */
  const lineViews = useMemo<CartLineView[]>(() => {
    if (isAuthenticated) {
      return (serverCart.data?.items ?? []).map((item) => ({
        id: item.id,
        variantId: item.variantId,
        quantity: item.quantity,
        slug: item.productSlug,
      }));
    }
    return lines.map((line) => ({
      id: null,
      variantId: line.variantId,
      quantity: line.quantity,
      slug: line.display?.slug ?? null,
    }));
  }, [isAuthenticated, lines, serverCart.data]);

  const [resolving, setResolving] = useState(false);
  const [mutating, setMutating] = useState(false);

  const detailKey = useMemo(() => productDetailKey(product.slug), [product.slug]);

  const readDetail = useCallback(() => {
    return queryClient.getQueryData<ProductDetail>(detailKey) ?? null;
  }, [queryClient, detailKey]);

  const fetchDetail = useCallback(async () => {
    const cached = readDetail();
    if (cached) return cached;
    setResolving(true);
    try {
      return await queryClient.fetchQuery(productDetailQueryOptions(product.slug));
    } finally {
      setResolving(false);
    }
  }, [queryClient, product.slug, readDetail]);

  /** Variant ids of THIS product, when the detail happens to be cached. */
  const variantIds = useMemo(() => {
    const detail = readDetail();
    return detail ? new Set(detail.variants.map((variant) => variant.id)) : undefined;
    // `readDetail` is stable per slug; re-derive when the detail query or the
    // cart changes (fetchDetail's `resolving` toggle also forces a re-render).
  }, [readDetail, lineViews]);

  const ownLine = useMemo(
    () => selectProductLine(lineViews, product.slug, variantIds),
    [lineViews, product.slug, variantIds],
  );

  const quantity = ownLine?.quantity ?? 0;
  const activeVariantId = ownLine?.variantId ?? null;

  const mutations = useMemo(
    () =>
      createCartMutations({
        gateway: cartApi,
        // The single source of cart truth: the View Cart pill, cart screen and
        // summary all read this key, so writing the server response here keeps
        // them in step without an extra GET.
        apply: (cart) => queryClient.setQueryData(CART_QUERY_KEY, cart),
      }),
    [queryClient],
  );

  /**
   * Runs `fn` under this product's lock.
   *
   * The lock is taken BEFORE `fn` runs, and `setMutating` happens only once
   * the lock is actually held — so a dropped tap cannot clear the disabled
   * state the first tap set. `fn` receives the whole operation, detail fetch
   * included, so nothing can slip in between the gate and the request.
   */
  const runExclusive = useCallback(
    async (fn: () => Promise<void>): Promise<boolean> => {
      try {
        const result = await mutations.runExclusive(product.slug, async () => {
          setMutating(true);
          try {
            await fn();
          } finally {
            setMutating(false);
          }
        });
        return result.ran;
      } catch (error) {
        // The lock has already released (its `finally`) and `mutating` has
        // already been cleared (the inner `finally`), so the control is usable
        // again and nothing was written to the cache — the quantity shown stays
        // the last server-confirmed one. There is no cart error toast in this
        // app, so the failure goes to the app's error sink instead; this also
        // turns what would otherwise be an unhandled rejection (`void add()`)
        // into a handled one.
        captureError(error, { component: 'ProductCard', product: product.slug });
        return false;
      }
    },
    [mutations, product.slug],
  );

  const add = useCallback(
    async (): Promise<boolean> =>
      runExclusive(async () => {
        const detail = await fetchDetail();
        const variant = defaultVariantOfDetail(detail);
        if (!variant) return;

        if (isAuthenticated) {
          await mutations.addItem(variant.id, 1);
          return;
        }

        rememberPrice(variant.id, variant.priceInPaise);
        addLine(variant.id, 1, displaySnapshot(detail, variant));
      }),
    [runExclusive, fetchDetail, isAuthenticated, mutations, rememberPrice, addLine],
  );

  /** Add exactly the chosen variant (picker/detail flows). */
  const addVariant = useCallback(
    async (variant: { id: string; priceInPaise: number; title?: string }): Promise<boolean> =>
      // Previously unguarded: every tap in the variant picker dispatched its
      // own request and `mutating` never flipped, so the control stayed live.
      runExclusive(async () => {
        if (isAuthenticated) {
          await mutations.addItem(variant.id, 1);
          return;
        }
        rememberPrice(variant.id, variant.priceInPaise);
        addLine(
          variant.id,
          1,
          variant.title ? displaySnapshot(readDetail(), variant as never) : undefined,
        );
      }),
    [runExclusive, isAuthenticated, mutations, rememberPrice, readDetail, addLine],
  );

  const increment = useCallback(
    async (): Promise<boolean> =>
      runExclusive(async () => {
        // A line we already own: `+1` is a RELATIVE server operation, so no
        // product-detail fetch is needed at all.
        if (ownLine !== null) {
          if (isAuthenticated) {
            await mutations.addItem(ownLine.variantId, 1);
            return;
          }
          setQuantity(ownLine.variantId, ownLine.quantity + 1);
          return;
        }

        // Nothing in the cart yet: resolve which variant to add.
        const detail = await fetchDetail();
        const variant =
          detail.variants.find((candidate) => candidate.id === preferredVariantId) ??
          defaultVariantOfDetail(detail);
        if (!variant) return;

        if (isAuthenticated) {
          await mutations.addItem(variant.id, 1);
          return;
        }

        rememberPrice(variant.id, variant.priceInPaise);
        setQuantity(variant.id, 1);
      }),
    [
      runExclusive,
      ownLine,
      isAuthenticated,
      mutations,
      fetchDetail,
      preferredVariantId,
      setQuantity,
      rememberPrice,
    ],
  );

  const decrement = useCallback(
    async (): Promise<boolean> =>
      runExclusive(async () => {
        // Quantity comes from the server cart (or guest store) — never from
        // arithmetic the server has not seen. The lock guarantees no second
        // decrement can read this same value and write it back.
        if (ownLine === null || ownLine.quantity <= 0) return;

        if (isAuthenticated && ownLine.id !== null) {
          await mutations.setLine(ownLine.id, ownLine.quantity - 1);
          return;
        }

        setQuantity(ownLine.variantId, ownLine.quantity - 1);
      }),
    [runExclusive, ownLine, isAuthenticated, mutations, setQuantity],
  );

  return { quantity, add, addVariant, increment, decrement, resolving, mutating, activeVariantId };
}
