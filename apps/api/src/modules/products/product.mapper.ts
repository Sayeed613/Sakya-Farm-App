import {
  DEFAULT_CURRENCY,
  type CatalogCategoryRef,
  type CatalogImage,
  type CatalogPriceRange,
  type CatalogVariant,
  type Paise,
  type ProductDetail,
  type ProductListItem,
  type ProductStatus,
} from '@sakya/types';

/**
 * Row shapes -> public DTOs.
 *
 * The interfaces below mirror the `select` objects in `products.service.ts`. They
 * are declared explicitly rather than derived from Prisma's generic payload types
 * so that the read projection is readable in one place; the assignment of a
 * `findMany` result to these types is still type-checked, so a select that stops
 * returning a required field is a compile error rather than a runtime surprise.
 *
 * Nothing here reads `costInPaise`, stock, or Shopify provenance ids: those are
 * server-side concerns and must not reach a public response.
 */

export interface ProductListRowVariant {
  priceInPaise: number;
  isAvailable: boolean;
  title: string;
  compareAtPriceInPaise: number | null;
}

export interface ProductListRowImage {
  url: string;
  altText: string | null;
}

export interface ProductCategoryRow {
  isPrimary: boolean;
  category: { slug: string; name: string };
}

export interface ProductListRow {
  id: string;
  slug: string;
  title: string;
  vendor: string | null;
  productType: string | null;
  isAvailable: boolean;
  publishedAt: Date | null;
  variants: ProductListRowVariant[];
  images: ProductListRowImage[];
  categories: ProductCategoryRow[];
}

export interface ProductDetailRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  descriptionHtml: string | null;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  status: ProductStatus;
  isAvailable: boolean;
  publishedAt: Date | null;
  variants: ProductVariantRow[];
  images: ProductDetailRowImage[];
  categories: ProductCategoryRow[];
}

export interface ProductDetailRowImage {
  url: string;
  altText: string | null;
  position: number;
}

export interface ProductVariantRow {
  id: string;
  title: string;
  sku: string | null;
  priceInPaise: number;
  compareAtPriceInPaise: number | null;
  isAvailable: boolean;
  position: number;
  /** Prisma `Json`; narrowed before it reaches a response. */
  optionValues: unknown;
}

/**
 * Summarise the variant prices a product actually carries.
 *
 * Returns null for a product with no variants: there is no price to report, and
 * inventing a zero would render as a free product.
 */
function toPriceRange(variants: readonly { priceInPaise: number }[]): CatalogPriceRange | null {
  if (variants.length === 0) {
    return null;
  }

  const prices = variants.map((variant) => variant.priceInPaise);

  return {
    minInPaise: Math.min(...prices) as Paise,
    maxInPaise: Math.max(...prices) as Paise,
    currency: DEFAULT_CURRENCY,
  };
}

function toCategoryRefs(categories: readonly ProductCategoryRow[]): CatalogCategoryRef[] {
  return categories.map((link) => ({
    slug: link.category.slug,
    name: link.category.name,
    isPrimary: link.isPrimary,
  }));
}

/**
 * Narrow Prisma's `JsonValue` to the string map the option values are known to be.
 * Anything else is reported as absent rather than passed through as-is.
 */
function toOptionValues(value: unknown): Record<string, string> | null {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );

  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

export function toCatalogVariant(row: ProductVariantRow): CatalogVariant {
  return {
    id: row.id,
    title: row.title,
    sku: row.sku,
    priceInPaise: row.priceInPaise as Paise,
    compareAtPriceInPaise: row.compareAtPriceInPaise as Paise | null,
    isAvailable: row.isAvailable,
    position: row.position,
    optionValues: toOptionValues(row.optionValues),
  };
}

export function toCatalogImage(row: ProductDetailRowImage): CatalogImage {
  return { url: row.url, altText: row.altText, position: row.position };
}

export function toProductListItem(row: ProductListRow): ProductListItem {
  const availableVariantCount = row.variants.filter((variant) => variant.isAvailable).length;

  // Highest compare-at across variants: the card's MRP anchor. Null when no
  // variant carries one.
  const compareAtValues = row.variants
    .map((variant) => variant.compareAtPriceInPaise)
    .filter((value): value is number => value !== null);
  const compareAtMaxInPaise =
    compareAtValues.length > 0 ? (Math.max(...compareAtValues) as Paise) : null;

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    vendor: row.vendor,
    productType: row.productType,
    isAvailable: row.isAvailable,
    primaryImageUrl: row.images[0]?.url ?? null,
    imageUrls: row.images.map((image) => image.url),
    price: toPriceRange(row.variants),
    compareAtMaxInPaise,
    variantCount: row.variants.length,
    availableVariantCount,
    variantTitles: row.variants.map((variant) => variant.title),
    categories: toCategoryRefs(row.categories),
    publishedAt: row.publishedAt?.toISOString() ?? null,
  };
}

export function toProductDetail(row: ProductDetailRow): ProductDetail {
  return {
    ...toProductListItem(row),
    description: row.description,
    descriptionHtml: row.descriptionHtml,
    tags: row.tags,
    status: row.status,
    images: row.images.map(toCatalogImage),
    variants: row.variants.map(toCatalogVariant),
  };
}
