import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { HealthCheckResult } from '@sakya/types';
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';

// Must evaluate before `../src/app.module`: it pins the config (see its doc).
import './health.env';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/database/prisma.service';
import { HealthService } from '../src/modules/health/health.service';

/**
 * HTTP-level tests for the health endpoints, following catalog.e2e.spec.ts:
 * the real application boots (routing, versioned prefix, global guards, the
 * @Public() decorator) and only the database is replaced. The Prisma stub's
 * `ping` is the database health check — a spy, so these tests can prove both
 * that `/health/live` never reaches for the database AND that `/health` still
 * does.
 *
 * No credentials are sent anywhere: a 200 through the real guard stack is what
 * "public" means for these routes.
 */

describe('Health endpoints (HTTP)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let checkSpy: MockInstance<HealthService['check']>;

  const ping = vi.fn(async () => 1.25);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ ping })
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    baseUrl = `${(await app.getUrl()).replace(/\/$/, '')}/api/v1`;

    // The controller resolves this same singleton, so the spy observes exactly
    // what the HTTP layer invokes.
    checkSpy = vi.spyOn(app.get(HealthService), 'check');
  });

  afterAll(async () => {
    await app?.close();
  });

  const get = (path: string): Promise<Response> => fetch(`${baseUrl}${path}`);

  describe('GET /health/live', () => {
    it('returns 200 for an anonymous caller', async () => {
      const response = await get('/health/live');

      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        status: string;
        uptimeSeconds: number;
        timestamp: string;
      };

      expect(body.status).toBe('ok');
      expect(Number.isFinite(body.uptimeSeconds)).toBe(true);
      expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    });

    it('never invokes the database health check', async () => {
      checkSpy.mockClear();
      ping.mockClear();

      const response = await get('/health/live');

      expect(response.status).toBe(200);
      // Not the service-level check...
      expect(checkSpy).not.toHaveBeenCalled();
      // ...and therefore no `SELECT 1` round trip either.
      expect(ping).not.toHaveBeenCalled();
    });
  });

  describe('GET /health (existing behaviour, unchanged)', () => {
    it('still probes the database and reports its status', async () => {
      checkSpy.mockClear();
      ping.mockClear();

      const response = await get('/health');

      expect(response.status).toBe(200);

      const body = (await response.json()) as HealthCheckResult;

      expect(body).toMatchObject({
        status: 'ok',
        service: 'sakya-farms-api',
        environment: 'test',
        checks: { database: { status: 'up', latencyMs: 1.25 } },
      });
      expect(typeof body.version).toBe('string');
      expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);

      // The probe really ran: once at the service level, once at the DB.
      expect(checkSpy).toHaveBeenCalledTimes(1);
      expect(ping).toHaveBeenCalledTimes(1);
    });
  });
});
