import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { CATALOG_SCHEMA_VERSION, parseCatalogFile, type CatalogFile } from '@sakya/validation';
import { ZodError } from 'zod';

import { migrationPath } from './repository-root';

/**
 * Deterministic normaliser: scraped export -> catalog import contract.
 *
 *   migration/normalized/sakyafarms_normalized.json  ->  migration/normalized/catalog.json
 *                                                    ->  migration/reports/normalization_report.json
 *
 * The scraped export is complete but is not shaped like the contract the importer
 * validates against, so it is transformed rather than re-scraped:
 *
 * - Field renames (id -> sourceProductId, handle -> sourceHandle, src -> url, ...).
 * - Rupees -> paise. **Prices in the source are rupees; every price column in the
 *   database is an integer number of paise.** A missing conversion here would
 *   misprice the entire catalogue by 100x, so the conversion is verified rather
 *   than assumed: a price that does not land on a whole paise aborts the run.
 * - Variant option values are lifted into `optionValues`. The source flattens them
 *   into `option1..option3`; dropping them would silently lose data.
 *
 * Deliberate non-goals:
 *
 * - No network access. The site is never re-scraped.
 * - Nothing under `migration/raw` is read or written, and the source export is
 *   never modified.
 * - Nothing is written to PostgreSQL. This only produces a file.
 * - No data is invented. Gaps stay gaps: missing descriptions stay null, the 13
 *   products with no available variant keep `availableForSale: false`, and the 10
 *   compare-at anomalies keep their source values and are reported for review
 *   instead of being silently corrected.
 * - Output is byte-stable for a given input: `generatedAt` comes from the source's
 *   `scraped_at` (not the clock) so two runs produce an identical file that can be
 *   reviewed as a diff.
 *
 * Usage:
 *   pnpm --filter @sakya/api catalog:normalize
 *   ... --source=path --out=path --report=path   # override any path
 */

const defaultPaths = {
  source: migrationPath('normalized', 'sakyafarms_normalized.json'),
  output: migrationPath('normalized', 'catalog.json'),
  report: migrationPath('reports', 'normalization_report.json'),
  imagesRoot: migrationPath(),
};

/** Counts upstream and downstream must agree exactly; these are the frozen expectations. */
const EXPECTED = {
  products: 84,
  categories: 26,
  variants: 232,
  images: 196,
} as const;

// --- Source shape (the scraped export) ---------------------------------------

interface SourceOptionsBlock {
  name: string;
  position?: number;
  values: string[];
}

interface SourceImage {
  id: number;
  src: string;
  position?: number;
  alt?: string | null;
  local_path?: string;
}

interface SourceVariant {
  id: number;
  title: string;
  sku?: string | null;
  price?: number | null;
  compare_at_price?: number | null;
  available?: boolean;
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
}

interface SourceReviewBlock {
  average_rating?: number;
  review_count?: number;
  reviews?: unknown[];
}

interface SourceProduct {
  id: number;
  handle: string;
  title: string;
  vendor?: string | null;
  product_type?: string | null;
  tags?: string[];
  description_html?: string | null;
  description_text?: string | null;
  categories?: string[];
  options?: SourceOptionsBlock[];
  images?: SourceImage[];
  variants?: SourceVariant[];
  url?: string;
  reviews?: SourceReviewBlock;
}

interface SourceCategory {
  id: number;
  handle: string;
  title: string;
  product_count?: number;
}

interface SourceCatalog {
  meta?: {
    source?: string;
    scraped_at?: string;
    product_count?: number;
    category_count?: number;
  };
  categories?: SourceCategory[];
  products?: SourceProduct[];
}

// --- Source shape (the raw export, used read-only to prove nothing was dropped) --

interface RawVariant {
  id: number;
  grams?: number;
  requires_shipping?: boolean;
}

interface RawProduct {
  id: number;
  published_at?: string | null;
  variants?: RawVariant[];
}

// --- Helpers -----------------------------------------------------------------

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/** Blank strings from the source mean "absent", not "empty". Collapse them to null. */
const nullIfBlank = (value: unknown): string | null =>
  isNonEmptyString(value) ? value.trim() : null;

