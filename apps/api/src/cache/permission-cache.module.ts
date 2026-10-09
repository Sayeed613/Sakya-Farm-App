import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../config/configuration';
import { PermissionCacheService } from './permission-cache.service';

/**
 * Global so JwtStrategy and any future authorization consumers share one cache
 * instance — invalidation only works if every reader and writer shares the same
 * object.
 *
 * TTL comes from `PERMISSION_CACHE_TTL_SECONDS` (default 60s, 0 disables).
 *
 * The cache is per-process. Admin invalidation reaches only the instance that
 * served the admin mutation; other instances converge within one TTL. At this
 * scale that is an accepted trade-off.
 */
@Global()
@Module({
  providers: [
    {
      provide: PermissionCacheService,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) =>
        new PermissionCacheService(
          config.getOrThrow('permissionCache.ttlSeconds', { infer: true }),
        ),
    },
  ],
  exports: [PermissionCacheService],
})
export class PermissionCacheModule {}
