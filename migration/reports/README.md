# reports/

One JSON report per applied catalog import
(`catalog-import-<timestamp>.json`), recording what was created and updated.

Reports are generated artefacts and are not committed (see `.gitignore`). Each
report captures:

- the export's path, `schemaVersion` and `generatedAt`;
- counts of categories, products, variants, images and category links;
- whether the run was a dry run or an applied import.

A failed import writes no report: the run is rolled back as a single transaction,
so a report always corresponds to changes that are actually in the database.
