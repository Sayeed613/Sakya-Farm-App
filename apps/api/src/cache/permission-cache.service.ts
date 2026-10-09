import { Injectable, Logger } from '@nestjs/common';

/** In-process cache for authenticated user permissions and roles. */

interface PermissionCacheEntry {
  value: {
    permissions: ReadonlyArray<string>;
    roles: ReadonlyArray<string>;
    isSuperAdmin: boolean;
  };
  expiresAt: number;
}

@Injectable()
export class PermissionCacheService {
  private readonly logger = new Logger(PermissionCacheService.name);
  private readonly entries = new Map<string, PermissionCacheEntry>();
  private readonly inflight = new Map<string, Promise<PermissionCacheEntry['value']>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private generation = 0;

  constructor(ttlSeconds: number, maxEntries = 2000) {
    this.ttlMs = ttlSeconds * 1000;
    this.maxEntries = maxEntries;
  }

  async getOrLoad(
    userId: string,
    loader: () => Promise<PermissionCacheEntry['value']>,
  ): Promise<PermissionCacheEntry['value']> {
    if (this.ttlMs <= 0) {
      return loader();
    }

    const key = `permission:user:${userId}`;
    const cached = this.entries.get(key);
    if (cached !== undefined) {
      if (cached.expiresAt > Date.now()) {
        this.entries.delete(key);
        this.entries.set(key, cached);
        return cached.value;
      }
      this.entries.delete(key);
    }

    const pending = this.inflight.get(key);
    if (pending !== undefined) {
      return pending;
    }

    const capturedGeneration = this.generation;
    const load = (async () => {
      const value = await loader();
      if (capturedGeneration === this.generation) {
        this.store(key, value);
      }
      return value;
    })();

    this.inflight.set(key, load);
    const settle = (): void => {
      if (this.inflight.get(key) === load) {
        this.inflight.delete(key);
      }
    };
    void load.then(settle, settle);

    return load;
  }

  invalidate(userId: string): void {
    const key = `permission:user:${userId}`;
    this.entries.delete(key);
    this.inflight.delete(key);
    this.logger.debug(`permission cache invalidated for user ${userId}`);
  }

  /** Clear every cached permission set. */
  invalidateAll(reason: string): void {
    this.generation += 1;
    this.entries.clear();
    this.inflight.clear();
    this.logger.debug(`permission cache invalidated: ${reason}`);
  }

  private store(key: string, value: PermissionCacheEntry['value']): void {
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done !== true) {
        this.entries.delete(oldest.value);
      }
    }
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}
