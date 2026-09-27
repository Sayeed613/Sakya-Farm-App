import { Injectable, Logger } from '@nestjs/common';

/**
 * In-process cache for the public catalogue reads (product list, product
 * detail, variants, category tree).
 *
 * Design notes:
 *
 * - **Why in-process:** browsing is read-heavy and the data changes rarely;
 *   every cache hit is a Postgres round trip the pool doesn't have to serve.
 *   No new infrastructure (no Redis) and no cache-network failure mode — the
 *   worst case is always "the database was queried after all".
 * - **TTL bounds all out-of-band staleness.** Admin writes invalidate
 *   immediately (see the admin services), but two staleness sources cannot be
 *   signalled in-process: catalogue import scripts that write to the database
 *   behind the API's back, and *other instances* when this service runs with a
 *   process manager. The TTL is therefore the honesty knob: it must be short
 *   enough that those sources are invisible to users (default 30s).
 * - **Stampede protection (single flight).** When a hot key expires, the first
 *   request queries the database and every concurrent request for the same key
 *   awaits that one query instead of firing its own. A viral product page
 *   after expiry produces one database hit, not N.
 * - **Invalidation is generation-based.** `invalidateAll()` bumps a generation
 *   counter and drops both maps. A query that was already in flight when the
 *   invalidation happened may still return its (now stale) answer to the
 *   caller who asked for it — that caller predates the write — but the result
 *   is not *stored*, because the generation no longer matches. Without this
 *   guard a read racing an admin write could repopulate the cache with
 *   pre-write data that then outlives its TTL.
 * - **Bounded memory.** Keys are derived from request parameters, and search
 *   terms are arbitrary, so the key space is unbounded. Entries live in a Map
 *   used as an LRU: a hit is re-inserted (moving it to the newest end) and an
 *   insert beyond `maxEntries` evicts the least recently used key. Memory is
 *   capped regardless of key cardinality or expiry.
 * - **Only successes are cached.** A thrown loader (e.g. `NotFoundException`
 *   for an unknown slug) is propagated to every waiter and never stored, so a
 *   miss always re-checks the database.
 *
 * Cross-cutting caveat: this cache is per process. Admin invalidation reaches
 * only the instance that served the admin request; other instances converge
 * within one TTL. That is an accepted trade-off at this scale and is what the
 * TTL is sized for.
 */
interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

@Injectable()
export class CatalogCacheService {
  private readonly logger = new Logger(CatalogCacheService.name);
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private generation = 0;

  /**
   * @param ttlSeconds Seconds a cached read stays fresh; 0 disables caching
   *   entirely (every read goes straight to the database).
   * @param maxEntries LRU ceiling on stored entries; kept small on purpose —
   *   a catalogue cache only needs room for the pages users actually browse.
   */
  constructor(ttlSeconds: number, maxEntries = 500) {
    this.ttlMs = ttlSeconds * 1000;
    this.maxEntries = maxEntries;
  }

  /**
   * Return the cached value for `key`, or run `loader` to populate it.
   *
   * Concurrent callers for the same key share a single `loader` execution.
   * Rejections propagate to every waiter and are not cached.
   */
  async getOrLoad<T>(key: string, loader: () => Promise<T>): Promise<T> {
    if (this.ttlMs <= 0) {
      return loader();
    }

    const cached = this.entries.get(key);
    if (cached !== undefined) {
      if (cached.expiresAt > Date.now()) {
        // LRU touch: re-insert so hot keys sink toward the oldest end.
        this.entries.delete(key);
        this.entries.set(key, cached);
        return cached.value as T;
      }
      this.entries.delete(key);
    }

    const pending = this.inflight.get(key);
    if (pending !== undefined) {
      return pending as Promise<T>;
    }

    const generation = this.generation;
    const load = (async () => {
      const value = await loader();
      // A generation mismatch means invalidateAll() ran while this query was
      // in flight: serve the value to the waiters who asked before the write,
      // but never store it — the write's whole point was to end this data.
      if (generation === this.generation) {
        this.store(key, value);
      }
      return value;
    })();

    this.inflight.set(key, load);
    // Cleanup for both settlement paths. The handlers never throw, so the
    // derived promise cannot surface an unhandled rejection of its own.
    const settle = (): void => {
      if (this.inflight.get(key) === load) {
        this.inflight.delete(key);
      }
    };
    void load.then(settle, settle);

    return load;
  }

  /**
   * Drop every cached read and any in-flight load's right to store itself.
   *
   * Called by the admin services after a successful catalogue write. Waiting
   * callers of a dropped in-flight load still receive its result — they asked
   * before the write — but it is not cached (generation guard above), so the
   * very next read is served fresh.
   */
  invalidateAll(reason: string): void {
    this.generation += 1;
    this.entries.clear();
    this.inflight.clear();
    this.logger.debug(`catalogue cache invalidated: ${reason}`);
  }

  private store(key: string, value: unknown): void {
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) {
      // Map iteration order is insertion order, so the first key is the least
      // recently used (hits are re-inserted by getOrLoad).
      const oldest = this.entries.keys().next();
      if (oldest.done !== true) {
        this.entries.delete(oldest.value);
      }
    }
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}
