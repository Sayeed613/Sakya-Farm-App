import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../config/configuration';
import { CatalogCacheService } from './catalog-cache.service';

/**
 * Global so products, categories and admin modules can inject the cache
 * without each feature module re-providing its own instance — invalidation
 * only works if every catalogue reader and writer shares one object.
 *
 * TTL comes from `CATALOG_CACHE_TTL_SECONDS` (default 30s, 0 disables).
 */
@Global()
@Module({
  providers: [
    {
      provide: CatalogCacheService,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) =>
        new CatalogCacheService(config.getOrThrow('catalog.cacheTtlSeconds', { infer: true })),
    },
  ],
  exports: [CatalogCacheService],
})
export class CatalogCacheModule {}
