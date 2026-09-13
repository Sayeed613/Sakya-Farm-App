# images/

Scraped product images.

Large binaries are intentionally **not committed** (see `.gitignore`); only this
directory and `.gitkeep` are tracked. Product image rows in PostgreSQL store the
URL, not the bytes, so the database never depends on this directory being present.

When a product image is later served from our own storage, the `url` in
`catalog.json` is what changes — `product_images` needs no schema change.
