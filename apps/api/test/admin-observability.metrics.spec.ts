import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/database/prisma.service';
import { incrementMetric, resetMetrics, snapshotMetrics } from '../src/observability/business-metrics';
import type { BusinessMetricsSnapshot } from '../src/observability/business-metrics';
import configuration from '../src/config/configuration';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';

/** HTTP-level tests for the internal observability diagnostics endpoint.

 * The endpoint is intentionally small and guarded:
 *  - behind the admin role + permission stack (same as other `/admin` routes);
 *  - returns counters + timestamp only, no customer or secret data;
 *  - is process-local by design (documented in the response, not hidden).
 *
 * Tokens are minted the same way real clients do: signed with the app's access
 * secret for a REAL database user, with `typ: 'access'`. The JWT strategy reads
 * roles/permissions from the database on every request (so revocation is
 * immediate), so embedding permissions or roles in the token would be ignored.
 */

function mintAccessToken(userId: string): string {
  const config = configuration();
  const jwt: JwtService = new JwtService({
    secret: config.auth.accessSecret,
    signOptions: {
      algorithm: 'HS256',
      expiresIn: config.auth.accessTtl as unknown as JwtSignOptions['expiresIn'],
      issuer: config.auth.issuer,
      audience: config.auth.audience,
    },
  });
  return jwt.sign({ sub: userId, typ: 'access' });
}

interface TestContext {
  adminUserId: string;
  deliveryPartnerUserId: string;
}

describe('Admin observability diagnostics (HTTP)', () => {
  let baseUrl: string;
  let ctx: TestContext;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    baseUrl = `${(await app.getUrl()).replace(/\/$/, '')}/api/v1`;
    vi.stubEnv('NOTIFICATIONS_WORKER_DISABLED', '1');

    const prisma = moduleRef.get(PrismaService);

    // Ensure the observability:read permission exists (may predate its addition
    // in Step 13 if the DB was seeded from an older catalogue).
    await prisma.permission.upsert({
      where: { code: 'observability:read' },
      update: {},
      create: { code: 'observability:read', description: 'Read internal observability diagnostics' },
    });

    // Ensure the ADMIN role is mapped to observability:read. ADMIN holds every
    // permission except permissions:manage, but an older seed may not include
    // this one yet.
    const adminRole = await prisma.role.findUnique({ where: { code: 'ADMIN' } });
    if (adminRole !== null) {
      const obsPerm = await prisma.permission.findUniqueOrThrow({ where: { code: 'observability:read' } });
      const existing = await prisma.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId: adminRole.id, permissionId: obsPerm.id } },
      });
      if (existing === null) {
        await prisma.rolePermission.create({ data: { roleId: adminRole.id, permissionId: obsPerm.id } });
      }
    }

    const hash = null;
    const admin = await prisma.user.upsert({
      where: { email: 'observability-admin@sakyafarms.example' },
      update: { firstName: 'Observability', status: 'ACTIVE' },
      create: {
        email: 'observability-admin@sakyafarms.example',
        passwordHash: hash,
        firstName: 'Observability',
        status: 'ACTIVE',
        roles: { create: [{ role: { connect: { code: 'ADMIN' } } }] },
      },
    });

    const deliveryPartner = await prisma.user.upsert({
      where: { email: 'delivery-partner@sakyafarms.example' },
      update: { firstName: 'Delivery', status: 'ACTIVE' },
      create: {
        email: 'delivery-partner@sakyafarms.example',
        passwordHash: hash,
        firstName: 'Delivery',
        status: 'ACTIVE',
        roles: { create: [{ role: { connect: { code: 'DELIVERY_PARTNER' } } }] },
      },
    });

    ctx = { adminUserId: admin.id, deliveryPartnerUserId: deliveryPartner.id };
  });

  beforeEach(() => resetMetrics());

  it('K. returns the in-process business counters and a timestamp', async () => {
    const accessToken = mintAccessToken(ctx.adminUserId);
    const response = await fetch(`${baseUrl}/admin/orders/observability/metrics`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { metrics: BusinessMetricsSnapshot; timestamp: string };
    expect(body.metrics).toMatchObject({
      ordersCreated: 0, ordersCancelled: 0, checkoutFailures: 0, paymentFailures: 0,
      webhookFailures: 0, inventoryReservationFailures: 0, notificationQueueFailures: 0,
      notificationRetries: 0, notificationPermanentFailures: 0,
    });
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('L. rejects a caller without the observability:read permission', async () => {
    const accessToken = mintAccessToken(ctx.deliveryPartnerUserId);
    const response = await fetch(`${baseUrl}/admin/orders/observability/metrics`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(response.status).toBe(403);
  });

  it('L. rejects an unauthenticated caller', async () => {
    const response = await fetch(`${baseUrl}/admin/orders/observability/metrics`);
    expect(response.status).toBe(401);
  });

  it('K. the payload contains no sensitive business data', async () => {
    const accessToken = mintAccessToken(ctx.adminUserId);
    const response = await fetch(`${baseUrl}/admin/orders/observability/metrics`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = (await response.json()) as { metrics: BusinessMetricsSnapshot; timestamp: string };
    expect(Object.keys(body)).toEqual(['metrics', 'timestamp']);
    expect(Object.keys(body.metrics)).toEqual([
      'ordersCreated', 'ordersCancelled', 'checkoutFailures', 'paymentFailures',
      'webhookFailures', 'inventoryReservationFailures', 'notificationQueueFailures',
      'notificationRetries', 'notificationPermanentFailures',
    ]);
    for (const value of Object.values(body.metrics)) expect(typeof value).toBe('number');
  });

  it('I. counters are process-local: snapshotMetrics returns per-process values', async () => {
    resetMetrics();
    snapshotMetrics();
    incrementMetric('ordersCreated');
    incrementMetric('ordersCancelled');
    const snapshot = snapshotMetrics();
    expect(snapshot.ordersCreated).toBe(1);
    expect(snapshot.ordersCancelled).toBe(1);
    expect(snapshot.webhookFailures).toBe(0);
  });

  afterAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const prisma = moduleRef.get(PrismaService);
    await prisma.user.deleteMany({
      where: { email: { in: ['observability-admin@sakyafarms.example', 'delivery-partner@sakyafarms.example'] } },
    });
    await moduleRef.close();
  });
});
