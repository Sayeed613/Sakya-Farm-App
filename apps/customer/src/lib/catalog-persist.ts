import type { Query } from '@tanstack/react-query';

/**
 * Catalogue-only React Query persistence.
 *
 * WHAT IS PERSISTED: exactly the catalogue namespaces that every listing
 * surface already shares —
 *   ['catalog', 'products', 'home-all']   Home / Fresh / Fresh-today listing
 *   ['catalog', 'categories']             category tree
 *   ['catalog', 'category', slug]         one category listing
 *   ['catalog', 'product', slug]          product detail
 *
 * WHAT IS NEVER PERSISTED: everything else, deliberately and by whitelist
 * rather than by blacklist — cart, wishlist, addresses, invoices, reviews,
 * orders, session-scoped queries. Auth tokens never reach React Query at all
 * (the zustand auth-store owns them, in SecureStore / localStorage), so a
 * persisted catalogue blob carries no credentials by construction.
 *
 * WHY A WHITELIST: a blacklist rots the moment anyone adds a new query key —
 * the new key silently becomes persistable. Here a new key is excluded by
 * default and must be added deliberately, in one reviewed place.
 *
 * STALENESS CONTRACT: persisted entries restore with their original
 * `dataUpdatedAt`, so anything older than the query's own staleTime renders
 * instantly from disk AND refetches in the background — the "fast first paint,
 * fresh data behind it" behaviour the plan calls for. `maxAge` bounds how
 * long a disk entry can survive at all; 24h matches the storefront's own
 * daily rhythm (fresh produce listings change daily at most).
 *
 * SAFETY: hydration is handled by PersistQueryClientProvider, which pauses
 * queries until the restore completes (IsRestoringProvider) — no query can
 * fetch before the cached catalogue is in place, so there is no
 * render-empty-then-pop sequence. Restored entries that fail to parse are
 * dropped by the persister's own try/catch; a corrupt blob degrades to
 * "no cache", never to a crash.
 */

/**
 * How long a persisted catalogue entry may sit on disk. Restored entries
 * older than this are discarded instead of rendered.
 */
export const CATALOG_PERSIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * The storage key the catalogue blob is written under. Kept specific
 * ('catalog', not 'query-cache') so a future feature can never share the
 * namespace by accident, and versioned so a schema change can invalidate old
 * blobs by bumping the suffix.
 */
export const CATALOG_PERSIST_STORAGE_KEY = 'sakya.catalog.query-cache.v1';

/** First element of every persistable catalogue key. */
const PERSISTED_CATALOG_KEY_PREFIXES = ['catalog'] as const;

/**
 * True when this query's data may be written to (and restored from) disk.
 *
 * Only SUCCESSFUL queries are persisted: caching an error or a pending
 * skeleton would resurrect failure states on the next launch, which is worse
 * than no cache at all.
 */
export function shouldPersistCatalogQuery(query: Query): boolean {
  if (query.state.status !== 'success') return false;

  const [root] = query.queryKey;
  return (PERSISTED_CATALOG_KEY_PREFIXES as readonly unknown[]).includes(root);
}

/**
 * Pure predicate over a bare key — exported so tests (and future call sites
 * that hold only a key, not a Query) can answer "would this persist?"
 * without constructing a Query instance.
 */
export function isPersistableCatalogKey(queryKey: readonly unknown[]): boolean {
  const [root] = queryKey;
  return (PERSISTED_CATALOG_KEY_PREFIXES as readonly unknown[]).includes(root);
}
