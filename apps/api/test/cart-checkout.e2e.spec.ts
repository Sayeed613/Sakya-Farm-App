import type { INestApplication } from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import configuration from '../src/config/configuration';
/**
 * HTTP-level tests for the cart and checkout endpoints.
 *
 * These boot the real application — routing, the global guards, the Zod
 * validation pipe and the exception filter — against a real database that has
 * been freshly seeded with roles, permissions, one CUSTOMER user, one coupon,
 * and one product with a variant.
 *
 * Because Prisma is real here (not stubbed), the SQL and the Prisma round trips
 * are under test, while the HTTP layer keeps exercised behaviour honest.
 *
 * To keep the seeded baseline stable, each test clears the rows it created at
 * the end. That is simpler and more reliable than per-test transactions when the
 * app owns its own Prisma client globally.
 */

const CUSTOMER_EMAIL = 'checkout-test@sakyafarms.example';
const CUSTOMER_PASSWORD = 'TestPassword123!';
// Every id column in the schema is `@db.Uuid`, so the fixtures use fixed,
// well-formed UUIDs. Fixed ids keep reruns idempotent (each seed is an upsert)
// and make a stray row obvious in the database.
const STORE_ID = 'a1111111-1111-4111-8111-111111111111';
const PRODUCT_ID = 'a2222222-2222-4222-8222-222222222222';
const VARIANT_ID = 'a3333333-3333-4333-8333-333333333333';
const CATEGORY_ID = 'a4444444-4444-4444-8444-444444444444';
const COUPON_CODE = 'CHECKOUT10';
const COUPON_ID = 'a5555555-5555-4555-8555-555555555555';

interface TestContext {
  app: INestApplication;
  prisma: PrismaClient;
  user: { id: string; email: string };
  token: string;
  baseUrl: string;
}

async function createTestUser(prisma: PrismaClient) {
  const passwordHash = await import('@node-rs/argon2').then((m) =>
    m.hash(CUSTOMER_PASSWORD, {
      algorithm: 2,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    })
  );

  const user = await prisma.user.upsert({
    where: { email: CUSTOMER_EMAIL },
    update: { passwordHash, status: 'ACTIVE' },
    create: {
      email: CUSTOMER_EMAIL,
      passwordHash,
      firstName: 'Checkout',
      lastName: 'Test',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });

  const customerRole = await prisma.role.findUniqueOrThrow({ where: { code: 'CUSTOMER' } });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: customerRole.id } },
    update: {},
    create: { userId: user.id, roleId: customerRole.id },
  });

  return user;
}

async function seedTestData(prisma: PrismaClient) {
  const store = await prisma.store.upsert({
    where: { id: STORE_ID },
    update: {},
    create: {
      id: STORE_ID,
      code: 'CHECKOUT-TEST',
      name: 'Checkout Test Store',
    },
  });

  const product = await prisma.product.upsert({
    where: { id: PRODUCT_ID },
    update: {},
    create: {
      id: PRODUCT_ID,
      sourcePlatform: 'MANUAL',
      sourceProductId: 'checkout-test-product',
      sourceHandle: 'checkout-test-product',
      title: 'Checkout Test Mango',
      slug: 'checkout-test-mango',
      status: 'ACTIVE',
      isAvailable: true,
      publishedAt: new Date(),
    },
  });

  const variant = await prisma.productVariant.upsert({
    where: { id: VARIANT_ID },
    update: {},
    create: {
      id: VARIANT_ID,
      productId: product.id,
      title: '1 kg',
      sku: 'CHECKOUT-1KG',
      priceInPaise: 2400,
      currency: 'INR',
      isAvailable: true,
    },
  });

  // The catalogue import owns the real categories; this test creates its own so
  // it does not depend on that import having been run.
  const category = await prisma.category.upsert({
    where: { slug: 'checkout-test-category' },
    update: {},
    create: {
      id: CATEGORY_ID,
      slug: 'checkout-test-category',
      name: 'Checkout Test Category',
    },
  });

  await prisma.productCategory.upsert({
    where: { productId_categoryId: { productId: product.id, categoryId: category.id } },
    update: {},
    create: { productId: product.id, categoryId: category.id, isPrimary: true },
  });

  const coupon = await prisma.coupon.upsert({
    where: { id: COUPON_ID },
    update: {},
    create: {
      id: COUPON_ID,
      code: COUPON_CODE,
      type: 'PERCENTAGE',
      value: 1000,
      minOrderInPaise: 0,
      usageLimit: null,
      perUserLimit: 1,
      isActive: true,
    },
  });

  return { store, variant, coupon };
}

