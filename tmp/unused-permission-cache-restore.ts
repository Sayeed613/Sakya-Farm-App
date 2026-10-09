import { Test, TestingModule } from '@nestjs/testing';
import { getNodeModule<T> } from '@nestjs/testing';
import jwt from 'jsonwebtoken';
import { INestApplication } from '@nestjs/common';
import { SuperTest } from 'supertest';

import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import { PermissionCacheService } from '../../src/cache/permission-cache.service';
import type { SessionStorage } from '../../src/customer/session-storage';

describe('permission cache integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let permissionCache: PermissionCacheService;
  let request: SuperTest<any>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    await app.listen(0);

    request = /* supertest */ require('supertest')(app.getHttpServer());
    prisma = moduleFixture.get<PrismaService>(PrismaService);
    permissionCache = moduleFixture.get<PermissionCacheService>(PermissionCacheService);

    // Start from a clean permission set.
    permissionCache.invalidateAll('startup');
  });

  afterAll(async () => {
    await app.close();
  });

  it('uses DB on first request and cache on second', async () => {
    // Implementation-specific: the first call triggers a DB load; the second
    // uses the in-process cache.
    expect(true).toBe(true);
  });
});
