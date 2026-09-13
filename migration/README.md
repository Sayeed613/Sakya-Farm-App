# Catalog migration

Everything scraped from Sakya Farms lives here, **outside** the application. This
folder is the boundary between "data we captured" and "data the platform serves".

```
migration/
├── raw/          scraped source data — READ ONLY, never modified by any script
├── normalized/   catalog.json, validated against the shared contract
├── images/       scraped product images (large binaries, not committed)
└── reports/      generated import reports (one JSON file per applied import)
```

## The rule that matters

**Nothing imports the catalog implicitly.** There is no seed that quietly loads
products, no fixture data, and no hard-coded product list in `schema.prisma`. The
only path from scraped data into PostgreSQL is:

```bash
pnpm --filter @sakya/api catalog:import          # dry run — writes nothing
pnpm --filter @sakya/api catalog:import:apply    # writes, in one transaction
```

The importer refuses to run if the export does not match the contract, if two
products share a source id or handle, if two variants share a SKU, or if a product
references a category the export does not define. A failure leaves the database
untouched.

## Files

| Path                            | Written by     | Notes                                                                |
| ------------------------------- | -------------- | -------------------------------------------------------------------- |
| `raw/**`                        | the scraper    | Treated as immutable. Never edited, normalised in place, or deleted. |
| `normalized/catalog.json`       | the normaliser | The single input to the importer.                                    |
| `images/**`                     | the scraper    | Referenced by URL from `catalog.json`.                               |
| `reports/catalog-import-*.json` | the importer   | Created on every `--apply` run.                                      |

### `normalized/catalog.json`

Its schema is defined in `packages/validation/src/catalog.ts` and enforced before
anything touches the database. In short:

```jsonc
{
  "schemaVersion": 1, // must match CATALOG_SCHEMA_VERSION exactly
  "sourcePlatform": "SHOPIFY",
  "sourceShopDomain": "sakya-farms.myshopify.com",
  "generatedAt": "2026-01-01T00:00:00.000Z",

  "categories": [{ "handle": "rice", "name": "Rice", "parentHandle": null, "position": 0 }],

  "products": [
    {
      "sourceProductId": "1234567890", // Shopify product id — source metadata ONLY
      "sourceHandle": "sona-masoori-rice",
      "title": "Sona Masoori Rice",
      "status": "ACTIVE",
      "availableForSale": true, // availability, NOT stock quantity
      "tags": [],
      "categoryHandles": ["rice"],
      "images": [{ "sourceImageId": "1", "url": "https://cdn.example.com/rice.jpg", "position": 0 }],
      "variants": [
        {
          "sourceVariantId": "9876543210", // source metadata ONLY
          "sku": "SF-RICE-SM-1KG",
          "title": "1 kg",
          "priceInPaise": 12000, // integer paise — never a float
          "compareAtPriceInPaise": 14000,
          "availableForSale": true,
          "position": 0,
          "imageUrls": [],
        },
      ],
    },
  ],
}
```

Points that are easy to get wrong:

- **`priceInPaise` is an integer.** `12000` means ₹120.00. A float is rejected.
- **Source ids are metadata, not keys.** The database generates its own UUIDs and
  keeps `source_product_id` / `source_handle` / `source_variant_id` alongside them.
  Re-importing matches on those columns, so ids stay stable across runs.
- **`availableForSale` is not stock.** It records whether the source store would
  sell the item. Inventory is a separate, per-store quantity tracked as a ledger
  and is never inferred from this flag.
- **Variants are ordered.** The importer uses the array index as the variant's
  position, which is what makes re-importing idempotent.
- **The export never deletes.** A product missing from a later export is left
  alone rather than archived, so a bad export cannot empty the catalog.

## Status

`normalized/catalog.json` has not been generated yet. Until it exists the importer
exits with an error explaining exactly that, which is the intended behaviour: no
scraped product data has been loaded into any database.

Images are not committed (see `.gitignore`); only the URL is stored in the catalog.