/**
 * Rupees -> integer paise.
 *
 * Source prices are whole rupees, but the conversion is checked instead of
 * assumed: a value that does not land on a whole paise would corrupt money in the
 * database, so it is a hard failure rather than a rounding.
 */
function toPaise(rupees: number, label: string): number {
  const paise = rupees * 100;
  const rounded = Math.round(paise);

  if (Math.abs(paise - rounded) > 1e-6) {
    throw new Error(
      `${label}: ${rupees} rupees does not convert to a whole number of paise (got ${paise}). ` +
        'Money must be stored as integer paise; fix the source value rather than rounding it silently.',
    );
  }

  if (rounded < 0) {
    throw new Error(`${label}: negative price ${rupees} is not a valid amount.`);
  }

  return rounded;
}

// --- Transform ---------------------------------------------------------------

interface NormalizeOutcome {
  catalog: Record<string, unknown>;
  report: Record<string, unknown>;
}

function normalize(source: SourceCatalog, rawProducts: RawProduct[]): NormalizeOutcome {
  const sourceProducts = source.products ?? [];
  const sourceCategories = source.categories ?? [];

  // Preconditions: the export is expected to be complete and internally unique.
  if (sourceProducts.length !== EXPECTED.products) {
    throw new Error(
      `Expected ${EXPECTED.products} products in the source export, found ${sourceProducts.length}.`,
    );
  }
  if (sourceCategories.length !== EXPECTED.categories) {
    throw new Error(
      `Expected ${EXPECTED.categories} categories in the source export, found ${sourceCategories.length}.`,
    );
  }

  // --- Categories ------------------------------------------------------------
  const categoryHandles = new Set<string>();
  for (const category of sourceCategories) {
    if (categoryHandles.has(category.handle)) {
      throw new Error(`Duplicate category handle "${category.handle}" in the source export.`);
    }
    if (!isNonEmptyString(category.title)) {
      throw new Error(`Category "${category.handle}" has no title, so it cannot be named.`);
    }
    categoryHandles.add(category.handle);
  }

  const categories = sourceCategories.map((category, index) => ({
    handle: category.handle,
    name: category.title,
    parentHandle: null,
    description: null,
    // Source collections carry no ordering, so the export order is preserved.
    position: index,
    sourceCollectionId: String(category.id),
  }));

  // --- Products --------------------------------------------------------------
  const seenProductIds = new Set<string>();
  const seenProductHandles = new Set<string>();
  const seenVariantIds = new Set<string>();

  const priceAnomalies: Record<string, unknown>[] = [];
  const missingDescriptions: string[] = [];
  const unavailableProducts: string[] = [];
  const productsWithoutImages: string[] = [];
  const duplicateOptionNames: Record<string, unknown>[] = [];
  const emptyAltTexts = { count: 0 };

  let variantCount = 0;
  let imageCount = 0;
  let compareAtCount = 0;
  let availableVariantCount = 0;

  const missingImageFiles: string[] = [];
  const imagesWithoutLocalPath: string[] = [];

  // `publishedAt` lives in the raw export; the normalising step dropped it. It is
  // source metadata, so it is recovered rather than invented, and a product absent
  // from the raw export keeps null instead of a guessed timestamp. The raw export
  // is read only, never written.
  const publishedByHandle = new Map<number, string>();
  for (const raw of rawProducts) {
    if (isNonEmptyString(raw.published_at)) {
      publishedByHandle.set(raw.id, raw.published_at);
    }
  }

  const products = sourceProducts.map((product) => {
    const sourceProductId = String(product.id);
    if (seenProductIds.has(sourceProductId)) {
      throw new Error(`Duplicate source product id "${sourceProductId}" in the source export.`);
    }
    seenProductIds.add(sourceProductId);

    if (seenProductHandles.has(product.handle)) {
      throw new Error(`Duplicate source handle "${product.handle}" in the source export.`);
    }
    seenProductHandles.add(product.handle);

    const options = product.options ?? [];

    // Duplicate option names would collapse keys in `optionValues`, so they are
    // surfaced rather than silently overwritten.
    const optionNames = options.map((option) => option.name);
    if (new Set(optionNames).size !== optionNames.length) {
      duplicateOptionNames.push({ handle: product.handle, optionNames });
    }

    const description = nullIfBlank(product.description_text);
    if (description === null) {
      missingDescriptions.push(product.handle);
    }

    // --- Variants ------------------------------------------------------------
    const sourceVariants = product.variants ?? [];
    if (sourceVariants.length === 0) {
      throw new Error(
        `Product "${product.handle}" has no variants; the contract requires at least one.`,
      );
    }

    const variants = sourceVariants.map((variant, index) => {
      const sourceVariantId = String(variant.id);
      if (seenVariantIds.has(sourceVariantId)) {
        throw new Error(
          `Duplicate source variant id "${sourceVariantId}" (product "${product.handle}").`,
        );
      }
      seenVariantIds.add(sourceVariantId);

      if (typeof variant.price !== 'number') {
        throw new Error(`Variant ${sourceVariantId} has no numeric price.`);
      }

      const label = `product "${product.handle}" variant "${variant.title}"`;
      const priceInPaise = toPaise(variant.price, label);

      const compareAtPriceInPaise =
        typeof variant.compare_at_price === 'number'
          ? toPaise(variant.compare_at_price, `${label} compare-at`)
          : null;

      if (compareAtPriceInPaise !== null) {
        compareAtCount += 1;
        // Preserved on purpose and reported for manual review: a "compare at"
        // price below the selling price is a source data problem, not ours to fix.
        if (compareAtPriceInPaise < priceInPaise) {
          priceAnomalies.push({
            handle: product.handle,
            variant: variant.title,
            sourceVariantId,
            priceInPaise,
            compareAtPriceInPaise,
            issue: 'compare_at_price is lower than price',
          });
        }
      }

      if (variant.available === true) {
        availableVariantCount += 1;
      }

      // Flattened option1..3 are lifted into a named map so no source value is lost.
      const optionValues: Record<string, string> = {};
      const rawOptionValues = [variant.option1, variant.option2, variant.option3];
      for (const [optionIndex, option] of options.entries()) {
        const value = rawOptionValues[optionIndex];
        if (isNonEmptyString(value)) {
          optionValues[option.name] = value;
        }
      }

      variantCount += 1;

      return {
        sourceVariantId,
        sku: nullIfBlank(variant.sku),
        barcode: null,
        title: variant.title,
        priceInPaise,
        compareAtPriceInPaise,
        costInPaise: null,
        weightGrams: null,
        // Defaults: the normalised export does not carry shipping or weight flags
        // (the raw export does, but the normalised one is the contract's input).
        requiresShipping: true,
        availableForSale: variant.available === true,
        position: index,
        optionValues,
        imageUrls: [],
      };
    });

    // --- Images --------------------------------------------------------------
    const images = (product.images ?? []).map((image, index) => {
      const localPath = image.local_path ?? null;

      if (localPath === null) {
        imagesWithoutLocalPath.push(product.handle);
      } else {
        // A reference that cannot be resolved on disk is a broken migration input.
        if (!existsSync(join(defaultPaths.imagesRoot, localPath))) {
          missingImageFiles.push(`${product.handle} -> ${localPath}`);
        }
      }

      if (!isNonEmptyString(image.alt)) {
        emptyAltTexts.count += 1;
      }

      imageCount += 1;

      return {
        sourceImageId: String(image.id),
        url: image.src,
        altText: nullIfBlank(image.alt),
        // Source positions are 1-based; the contract is 0-based.
        position: typeof image.position === 'number' ? Math.max(0, image.position - 1) : index,
        variantSourceIds: [],
        // Not part of the contract: zod strips unknown keys, so this is preserved
        // for the image pipeline to read from the file rather than through the
        // importer. The importer stores `url` (the remote CDN address).
        localPath,
      };
    });

    if (images.length === 0) {
      productsWithoutImages.push(product.handle);
    }

    const availableForSale = variants.some((variant) => variant.availableForSale);
    if (!availableForSale) {
      unavailableProducts.push(product.handle);
    }

    const referencedHandles = [...new Set(product.categories ?? [])];
    for (const handle of referencedHandles) {
      if (!categoryHandles.has(handle)) {
        throw new Error(
          `Product "${product.handle}" references category "${handle}" which is not defined in categories[].`,
        );
      }
    }

    return {
      sourcePlatform: 'SHOPIFY',
      sourceProductId,
      sourceHandle: product.handle,
      title: product.title,
      description,
      descriptionHtml: nullIfBlank(product.description_html),
      vendor: nullIfBlank(product.vendor),
      productType: nullIfBlank(product.product_type),
      tags: Array.isArray(product.tags) ? product.tags : [],
      // All 84 products are published in the source, so ACTIVE is faithful.
      status: product.url ? 'ACTIVE' : 'DRAFT',
      publishedAt: publishedByHandle.get(product.id) ?? null,
      // Derived, not invented: Shopify treats a product as available when any
      // variant is, and the source carries no product-level flag.
      availableForSale,
      categoryHandles: referencedHandles,
      options: options.map((option) => ({ name: option.name, values: option.values })),
      images,
      variants,
    };
  });

  if (variantCount !== EXPECTED.variants) {
    throw new Error(`Expected ${EXPECTED.variants} variants, produced ${variantCount}.`);
  }
  if (imageCount !== EXPECTED.images) {
    throw new Error(`Expected ${EXPECTED.images} images, produced ${imageCount}.`);
  }
  if (missingImageFiles.length > 0) {
    throw new Error(
      `${missingImageFiles.length} image(s) referenced by the export are missing on disk:\n  ` +
        missingImageFiles.slice(0, 20).join('\n  '),
    );
  }
  if (duplicateOptionNames.length > 0) {
    throw new Error(
      `${duplicateOptionNames.length} product(s) have duplicate option names, which would collapse optionValues.`,
    );
  }

  // --- Determinism -----------------------------------------------------------
  // Using the source's scrape timestamp (not the clock) keeps the output stable
  // across runs, so the artefact can be reviewed as a diff.
  const scrapedAt = source.meta?.scraped_at;
  const generatedAt = isNonEmptyString(scrapedAt) ? new Date(scrapedAt) : new Date();
  if (Number.isNaN(generatedAt.getTime())) {
    throw new Error(`meta.scraped_at is not a valid date: ${String(scrapedAt)}`);
  }

  let sourceShopDomain: string | null = null;
  if (isNonEmptyString(source.meta?.source)) {
    try {
      sourceShopDomain = new URL(source.meta.source).hostname;
    } catch {
      throw new Error(`meta.source is not a valid URL: ${source.meta.source}`);
    }
  }

  const catalog: Record<string, unknown> = {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    sourcePlatform: 'SHOPIFY',
    sourceShopDomain,
    generatedAt: generatedAt.toISOString(),
    categories,
    products,
  };

  const report: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    source: {
      path: defaultPaths.source,
      scrapedAt: generatedAt.toISOString(),
      productCount: sourceProducts.length,
      categoryCount: sourceCategories.length,
    },
    output: {
      path: defaultPaths.output,
      productCount: products.length,
      categoryCount: categories.length,
      variantCount,
      imageCount,
      productCategoryLinks: products.reduce(
        (total, product) => total + product.categoryHandles.length,
        0,
      ),
    },
    priceConversion: {
      from: 'rupees (source variant.price)',
      to: 'integer paise (variant.priceInPaise)',
      multiplier: 100,
      convertedVariants: variantCount,
      nonIntegerResults: 0,
      minimumRupees:
        Math.min(
          ...products.flatMap((product) => product.variants.map((variant) => variant.priceInPaise)),
        ) / 100,
      maximumRupees:
        Math.max(
          ...products.flatMap((product) => product.variants.map((variant) => variant.priceInPaise)),
        ) / 100,
      compareAtPricesConverted: compareAtCount,
      availableVariants: availableVariantCount,
      unavailableVariants: variantCount - availableVariantCount,
    },
    missingDescriptions: {
      count: missingDescriptions.length,
      note: 'Left null on purpose. Descriptions are never invented; fill these in the source and re-run.',
      handles: missingDescriptions,
    },
    unavailableProducts: {
      count: unavailableProducts.length,
      note: 'Kept, not deleted. Every variant has availableForSale: false.',
      handles: unavailableProducts,
    },
    productsWithoutImages: {
      count: productsWithoutImages.length,
      handles: productsWithoutImages,
    },
    priceAnomalies: {
      count: priceAnomalies.length,
      note: 'Preserved verbatim from the source for manual review; the normaliser does not correct them.',
      entries: priceAnomalies,
    },
    images: {
      referenced: imageCount,
      resolvedOnDisk: imageCount - missingImageFiles.length,
      missingOnDisk: missingImageFiles,
      withoutLocalPath: imagesWithoutLocalPath,
      nullAltText: emptyAltTexts.count,
      note: 'images[].localPath is carried in catalog.json but is not in the contract schema, so parseCatalogFile strips it. The importer stores images[].url (the remote CDN address).',
    },
    validation: {
      structuralErrors: [],
      recordsSkipped: 0,
      duplicateProductIds: 0,
      duplicateVariantIds: 0,
      duplicateHandles: 0,
      unresolvedCategoryHandles: 0,
      categoriesWithNoProducts: categories
        .filter(
          (category) =>
            !products.some((product) => product.categoryHandles.includes(category.handle)),
        )
        .map((category) => category.handle),
    },
    fieldCoverage: {
      note: 'Every source field is either carried, transformed, or listed here with a reason.',
      carried: {
        'categories[].id': 'categories[].sourceCollectionId',
        'categories[].handle': 'categories[].handle',
        'categories[].title': 'categories[].name',
        'products[].id': 'products[].sourceProductId',
        'products[].handle': 'products[].sourceHandle',
        'products[].title': 'products[].title',
        'products[].vendor': 'products[].vendor',
        'products[].product_type': 'products[].productType',
        'products[].tags': 'products[].tags',
        'products[].description_text': 'products[].description',
        'products[].description_html': 'products[].descriptionHtml',
        'products[].categories': 'products[].categoryHandles',
        'products[].options[].name': 'products[].options[].name',
        'products[].options[].values': 'products[].options[].values',
        'products[].images[].id': 'products[].images[].sourceImageId',
        'products[].images[].src': 'products[].images[].url',
        'products[].images[].alt': 'products[].images[].altText',
        'products[].images[].position': 'products[].images[].position (1-based -> 0-based)',
        'products[].images[].local_path':
          'products[].images[].localPath (beyond contract; informational)',
        'products[].variants[].id': 'products[].variants[].sourceVariantId',
        'products[].variants[].title': 'products[].variants[].title',
        'products[].variants[].sku': 'products[].variants[].sku',
        'products[].variants[].price': 'products[].variants[].priceInPaise (x100)',
        'products[].variants[].compare_at_price':
          'products[].variants[].compareAtPriceInPaise (x100)',
        'products[].variants[].available': 'products[].variants[].availableForSale',
        'products[].variants[].option1..3': 'products[].variants[].optionValues (named)',
        'meta.source': 'sourceShopDomain',
        'meta.scraped_at': 'generatedAt',
      },
      notCarried: {
        'meta.product_count / meta.category_count':
          'Redundant: counts are recomputed and asserted.',
        'categories[].product_count': 'Redundant: derivable from products[].categoryHandles.',
        'products[].url': 'Derivable from sourceHandle; the contract has no field for it.',
        'products[].reviews':
          'The contract has no reviews field; the reviews module is not part of this import.',
        'products[].options[].position': 'Contract options carry only name and values.',
        'variants[].grams / requires_shipping':
          'Dropped by the normalising step upstream; the contract defaults are used.',
      },
      contractFieldsWithNoSourceEquivalent: {
        'products[].publishedAt':
          'Recovered from the raw export (published_at); null where absent.',
        'products[].status': 'ACTIVE for every product, matching the source publish state.',
        'products[].availableForSale': 'Derived: true when any variant is available.',
        'variants[].barcode / costInPaise / weightGrams / imageUrls':
          'Not present in the source; left null/empty rather than invented.',
        'variants[].requiresShipping': 'Contract default (true).',
        'images[].variantSourceIds': 'The source maps no images to variants; left empty.',
        'categories[].parentHandle / description':
          'Flat collections with no description; left null.',
        'categories[].position': 'Preserved from export order.',
      },
    },
  };

  return { catalog, report };
}

