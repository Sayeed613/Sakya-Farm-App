import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

/**
 * HTTP-level tests for the phone + OTP customer authentication flow.
 *
 * Boots the real application — routing, global guards, Zod validation, the
 * throttler — against a real database. The dev OTP sender logs the code and
 * the API reports it in the response (`devCode`) outside production, which is
 * exactly the hook these tests use to complete verification without an SMS
 * provider.
 *
 * Covers: OTP send, verification, existing/new customer authentication, reuse
 * rejection, token issuance, refresh rotation, replay detection, logout, and
 * the guest-cart merge.
 */

const PHONE_NEW = '+915555000001';
const PHONE_EXISTING = '+915555000002';
const STORE_ID = 'b1111111-1111-4111-8111-111111111111';
const PRODUCT_ID = 'b2222222-2222-4222-8222-222222222222';
const VARIANT_A = 'b3333333-3333-4333-8333-333333333331';
const VARIANT_B = 'b3333333-3333-4333-8333-333333333332';

interface TestContext {
  app: INestApplication;
  prisma: PrismaClient;
  baseUrl: string;
}

const runDatabaseE2e = process.env.RUN_DB_E2E === '1';

async function seedFixture(prisma: PrismaClient) {
  await prisma.store.upsert({
    where: { id: STORE_ID },
    update: {},
    create: { id: STORE_ID, code: 'OTP-TEST', name: 'OTP Test Store' },
  });

  const product = await prisma.product.upsert({
    where: { id: PRODUCT_ID },
    update: {},
    create: {
      id: PRODUCT_ID,
      sourcePlatform: 'MANUAL',
      sourceProductId: 'otp-test-product',
      sourceHandle: 'otp-test-product',
      title: 'OTP Test Mango',
      slug: 'otp-test-mango',
      status: 'ACTIVE',
      isAvailable: true,
      publishedAt: new Date(),
    },
  });

  for (const [id, sku, position] of [
    [VARIANT_A, 'OTP-500G', 0],
    [VARIANT_B, 'OTP-1KG', 1],
  ] as const) {
    await prisma.productVariant.upsert({
      where: { id },
      update: {},
      create: {
        id,
        productId: product.id,
        title: sku === 'OTP-500G' ? '500 g' : '1 kg',
        sku,
        priceInPaise: sku === 'OTP-500G' ? 2400 : 4500,
        currency: 'INR',
        isAvailable: true,
        position,
      },
    });
  }

  // An existing phone customer, so both auth paths are exercised.
  const existing = await prisma.user.upsert({
    where: { phone: PHONE_EXISTING },
    update: { status: 'ACTIVE' },
    create: {
      email: `otp-existing-${PHONE_EXISTING}@sakyafarms.example`,
      phone: PHONE_EXISTING,
      firstName: 'Existing',
      lastName: 'Customer',
      status: 'ACTIVE',
      phoneVerifiedAt: new Date(),
    },
  });
  const customerRole = await prisma.role.findUniqueOrThrow({ where: { code: 'CUSTOMER' } });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: existing.id, roleId: customerRole.id } },
    update: {},
    create: { userId: existing.id, roleId: customerRole.id },
  });
}

async function cleanupPhones(prisma: PrismaClient) {
  for (const phone of [PHONE_NEW, PHONE_EXISTING]) {
    const user = await prisma.user.findUnique({ where: { phone }, select: { id: true } });
    if (user !== null) {
      await prisma.$transaction([
        prisma.refreshToken.deleteMany({ where: { userId: user.id } }),
        prisma.cartItem.deleteMany({ where: { cart: { userId: user.id } } }),
        prisma.cart.deleteMany({ where: { userId: user.id } }),
        prisma.userRole.deleteMany({ where: { userId: user.id } }),
        prisma.user.delete({ where: { id: user.id } }),
      ]);
    }
    await prisma.otpCode.deleteMany({ where: { phone } });
  }
  await prisma.inventoryMovement.deleteMany({ where: { storeId: STORE_ID } });
  await prisma.inventory.deleteMany({ where: { storeId: STORE_ID } });
  await prisma.cartItem.deleteMany({ where: { storeId: STORE_ID } });
  await prisma.productVariant.deleteMany({ where: { productId: PRODUCT_ID } });
  await prisma.product.deleteMany({ where: { id: PRODUCT_ID } });
  await prisma.store.deleteMany({ where: { id: STORE_ID } });
}

