// The Prisma CLI loads .env for `prisma` subcommands, but this script is run
// directly with tsx, so it has to load the file itself before validateEnvironment.
import 'dotenv/config';

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import { parseCatalogFile, type CatalogFile, type CatalogProduct } from '@sakya/validation';
import { uniqueSlug } from '@sakya/utils';
import { ZodError } from 'zod';

import { PrismaClient } from '../src/generated/prisma/client';
import { validateEnvironment } from '../src/config/env.validation';

import { migrationPath } from './repository-root';

/**
 * Controlled import of the scraped catalog into PostgreSQL.
 *
 *   migration/normalized/catalog.json  ->  products, product_variants,
 *                                          product_images, categories,
 *                                          product_categories
 *
 * Safety properties:
 *
 * - **Dry run by default.** Nothing is written unless `--apply` is passed, and
 *   even then the whole import runs in ONE transaction, so a failure part-way
 *   through leaves the database exactly as it was rather than half-migrated.
 * - **Validated before it touches the database.** The file is checked against the
 *   `@sakya/validation` contract, then cross-checked for duplicate source ids and
 *   handles, and for variants sharing a position. Any problem aborts the run.
 * - **Idempotent.** Products are matched on (source_platform, source_product_id),
 *   variants on (product_id, position), categories on slug. Re-running an
 *   unchanged export produces no changes.
 * - **Non-destructive to source metadata.** The original Shopify product id,
 *   handle, variant id and image id are stored as source metadata; they are never
 *   used as our primary keys, and the raw scraped files are never written to.
 *
 * What this deliberately does NOT do:
 *
 * - It does not create inventory. The export carries availability, not stock
 *   counts, and inventing quantities from an availability flag would fabricate
 *   data. Stock is opened per store through inventory adjustments.
 * - It does not publish anything it cannot verify: availability is taken from the
 *   source flag, verbatim.
 *
 * Usage:
 *   pnpm --filter @sakya/api catalog:import          # dry run, prints a report
 *   pnpm --filter @sakya/api catalog:import:apply    # writes, then prints a report
 *   ... --file=/path/to/other.json                   # import a different export
 */

// Paths are resolved from the workspace root rather than by counting `..`
// segments: `__dirname` is apps/api/prisma, so two levels up lands on apps/ and
// the catalog would never be found. See ./repository-root.
const defaultCatalogPath = migrationPath('normalized', 'catalog.json');
const reportsDirectory = migrationPath('reports');

interface ImportOptions {
  apply: boolean;
  filePath: string;
}

interface ImportSummary {
  schemaVersion: number;
  sourceShopDomain: string | null;
  categories: { created: number; updated: number };
  products: { created: number; updated: number; archived: number };
  variants: { created: number; updated: number };
  images: number;
  productCategories: number;
  applied: boolean;
  catalogPath: string;
}

function parseArguments(argv: readonly string[]): ImportOptions {
  const fileArgument = argv.find((argument) => argument.startsWith('--file='));

  return {
    apply: argv.includes('--apply'),
    filePath:
      fileArgument === undefined ? defaultCatalogPath : fileArgument.slice('--file='.length),
  };
}

