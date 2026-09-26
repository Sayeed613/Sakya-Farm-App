import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

/**
 * HTTP-level tests for the LOGGED-IN add-to-cart flow — the path behind the
 * customer app's "View Cart" pill.
 *
 * The reported bug: after logging in, adding a product incremented the card
 * stepper but the pill never appeared. The pill counts the SERVER cart when
 * authenticated, and the app now posts to POST /cart/items WITHOUT a storeId
 * (the server must resolve the fulfillment store itself — the same rule the
 * merge endpoint applies). These tests pin that exact flow:
 *
 *   signup → add (no storeId)  → GET /cart shows the line  → pill renders
 *   login  → add (no storeId)  → GET /cart shows the line  → pill renders
 *   add with an explicit storeId must keep working (backwards compatibility)
 *   unavailable variant → 409 → app stays silent, no pill
 */

/*
 * One phone per test: the OTP service enforces a per-phone resend cooldown,
 * so reusing a phone across tests that run within seconds hits 429.
 */
const PHONE_SIGNUP = '+915556000001';
const PHONE_LOGIN = '+915556000002';
const PHONE_STOREID = '+915556000003';
const PHONE_UNAVAILABLE = '+915556000004';
const ALL_PHONES = [PHONE_SIGNUP, PHONE_LOGIN, PHONE_STOREID, PHONE_UNAVAILABLE];
const STORE_ID = 'b1111111-1111-4222-8111-111111111111';
const PRODUCT_ID = 'b2222222-2222-4222-8222-222222222221';
const VARIANT_A = 'b3333333-3333-4333-8333-333333333341';
const VARIANT_UNAVAILABLE = 'b3333333-3333-4333-8333-333333333343';

interface TestContext {
  app: INestApplication;
  prisma: PrismaClient;
  baseUrl: string;
}

const runDatabaseE2e = process.env.RUN_DB_E2E === '1';

async function seedExistingCustomer(prisma: PrismaClient) {
  // Pre-provision the "returning" customer so the LOGIN test actually logs
  // in (isNewUser: false) rather than signing up.
  await prisma.user.upsert({
    where: { phone: PHONE_LOGIN },
    update: { status: 'ACTIVE' },
    create: {
      email: `pill-login-${PHONE_LOGIN}@sakyafarms.example`,
      phone: PHONE_LOGIN,
      firstName: 'Returning',
      lastName: 'Customer',
      status: 'ACTIVE',
      phoneVerifiedAt: new Date(),
    },
  });
  const customerRole = await prisma.role.findUniqueOrThrow({ where: { code: 'CUSTOMER' } });
  const user = await prisma.user.findUniqueOrThrow({ where: { phone: PHONE_LOGIN }, select: { id: true } });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: customerRole.id } },
    update: {},
    create: { userId: user.id, roleId: customerRole.id },
  });
}

async function seedFixture(prisma: PrismaClient) {
  await prisma.store.upsert({
    where: { id: STORE_ID },
    update: { isActive: true },
    create: { id: STORE_ID, code: 'CART-PILL-TEST', name: 'Cart Pill Test Store', isActive: true },
  });

  const product = await prisma.product.upsert({
    where: { id: PRODUCT_ID },
    update: {},
    create: {
      id: PRODUCT_ID,
      sourcePlatform: 'MANUAL',
      sourceProductId: 'cart-pill-test-product',
      sourceHandle: 'cart-pill-test-product',
      title: 'Cart Pill Test Ghee',
      slug: 'cart-pill-test-ghee',
      status: 'ACTIVE',
      isAvailable: true,
      publishedAt: new Date(),
    },
  });

  await prisma.productVariant.upsert({
    where: { id: VARIANT_A },
    update: { isAvailable: true },
    create: {
      id: VARIANT_A,
      productId: product.id,
      title: '500 g',
      sku: 'PILL-500G',
      priceInPaise: 2400,
      currency: 'INR',
      isAvailable: true,
      position: 0,
    },
  });

  // A variant that exists but cannot be bought: addItem must reject it.
  await prisma.productVariant.upsert({
    where: { id: VARIANT_UNAVAILABLE },
    update: { isAvailable: false },
    create: {
      id: VARIANT_UNAVAILABLE,
      productId: product.id,
      title: '1 kg',
      sku: 'PILL-1KG',
      priceInPaise: 4500,
      currency: 'INR',
      isAvailable: false,
      position: 1,
    },
  });

  await prisma.inventory.upsert({
    where: { variantId_storeId: { storeId: STORE_ID, variantId: VARIANT_A } },
    update: { quantityOnHand: 100 },
    create: { storeId: STORE_ID, variantId: VARIANT_A, quantityOnHand: 100 },
  });
}

