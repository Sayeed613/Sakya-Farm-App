# raw/

Scraped source data, exactly as it was captured.

**This directory is read-only.** No script in this repository may modify, rewrite,
normalise or delete anything here:

- the normaliser must write to `../normalized/`, never back into `raw/`;
- a re-scrape appends a new snapshot rather than overwriting an old one;
- the importer never reads from this directory.

Keeping `raw/` pristine is what makes the pipeline auditable: whenever the served
catalog is questioned, the original capture can be re-read and the transformation
re-checked without wondering whether the input was edited along the way.
