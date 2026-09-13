# normalized/

Produced from `../raw/`. This is the only input the importer accepts.

`catalog.json` must satisfy the contract in
`packages/validation/src/catalog.ts`, which `pnpm --filter @sakya/api
catalog:import` enforces before it touches the database. See `../README.md` for
the full field-by-field description.

The normaliser is responsible for:

- mapping scraped fields onto the contract (never inventing values);
- converting every price to **integer paise**;
- keeping each record's original source ids and handle;
- de-duplicating by source id and by handle;
- resolving category handles so that every `categoryHandles` entry exists in
  `categories[]`.

**Status: not generated yet.** No product data has been imported into any
database, and nothing here should be hand-written.
