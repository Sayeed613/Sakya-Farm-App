import { z } from 'zod';

import { paiseSchema, slugSchema } from './primitives';

/**
 * The contract for `migration/normalized/catalog.json`.
 *
 * This file is the boundary between the scraping/normalising step and the
 * database. The importer (`apps/api/prisma/import-catalog.ts`) validates the
 * document against these schemas before it writes anything, so a malformed
 * export fails loudly instead of producing a half-imported catalog.
 *
 * Rules encoded here:
 * - Prices are integer paise, never floats.
 * - Every record carries its original Shopify id and handle as source metadata;
 *   Shopify ids are never used as our primary keys.
 * - Shopify's `availableForSale` becomes our product/variant availability flag,
 *   which is deliberately separate from inventory quantity.
 */

export const CATALOG_SCHEMA_VERSION = 1;

export const catalogProductOptionSchema = z.object({
  name: z.string().min(1),
  values: z.array(z.string()),
});

export const catalogVariantSchema = z.object({
  /** Shopify variant id. Source metadata, not our primary key. */
  sourceVariantId: z.string().min(1),
  sku: z.string().min(1).nullish(),
  barcode: z.string().min(1).nullish(),
  /** Variant title, e.g. "500 g" or "1 kg". */
  title: z.string().min(1),
  /** Price in integer paise. */
  priceInPaise: paiseSchema,
  compareAtPriceInPaise: paiseSchema.nullish(),
  costInPaise: paiseSchema.nullish(),
  weightGrams: z.number().int().nonnegative().nullish(),
  requiresShipping: z.boolean().default(true),
  /** Availability from the source store, independent of our inventory counts. */
  availableForSale: z.boolean().default(false),
  position: z.number().int().nonnegative().default(0),
  optionValues: z.record(z.string(), z.string()).default({}),
  imageUrls: z.array(z.string().url()).default([]),
});

export const catalogImageSchema = z.object({
  sourceImageId: z.string().min(1).nullish(),
  url: z.string().url(),
  altText: z.string().nullish(),
  position: z.number().int().nonnegative().default(0),
  /** Source variant ids this image belongs to; empty means product-level. */
  variantSourceIds: z.array(z.string()).default([]),
});

export const catalogCategorySchema = z.object({
  /** Stable identifier used by `products[].categoryHandles`. */
  handle: slugSchema,
  name: z.string().min(1),
  parentHandle: slugSchema.nullish(),
  description: z.string().nullish(),
  position: z.number().int().nonnegative().default(0),
  sourceCollectionId: z.string().nullish(),
});

export const catalogProductSchema = z.object({
  sourcePlatform: z.literal('SHOPIFY').default('SHOPIFY'),
  sourceProductId: z.string().min(1),
  sourceHandle: z.string().min(1),
  title: z.string().min(1),
  /** Defaults to the source handle when omitted. */
  slug: slugSchema.optional(),
  description: z.string().nullish(),
  descriptionHtml: z.string().nullish(),
  vendor: z.string().nullish(),
  productType: z.string().nullish(),
  tags: z.array(z.string()).default([]),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).default('ACTIVE'),
  publishedAt: z.coerce.date().nullish(),
  availableForSale: z.boolean().default(false),
  categoryHandles: z.array(slugSchema).default([]),
  options: z.array(catalogProductOptionSchema).default([]),
  images: z.array(catalogImageSchema).default([]),
  variants: z.array(catalogVariantSchema).min(1, 'A product must have at least one variant'),
});

export const catalogFileSchema = z.object({
  schemaVersion: z.literal(CATALOG_SCHEMA_VERSION),
  sourcePlatform: z.literal('SHOPIFY'),
  sourceShopDomain: z.string().nullish(),
  /** When the normalised export was produced. */
  generatedAt: z.coerce.date(),
  categories: z.array(catalogCategorySchema).default([]),
  products: z.array(catalogProductSchema).default([]),
});

export type CatalogFile = z.infer<typeof catalogFileSchema>;
export type CatalogProduct = z.infer<typeof catalogProductSchema>;
export type CatalogVariant = z.infer<typeof catalogVariantSchema>;
export type CatalogImage = z.infer<typeof catalogImageSchema>;
export type CatalogCategory = z.infer<typeof catalogCategorySchema>;

/**
 * Parse a catalog document, throwing a ZodError with the failing paths.
 * The importer reports those paths rather than attempting a partial load.
 */
export function parseCatalogFile(input: unknown): CatalogFile {
  return catalogFileSchema.parse(input);
}