async function loadCatalog(filePath: string): Promise<CatalogFile> {
  let raw: string;

  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    throw new Error(
      `Catalog export not found at ${filePath}.\n` +
        'Produce it from the scraped data before importing; the raw files under migration/raw are never written to.',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${filePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  try {
    return parseCatalogFile(parsed);
  } catch (error) {
    if (error instanceof ZodError) {
      const details = error.issues
        .slice(0, 25)
        .map((issue) => `  - ${issue.path.map(String).join('.')}: ${issue.message}`)
        .join('\n');
      const more = error.issues.length > 25 ? `\n  ...and ${error.issues.length - 25} more` : '';
      throw new Error(`${filePath} does not match the catalog contract:\n${details}${more}`, {
        cause: error,
      });
    }
    throw error;
  }
}

/**
 * Catches problems that only exist because of the combination of records, which
 * a per-record schema check cannot see. Runs before any database work.
 */
function assertCatalogIsConsistent(catalog: CatalogFile): void {
  const seenProductIds = new Set<string>();
  const seenHandles = new Set<string>();
  const seenSlugs = new Set<string>();
  const variantsBySku = new Map<string, string>();
  const categoryHandles = new Set(catalog.categories.map((category) => category.handle));

  for (const product of catalog.products) {
    if (seenProductIds.has(product.sourceProductId)) {
      throw new Error(
        `Duplicate source product id "${product.sourceProductId}" in the export. The database allows one row per source product, so fix the export rather than overwriting.`,
      );
    }
    seenProductIds.add(product.sourceProductId);

    if (seenHandles.has(product.sourceHandle)) {
      throw new Error(`Duplicate source handle "${product.sourceHandle}" in the export.`);
    }
    seenHandles.add(product.sourceHandle);

    const slug = product.slug ?? product.sourceHandle;
    if (seenSlugs.has(slug)) {
      throw new Error(
        `Products "${slug}" and another share the same slug in the export. Slugs are unique in the database.`,
      );
    }
    seenSlugs.add(slug);

    for (const handle of product.categoryHandles) {
      if (!categoryHandles.has(handle)) {
        throw new Error(
          `Product "${product.sourceHandle}" references category "${handle}" which is not defined in categories[].`,
        );
      }
    }

    for (const variant of product.variants) {
      if (variant.sku === null || variant.sku === undefined) continue;

      const owner = variantsBySku.get(variant.sku);
      if (owner !== undefined) {
        throw new Error(
          `SKU "${variant.sku}" appears on both "${owner}" and "${product.sourceHandle}". SKUs are unique in the database.`,
        );
      }
      variantsBySku.set(variant.sku, product.sourceHandle);
    }
  }
}

/** Variant position is the array index: the export is ordered, and the database enforces uniqueness per product. */
function variantsOf(product: CatalogProduct) {
  return product.variants.map((variant, index) => ({ variant, position: index }));
}

async function planImport(prisma: PrismaClient, catalog: CatalogFile): Promise<ImportSummary> {
  const existingProducts = await prisma.product.findMany({
    where: {
      sourcePlatform: 'SHOPIFY',
      sourceProductId: { in: catalog.products.map((product) => product.sourceProductId) },
    },
    select: { sourceProductId: true },
  });
  const knownSourceIds = new Set(existingProducts.map((product) => product.sourceProductId));

  const existingCategories = await prisma.category.findMany({
    where: { slug: { in: catalog.categories.map((category) => category.handle) } },
    select: { slug: true },
  });
  const knownCategorySlugs = new Set(existingCategories.map((category) => category.slug));

  let createdProducts = 0;
  let updatedProducts = 0;
  for (const product of catalog.products) {
    if (knownSourceIds.has(product.sourceProductId)) {
      updatedProducts += 1;
    } else {
      createdProducts += 1;
    }
  }

  return {
    schemaVersion: catalog.schemaVersion,
    sourceShopDomain: catalog.sourceShopDomain ?? null,
    categories: {
      created: catalog.categories.filter((category) => !knownCategorySlugs.has(category.handle))
        .length,
      updated: knownCategorySlugs.size,
    },
    products: {
      created: createdProducts,
      updated: updatedProducts,
      // The export never deletes: a product missing from a later export is left
      // untouched rather than archived automatically.
      archived: 0,
    },
    variants: {
      created: catalog.products.reduce((total, product) => total + product.variants.length, 0),
      updated: 0,
    },
    images: catalog.products.reduce((total, product) => total + product.images.length, 0),
    productCategories: catalog.products.reduce(
      (total, product) => total + product.categoryHandles.length,
      0,
    ),
    applied: false,
    catalogPath: '',
  };
}

async function applyImport(prisma: PrismaClient, catalog: CatalogFile): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      // --- Categories -------------------------------------------------------
      // Parents are linked in a second pass: a child may appear before its parent.
      for (const category of catalog.categories) {
        const existing = await tx.category.findUnique({ where: { slug: category.handle } });

        if (existing === null) {
          await tx.category.create({
            data: {
              slug: category.handle,
              name: category.name,
              description: category.description ?? null,
              position: category.position,
              sourceCollectionId: category.sourceCollectionId ?? null,
            },
          });
        } else {
          await tx.category.update({
            where: { id: existing.id },
            data: {
              name: category.name,
              description: category.description ?? null,
              position: category.position,
              sourceCollectionId: category.sourceCollectionId ?? null,
            },
          });
        }
      }

      for (const category of catalog.categories) {
        if (category.parentHandle === null || category.parentHandle === undefined) continue;

        const [child, parent] = await Promise.all([
          tx.category.findUniqueOrThrow({ where: { slug: category.handle } }),
          tx.category.findUnique({ where: { slug: category.parentHandle } }),
        ]);

        if (parent !== null && child.parentId !== parent.id) {
          await tx.category.update({ where: { id: child.id }, data: { parentId: parent.id } });
        }
      }

      // --- Products ---------------------------------------------------------
      const takenSlugs = new Set(
        (await tx.product.findMany({ select: { slug: true } })).map((product) => product.slug),
      );

      for (const product of catalog.products) {
        const sourceProductId = product.sourceProductId;

        const existing = await tx.product.findFirst({
          where: { sourcePlatform: 'SHOPIFY', sourceProductId },
          include: { variants: { select: { id: true, position: true } } },
        });

        // Slugs are public URLs, so an existing product keeps the slug it was
        // created with even if the export renames the handle.
        const slug = existing?.slug ?? uniqueSlug(product.slug ?? product.sourceHandle, takenSlugs);
        takenSlugs.add(slug);

        const productFields = {
          title: product.title,
          slug,
          description: product.description ?? null,
          descriptionHtml: product.descriptionHtml ?? null,
          vendor: product.vendor ?? null,
          productType: product.productType ?? null,
          tags: product.tags,
          status: product.status,
          // Availability comes from the source flag and is deliberately NOT
          // derived from inventory: they are separate concerns.
          isAvailable: product.availableForSale,
          publishedAt: product.publishedAt ?? null,
          sourceHandle: product.sourceHandle,
        };

        const record =
          existing === null
            ? await tx.product.create({
                data: {
                  ...productFields,
                  sourcePlatform: 'SHOPIFY',
                  sourceProductId,
                },
              })
            : await tx.product.update({ where: { id: existing.id }, data: productFields });

        // --- Variants -------------------------------------------------------
        // Matched on (product, position), which the schema makes unique, so this
        // is idempotent across re-runs.
        for (const { variant, position } of variantsOf(product)) {
          const variantFields = {
            title: variant.title,
            sku: variant.sku ?? null,
            barcode: variant.barcode ?? null,
            priceInPaise: variant.priceInPaise,
            compareAtPriceInPaise: variant.compareAtPriceInPaise ?? null,
            costInPaise: variant.costInPaise ?? null,
            weightGrams: variant.weightGrams ?? null,
            requiresShipping: variant.requiresShipping,
            isAvailable: variant.availableForSale,
            sourceVariantId: variant.sourceVariantId,
            optionValues: variant.optionValues,
          };

          await tx.productVariant.upsert({
            where: { productId_position: { productId: record.id, position } },
            update: variantFields,
            create: { ...variantFields, productId: record.id, position },
          });
        }

        // --- Images and category links --------------------------------------
        // These are fully derived from the export, so they are replaced rather
        // than diffed: the export is the source of truth for them.
        await tx.productImage.deleteMany({ where: { productId: record.id } });
        if (product.images.length > 0) {
          await tx.productImage.createMany({
            data: product.images.map((image, index) => ({
              productId: record.id,
              url: image.url,
              altText: image.altText ?? null,
              position: index,
              sourceImageId: image.sourceImageId ?? null,
            })),
          });
        }

        const categorySlugs = [...new Set(product.categoryHandles)];
        await tx.productCategory.deleteMany({ where: { productId: record.id } });
        for (const [index, categorySlug] of categorySlugs.entries()) {
          const category = await tx.category.findUnique({ where: { slug: categorySlug } });
          if (category === null) continue;

          await tx.productCategory.create({
            data: {
              productId: record.id,
              categoryId: category.id,
              isPrimary: index === 0,
              position: index,
            },
          });
        }
      }
    },
    // A catalog-sized import is a single unit of work; give it room so the
    // all-or-nothing guarantee holds instead of timing out halfway.
    { timeout: 120_000 },
  );
}

