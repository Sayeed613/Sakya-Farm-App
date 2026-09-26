import type { ProductListItem } from '@sakya/types';

import { DISCOUNT_ANOMALY_HANDLES } from '../config/home-sections';

/** Thirty-day "New" window. */
const NEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface ProductBadges {
  isNew: boolean;
  isBestseller: boolean;
  discountPercent: number | null;
  isOutOfStock: boolean;
}

/** Merchandising badges — curated by section, never fabricated product data. */
export type MerchBadge = 'premium' | 'fresh';

/**
 * The catalog's "Premium Vegetables" category (gourds-local-vegetables-copy —
 * broccoli, capsicum, baby corn, asparagus class produce). Anything inside it
 * legitimately wears the Premium badge; fresh produce (All Fresh) wears Fresh.
 */
const PREMIUM_CATEGORY_SLUG = 'gourds-local-vegetables-copy';
const FRESH_CATEGORY_SLUGS = new Set(['all-fresh', 'country-special-copy']);

export function deriveMerchBadges(product: ProductListItem): MerchBadge[] {
  const slugs = product.categories.map((category) => category.slug);
  const badges: MerchBadge[] = [];
  if (slugs.includes(PREMIUM_CATEGORY_SLUG)) badges.push('premium');
  if (FRESH_CATEGORY_SLUGS.has(slugs[0] ?? '')) badges.push('fresh');
  return badges;
}

/**
 * Data-driven badge derivation.
 *
 * "New" comes from the publish date; "Bestseller" only from an explicit field
 * on the product (none exists in this API version — read defensively so it
 * appears when a backend supplies it, never invented); the discount percentage
 * only when compare-at is genuinely higher than the selling price, which also
 * neutralises the broken compareAt values inherited from the Shopify export.
 */
export function deriveBadges(product: ProductListItem): ProductBadges {
  const extended = product as ProductListItem & {
    isBestseller?: boolean;
    bestseller?: boolean;
  };

  const publishedAt = product.publishedAt ? Date.parse(product.publishedAt) : null;
  const isNew =
    publishedAt !== null && !Number.isNaN(publishedAt) && Date.now() - publishedAt <= NEW_WINDOW_MS;

  const isBestseller = extended.isBestseller === true || extended.bestseller === true;

  const compareAt = product.compareAtMaxInPaise ?? null;
  const price = product.price?.minInPaise ?? null;
  let discountPercent: number | null = null;
  if (
    compareAt !== null &&
    price !== null &&
    compareAt > price &&
    !DISCOUNT_ANOMALY_HANDLES.has(product.slug)
  ) {
    discountPercent = Math.round(((compareAt - price) / compareAt) * 100);
  }

  const isOutOfStock = !product.isAvailable;

  return { isNew, isBestseller, discountPercent, isOutOfStock };
}
