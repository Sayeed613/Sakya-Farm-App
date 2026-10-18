import { QueryClient } from '@tanstack/react-query';
import { onlineManager } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * The gateway reaches the HTTP client, which pulls native modules (NetInfo,
 * secure store) that do not load in Node. Every gateway call in this suite is
 * spied before use — the HTTP layer itself is covered by `client.spec.ts`.
 */
vi.mock('./client', () => ({
  requireApiClient: () => {
    throw new Error('catalog gateway must be spied in this suite');
  },
}));

import { catalogApi } from './catalog';
import {
  CATEGORY_LISTING_STALE_TIME_MS,
  categoryProductsKey,
  categoryProductsQueryOptions,
  prefetchCategoryProducts,
  prefetchHomeCatalog,
} from './catalog-query-options';
import { productDetailKey } from './product-detail-query';

const page = <T>(items: T[]) => ({
  items,
  meta: { page: 1, perPage: 20, total: items.length, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
});

const listItem = (slug: string) => ({ id: `p-${slug}`, slug }) as never;

afterEach(() => {
  vi.restoreAllMocks();
  onlineManager.setOnline(true);
});

/**
 * Category listing prefetch + shared-key contract (Phase 2). Mirrors the
 * product-detail suite's methodology: a REAL QueryClient, catalogApi spied so
 * request counts are observed, and the "screen opening" simulated by mounting
 * an observer with the exact shared options the screen uses.
 */
describe('category listing prefetch (Phase 2)', () => {
  it('A. prefetch writes under the exact key the category screen observes', async () => {
    const spy = vi
      .spyOn(catalogApi, 'listCategoryProducts')
      .mockResolvedValue(page([listItem('mango')]));
    const queryClient = new QueryClient();

    await prefetchCategoryProducts(queryClient, 'leafy-greens');

    expect(categoryProductsKey('leafy-greens')).toEqual(['catalog', 'category', 'leafy-greens']);
    expect(categoryProductsQueryOptions('leafy-greens').queryKey).toEqual([
      'catalog',
      'category',
      'leafy-greens',
    ]);
    expect(queryClient.getQueryData(categoryProductsKey('leafy-greens'))).toEqual(
      page([listItem('mango')]),
    );

    // The screen's fetchQuery (via its own observer) reads the prefetched
    // entry without a second request.
    const data = await queryClient.fetchQuery(categoryProductsQueryOptions('leafy-greens'));
    expect(data).toEqual(page([listItem('mango')]));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('B. tap + immediate screen mount coalesce into one in-flight request', async () => {
    let release!: (value: ReturnType<typeof page<never>>) => void;
    const spy = vi
      .spyOn(catalogApi, 'listCategoryProducts')
      .mockImplementation(
        () => new Promise((resolve) => { release = resolve; }),
      );
    const queryClient = new QueryClient();

    // The tap starts the prefetch but it stays in flight…
    const prefetched = prefetchCategoryProducts(queryClient, 'leafy-greens');
    // …and the screen mounts before it resolves.
    const opened = queryClient.fetchQuery(categoryProductsQueryOptions('leafy-greens'));

    release(page([listItem('mango')]));
    const [screenData] = await Promise.all([opened, prefetched]);
    expect(screenData).toEqual(page([listItem('mango')]));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('C. offline tap schedules no request at all', async () => {
    const spy = vi.spyOn(catalogApi, 'listCategoryProducts').mockResolvedValue(page([]));
    const queryClient = new QueryClient();

    onlineManager.setOnline(false);
    try {
      await prefetchCategoryProducts(queryClient, 'leafy-greens');
      expect(spy).not.toHaveBeenCalled();
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    } finally {
      onlineManager.setOnline(true);
    }

    // Back online, the same helper warms normally.
    await prefetchCategoryProducts(queryClient, 'leafy-greens');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('D. a failed prefetch throws nothing and does not block the screen query', async () => {
    const spy = vi
      .spyOn(catalogApi, 'listCategoryProducts')
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue(page([listItem('mango')]));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    // Fire-and-forget contract: resolves even though the fetch failed…
    await prefetchCategoryProducts(queryClient, 'leafy-greens');
    expect(queryClient.getQueryState(categoryProductsKey('leafy-greens'))?.status).toBe('error');

    // …and the screen's own query still runs.
    const data = await queryClient.fetchQuery(categoryProductsQueryOptions('leafy-greens'));
    expect(data.items).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('E. prefetch touches category listings only — never cart, never detail keys', async () => {
    const spy = vi.spyOn(catalogApi, 'listCategoryProducts').mockResolvedValue(page([]));
    const queryClient = new QueryClient();

    await prefetchCategoryProducts(queryClient, 'leafy-greens');

    expect(spy).toHaveBeenCalledWith('leafy-greens');
    const keys = queryClient.getQueryCache().getAll().map((query) => query.queryKey);
    expect(keys).toHaveLength(1);
    expect(keys[0]?.[0]).toBe('catalog');
    expect(keys[0]?.[1]).toBe('category');
    expect(queryClient.getQueryData(['cart'])).toBeUndefined();
    expect(queryClient.getQueryData(productDetailKey('mango'))).toBeUndefined();
  });

  it('F. an empty slug is a no-op instead of a bogus request', async () => {
    const spy = vi.spyOn(catalogApi, 'listCategoryProducts').mockResolvedValue(page([]));
    const queryClient = new QueryClient();

    await prefetchCategoryProducts(queryClient, '');
    expect(spy).not.toHaveBeenCalled();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('G. category listing staleness is the shared finite 60s value', () => {
    expect(categoryProductsQueryOptions('leafy-greens').staleTime).toBe(
      CATEGORY_LISTING_STALE_TIME_MS,
    );
    expect(CATEGORY_LISTING_STALE_TIME_MS).toBe(60_000);
    expect(Number.isFinite(CATEGORY_LISTING_STALE_TIME_MS)).toBe(true);
  });

  it('H. boot warm-up writes the two Home keys the screens observe, and nothing else', async () => {
    const productsSpy = vi
      .spyOn(catalogApi, 'listProducts')
      .mockResolvedValue(page([listItem('mango')]));
    const categoriesSpy = vi
      .spyOn(catalogApi, 'listCategories')
      .mockResolvedValue([{ slug: 'leafy-greens' }] as never);
    const queryClient = new QueryClient();

    await prefetchHomeCatalog(queryClient);

    expect(productsSpy).toHaveBeenCalledTimes(1);
    expect(productsSpy).toHaveBeenCalledWith({ limit: 100 });
    expect(categoriesSpy).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(['catalog', 'products', 'home-all'])).toEqual(
      page([listItem('mango')]),
    );
    expect(queryClient.getQueryData(['catalog', 'categories'])).toEqual([
      { slug: 'leafy-greens' },
    ]);
    // Exactly the two boot keys — no cart, no extras.
    const keys = queryClient.getQueryCache().getAll().map((query) => query.queryKey);
    expect(keys).toHaveLength(2);
    expect(keys.every((key) => key[0] === 'catalog')).toBe(true);
  });

  it('I. boot warm-up is skipped entirely when offline', async () => {
    const productsSpy = vi.spyOn(catalogApi, 'listProducts').mockResolvedValue(page([]));
    const categoriesSpy = vi.spyOn(catalogApi, 'listCategories').mockResolvedValue([] as never);
    const queryClient = new QueryClient();

    onlineManager.setOnline(false);
    try {
      await prefetchHomeCatalog(queryClient);
      expect(productsSpy).not.toHaveBeenCalled();
      expect(categoriesSpy).not.toHaveBeenCalled();
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    } finally {
      onlineManager.setOnline(true);
    }
  });
});