async function sendOtp(ctx: TestContext, phone: string) {
  const res = await fetch(`${ctx.baseUrl}/auth/otp/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { phone: string; devCode?: string; resendAfterSeconds: number };
}

async function verifyOtp(ctx: TestContext, phone: string, otp: string) {
  return fetch(`${ctx.baseUrl}/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, otp }),
  });
}

describe.skipIf(!runDatabaseE2e)('Phone + OTP customer authentication (seeded DB)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
    await prisma.$connect();

    await cleanupPhones(prisma);
    await seedFixture(prisma);

    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = module.createNestApplication();
    configureApp(app);
    await app.init();

    const server = (await app.listen(0)) as { address(): { port: number } | null };
    const port = server.address()?.port ?? 0;

    ctx = { app, prisma, baseUrl: `http://127.0.0.1:${port}/api/v1` };
  });

  afterAll(async () => {
    if (ctx !== undefined) {
      await cleanupPhones(ctx.prisma);
      // Remove this suite's fixtures so the shared catalog never shows test rows.
      await ctx.prisma.cartItem.deleteMany({ where: { variant: { productId: PRODUCT_ID } } });
      await ctx.prisma.productVariant.deleteMany({ where: { productId: PRODUCT_ID } });
      await ctx.prisma.productImage.deleteMany({ where: { productId: PRODUCT_ID } });
      await ctx.prisma.product.deleteMany({ where: { id: PRODUCT_ID } });
      await ctx?.app.close();
      await ctx?.prisma.$disconnect();
    }
  });

  afterEach(async () => {
    // The 60s resend cooldown and hourly caps are per-phone state in the DB;
    // clearing OTP rows between tests keeps each spec independent.
    if (ctx !== undefined) {
      await ctx.prisma.otpCode.deleteMany({ where: { phone: { in: [PHONE_NEW, PHONE_EXISTING] } } });
    }
  });

  it('sends an OTP without revealing whether the phone has an account', async () => {
    const unknown = await sendOtp(ctx, PHONE_NEW);
    const existing = await sendOtp(ctx, PHONE_EXISTING);

    // Identical response shape, no account-existence hint.
    expect(unknown.phone).toBe(PHONE_NEW);
    expect(existing.phone).toBe(PHONE_EXISTING);
    expect(Object.keys(unknown).sort()).toEqual(Object.keys(existing).sort());
    expect(unknown.devCode).toMatch(/^\d{6}$/);
  });

  it('authenticates a NEW customer on first verification: tokens, CUSTOMER role, no password', async () => {
    const { devCode } = await sendOtp(ctx, PHONE_NEW);

    const res = await verifyOtp(ctx, PHONE_NEW, devCode!);
    expect(res.status).toBe(200);

    const session = (await res.json()) as {
      isNewUser: boolean;
      accessToken: string;
      refreshToken: string;
      user: { id: string; phone: string | null; email: string | null };
    };

    expect(session.isNewUser).toBe(true);
    expect(session.user.phone).toBe(PHONE_NEW);
    expect(session.user.email).toBeNull();

    const user = await ctx.prisma.user.findUniqueOrThrow({
      where: { phone: PHONE_NEW },
      include: { roles: { include: { role: true } } },
    });
    expect(user.passwordHash).toBeNull();
    expect(user.roles.some((assignment) => assignment.role.code === 'CUSTOMER')).toBe(true);
    expect(user.phoneVerifiedAt).not.toBeNull();

    // The access token authenticates against /users/me.
    const me = await fetch(`${ctx.baseUrl}/users/me`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    expect(me.status).toBe(200);
  });

  it('authenticates an EXISTING customer with the correct code', async () => {
    const { devCode } = await sendOtp(ctx, PHONE_EXISTING);

    const res = await verifyOtp(ctx, PHONE_EXISTING, devCode!);
    expect(res.status).toBe(200);

    const session = (await res.json()) as { isNewUser: boolean; user: { firstName: string } };
    expect(session.isNewUser).toBe(false);
    expect(session.user.firstName).toBe('Existing');
  });

  it('rejects a reused (single-use) code and keeps the response generic', async () => {
    const { devCode } = await sendOtp(ctx, PHONE_NEW);
    expect((await verifyOtp(ctx, PHONE_NEW, devCode!)).status).toBe(200);

    const replay = await verifyOtp(ctx, PHONE_NEW, devCode!);
    expect(replay.status).toBe(401);
    const body = (await replay.json()) as { message: string };
    // Same generic message as a wrong code: no oracle for what happened.
    expect(body.message).toMatch(/invalid or expired/i);
  });

  it('rejects a wrong code with the same generic message as an unknown code', async () => {
    const { devCode } = await sendOtp(ctx, PHONE_NEW);

    const wrong = await verifyOtp(ctx, PHONE_NEW, '000001');
    expect(wrong.status).toBe(401);

    // And a verification with no active code at all reads identically.
    const noCode = await fetch(`${ctx.baseUrl}/auth/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '+915555000003', otp: '123456' }),
    });
    expect(noCode.status).toBe(401);
    expect(((await wrong.json()) as { message: string }).message).toBe(
      ((await noCode.json()) as { message: string }).message,
    );
    void devCode;
  });

  it('rotates refresh tokens and revokes the family on replay', async () => {
    const { devCode } = await sendOtp(ctx, PHONE_EXISTING);
    const first = (await (await verifyOtp(ctx, PHONE_EXISTING, devCode!)).json()) as {
      accessToken: string;
      refreshToken: string;
    };

    // Rotation: the first refresh succeeds and issues new tokens.
    const rotate = await fetch(`${ctx.baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: first.refreshToken }),
    });
    expect(rotate.status).toBe(201);
    const second = (await rotate.json()) as { refreshToken: string };

    // Replay: presenting the superseded token revokes the WHOLE family.
    const replay = await fetch(`${ctx.baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: first.refreshToken }),
    });
    expect(replay.status).toBe(401);

    // The rotated token is dead too: family revocation.
    const afterReplay = await fetch(`${ctx.baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: second.refreshToken }),
    });
    expect(afterReplay.status).toBe(401);

    // Scope the assertion to THIS session's family: earlier tests also minted
    // tokens for this seeded user and they are legitimately still active.
    const { createHash } = await import('node:crypto');
    const familyId = (
      await ctx.prisma.refreshToken.findUniqueOrThrow({
        where: { tokenHash: createHash('sha256').update(first.refreshToken).digest('hex') },
        select: { familyId: true },
      })
    ).familyId;

    const family = await ctx.prisma.refreshToken.findMany({
      where: { familyId },
      select: { revokedAt: true, revokedReason: true },
    });
    expect(family.length).toBe(2);
    for (const row of family) {
      expect(row.revokedAt).not.toBeNull();
      expect(row.revokedReason).toMatch(/replay|Rotated/i);
    }
  });

  it('logs out: the refresh token stops working', async () => {
    const { devCode } = await sendOtp(ctx, PHONE_EXISTING);
    const session = (await (await verifyOtp(ctx, PHONE_EXISTING, devCode!)).json()) as {
      refreshToken: string;
    };

    const logout = await fetch(`${ctx.baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    expect(logout.status).toBe(201);

    const refresh = await fetch(`${ctx.baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    expect(refresh.status).toBe(401);
  });

  it('merges the guest cart after authentication: dedupes, revalidates, drops dead lines', async () => {
    const { devCode } = await sendOtp(ctx, PHONE_NEW);
    const session = (await (await verifyOtp(ctx, PHONE_NEW, devCode!)).json()) as {
      accessToken: string;
    };
    const auth = { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' };

    const merge = await fetch(`${ctx.baseUrl}/cart/merge-guest-cart`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        lines: [
          { variantId: VARIANT_A, quantity: 2 },
          // Duplicate of the same variant: must fold into one line of 3.
          { variantId: VARIANT_A, quantity: 1 },
          { variantId: VARIANT_B, quantity: 1 },
          // Unknown variant: dropped, merge continues.
          { variantId: '00000000-0000-4000-8000-000000000000', quantity: 5 },
        ],
      }),
    });
    expect(merge.status).toBe(200);

    const cart = (await merge.json()) as {
      items: Array<{ variantId: string; quantity: number; unitPriceInPaise: number }>;
      subtotalInPaise: number;
    };
    expect(cart.items).toHaveLength(2);
    const lineA = cart.items.find((item) => item.variantId === VARIANT_A)!;
    const lineB = cart.items.find((item) => item.variantId === VARIANT_B)!;
    expect(lineA.quantity).toBe(3);
    expect(lineB.quantity).toBe(1);
    // Server prices, not client prices.
    expect(lineA.unitPriceInPaise).toBe(2400);
    expect(lineB.unitPriceInPaise).toBe(4500);
    expect(cart.subtotalInPaise).toBe(3 * 2400 + 1 * 4500);
  });

  it('keeps email/password operator login working alongside OTP', async () => {
    // The operator endpoints survive: still registered, still validated.
    const res = await fetch(`${ctx.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@sakyafarms.example', password: 'NotTheRightPassword1!' }),
    });
    // 401 (bad credentials) — NOT 404. The endpoint exists for operator apps.
    expect(res.status).toBe(401);
  });
});
