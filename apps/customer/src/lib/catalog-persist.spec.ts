import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import {
  CATALOG_PERSIST_MAX_AGE_MS,
  CATALOG_PERSIST_STORAGE_KEY,
  isPersistableCatalogKey,
  shouldPersistCatalogQuery,
} from './catalog-persist';

/**
 * The persistence whitelist is the security boundary between the catalogue
 * cache and everything session-scoped (cart, addresses, invoices). These tests
 * run against a REAL QueryClient so the predicate is exercised on genuine
 * cache entries — the same objects the dehydrator will hand it in production.
 */
function clientWith(queryKey: readonly unknown[], data: unknown) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(queryKey, data);
  return queryClient;
}

function queryOf(queryClient: QueryClient, queryKey: readonly unknown[]) {
  const query = queryClient.getQueryCache().find({ queryKey });
  if (!query) throw new Error(`no cache entry for ${JSON.stringify(queryKey)}`);
  return query;
}

describe('catalogue-only persistence filter', () => {
  it('persists every catalogue namespace the app renders', () => {
    const cases: Array<[readonly unknown[], unknown]> = [
      [['catalog', 'products', 'home-all'], { items: [] }],
      [['catalog', 'categories'], []],
      [['catalog', 'category', 'leafy-greens'], { items: [] }],
      [['catalog', 'product', 'mango'], { slug: 'mango' }],
    ];

    for (const [key, data] of cases) {
      const queryClient = clientWith(key, data);
      expect(shouldPersistCatalogQuery(queryOf(queryClient, key))).toBe(true);
    }
  });

  it('NEVER persists cart, checkout, payment, session or user data', () => {
    const forbidden: Array<readonly unknown[]> = [
      ['cart'],
      ['addresses'],
      ['wishlist'],
      ['invoice', 'ORD-1'],
      ['orders'],
      ['reviews', 'p1'],
      ['reviews', 'p1', 'eligibility'],
      ['session'],
      ['auth', 'tokens'],
      ['payment', 'pay_123'],
      ['checkout', 'summary'],
    ];

    for (const key of forbidden) {
      const queryClient = clientWith(key, { secret: 'user-data' });
      expect(shouldPersistCatalogQuery(queryOf(queryClient, key))).toBe(false);
    }
  });

  it('rejects unknown roots by default — a new key must be opted IN', () => {
    const queryClient = clientWith(['inventory', 'stock'], { v: 1 });
    expect(shouldPersistCatalogQuery(queryOf(queryClient, ['inventory', 'stock']))).toBe(false);
  });

  it('never persists a query that is not in success state', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    // Error state: a failed fetch must not be resurrected on next boot.
    // prefetchQuery swallows the rejection internally, so awaiting is safe.
    await queryClient.prefetchQuery({
      queryKey: ['catalog', 'product', 'mango'],
      queryFn: () => Promise.reject(new Error('network down')),
    });

    const query = queryOf(queryClient, ['catalog', 'product', 'mango']);
    expect(query.state.status).toBe('error');
    expect(shouldPersistCatalogQuery(query)).toBe(false);
  });

  it('isPersistableCatalogKey mirrors the Query-level predicate on keys', () => {
    expect(isPersistableCatalogKey(['catalog', 'products', 'home-all'])).toBe(true);
    expect(isPersistableCatalogKey(['catalog'])).toBe(true);
    expect(isPersistableCatalogKey(['cart'])).toBe(false);
    expect(isPersistableCatalogKey(['session'])).toBe(false);
    expect(isPersistableCatalogKey([])).toBe(false);
  });

  it('the persisted blob is bounded to a day and namespaced to this app', () => {
    expect(CATALOG_PERSIST_MAX_AGE_MS).toBe(24 * 60 * 60 * 1000);
    expect(Number.isFinite(CATALOG_PERSIST_MAX_AGE_MS)).toBe(true);
    expect(CATALOG_PERSIST_STORAGE_KEY).toContain('catalog');
  });
});