function signIn(user: { id: string; email: string }) {
  // Build a valid access token by minting the same payload the JWT strategy
  // validates. The signing options mirror AuthModule exactly, so a token that
  // the app would reject cannot make these tests pass.
  const config = configuration();
  const jwt = new JwtService({
    secret: config.auth.accessSecret,
    signOptions: {
      algorithm: 'HS256',
      expiresIn: config.auth.accessTtl as unknown as JwtSignOptions['expiresIn'],
      issuer: config.auth.issuer,
      audience: config.auth.audience,
    },
  });

  return jwt.sign({ sub: user.id, typ: 'access' });
}

/**
 * Remove everything a test created for the test customer.
 *
 * Payments restrict deletion of their order, so they must go first — deleting
 * orders ahead of them failed the whole transaction and silently left rows
 * behind for the next test. Order items and status history cascade from the
 * order and need no separate delete.
 */
async function clearTestUserData(prisma: PrismaClient, userId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.cartItem.deleteMany({ where: { cart: { userId } } });
    await tx.cart.deleteMany({ where: { userId } });
    await tx.payment.deleteMany({ where: { order: { userId } } });
    await tx.order.deleteMany({ where: { userId } });
  });
}

describe('Cart and checkout endpoints (seeded DB)', () => {
  let ctx: TestContext;

  // Boots the real application, hashes a password with Argon2id (19 MiB, t=2)
  // and seeds the fixtures. The generous timeout lives in vitest.config.ts.
  beforeAll(async () => {
    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
    await prisma.$connect();

    // Seed the baseline that every test needs, if it does not already exist.
    await seedTestData(prisma);
    const user = await createTestUser(prisma);
    // Start from a clean slate even if an earlier run was interrupted.
    await clearTestUserData(prisma, user.id);
    const token = signIn(user);

    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = module.createNestApplication();
    configureApp(app);
    await app.init();

    // `listen` resolves with the underlying HTTP server, which is the only
    // object that owns `address()` — `getHttpAdapter().getInstance()` returns
    // the Express application, not the server.
    const server = (await app.listen(0)) as { address(): { port: number } | null };
    const port = server.address()?.port ?? 0;

    ctx = { app, prisma, user, token, baseUrl: `http://127.0.0.1:${port}/api/v1` };
  });

  afterAll(async () => {
    await ctx.app.close();
    await ctx.prisma.$disconnect();
  });

  afterEach(async () => {
    // Clear the rows created by this test so the next test starts from the
    // same seeded baseline.
    await clearTestUserData(ctx.prisma, ctx.user.id);
  });

  it('returns the current cart with zero totals for a new user', async () => {
    const res = await fetch(ctx.baseUrl + '/cart', {
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        'Content-Type': 'application/json',
        'x-request-id': 'test-1',
      },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; items: unknown[]; subtotalInPaise: number; totalInPaise: number };
    expect(body.items).toHaveLength(0);
    expect(body.subtotalInPaise).toBe(0);
    expect(body.totalInPaise).toBe(0);
  });

  it('adds an item and recomputes the totals server-side', async () => {
    await fetch(ctx.baseUrl + '/cart/items', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        'Content-Type': 'application/json',
        'x-request-id': 'test-2',
      },
      body: JSON.stringify({
        variantId: VARIANT_ID,
        storeId: STORE_ID,
        quantity: 2,
      }),
    });

    const res = await fetch(ctx.baseUrl + '/cart', {
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        'x-request-id': 'test-2b',
      },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ quantity: number; unitPriceInPaise: number; lineTotalInPaise: number; isAvailable: boolean }>;
      subtotalInPaise: number;
      totalInPaise: number;
      currency: string;
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.quantity).toBe(2);
    expect(body.items[0]!.unitPriceInPaise).toBe(2400);
    expect(body.items[0]!.lineTotalInPaise).toBe(2 * 2400);
    expect(body.subtotalInPaise).toBe(2 * 2400);
    expect(body.totalInPaise).toBe(2 * 2400);
    expect(body.currency).toBe('INR');
  });

  it('rejects an unavailable variant', async () => {
    const res = await fetch(ctx.baseUrl + '/cart/items', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        'Content-Type': 'application/json',
        'x-request-id': 'test-3',
      },
      body: JSON.stringify({
        variantId: '00000000-0000-0000-0000-000000000001',
        storeId: STORE_ID,
        quantity: 1,
      }),
    });

    expect(res.status).toBe(400);
  });

  it('applies a coupon and recomputes the total', async () => {
    await fetch(ctx.baseUrl + '/cart/items', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        'Content-Type': 'application/json',
        'x-request-id': 'test-4',
      },
      body: JSON.stringify({
        variantId: VARIANT_ID,
        storeId: STORE_ID,
        quantity: 1,
      }),
    });

    const couponRes = await fetch(ctx.baseUrl + '/cart/coupon', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        'Content-Type': 'application/json',
        'x-request-id': 'test-4b',
      },
      body: JSON.stringify({
        code: COUPON_CODE,
      }),
    });

    expect(couponRes.status).toBe(200);
    const body = (await couponRes.json()) as {
      coupon: { code: string; type: string };
      discountInPaise: number;
      totalInPaise: number;
    };
    expect(body.coupon).not.toBeNull();
    expect(body.coupon.code).toBe(COUPON_CODE);
    expect(body.discountInPaise).toBe(240);
    expect(body.totalInPaise).toBe(2400 - 240);
  });

  it('places an order with the server-computed totals and a MANUAL PENDING payment', async () => {
    await fetch(ctx.baseUrl + '/cart/items', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        'Content-Type': 'application/json',
        'x-request-id': 'test-5',
      },
      body: JSON.stringify({
        variantId: VARIANT_ID,
        storeId: STORE_ID,
        quantity: 2,
      }),
    });

    const checkoutRes = await fetch(ctx.baseUrl + '/orders', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        'Content-Type': 'application/json',
        'x-request-id': 'test-5b',
      },
      body: JSON.stringify({
        idempotencyKey: 'checkout-key-1',
        shippingAddress: { line1: 'Home', city: 'Bengaluru' },
        billingAddress: null,
        notes: 'Test order',
      }),
    });

    expect(checkoutRes.status).toBe(201);
    const order = (await checkoutRes.json()) as {
      orderNumber: string;
      status: string;
      totalInPaise: number;
      items: Array<{ productTitle: string; variantTitle: string; quantity: number; unitPriceInPaise: number; totalInPaise: number }>;
      payments: Array<{ provider: string; status: string; amountInPaise: number }>;
    };

    expect(order.orderNumber).toMatch(/^ORD-/);
    expect(order.status).toBe('PENDING_PAYMENT');
    // Server recomputes: 2 * 2400 = 4800
    expect(order.totalInPaise).toBe(4800);
    expect(order.items).toHaveLength(1);
    expect(order.items[0]!.productTitle).toBe('Checkout Test Mango');
    expect(order.items[0]!.variantTitle).toBe('1 kg');
    expect(order.items[0]!.quantity).toBe(2);
    expect(order.payments).toHaveLength(1);
    expect(order.payments[0]!.provider).toBe('MANUAL');
    expect(order.payments[0]!.status).toBe('PENDING');
    expect(order.payments[0]!.amountInPaise).toBe(4800);
  });

  it('is idempotent for a retried checkout', async () => {
    await fetch(ctx.baseUrl + '/cart/items', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        'Content-Type': 'application/json',
        'x-request-id': 'test-6',
      },
      body: JSON.stringify({
        variantId: VARIANT_ID,
        storeId: STORE_ID,
        quantity: 1,
      }),
    });

    const first = await fetch(ctx.baseUrl + '/orders', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        'Content-Type': 'application/json',
        'x-request-id': 'test-6a',
      },
      body: JSON.stringify({
        idempotencyKey: 'checkout-key-2',
        shippingAddress: { line1: 'Home', city: 'Bengaluru' },
        billingAddress: null,
        notes: null,
      }),
    });

    expect(first.status).toBe(201);
    const firstOrder = (await first.json()) as { orderNumber: string };

    const second = await fetch(ctx.baseUrl + '/orders', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        'Content-Type': 'application/json',
        'x-request-id': 'test-6b',
      },
      body: JSON.stringify({
        idempotencyKey: 'checkout-key-2',
        shippingAddress: { line1: 'Home', city: 'Bengaluru' },
        billingAddress: null,
        notes: null,
      }),
    });

    expect(second.status).toBe(201);
    const secondOrder = (await second.json()) as { orderNumber: string };
    expect(secondOrder.orderNumber).toBe(firstOrder.orderNumber);
  });

  it('lists the caller own orders', async () => {
    await fetch(ctx.baseUrl + '/cart/items', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        'Content-Type': 'application/json',
        'x-request-id': 'test-7',
      },
      body: JSON.stringify({
        variantId: VARIANT_ID,
        storeId: STORE_ID,
        quantity: 1,
      }),
    });

    await fetch(ctx.baseUrl + '/orders', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        'Content-Type': 'application/json',
        'x-request-id': 'test-7b',
      },
      body: JSON.stringify({
        idempotencyKey: 'checkout-key-3',
        shippingAddress: { line1: 'Home', city: 'Bengaluru' },
        billingAddress: null,
        notes: null,
      }),
    });

    const listRes = await fetch(ctx.baseUrl + '/orders', {
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        'x-request-id': 'test-7c',
      },
    });

    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { items: Array<{ orderNumber: string }>; meta: { total: number } };
    expect(list.items).toHaveLength(1);
    expect(list.meta.total).toBe(1);
  });

  it('can cancel a PENDING_PAYMENT order', async () => {
    await fetch(ctx.baseUrl + '/cart/items', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        'Content-Type': 'application/json',
        'x-request-id': 'test-8',
      },
      body: JSON.stringify({
        variantId: VARIANT_ID,
        storeId: STORE_ID,
        quantity: 1,
      }),
    });

    const placed = await fetch(ctx.baseUrl + '/orders', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        'Content-Type': 'application/json',
        'x-request-id': 'test-8b',
      },
      body: JSON.stringify({
        idempotencyKey: 'checkout-key-4',
        shippingAddress: { line1: 'Home', city: 'Bengaluru' },
        billingAddress: null,
        notes: null,
      }),
    });

    const placedOrder = (await placed.json()) as { id: string };
    const cancelRes = await fetch(ctx.baseUrl + `/orders/${placedOrder.id}/cancel`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        'Content-Type': 'application/json',
        'x-request-id': 'test-8c',
      },
      body: JSON.stringify({
        reason: 'Changed mind',
      }),
    });

    expect(cancelRes.status).toBe(200);
    const cancelled = (await cancelRes.json()) as { status: string; cancelReason: string };
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.cancelReason).toBe('Changed mind');
  });

  it('rejects cancelling an order without a reason', async () => {
    await fetch(ctx.baseUrl + '/cart/items', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        'Content-Type': 'application/json',
        'x-request-id': 'test-9',
      },
      body: JSON.stringify({
        variantId: VARIANT_ID,
        storeId: STORE_ID,
        quantity: 1,
      }),
    });

    const placed = await fetch(ctx.baseUrl + '/orders', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        'Content-Type': 'application/json',
        'x-request-id': 'test-9b',
      },
      body: JSON.stringify({
        idempotencyKey: 'checkout-key-5',
        shippingAddress: { line1: 'Home', city: 'Bengaluru' },
        billingAddress: null,
        notes: null,
      }),
    });

    const placedOrder = (await placed.json()) as { id: string };

    const res = await fetch(ctx.baseUrl + `/orders/${placedOrder.id}/cancel`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        'Content-Type': 'application/json',
        'x-request-id': 'test-9c',
      },
      body: JSON.stringify({
        reason: '',
      }),
    });

    expect(res.status).toBe(400);
  });
});
