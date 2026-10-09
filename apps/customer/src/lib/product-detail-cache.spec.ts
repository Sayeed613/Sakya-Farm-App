import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

/**
 * Step 9 (F) — product-detail fetch deduplication and caching.
 *
 * `useProductAdd.fetchDetail()` resolves a variant through
 * `queryClient.fetchQuery({ queryKey: ['catalog','product',slug], ... })`, the
 * same cache entry the quick view, the detail screen and the Notify-Me control
 * read. These tests exercise that exact call shape against a real
 * `QueryClient`, so the claim "the cards do not re-fetch the same product" is
 * verified against the library rather than asserted.
 */
const DETAIL_STALE_TIME_MS = 120_000;

const detail = (slug: string) => ({
  slug,
  title: 'Alphonso Mango',
  variants: [{ id: `variant-${slug}`, isAvailable: true, priceInPaise: 4200, title: '1 kg' }],
});

describe('product detail caching', () => {
  it('coalesces concurrent detail fetches for one product into a single request', async () => {
    const queryClient = new QueryClient();
    const getProduct = vi.fn(async (slug: string) => detail(slug));
    const options = (slug: string) => ({
      queryKey: ['catalog', 'product', slug] as const,
      queryFn: () => getProduct(slug),
      staleTime: DETAIL_STALE_TIME_MS,
    });

    // Two cards for the same product tapping at the same moment (and the
    // quick view doing the same) all share one in-flight request.
    const [first, second, third] = await Promise.all([
      queryClient.fetchQuery(options('mango')),
      queryClient.fetchQuery(options('mango')),
      queryClient.fetchQuery(options('mango')),
    ]);

    expect(getProduct).toHaveBeenCalledTimes(1);
    expect(first.slug).toBe('mango');
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it('reuses the cached detail within staleTime instead of fetching again', async () => {
    const queryClient = new QueryClient();
    const getProduct = vi.fn(async (slug: string) => detail(slug));
    const options = {
      queryKey: ['catalog', 'product', 'mango'] as const,
      queryFn: () => getProduct('mango'),
      staleTime: DETAIL_STALE_TIME_MS,
    };

    await queryClient.fetchQuery(options);
    await queryClient.fetchQuery(options);
    await queryClient.fetchQuery(options);

    expect(getProduct).toHaveBeenCalledTimes(1);
    expect(
      queryClient.getQueryData(['catalog', 'product', 'mango']),
    ).toEqual(detail('mango'));
  });

  it('keeps different products in separate cache entries', async () => {
    const queryClient = new QueryClient();
    const getProduct = vi.fn(async (slug: string) => detail(slug));

    await queryClient.fetchQuery({
      queryKey: ['catalog', 'product', 'mango'],
      queryFn: () => getProduct('mango'),
      staleTime: DETAIL_STALE_TIME_MS,
    });
    await queryClient.fetchQuery({
      queryKey: ['catalog', 'product', 'banana'],
      queryFn: () => getProduct('banana'),
      staleTime: DETAIL_STALE_TIME_MS,
    });

    expect(getProduct).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryData(['catalog', 'product', 'mango'])).toEqual(detail('mango'));
    expect(queryClient.getQueryData(['catalog', 'product', 'banana'])).toEqual(detail('banana'));
  });

  it('serves a cached detail to a later reader without touching the network', async () => {
    const queryClient = new QueryClient();
    const getProduct = vi.fn(async (slug: string) => detail(slug));

    // Populate from any consumer (the detail screen, quick view...).
    await queryClient.fetchQuery({
      queryKey: ['catalog', 'product', 'mango'],
      queryFn: () => getProduct('mango'),
      staleTime: DETAIL_STALE_TIME_MS,
    });

    // A card's readDetail() path — plain cache read, never a request.
    expect(queryClient.getQueryData(['catalog', 'product', 'mango'])).toEqual(detail('mango'));
    expect(getProduct).toHaveBeenCalledTimes(1);
  });
});