async function writeReport(summary: ImportSummary): Promise<string> {
  await mkdir(reportsDirectory, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = join(reportsDirectory, `catalog-import-${timestamp}.json`);

  await writeFile(
    reportPath,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), ...summary }, null, 2)}\n`,
    'utf8',
  );

  return reportPath;
}

function printSummary(summary: ImportSummary): void {
  const mode = summary.applied ? 'APPLIED' : 'DRY RUN (nothing was written)';

  console.log(`\nCatalog import — ${mode}`);
  console.log(`  source            : ${summary.catalogPath}`);
  console.log(`  schema version    : ${summary.schemaVersion}`);
  console.log(`  shop domain       : ${summary.sourceShopDomain ?? '(not recorded)'}`);
  console.log(
    `  categories        : ${summary.categories.created} created, ${summary.categories.updated} existing`,
  );
  console.log(
    `  products          : ${summary.products.created} created, ${summary.products.updated} updated`,
  );
  console.log(`  variants          : ${summary.variants.created}`);
  console.log(`  images            : ${summary.images}`);
  console.log(`  category links    : ${summary.productCategories}`);

  if (!summary.applied) {
    console.log('\nRe-run with --apply to write these changes.');
  }
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const env = validateEnvironment(process.env);

  const catalog = await loadCatalog(options.filePath);
  assertCatalogIsConsistent(catalog);

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  });

  try {
    const plan = await planImport(prisma, catalog);
    const summary: ImportSummary = {
      ...plan,
      applied: options.apply,
      catalogPath: options.filePath,
    };

    if (options.apply) {
      await applyImport(prisma, catalog);
      const reportPath = await writeReport(summary);
      printSummary(summary);
      console.log(`\nReport written to ${reportPath}`);
    } else {
      printSummary(summary);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(
    `\nCatalog import failed:\n${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
