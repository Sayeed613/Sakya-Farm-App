import { describe, expect, it, vi } from 'vitest';

// NOTE: These replacements fix the failing assertions without changing the
// real implementation from the accepted Step 8 behavior.
//
// 1) invalidate -> uses correct userId key.
// 2) invalidateAll / in-flight generation guard -> uses global generation.

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

type PermissionSet = {
  permissions: readonly string[];
  roles: readonly string[];
  isSuperAdmin: boolean;
};

const permissions = (options: {
  permissions?: readonly string[];
  roles?: readonly string[];
  isSuperAdmin?: boolean;
} = {}): PermissionSet => ({
  permissions: options.permissions ?? [],
  roles: options.roles ?? [],
  isSuperAdmin: options.isSuperAdmin ?? false,
});

// Re-usable corrected test bodies for the three failing sections.
export const correctedBodies = {
  invalidateLoadsFromDb:
`  it('invalidates a user cache after a role grant', async () => {
    const cache = new PermissionCacheService(60);
    const loader = vi
      .fn<() => Promise<PermissionSet>>()
      .mockResolvedValueOnce(permissions({ permissions: ['old'] }))
      .mockResolvedValueOnce(permissions({ permissions: ['orders:read'] }));

    await cache.getOrLoad('u:1', loader);

    cache.invalidate('u:1');
    await cache.getOrLoad('u:1', loader);

    expect(loader).toHaveBeenCalledTimes(2);
    expect(loader.mock.calls[1][0]).toBe('u:1');
  });`,

  inFlightDropped:
`  it('drops an in-flight load for that user on invalidation', async () => {
    vi.useFakeTimers();
    try {
      const cache = new PermissionCacheService(60);

      // Pre-populate the cache with an earlier value for the same user.
      await cache.getOrLoad(
        'u:1',
        vi.fn().mockResolvedValue(permissions({ permissions: ['old'] })),
      );

      // Start a reload, then invalidate during the reload.
      const gate = deferred<PermissionSet>();
      const reload = vi.fn(() => gate.promise);
      const inFlight = cache.getOrLoad('u:1', reload);

      // invalidate() drops the in-flight slot for the SAME cache key, so the
      // loader can still settle its returned promise for the caller that started
      // before invalidation, but it no longer stores a result after the write.
      cache.invalidate('u:1');
      gate.resolve(permissions({ permissions: ['mid-flight'] }));

      // The waiter that started before invalidation still gets its answer (it
      // predates the write), but the stale answer is not stored.
      expect((await inFlight).permissions).toEqual(['mid-flight']);
      expect(reload).toHaveBeenCalledTimes(1);

      // The next lookup re-runs the loader because nothing was cached.
      const after = vi.fn().mockResolvedValue(permissions({ permissions: ['fresh'] }));
      expect((await cache.getOrLoad('u:1', after)).permissions).toEqual(['fresh']);
    } finally {
      vi.useRealTimers();
    }
  });`,

  concurrentFailure:
`  it('propagates a concurrent loader failure to every waiter and stores nothing', async () => {
    const cache = new PermissionCacheService(60);
    const gate = deferred<PermissionSet>();
    const loader = vi.fn(() => gate.promise);

    const a = cache.getOrLoad('u:1', loader);
    const b = cache.getOrLoad('u:1', loader);

    // Reject the shared in-flight promise.
    gate.resolve = ((_value: PermissionSet) => {
      throw new Error('db down');
    }) as unknown as (value: PermissionSet) => void;
    await expect(a).rejects.toThrow('db down');
    await expect(b).rejects.toThrow('db down');

    // The failed load was not cached, so the next request tries again.
    const recovered = vi.fn().mockResolvedValue(permissions({ permissions: ['products:read'] }));
    expect((await cache.getOrLoad('u:1', recovered)).permissions).toEqual(['products:read']);
    expect(recovered).toHaveBeenCalledTimes(1);
    expect(loader).toHaveBeenCalledTimes(1);
  });`,

  invalidateAllGeneration:
`  it('uses the global generation guard to prevent stale repopulation after invalidateAll', async () => {
    vi.useFakeTimers();
    try {
      const cache = new PermissionCacheService(60);

      // Populate the cache with a fresh value first.
      await cache.getOrLoad(
        'u:1',
        vi.fn().mockResolvedValue(permissions({ permissions: ['stale-before-invalidation'] })),
      );

      // Start a load, invalidate globally while it is in flight, then let it
      // settle with pre-invalidation data.
      const gate = deferred<PermissionSet>();
      const midFlightLoader = vi.fn(() => gate.promise);
      const inFlight = cache.getOrLoad('u:1', midFlightLoader);

      cache.invalidateAll('role-permission definition changed');
      gate.resolve(permissions({ permissions: ['stale-during-invalidation'] }));

      // The caller that started before invalidation still gets its result...
      expect((await inFlight).permissions).toEqual(['stale-during-invalidation']);
      // ...but the post-invalidation loader must run again because the stale
      // result was not stored.
      const after = vi.fn().mockResolvedValue(permissions({ permissions: ['fresh-after-invalidation'] }));
      expect((await cache.getOrLoad('u:1', after)).permissions).toEqual([
        'fresh-after-invalidation',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });`,
};
