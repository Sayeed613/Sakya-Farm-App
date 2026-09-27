import { describe, expect, it, vi } from 'vitest';

import { CatalogCacheService } from '../src/cache/catalog-cache.service';

/**
 * The cache is load-bearing for catalogue correctness: a bug here serves
 * stale prices or lets an admin write vanish behind a cached read. These
 * tests pin the four behaviours that make it safe: TTL expiry, single-flight
 * coalescing, the generation guard on invalidation, and the LRU bound.
 */

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('CatalogCacheService', () => {
  it('serves the stored value without re-running the loader inside the TTL', async () => {
    const cache = new CatalogCacheService(60);
    const loader = vi.fn().mockResolvedValue('value');

    expect(await cache.getOrLoad('k', loader)).toBe('value');
    expect(await cache.getOrLoad('k', loader)).toBe('value');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('re-runs the loader once the TTL has elapsed', async () => {
    vi.useFakeTimers();
    try {
      const cache = new CatalogCacheService(30);
      const loader = vi.fn().mockResolvedValueOnce('old').mockResolvedValueOnce('new');

      expect(await cache.getOrLoad('k', loader)).toBe('old');
      vi.advanceTimersByTime(30_001);
      expect(await cache.getOrLoad('k', loader)).toBe('new');
      expect(loader).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never caches when constructed with a TTL of 0', async () => {
    const cache = new CatalogCacheService(0);
    const loader = vi.fn().mockResolvedValue('value');

    await cache.getOrLoad('k', loader);
    await cache.getOrLoad('k', loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent misses into a single loader call (stampede protection)', async () => {
    const cache = new CatalogCacheService(60);
    const gate = deferred<string>();
    const loader = vi.fn(() => gate.promise);

    const first = cache.getOrLoad('k', loader);
    const second = cache.getOrLoad('k', loader);
    gate.resolve('value');

    expect(await first).toBe('value');
    expect(await second).toBe('value');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('propagates a loader failure to every waiter and stores nothing', async () => {
    const cache = new CatalogCacheService(60);
    const loader = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce('recovered');

    const a = cache.getOrLoad('k', loader);
    const b = cache.getOrLoad('k', loader);
    await expect(a).rejects.toThrow('db down');
    await expect(b).rejects.toThrow('db down');

    // The failure was not cached, so the next read tries again.
    expect(await cache.getOrLoad('k', loader)).toBe('recovered');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('drops stored values on invalidateAll', async () => {
    const cache = new CatalogCacheService(60);
    const loader = vi.fn().mockResolvedValueOnce('old').mockResolvedValueOnce('new');

    expect(await cache.getOrLoad('k', loader)).toBe('old');
    cache.invalidateAll('admin write');
    expect(await cache.getOrLoad('k', loader)).toBe('new');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('refuses to store a load that was in flight when invalidation happened', async () => {
    const cache = new CatalogCacheService(60);
    const gate = deferred<string>();
    const loader = vi.fn(() => gate.promise);

    // A read starts, then an admin write invalidates, then the read lands.
    const inFlight = cache.getOrLoad('k', loader);
    cache.invalidateAll('admin write');
    gate.resolve('pre-write data');

    // The caller who asked before the write still gets its answer...
    expect(await inFlight).toBe('pre-write data');
    // ...but it was not stored: the next read must hit the database again.
    const reload = vi.fn().mockResolvedValue('post-write data');
    expect(await cache.getOrLoad('k', reload)).toBe('post-write data');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('bounds memory by evicting the least recently used key at capacity', async () => {
    const cache = new CatalogCacheService(60, 2);
    const loaders: Record<string, () => Promise<string>> = {
      a: vi.fn(async () => 'a'),
      b: vi.fn(async () => 'b'),
      c: vi.fn(async () => 'c'),
    };

    await cache.getOrLoad('a', loaders.a!);
    await cache.getOrLoad('b', loaders.b!);
    // Touch 'a' so it becomes the most recently used and 'b' the oldest.
    await cache.getOrLoad('a', loaders.a!);
    await cache.getOrLoad('c', loaders.c!);

    // 'b' was evicted and 'a' survived. Read 'a' first: touching it before
    // 'b' reloads keeps 'a' newest, so 'b''s reload evicts 'c', not 'a'.
    await cache.getOrLoad('a', loaders.a!);
    await cache.getOrLoad('b', loaders.b!);

    // 'b' reloaded (evicted), 'a' never reloaded (it survived: a hit runs no
    // loader), and 'c' ran exactly once before being evicted by 'b''s reload.
    expect(loaders.b).toHaveBeenCalledTimes(2);
    expect(loaders.a).toHaveBeenCalledTimes(1);
    expect(loaders.c).toHaveBeenCalledTimes(1);  });
});
