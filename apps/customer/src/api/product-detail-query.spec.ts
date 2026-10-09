import { QueryClient, QueryObserver, onlineManager } from '@tanstack/react-query';
import type { ProductDetail } from '@sakya/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { catalogApi } from './catalog';
import {
  PRODUCT_DETAIL_STALE_TIME_MS,
  RELATED_PREFETCH_LIMIT,
  prefetchProductDetail,
  prefetchProductDetails,
  productDetailKey,
  productDetailQueryOptions,
} from './product-detail-query';

/**
 * Step 10 — product-detail prefetch safety and cache-key consistency.
 *
 * Every test runs against a REAL `QueryClient` (the library's own dedupe,
 * staleTime and observer semantics are exactly what the app relies on), with
 * `catalogApi.getProduct` spied so request counts are observed, not assumed.
 * The "detail screen opening" is simulated headlessly with a `QueryObserver`
 * carrying the same options the screen mounts — no React rendering needed.
 */
/*
 * The catalog gateway reaches the HTTP client, which pulls native modules
 * (NetInfo, secure store) that do not load in Node. Every gateway call in this
 * suite is spied before use, so the real client is swapped for a fail-loud
 * stub — the HTTP layer itself is covered by `client.spec.ts`.
 */
vi.mock('./client', () => ({
  requireApiClient: () => {
    throw new Error('catalog gateway must be spied in this suite');
  },
}));

const detail = (slug: string) =>
  ({ slug, title: `Title ${slug}` }) as unknown as ProductDetail;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Mount an observer the way the detail screen does, resolving once it has data.
 *
 * A headless observer only notifies on RESULT CHANGES, so the current result is
 * read explicitly after subscribing — a cache that is already warm resolves
 * immediately, a pending fetch resolves when it lands.
 */
function openDetail(queryClient: QueryClient, slug: string) {
  const observer = new QueryObserver(queryClient, productDetailQueryOptions(slug));
  let unsubscribe: (() => void) | null = null;
  const settled = new Promise<ProductDetail>((resolve, reject) => {
    const handle = () => {
      const result = observer.getCurrentResult();
      if (result.data !== undefined) {
        unsubscribe?.();
        resolve(result.data);
      } else if (result.error) {
        unsubscribe?.();
        reject(result.error);
      }
    };
    unsubscribe = observer.subscribe(handle);
    handle();
  });
  return { observer, settled };
}

afterEach(() => {
  vi.restoreAllMocks();
  onlineManager.setOnline(true);
});

