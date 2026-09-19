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
  user: { id: string; email: string | null };
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

  // Inventory is per (variant, store) and must exist before checkout can
  // reserve stock. This must run *after* the variant is created — referencing
  // `variant.id` above its declaration threw a temporal-dead-zone
  // `ReferenceError` and skipped the whole suite.
  await prisma.inventory.upsert({
    where: {
      variantId_storeId: {
        variantId: variant.id,
        storeId: store.id,
      },
    },
    update: {
      quantityOnHand: 10,
      quantityReserved: 0,
      reorderLevel: 2,
    },
    create: {
      variantId: variant.id,
      storeId: store.id,
      quantityOnHand: 10,
      quantityReserved: 0,
      reorderLevel: 2,
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

function signIn(user: { id: string; email: string | null }) {
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

  // Checkout holds stock (it writes `quantityReserved`), and deleting an order
  // does not give that stock back. Without restoring the fixture, reservations
  // accumulate across the specs in this file and a later test fails on
  // starvation caused by an earlier one. The ledger rows are cleared with the
  // counters so every spec starts from a truly identical baseline.
  await prisma.inventoryMovement.deleteMany({
    where: { variantId: VARIANT_ID, storeId: STORE_ID },
  });
  // Upsert rather than update: one spec deliberately removes the stock row to
  // prove checkout refuses an unconfigured variant, and the baseline has to
  // come back afterwards whatever order the specs run in.
  await prisma.inventory.upsert({
    where: { variantId_storeId: { variantId: VARIANT_ID, storeId: STORE_ID } },
    update: { quantityOnHand: 10, quantityReserved: 0 },
    create: {
      variantId: VARIANT_ID,
      storeId: STORE_ID,
      quantityOnHand: 10,
      quantityReserved: 0,
      reorderLevel: 2,
    },
  });
}

/** Read the fixture's inventory row — the source of truth for stock assertions. */
function readInventory(prisma: PrismaClient) {
  return prisma.inventory.findUniqueOrThrow({
    where: { variantId_storeId: { variantId: VARIANT_ID, storeId: STORE_ID } },
  });
}

/**
 * These specs own a real Nest app and write real rows, so they only run when a
 * disposable database has been designated for them. Without the guard,
 * `pnpm test` would seed fixtures into whatever `DATABASE_URL` happens to be
 * configured (a shared database included).
 */
const runDatabaseE2e = process.env.RUN_DB_E2E === '1';

describe.skipIf(!runDatabaseE2e)('Cart and checkout endpoints (seeded DB)', () => {
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
    // `ctx` is absent when `beforeAll` failed; guard so the real cause is not
    // buried under a second "cannot read properties of undefined" error.
    if (ctx) {
      // Remove this suite's fixtures so the shared catalog never shows test rows.
      await ctx.prisma.cartItem.deleteMany({ where: { variant: { productId: PRODUCT_ID } } });
      await ctx.prisma.productCategory.deleteMany({ where: { productId: PRODUCT_ID } });
      await ctx.prisma.productVariant.deleteMany({ where: { productId: PRODUCT_ID } });
      await ctx.prisma.product.deleteMany({ where: { id: PRODUCT_ID } });
      await ctx.prisma.category.deleteMany({ where: { slug: 'checkout-test-category' } });
    }
    await ctx?.app.close();
    await ctx?.prisma.$disconnect();
  });

  afterEach(async () => {
    // Clear the rows created by this test so the next test starts from the
    // same seeded baseline.
    if (ctx !== undefined) await clearTestUserData(ctx.prisma, ctx.user.id);
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
      id: string;
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

    // The order must persist the fulfilment store and the variant, or the stock
    // it holds could never be released against the right row.
    const persisted = await ctx.prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: true },
    });
    expect(persisted.storeId).toBe(STORE_ID);
    expect(persisted.couponId).toBeNull();
    expect(persisted.items).toHaveLength(1);
    expect(persisted.items[0]!.variantId).toBe(VARIANT_ID);

    // Stock is *held* at checkout, not consumed: reserved goes up by the ordered
    // quantity while on-hand is untouched.
    const inventory = await readInventory(ctx.prisma);
    expect(inventory.quantityOnHand).toBe(10);
    expect(inventory.quantityReserved).toBe(2);

    const reservation = await ctx.prisma.inventoryMovement.findFirst({
      where: { variantId: VARIANT_ID, storeId: STORE_ID, type: 'RESERVATION' },
    });
    expect(reservation).not.toBeNull();
    expect(reservation!.quantityDelta).toBe(2);
    expect(reservation!.referenceId).toBe(order.id);
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
    const firstOrder = (await first.json()) as { id: string; orderNumber: string };

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
    const secondOrder = (await second.json()) as { id: string; orderNumber: string };
    expect(secondOrder.orderNumber).toBe(firstOrder.orderNumber);
    expect(secondOrder.id).toBe(firstOrder.id);

    // The retry must not re-reserve: one order, one reservation movement, and
    // reserved stock equal to a single quantity.
    const reservations = await ctx.prisma.inventoryMovement.findMany({
      where: {
        variantId: VARIANT_ID,
        storeId: STORE_ID,
        type: 'RESERVATION',
        referenceId: firstOrder.id,
      },
    });
    expect(reservations).toHaveLength(1);

    const orders = await ctx.prisma.order.count({ where: { userId: ctx.user.id } });
    expect(orders).toBe(1);

    const inventory = await readInventory(ctx.prisma);
    expect(inventory.quantityReserved).toBe(1);
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

    expect(placed.status).toBe(201);
    expect(cancelRes.status).toBe(200);
    const cancelled = (await cancelRes.json()) as { status: string; cancelReason: string };
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.cancelReason).toBe('Changed mind');

    // Cancelling gives the held stock back, exactly once.
    const inventory = await readInventory(ctx.prisma);
    expect(inventory.quantityOnHand).toBe(10);
    expect(inventory.quantityReserved).toBe(0);

    const release = await ctx.prisma.inventoryMovement.findFirst({
      where: {
        variantId: VARIANT_ID,
        storeId: STORE_ID,
        type: 'RESERVATION_RELEASE',
        referenceId: placedOrder.id,
      },
    });
    expect(release).not.toBeNull();
    expect(release!.quantityDelta).toBe(-1);
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

  it('refuses checkout when the store does not have enough available stock', async () => {
    // One unit available, two ordered. On-hand is left above zero so the failure
    // is specifically the availability check, not a missing row.
    await ctx.prisma.inventory.updateMany({
      where: { variantId: VARIANT_ID, storeId: STORE_ID },
      data: { quantityOnHand: 1, quantityReserved: 0 },
    });

    const addRes = await fetch(ctx.baseUrl + '/cart/items', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        'Content-Type': 'application/json',
        'x-request-id': 'test-10',
      },
      body: JSON.stringify({
        variantId: VARIANT_ID,
        storeId: STORE_ID,
        quantity: 2,
      }),
    });
    expect(addRes.status).toBe(201);

    const res = await fetch(ctx.baseUrl + '/orders', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        'Content-Type': 'application/json',
        'x-request-id': 'test-10b',
      },
      body: JSON.stringify({
        idempotencyKey: 'checkout-key-short',
        shippingAddress: { line1: 'Home', city: 'Bengaluru' },
        billingAddress: null,
        notes: null,
      }),
    });

    expect(res.status).toBe(409);

    // The whole transaction rolled back: no order, no payment, no reservation.
    expect(await ctx.prisma.order.count({ where: { userId: ctx.user.id } })).toBe(0);
    expect(await ctx.prisma.payment.count({ where: { order: { userId: ctx.user.id } } })).toBe(0);

    const inventory = await readInventory(ctx.prisma);
    expect(inventory.quantityOnHand).toBe(1);
    expect(inventory.quantityReserved).toBe(0);

    const reservations = await ctx.prisma.inventoryMovement.count({
      where: { variantId: VARIANT_ID, storeId: STORE_ID, type: 'RESERVATION' },
    });
    expect(reservations).toBe(0);
  });

  it('refuses checkout when no stock is configured for the variant at the store', async () => {
    // Stock must be configured before a variant can be sold from a store.
    await ctx.prisma.inventoryMovement.deleteMany({
      where: { variantId: VARIANT_ID, storeId: STORE_ID },
    });
    await ctx.prisma.inventory.deleteMany({
      where: { variantId: VARIANT_ID, storeId: STORE_ID },
    });

    const addRes = await fetch(ctx.baseUrl + '/cart/items', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        'Content-Type': 'application/json',
        'x-request-id': 'test-11',
      },
      body: JSON.stringify({
        variantId: VARIANT_ID,
        storeId: STORE_ID,
        quantity: 1,
      }),
    });
    expect(addRes.status).toBe(201);

    const res = await fetch(ctx.baseUrl + '/orders', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        'Content-Type': 'application/json',
        'x-request-id': 'test-11b',
      },
      body: JSON.stringify({
        idempotencyKey: 'checkout-key-nostock',
        shippingAddress: { line1: 'Home', city: 'Bengaluru' },
        billingAddress: null,
        notes: null,
      }),
    });

    expect(res.status).toBe(409);
    expect(await ctx.prisma.order.count({ where: { userId: ctx.user.id } })).toBe(0);
  });

  it('cannot oversell the same variant when two checkouts race', async () => {
    // Exactly one unit is available, and both requests ask for that one unit.
    await ctx.prisma.inventory.updateMany({
      where: { variantId: VARIANT_ID, storeId: STORE_ID },
      data: { quantityOnHand: 1, quantityReserved: 0 },
    });

    await fetch(ctx.baseUrl + '/cart/items', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        'Content-Type': 'application/json',
        'x-request-id': 'test-12',
      },
      body: JSON.stringify({
        variantId: VARIANT_ID,
        storeId: STORE_ID,
        quantity: 1,
      }),
    });

    const checkout = (key: string) =>
      fetch(ctx.baseUrl + '/orders', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ctx.token}`,
          'Content-Type': 'application/json',
          'x-request-id': key,
        },
        body: JSON.stringify({
          idempotencyKey: key,
          shippingAddress: { line1: 'Home', city: 'Bengaluru' },
          billingAddress: null,
          notes: null,
        }),
      });

    // Distinct idempotency keys, so these are two genuinely separate attempts to
    // buy the same single unit — not a retry of one attempt.
    const [first, second] = await Promise.all([
      checkout('race-key-1'),
      checkout('race-key-2'),
    ]);
    const statuses = [first.status, second.status].sort((a, b) => a - b);

    // Exactly one wins. The loser is rejected on availability rather than the
    // stock being promised twice — this is the conditional UPDATE doing its job.
    expect(statuses).toEqual([201, 409]);

    const inventory = await readInventory(ctx.prisma);
    expect(inventory.quantityOnHand).toBe(1);
    expect(inventory.quantityReserved).toBe(1);

    expect(await ctx.prisma.order.count({ where: { userId: ctx.user.id } })).toBe(1);
    const reservations = await ctx.prisma.inventoryMovement.count({
      where: { variantId: VARIANT_ID, storeId: STORE_ID, type: 'RESERVATION' },
    });
    expect(reservations).toBe(1);
  });
});
