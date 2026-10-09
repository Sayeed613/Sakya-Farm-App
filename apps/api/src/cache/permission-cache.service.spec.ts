import { describe, expect, it, vi } from 'vitest';

import { PermissionCacheService } from './permission-cache.service';

/** Deterministic deferred used for concurrency tests. */
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

describe('PermissionCacheService', () => {
  // Helper that models the exact auth-relevant cache value shape the service
  // caches and the authorization path consumes.
  const permissions = (options: {
    permissions?: readonly string[];
    roles?: readonly string[];
    isSuperAdmin?: boolean;
  } = {}): PermissionSet => ({
    permissions: options.permissions ?? [],
    roles: options.roles ?? [],
    isSuperAdmin: options.isSuperAdmin ?? false,
  });

  it('loads from the database on a cache miss', async () => {
    const cache = new PermissionCacheService(60);
    const loader = vi.fn().mockResolvedValue(permissions());

    const result = await cache.getOrLoad('u:1', loader);

    expect(result).toEqual(permissions());
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('stores a successful load for reuse within the TTL', async () => {
    const cache = new PermissionCacheService(60);
    const loader = vi.fn().mockResolvedValue(permissions({ permissions: ['orders:read'] }));

    await cache.getOrLoad('u:1', loader);
    await cache.getOrLoad('u:1', loader);

    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('uses a cached permission set on a repeated lookup', async () => {
    const cache = new PermissionCacheService(60);
    const loader = vi.fn().mockResolvedValue(permissions({ permissions: ['products:read'] }));

    const first = await cache.getOrLoad('u:1', loader);
    const second = await cache.getOrLoad('u:1', loader);

    expect(first.permissions).toEqual(['products:read']);
    expect(second.permissions).toEqual(['products:read']);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('reloads from the database after TTL expires', async () => {
    vi.useFakeTimers();
    try {
      const cache = new PermissionCacheService(30);
      const loader = vi
        .fn<() => Promise<PermissionSet>>()
        .mockResolvedValueOnce(permissions({ permissions: ['old'] }))
        .mockResolvedValueOnce(permissions({ permissions: ['new'] }));

      expect((await cache.getOrLoad('u:1', loader)).permissions).toEqual(['old']);
      vi.advanceTimersByTime(30_001);

      expect((await cache.getOrLoad('u:1', loader)).permissions).toEqual(['new']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never caches when the TTL is 0', async () => {
    const cache = new PermissionCacheService(0);
    const loader = vi.fn().mockResolvedValue(permissions());

    await cache.getOrLoad('u:1', loader);
    await cache.getOrLoad('u:1', loader);

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('isolates cached permissions per user', async () => {
    const cache = new PermissionCacheService(60);

    const loaderA = vi.fn().mockResolvedValue(permissions({ permissions: ['orders:read'] }));
    const loaderB = vi.fn().mockResolvedValue(permissions({ permissions: ['products:read'] }));

    const userA = await cache.getOrLoad('u:1', loaderA);
    const userB = await cache.getOrLoad('u:2', loaderB);

    expect(userA.permissions).toEqual(['orders:read']);
    expect(userB.permissions).toEqual(['products:read']);

    // A second lookup for user A must still use its own cached value.
    const userA2 = await cache.getOrLoad('u:1', loaderA);

    expect(userA2.permissions).toEqual(['orders:read']);
    expect(userB.permissions).toEqual(['products:read']);
  });

  it('invalidates a user cache after a role grant', async () => {
    const cache = new PermissionCacheService(60);

    const firstLoader = vi.fn().mockResolvedValue(permissions({ permissions: ['old'] }));
    await cache.getOrLoad('u:1', firstLoader);

    cache.invalidate('u:1');

    const secondLoader = vi.fn().mockResolvedValue(permissions({ permissions: ['orders:read'] }));
    const second = await cache.getOrLoad('u:1', secondLoader);

    // After invalidation the cached entry is gone, so the second lookup misses
    // and calls the second-stage loader. (The loader takes no arguments, so only
    // call counts are meaningful here.)
    expect(secondLoader).toHaveBeenCalledTimes(1);
    expect(second.permissions).toEqual(['orders:read']);
  });

  it('drops an in-flight load for that user on invalidation', async () => {
    const cache = new PermissionCacheService(60);

    const gateA = deferred<PermissionSet>();
    const gateB = deferred<PermissionSet>();
    let calls = 0;
    const loader = vi.fn(() => {
      calls += 1;
      return calls === 1 ? gateA.promise : gateB.promise;
    });

    // Start a load, then invalidate while it is still in flight.
    const first = cache.getOrLoad('u:1', loader);
    cache.invalidate('u:1');
    // A lookup issued after invalidation must NOT join the orphaned in-flight
    // promise — invalidate() dropped the inflight slot, so this starts a brand
    // new database load instead.
    const second = cache.getOrLoad('u:1', loader);

    expect(loader).toHaveBeenCalledTimes(2);

    // Both waiters settle with the value their own loader produced: the one
    // that predates the write still gets its (now stale) answer, and it is not
    // shared with the post-invalidation waiter.
    gateB.resolve(permissions({ permissions: ['fresh'] }));
    gateA.resolve(permissions({ permissions: ['stale'] }));

    expect((await first).permissions).toEqual(['stale']);
    expect((await second).permissions).toEqual(['fresh']);
  });

  it('does not permanently cache a deactivated-account failure', async () => {
    const cache = new PermissionCacheService(60);
    const loader = vi
      .fn<() => Promise<PermissionSet>>()
      .mockRejectedValueOnce(new Error('UnauthorizedException: account is inactive'))
      .mockResolvedValueOnce(permissions({ permissions: ['products:read'] }));

    await expect(cache.getOrLoad('u:1', loader)).rejects.toThrow('account is inactive');
    expect(loader).toHaveBeenCalledTimes(1);

    // Failures are not cached, so a later retry reaches the loader again.
    const result = await cache.getOrLoad('u:1', loader);
    expect(result.permissions).toEqual(['products:read']);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('preserves authorization error semantics through the cache: denying remains denying', async () => {
    // Fail-safe property for the auth path: the cache stores only successful
    // permission sets. A loader rejection (missing user, inactive status, etc.)
    // is propagated and not cached, so the next request re-checks the database.
    // That is what keeps deactivated/revoked access from becoming permanently
    // cached in this service.
    const cache = new PermissionCacheService(120);
    const loader = vi
      .fn<() => Promise<PermissionSet>>()
      .mockRejectedValueOnce(new Error('UnauthorizedException: account no longer exists'))
      .mockResolvedValueOnce(permissions({ permissions: ['orders:read'] }));

    await expect(cache.getOrLoad('u:1', loader)).rejects.toThrow('account no longer exists');
    expect(loader).toHaveBeenCalledTimes(1);

    const recovered = await cache.getOrLoad('u:1', loader);
    expect(recovered.permissions).toEqual(['orders:read']);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent misses into a single database load', async () => {
    const cache = new PermissionCacheService(60);
    const gate = deferred<PermissionSet>();
    const loader = vi.fn(() => gate.promise);

    const first = cache.getOrLoad('u:1', loader);
    const second = cache.getOrLoad('u:1', loader);
    const third = cache.getOrLoad('u:1', loader);

    gate.resolve(permissions({ permissions: ['orders:read'] }));

    expect(await first).toEqual(permissions({ permissions: ['orders:read'] }));
    expect(await second).toEqual(permissions({ permissions: ['orders:read'] }));
    expect(await third).toEqual(permissions({ permissions: ['orders:read'] }));
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('propagates a concurrent loader failure to every waiter and stores nothing', async () => {
    const cache = new PermissionCacheService(60);
    // The loader fails on the shared first attempt; both concurrent waiters are
    // coalesced onto that single in-flight promise, so both observe the failure.
    const loader = vi.fn(() => Promise.reject(new Error('db down')));

    const a = cache.getOrLoad('u:1', loader);
    const b = cache.getOrLoad('u:1', loader);

    await expect(a).rejects.toThrow('db down');
    await expect(b).rejects.toThrow('db down');

    // The failed load was not cached, so the next request tries again.
    const recovered = vi.fn().mockResolvedValue(permissions({ permissions: ['products:read'] }));
    const recoveredValue = await cache.getOrLoad('u:1', recovered);
    expect(recoveredValue.permissions).toEqual(['products:read']);
    expect(recovered).toHaveBeenCalledTimes(1);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('invalidates all cached permission sets on global invalidation', async () => {
    vi.useFakeTimers();
    try {
      const cache = new PermissionCacheService(60);

      const loaderU1 = vi.fn().mockResolvedValue(permissions({ permissions: ['old-1'] }));
      const loaderU2 = vi.fn().mockResolvedValue(permissions({ permissions: ['old-2'] }));

      await cache.getOrLoad('u:1', loaderU1);
      await cache.getOrLoad('u:2', loaderU2);
      cache.invalidateAll('role-permission definition changed');

      const newU1 = vi.fn().mockResolvedValue(permissions({ permissions: ['new-1'] }));
      const newU2 = vi.fn().mockResolvedValue(permissions({ permissions: ['new-2'] }));

      expect((await cache.getOrLoad('u:1', newU1)).permissions).toEqual(['new-1']);
      expect((await cache.getOrLoad('u:2', newU2)).permissions).toEqual(['new-2']);
      expect(newU1).toHaveBeenCalledTimes(1);
      expect(newU2).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the global generation guard to prevent stale repopulation after invalidateAll', async () => {
    vi.useFakeTimers();
    try {
      const cache = new PermissionCacheService(60);

      // Populate the cache with a fresh value first.
      await cache.getOrLoad(
        'u:1',
        vi.fn().mockResolvedValue(permissions({ permissions: ['stale-before-invalidation'] })),
      );

      // Evict so the next lookup is a clean miss that starts an in-flight load.
      cache.invalidate('u:1');

      // Start a load, invalidate globally while it is in flight, then let it
      // settle with pre-invalidation data.
      const gate = deferred<PermissionSet>();
      const midFlightLoader = vi.fn(() => gate.promise);
      const inFlight = cache.getOrLoad('u:1', midFlightLoader);

      cache.invalidateAll('role-permission definition changed');
      gate.resolve(permissions({ permissions: ['stale-during-invalidation'] }));

      // The caller that started before invalidation still gets its result...
      expect((await inFlight).permissions).toEqual(['stale-during-invalidation']);
      expect(midFlightLoader).toHaveBeenCalledTimes(1);
      // ...but the post-invalidation loader must run again because the stale
      // result was not stored (generation guard skipped store()).
      const after = vi.fn().mockResolvedValue(permissions({ permissions: ['fresh-after-invalidation'] }));
      expect((await cache.getOrLoad('u:1', after)).permissions).toEqual([
        'fresh-after-invalidation',
      ]);
      expect(after).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds memory with LRU eviction', async () => {
    const cache = new PermissionCacheService(60, 2);
    const u1 = vi.fn().mockResolvedValue(permissions({ permissions: ['a'] }));
    const u2 = vi.fn().mockResolvedValue(permissions({ permissions: ['b'] }));
    const u3 = vi.fn().mockResolvedValue(permissions({ permissions: ['c'] }));

    await cache.getOrLoad('user:1', u1);
    await cache.getOrLoad('user:2', u2);
    // Touch user:1 so user:2 becomes the least recently used.
    await cache.getOrLoad('user:1', u1);
    await cache.getOrLoad('user:3', u3);

    // user:2 was evicted. Read it again: it must reload.
    await cache.getOrLoad('user:2', u2);

    expect(u1).toHaveBeenCalledTimes(1);
    expect(u2).toHaveBeenCalledTimes(2);
    expect(u3).toHaveBeenCalledTimes(1);
  });
});
