import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

import { catalogApi } from '../api/catalog';
import type { ProductDetail, ProductListItem } from '@sakya/types';
import { useGuestCartStore } from '../stores/guest-cart-store';

/**
 * Bridges a product card to the guest cart.
 *
 * List items carry no variant ids (price lives on the variant), so the first
 * ADD resolves the product detail once — reusing the same
 * `['catalog','product',slug]` cache the quick view and detail page use — and
 * adds the default available variant. Afterwards quantities are pure local
 * arithmetic, so steppers respond instantly.
 *
 * Only `variantId + quantity` enter the cart store; prices stay server-side.
 *
 * Variant rules (per the product spec):
 * - single available variant → ADD adds that variant directly;
 * - multiple available variants → the card opens the variant picker instead
 *   (handled by the caller); the `preferredVariantId` lets the picker reflect
 *   an in-progress choice, and `addVariant` adds an exact chosen variant.
 */
const DETAIL_STALE_TIME_MS = 120_000;

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
  const preferredVariantId = options?.preferredVariantId ?? null;

  const [resolving, setResolving] = useState(false);

  const detailKey = useMemo(() => ['catalog', 'product', product.slug] as const, [product.slug]);

  const readDetail = useCallback(() => {
    return queryClient.getQueryData<ProductDetail>(detailKey) ?? null;
  }, [queryClient, detailKey]);

  const fetchDetail = useCallback(async () => {
    const cached = readDetail();
    if (cached) return cached;
    setResolving(true);
    try {
      return await queryClient.fetchQuery({
        queryKey: detailKey,
        queryFn: () => catalogApi.getProduct(product.slug),
        staleTime: DETAIL_STALE_TIME_MS,
      });
    } finally {
      setResolving(false);
    }
  }, [queryClient, detailKey, product.slug, readDetail]);

  const quantity = useMemo(() => {
    const detail = readDetail();
    if (!detail) return 0;
    // The card shows ONE stepper per product. Whichever variant of this
    // product is already in the cart owns the stepper (first line wins), so a
    // picker-chosen variant keeps its quantity visible on the card.
    const variantIds = new Set(detail.variants.map((variant) => variant.id));
    const line = lines.find((candidate) => variantIds.has(candidate.variantId));
    return line?.quantity ?? 0;
  }, [readDetail, lines]);

  /** The variant currently owning this product's stepper, if any. */
  const activeVariantId = useMemo(() => {
    const detail = readDetail();
    if (!detail) return null;
    const variantIds = new Set(detail.variants.map((variant) => variant.id));
    return lines.find((candidate) => variantIds.has(candidate.variantId))?.variantId ?? null;
  }, [readDetail, lines]);

  const add = useCallback(async () => {
    const detail = await fetchDetail();
    const variant = defaultVariantOfDetail(detail);
    if (variant) {
      rememberPrice(variant.id, variant.priceInPaise);
      addLine(variant.id, 1, displaySnapshot(detail, variant));
    }
  }, [fetchDetail, addLine, rememberPrice]);

  /** Add exactly the chosen variant (picker/detail flows). */
  const addVariant = useCallback(
    (variant: { id: string; priceInPaise: number; title?: string }) => {
      rememberPrice(variant.id, variant.priceInPaise);
      addLine(variant.id, 1, variant.title ? displaySnapshot(readDetail(), variant as never) : undefined);
    },
    [addLine, rememberPrice, readDetail],
  );

  const increment = useCallback(async () => {
    const detail = await fetchDetail();
    // Bump the line that owns the stepper, else the preferred/default variant.
    const variantIds = new Set(detail.variants.map((variant) => variant.id));
    const owned = lines.find((candidate) => variantIds.has(candidate.variantId));
    const variant =
      detail.variants.find((candidate) => candidate.id === (owned?.variantId ?? preferredVariantId)) ??
      defaultVariantOfDetail(detail);
    if (!variant) return;
    rememberPrice(variant.id, variant.priceInPaise);
    const current = lines.find((line) => line.variantId === variant.id)?.quantity ?? 0;
    setQuantity(variant.id, current + 1);
  }, [fetchDetail, lines, setQuantity, rememberPrice, preferredVariantId]);

  const decrement = useCallback(() => {
    const detail = readDetail();
    if (!detail) return;
    const variantIds = new Set(detail.variants.map((variant) => variant.id));
    const owned = lines.find((candidate) => variantIds.has(candidate.variantId));
    if (!owned) return;
    const current = owned.quantity;
    setQuantity(owned.variantId, current - 1);
  }, [readDetail, lines, setQuantity]);

  return { quantity, add, addVariant, increment, decrement, resolving, activeVariantId };
}
