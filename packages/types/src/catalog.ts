import type { CurrencyCode, Paise } from './money';
import type { ProductStatus } from './statuses';

/**
 * Read-only catalog contracts.
 *
 * These are deliberately narrower than the database rows. Clients get what they
 * render and nothing else:
 *
 * - Cost price, stock levels and Shopify provenance ids stay server-side.
 * - Money is always integer paise, matching how it is stored.
 * - Availability is reported as its own flag; it is not derived from stock,
 *   because the two answer different questions ("can I buy this?" versus
 *   "how many are on the shelf?").
 */

export interface CatalogImage {
  url: string;
  altText: string | null;
  position: number;
}

export interface CatalogCategoryRef {
  slug: string;
  name: string;
  /** The category shown as the product's primary grouping. */
  isPrimary: boolean;
}

export interface CatalogVariant {
  id: string;
  title: string;
  sku: string | null;
  priceInPaise: Paise;
  compareAtPriceInPaise: Paise | null;
  /** Source availability for this variant, independent of inventory. */
  isAvailable: boolean;
  position: number;
  /** Source option values, e.g. `{ "Qty:": "1 kg" }`. */
  optionValues: Record<string, string> | null;
}

/** Wide enough for every price the product's variants carry. */
export interface CatalogPriceRange {
  minInPaise: Paise;
  maxInPaise: Paise;
  currency: CurrencyCode;
}

/** List projection: enough to render a catalogue card and link to the detail view. */
export interface ProductListItem {
  id: string;
  slug: string;
  title: string;
  vendor: string | null;
  productType: string | null;
  /** Product-level availability, as published. Independent of stock. */
  isAvailable: boolean;
  primaryImageUrl: string | null;
  /** First four image URLs in display order, for card carousels. */
  imageUrls: string[];
  /**
   * Null when the product has no variant, and therefore no price: price lives on
   * the variant. Reported as null rather than a misleading zero.
   */
  price: CatalogPriceRange | null;
  /** Highest compare-at price across variants; null when none carries one. */
  compareAtMaxInPaise: Paise | null;
  variantCount: number;
  availableVariantCount: number;
  /** Variant titles in display order, e.g. ['500 g', '1 kg'] for pack sizes. */
  variantTitles: string[];
  categories: CatalogCategoryRef[];
  publishedAt: string | null;
}

/** Detail projection: everything the product page needs in one round trip. */
export interface ProductDetail extends ProductListItem {
  description: string | null;
  descriptionHtml: string | null;
  tags: string[];
  status: ProductStatus;
  images: CatalogImage[];
  variants: CatalogVariant[];
}

/** Category with the number of products currently linked to it. */
export interface CategorySummary {
  slug: string;
  name: string;
  description: string | null;
  /** Slug of the parent category, or null at the root of the tree. */
  parentSlug: string | null;
  position: number;
  productCount: number;
}