describe('product detail prefetch (Step 10)', () => {
  it('A. prefetch writes under the exact key the detail screen observes', async () => {
    const spy = vi.spyOn(catalogApi, 'getProduct').mockResolvedValue(detail('mango'));
    const queryClient = new QueryClient();

    await prefetchProductDetail(queryClient, 'mango');

    // One namespace, defined once and shared by list-independent consumers.
    expect(productDetailKey('mango')).toEqual(['catalog', 'product', 'mango']);
    expect(productDetailQueryOptions('mango').queryKey).toEqual(['catalog', 'product', 'mango']);
    expect(queryClient.getQueryData(productDetailKey('mango'))).toEqual(detail('mango'));

    // The screen's observer reads the prefetched entry without a new request.
    const { observer, settled } = openDetail(queryClient, 'mango');
    expect(await settled).toEqual(detail('mango'));
    await delay(10);
    expect(observer.getCurrentResult().data).toEqual(detail('mango'));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('B. prefetch + immediate detail open coalesce into one in-flight request', async () => {
    let release!: (value: ProductDetail) => void;
    const spy = vi
      .spyOn(catalogApi, 'getProduct')
      .mockImplementation(
        () => new Promise<ProductDetail>((resolve) => { release = resolve; }),
      );
    const queryClient = new QueryClient();

    // Prefetch starts but stays in flight…
    const prefetched = prefetchProductDetail(queryClient, 'mango');
    // …and the detail screen opens before it resolves.
    const opened = openDetail(queryClient, 'mango');

    release(detail('mango'));
    const [data] = await Promise.all([opened.settled, prefetched]);

    expect(data).toEqual(detail('mango'));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('C. a cached detail triggers no network request within staleTime', async () => {
    const spy = vi.spyOn(catalogApi, 'getProduct').mockResolvedValue(detail('mango'));
    const queryClient = new QueryClient();

    await prefetchProductDetail(queryClient, 'mango');
    expect(spy).toHaveBeenCalledTimes(1);

    // Opening the screen (observer mount) serves from cache.
    const { observer, settled } = openDetail(queryClient, 'mango');
    expect(await settled).toEqual(detail('mango'));
    await delay(25);
    expect(observer.getCurrentResult().data).toEqual(detail('mango'));

    // The add-to-cart fetchQuery path also serves from cache.
    await queryClient.fetchQuery(productDetailQueryOptions('mango'));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('D. separate products remain separate cache entries', async () => {
    const spy = vi
      .spyOn(catalogApi, 'getProduct')
      .mockImplementation(async (slug: string) => detail(slug));
    const queryClient = new QueryClient();

    await prefetchProductDetail(queryClient, 'mango');
    await prefetchProductDetail(queryClient, 'banana');

    expect(spy).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryData(productDetailKey('mango'))).toEqual(detail('mango'));
    expect(queryClient.getQueryData(productDetailKey('banana'))).toEqual(detail('banana'));
  });

  it('E. a failed prefetch throws nothing and does not block the normal detail fetch', async () => {
    const spy = vi
      .spyOn(catalogApi, 'getProduct')
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue(detail('mango'));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    // Fire-and-forget contract: resolves even though the fetch failed…
    await prefetchProductDetail(queryClient, 'mango');
    expect(queryClient.getQueryState(productDetailKey('mango'))?.status).toBe('error');

    // …and navigation still lands on a working detail fetch.
    const data = await queryClient.fetchQuery(productDetailQueryOptions('mango'));
    expect(data.slug).toBe('mango');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('F. offline prefetch schedules no request at all', async () => {
    const spy = vi.spyOn(catalogApi, 'getProduct').mockResolvedValue(detail('mango'));
    const queryClient = new QueryClient();

    onlineManager.setOnline(false);
    try {
      await prefetchProductDetail(queryClient, 'mango');
      expect(spy).not.toHaveBeenCalled();
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    } finally {
      onlineManager.setOnline(true);
    }

    // Back online, the same helper warms normally.
    await prefetchProductDetail(queryClient, 'mango');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('G. prefetch reads product detail only — cart state is never touched', async () => {
    const spy = vi.spyOn(catalogApi, 'getProduct').mockResolvedValue(detail('mango'));
    const queryClient = new QueryClient();

    await prefetchProductDetail(queryClient, 'mango');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('mango');
    expect(queryClient.getQueryData(['cart'])).toBeUndefined();
    expect(
      queryClient.getQueryCache().getAll().some((query) => query.queryKey[0] === 'cart'),
    ).toBe(false);
    expect(
      queryClient.getQueryCache().getAll().every((query) => query.queryKey[0] === 'catalog'),
    ).toBe(true);
  });

  it('H. batch prefetch is capped and deduped — never a catalogue-wide warm', async () => {
    const spy = vi
      .spyOn(catalogApi, 'getProduct')
      .mockImplementation(async (slug: string) => detail(slug));
    const queryClient = new QueryClient();

    const slugs = Array.from({ length: 40 }, (_, index) => `p${index}`);
    await prefetchProductDetails(queryClient, slugs);

    expect(spy).toHaveBeenCalledTimes(RELATED_PREFETCH_LIMIT);
    const keys = queryClient.getQueryCache().getAll().map((query) => query.queryKey);
    expect(keys).toHaveLength(RELATED_PREFETCH_LIMIT);
    // Only detail keys — the 100-product listing is never prefetched.
    expect(keys.every((key) => key[0] === 'catalog' && key[1] === 'product')).toBe(true);
    expect(keys.some((key) => key[0] === 'catalog' && key[1] === 'products')).toBe(false);

    // Duplicate slugs collapse to one request.
    await prefetchProductDetails(queryClient, ['mango', 'mango', 'mango'], 5);
    expect(spy).toHaveBeenCalledTimes(RELATED_PREFETCH_LIMIT + 1);
  });

  it('I. prefetch leaves no query observer behind (no refocus refetch / render pressure)', async () => {
    vi.spyOn(catalogApi, 'getProduct').mockResolvedValue(detail('mango'));
    const queryClient = new QueryClient();

    await prefetchProductDetail(queryClient, 'mango');
    await prefetchProductDetails(queryClient, ['banana', 'papaya']);

    for (const slug of ['mango', 'banana', 'papaya']) {
      const [query] = queryClient.getQueryCache().findAll({ queryKey: productDetailKey(slug) });
      expect(query).toBeDefined();
      expect(query?.getObserversCount()).toBe(0);
    }
  });

  it('staleTime is the shared finite 120s value — never "cache forever"', () => {
    expect(productDetailQueryOptions('mango').staleTime).toBe(PRODUCT_DETAIL_STALE_TIME_MS);
    expect(PRODUCT_DETAIL_STALE_TIME_MS).toBe(120_000);
    expect(Number.isFinite(productDetailQueryOptions('mango').staleTime)).toBe(true);
  });

  it('an empty slug is a no-op instead of a bogus request', async () => {
    const spy = vi.spyOn(catalogApi, 'getProduct').mockResolvedValue(detail(''));
    const queryClient = new QueryClient();

    await prefetchProductDetail(queryClient, '');
    expect(spy).not.toHaveBeenCalled();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });
});