async function cleanupPhones(prisma: PrismaClient) {
  for (const phone of ALL_PHONES) {
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

interface Session {
  accessToken: string;
  refreshToken: string;
  isNewUser: boolean;
}

async function authenticate(ctx: TestContext, phone: string): Promise<Session> {
  const { devCode } = await sendOtp(ctx, phone);
  const res = await verifyOtp(ctx, phone, devCode!);
  expect(res.status).toBe(200);
  return (await res.json()) as Session;
}

function authHeaders(session: Session) {
  return { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' };
}

/** What the View Cart pill reads: the server cart's line count. */
async function getCart(ctx: TestContext, session: Session) {
  const res = await fetch(`${ctx.baseUrl}/cart`, { headers: authHeaders(session) });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    items: Array<{ variantId: string; quantity: number; unitPriceInPaise: number }>;
    subtotalInPaise: number;
  };
}

/** The exact call the customer app makes on ADD (no storeId). */
async function addItem(ctx: TestContext, session: Session, variantId: string, quantity = 1) {
  return fetch(`${ctx.baseUrl}/cart/items`, {
    method: 'POST',
    headers: authHeaders(session),
    body: JSON.stringify({ variantId, quantity }),
  });
}

describe.skipIf(!runDatabaseE2e)('Logged-in add-to-cart → View Cart pill (seeded DB)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
    await prisma.$connect();

    await cleanupPhones(prisma);
    await seedFixture(prisma);
    await seedExistingCustomer(prisma);

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
      await ctx.prisma.cartItem.deleteMany({ where: { variant: { productId: PRODUCT_ID } } });
      await ctx.prisma.$disconnect();
      await ctx.app.close();
    }
  });

  it('SIGNUP flow: first-time user adds to cart without a storeId and the pill sees the line', async () => {
    const session = await authenticate(ctx, PHONE_SIGNUP);
    expect(session.isNewUser).toBe(true);

    // The app's ADD call — variantId + quantity only, NO storeId.
    const res = await addItem(ctx, session, VARIANT_A);
    expect(res.status).toBe(201);

    const cart = await getCart(ctx, session);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]?.variantId).toBe(VARIANT_A);
    expect(cart.items[0]?.quantity).toBe(1);
    // Server price, never a client-sent one.
    expect(cart.items[0]?.unitPriceInPaise).toBe(2400);
    expect(cart.subtotalInPaise).toBe(2400);
  });

  it('LOGIN flow: returning user adds twice and the pill count accumulates', async () => {
    const session = await authenticate(ctx, PHONE_LOGIN);
    expect(session.isNewUser).toBe(false);

    expect((await addItem(ctx, session, VARIANT_A)).status).toBe(201);
    expect((await addItem(ctx, session, VARIANT_A)).status).toBe(201);

    const cart = await getCart(ctx, session);
    expect(cart.items).toHaveLength(1);
    // addItem on an existing line increments the quantity.
    expect(cart.items[0]?.quantity).toBe(2);
    expect(cart.subtotalInPaise).toBe(2 * 2400);
  });

  it('an explicit storeId keeps working for callers that send one', async () => {
    const session = await authenticate(ctx, PHONE_STOREID);

    const res = await fetch(`${ctx.baseUrl}/cart/items`, {
      method: 'POST',
      headers: authHeaders(session),
      body: JSON.stringify({ variantId: VARIANT_A, storeId: STORE_ID, quantity: 1 }),
    });
    expect(res.status).toBe(201);

    const cart = await getCart(ctx, session);
    expect(cart.items.some((item) => item.variantId === VARIANT_A)).toBe(true);
  });

  it('an unavailable variant is rejected with 400 — no line, no pill', async () => {
    const session = await authenticate(ctx, PHONE_UNAVAILABLE);

    const res = await addItem(ctx, session, VARIANT_UNAVAILABLE);
    // BadRequest: the variant exists but is not sellable — the app stays
    // silent and no pill appears.
    expect(res.status).toBe(400);

    const cart = await getCart(ctx, session);
    expect(cart.items).toHaveLength(0);
  });

  it('unauthenticated adds are rejected — the guest cart is local-only', async () => {
    const res = await fetch(`${ctx.baseUrl}/cart/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variantId: VARIANT_A, quantity: 1 }),
    });
    expect(res.status).toBe(401);
  });
});