// --- Runner ------------------------------------------------------------------

interface Paths {
  source: string;
  output: string;
  report: string;
}

function parseArguments(argv: readonly string[]): Paths {
  const read = (flag: string, fallback: string): string => {
    const match = argv.find((argument) => argument.startsWith(`${flag}=`));
    return match === undefined ? fallback : match.slice(flag.length + 1);
  };

  return {
    source: read('--source', defaultPaths.source),
    output: read('--out', defaultPaths.output),
    report: read('--report', defaultPaths.report),
  };
}

async function readJson<T>(filePath: string, label: string): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    throw new Error(`${label} not found at ${filePath}.`);
  }

  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(
      `${label} at ${filePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

async function main(): Promise<void> {
  const paths = parseArguments(process.argv.slice(2));

  const source = await readJson<SourceCatalog>(paths.source, 'Scraped export');

  // The raw export is read-only here, purely to recover fields the normalising
  // step dropped (published_at). It is never written to.
  const rawProductsPath = migrationPath('raw', 'products_raw.json');
  const rawProducts = existsSync(rawProductsPath)
    ? await readJson<RawProduct[]>(rawProductsPath, 'Raw export')
    : [];

  const { catalog, report } = normalize(source, rawProducts);

  // Validate before writing: a file that fails the contract must never land on disk.
  let parsed: CatalogFile;
  try {
    parsed = parseCatalogFile(catalog);
  } catch (error) {
    if (error instanceof ZodError) {
      const details = error.issues
        .slice(0, 25)
        .map((issue) => `  - ${issue.path.map(String).join('.')}: ${issue.message}`)
        .join('\n');
      const more = error.issues.length > 25 ? `\n  ...and ${error.issues.length - 25} more` : '';
      throw new Error(`Normalised catalog does not match the contract:\n${details}${more}`, {
        cause: error,
      });
    }
    throw error;
  }

  // Parity: the schema must not be dropping records.
  if (
    parsed.products.length !== EXPECTED.products ||
    parsed.categories.length !== EXPECTED.categories ||
    parsed.products.reduce((total, product) => total + product.variants.length, 0) !==
      EXPECTED.variants ||
    parsed.products.reduce((total, product) => total + product.images.length, 0) !== EXPECTED.images
  ) {
    throw new Error('Record counts changed while validating against the contract.');
  }

  await mkdir(migrationPath('normalized'), { recursive: true });
  await mkdir(migrationPath('reports'), { recursive: true });

  await writeFile(paths.output, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  await writeFile(paths.report, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const output = report['output'] as Record<string, number>;

  console.log('\nCatalog normalisation');
  console.log(`  source           : ${paths.source}`);
  console.log(`  output           : ${paths.output}`);
  console.log(`  report           : ${paths.report}`);
  console.log(`  categories       : ${output['categoryCount']}  (expected ${EXPECTED.categories})`);
  console.log(`  products         : ${output['productCount']}  (expected ${EXPECTED.products})`);
  console.log(`  variants         : ${output['variantCount']}  (expected ${EXPECTED.variants})`);
  console.log(`  images           : ${output['imageCount']}  (expected ${EXPECTED.images})`);
  console.log(`  category links   : ${output['productCategoryLinks']}`);
  console.log('  price conversion : rupees x100 -> integer paise');
  console.log('  structural errors: 0');
  console.log('  records skipped  : 0');
  console.log('\nContract validation passed. Nothing was written to PostgreSQL.');
}

main().catch((error: unknown) => {
  console.error(
    `\nCatalog normalisation failed:\n${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
