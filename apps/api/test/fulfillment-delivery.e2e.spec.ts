import type { INestApplication } from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../src/generated/prisma/client';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import configuration from '../src/config/configuration';

/**
 * HTTP-level tests for the fulfilment half of the order lifecycle:
 *
 *   checkout → store picking → shipment → delivery assignment → partner
 *   transitions → DELIVERED → inventory deducted exactly once.
 *
 * Prisma is real here — the app and the assertions share the E2E database — so
 * the stock arithmetic, the ledger and the state machines are all exercised for
 * real rather than against doubles.
 *
 * Runs only when `RUN_DB_E2E=1` and a disposable `DATABASE_URL` is configured.
 * The fixtures use their own store/product/variant UUIDs so this file cannot
 * interfere with `cart-checkout.e2e.spec.ts` when the two run in parallel.
 */

const CUSTOMER_EMAIL = 'fulfilment-test@sakyafarms.example';
const STORE_MANAGER_EMAIL = 'fulfilment-store-manager@sakyafarms.example';
const ADMIN_EMAIL = 'fulfilment-admin@sakyafarms.example';
const PARTNER_EMAIL = 'fulfilment-partner@sakyafarms.example';
const OTHER_PARTNER_EMAIL = 'fulfilment-other-partner@sakyafarms.example';
const PASSWORD = 'TestPassword123!';

const STORE_ID = 'b1111111-1111-4111-8111-111111111111';
const PRODUCT_ID = 'b2222222-2222-4222-8222-222222222222';
const VARIANT_ID = 'b3333333-3333-4333-8333-333333333333';
const CATEGORY_ID = 'b4444444-4444-4444-8444-444444444444';

const INITIAL_STOCK = 10;
const ORDERED_QUANTITY = 2;

interface Actor {
  id: string;
  email: string;
  token: string;
}

interface TestContext {
  app: INestApplication;
  prisma: PrismaClient;
  baseUrl: string;
  customer: Actor;
  storeManager: Actor;
  admin: Actor;
  partner: Actor;
  otherPartner: Actor;
}

const runDatabaseE2e = process.env.RUN_DB_E2E === '1';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function passwordHash(): Promise<string> {
  const { hash } = await import('@node-rs/argon2');
  return hash(PASSWORD, { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

async function upsertActor(
  prisma: PrismaClient,
  email: string,
  roleCode: 'CUSTOMER' | 'STORE_MANAGER' | 'ADMIN' | 'DELIVERY_PARTNER',
  hash: string,
) {
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash: hash, status: 'ACTIVE' },
    create: {
      email,
      passwordHash: hash,
      firstName: email.split('@')[0]!.split('-')[0] ?? 'Test',
      lastName: 'Fulfilment',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });

  const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    update: {},
    create: { userId: user.id, roleId: role.id },
  });

  return user;
}

async function seedTestData(prisma: PrismaClient) {
  const store = await prisma.store.upsert({
    where: { id: STORE_ID },
    update: { isActive: true },
    create: {
      id: STORE_ID,
      code: 'FULFILMENT-TEST',
      name: 'Fulfilment Test Store',
      city: 'Bengaluru',
      isActive: true,
    },
  });

  const product = await prisma.product.upsert({
    where: { id: PRODUCT_ID },
    update: {},
    create: {
      id: PRODUCT_ID,
      sourcePlatform: 'MANUAL',
      sourceProductId: 'fulfilment-test-product',
      sourceHandle: 'fulfilment-test-product',
      title: 'Fulfilment Test Ghee',
      slug: 'fulfilment-test-ghee',
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
      title: '500 ml',
      sku: 'FULFILMENT-500ML',
      priceInPaise: 2400,
      currency: 'INR',
      isAvailable: true,
    },
  });

  const category = await prisma.category.upsert({
    where: { slug: 'fulfilment-test-category' },
    update: {},
    create: {
      id: CATEGORY_ID,
      slug: 'fulfilment-test-category',
      name: 'Fulfilment Test Category',
    },
  });

  await prisma.productCategory.upsert({
    where: { productId_categoryId: { productId: product.id, categoryId: category.id } },
    update: {},
    create: { productId: product.id, categoryId: category.id, isPrimary: true },
  });

  return { store, variant };
}

/** Put the store's stock and its ledger back to the seeded baseline. */
async function resetInventory(prisma: PrismaClient) {
  await prisma.inventoryMovement.deleteMany({
    where: { variantId: VARIANT_ID, storeId: STORE_ID },
  });
  await prisma.inventory.upsert({
    where: { variantId_storeId: { variantId: VARIANT_ID, storeId: STORE_ID } },
    update: { quantityOnHand: INITIAL_STOCK, quantityReserved: 0, reorderLevel: 2 },
    create: {
      variantId: VARIANT_ID,
      storeId: STORE_ID,
      quantityOnHand: INITIAL_STOCK,
      quantityReserved: 0,
      reorderLevel: 2,
    },
  });
}

/**
 * Remove everything a test created for its customer.
 *
 * Shipments, delivery assignments and status history cascade from the order, but
 * payments restrict it, so they go first. The order delete is also what keeps
 * the "one active assignment per order" conflict from leaking across specs.
 */
async function clearCustomerData(prisma: PrismaClient, customerId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.cartItem.deleteMany({ where: { cart: { userId: customerId } } });
    await tx.cart.deleteMany({ where: { userId: customerId } });
    await tx.payment.deleteMany({ where: { order: { userId: customerId } } });
    await tx.order.deleteMany({ where: { userId: customerId } });
  });

  await resetInventory(prisma);
}

function signIn(user: { id: string }): string {
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

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function api(ctx: TestContext) {
  const call = (actor: Actor) => ({
    async get(path: string) {
      return fetch(ctx.baseUrl + path, {
        headers: { Authorization: `Bearer ${actor.token}` },
      });
    },
    async post(path: string, body: unknown) {
      return fetch(ctx.baseUrl + path, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${actor.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    },
    async patch(path: string, body: unknown) {
      return fetch(ctx.baseUrl + path, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${actor.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    },
  });

  return {
    customer: call(ctx.customer),
    storeManager: call(ctx.storeManager),
    admin: call(ctx.admin),
    partner: call(ctx.partner),
    otherPartner: call(ctx.otherPartner),
  };
}

/** Add the fixture variant to the cart, then place the order. */
async function placeOrder(ctx: TestContext, idempotencyKey: string) {
  const http = api(ctx);

  const added = await http.customer.post('/cart/items', {
    variantId: VARIANT_ID,
    storeId: STORE_ID,
    quantity: ORDERED_QUANTITY,
  });
  expect(added.status).toBe(201);

  const placed = await http.customer.post('/orders', {
    idempotencyKey,
    shippingAddress: { line1: 'Home', city: 'Bengaluru' },
    billingAddress: null,
    notes: 'Fulfilment test',
  });
  expect(placed.status).toBe(201);

  return (await placed.json()) as { id: string; orderNumber: string; status: string };
}

/** Walk the store-side picking transitions up to READY_FOR_PICKUP. */
async function advanceToReadyForPickup(ctx: TestContext, orderId: string) {
  const http = api(ctx);

  for (const status of ['CONFIRMED', 'PROCESSING', 'PACKED', 'READY_FOR_PICKUP'] as const) {
    const res = await http.storeManager.patch(`/stores/${STORE_ID}/orders/${orderId}/status`, {
      status,
      reason: `Store set ${status}`,
    });
    expect(res.status, `transition to ${status}`).toBe(200);
  }
}

/** Create the shipment for the order and assign the partner. */
async function dispatch(ctx: TestContext, orderId: string) {
  const http = api(ctx);

  const shipmentRes = await http.admin.post(`/admin/orders/${orderId}/shipment`, {
    carrier: 'Sakya Logistics',
  });
  expect(shipmentRes.status).toBe(201);
  const shipment = (await shipmentRes.json()) as { id: string; orderId: string; status: string };

  const assignRes = await http.admin.post(`/admin/orders/${orderId}/assign`, {
    deliveryPartnerUserId: ctx.partner.id,
  });
  expect(assignRes.status).toBe(201);
  const assignment = (await assignRes.json()) as {
    id: string;
    orderId: string;
    shipmentId: string | null;
    status: string;
  };

  return { shipment, assignment };
}

function readInventory(prisma: PrismaClient) {
  return prisma.inventory.findUniqueOrThrow({
    where: { variantId_storeId: { variantId: VARIANT_ID, storeId: STORE_ID } },
  });
}

function countMovements(
  prisma: PrismaClient,
  type: 'SALE' | 'RESERVATION' | 'RESERVATION_RELEASE',
  orderId?: string,
) {
  return prisma.inventoryMovement.count({
    where: {
      variantId: VARIANT_ID,
      storeId: STORE_ID,
      type,
      ...(orderId === undefined ? {} : { referenceId: orderId }),
    },
  });
}

describe.skipIf(!runDatabaseE2e)('Order fulfilment to delivery (seeded DB)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
    await prisma.$connect();

    await seedTestData(prisma);
    await resetInventory(prisma);

    const hash = await passwordHash();
    const customer = await upsertActor(prisma, CUSTOMER_EMAIL, 'CUSTOMER', hash);
    const storeManager = await upsertActor(prisma, STORE_MANAGER_EMAIL, 'STORE_MANAGER', hash);
    const admin = await upsertActor(prisma, ADMIN_EMAIL, 'ADMIN', hash);
    const partner = await upsertActor(prisma, PARTNER_EMAIL, 'DELIVERY_PARTNER', hash);
    const otherPartner = await upsertActor(prisma, OTHER_PARTNER_EMAIL, 'DELIVERY_PARTNER', hash);

    // Store-scoped access is a separate membership row, not just a platform role.
    await prisma.storeStaff.upsert({
      where: { storeId_userId: { storeId: STORE_ID, userId: storeManager.id } },
      update: { role: 'STORE_MANAGER', isActive: true },
      create: {
        storeId: STORE_ID,
        userId: storeManager.id,
        role: 'STORE_MANAGER',
        isActive: true,
      },
    });

    await clearCustomerData(prisma, customer.id);

    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = module.createNestApplication();
    configureApp(app);
    await app.init();

    const server = (await app.listen(0)) as { address(): { port: number } | null };
    const port = server.address()?.port ?? 0;

    ctx = {
      app,
      prisma,
      baseUrl: `http://127.0.0.1:${port}/api/v1`,
      customer: { id: customer.id, email: CUSTOMER_EMAIL, token: signIn(customer) },
      storeManager: {
        id: storeManager.id,
        email: STORE_MANAGER_EMAIL,
        token: signIn(storeManager),
      },
      admin: { id: admin.id, email: ADMIN_EMAIL, token: signIn(admin) },
      partner: { id: partner.id, email: PARTNER_EMAIL, token: signIn(partner) },
      otherPartner: {
        id: otherPartner.id,
        email: OTHER_PARTNER_EMAIL,
        token: signIn(otherPartner),
      },
    };
  });

  afterAll(async () => {
    // Remove this suite's fixtures so the shared dev/staging catalog never
    // shows test rows to real customers. Orders cascade; the rest is explicit.
    if (ctx) {
      await ctx.prisma.cartItem.deleteMany({ where: { variant: { productId: PRODUCT_ID } } });
      await ctx.prisma.productCategory.deleteMany({ where: { productId: PRODUCT_ID } });
      await ctx.prisma.productVariant.deleteMany({ where: { productId: PRODUCT_ID } });
      await ctx.prisma.product.deleteMany({ where: { id: PRODUCT_ID } });
      await ctx.prisma.category.deleteMany({ where: { slug: 'fulfilment-test-category' } });
    }
    await ctx?.app.close();
    await ctx?.prisma.$disconnect();
  });

  afterEach(async () => {
    if (ctx !== undefined) await clearCustomerData(ctx.prisma, ctx.customer.id);
  });

  it('runs checkout → picking → shipment → assignment → delivery and deducts stock exactly once', async () => {
    const http = api(ctx);
    const order = await placeOrder(ctx, 'fulfilment-key-1');

    // Checkout holds the stock.
    let inventory = await readInventory(ctx.prisma);
    expect(inventory.quantityOnHand).toBe(INITIAL_STOCK);
    expect(inventory.quantityReserved).toBe(ORDERED_QUANTITY);

    await advanceToReadyForPickup(ctx, order.id);
    expect(
      (await ctx.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status,
    ).toBe('READY_FOR_PICKUP');

    const { shipment, assignment } = await dispatch(ctx, order.id);

    // One shipment, carrying the right order.
    const shipments = await ctx.prisma.shipment.findMany({ where: { orderId: order.id } });
    expect(shipments).toHaveLength(1);
    expect(shipment.orderId).toBe(order.id);

    // The order knows the store that is actually fulfilling it.
    const orderRow = await ctx.prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: true },
    });
    expect(orderRow.storeId).toBe(STORE_ID);
    expect(orderRow.items[0]!.variantId).toBe(VARIANT_ID);

    // …and the assignment points at that shipment and that partner.
    expect(assignment.shipmentId).toBe(shipment.id);
    expect(assignment.orderId).toBe(order.id);
    expect(assignment.status).toBe('ASSIGNED');

    // Partner lifecycle.
    for (const status of ['ACCEPTED', 'PICKED_UP'] as const) {
      const res = await http.partner.patch(`/delivery/assignments/${assignment.id}`, { status });
      expect(res.status, `partner transition to ${status}`).toBe(200);
    }

    const deliveredRes = await http.partner.patch(`/delivery/assignments/${assignment.id}`, {
      status: 'DELIVERED',
    });
    expect(deliveredRes.status).toBe(200);

    // Delivery completion closes the order…
    const finalOrder = await ctx.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(finalOrder.status).toBe('DELIVERED');
    expect(finalOrder.deliveredAt).not.toBeNull();

    const finalShipment = await ctx.prisma.shipment.findUniqueOrThrow({
      where: { id: shipment.id },
    });
    expect(finalShipment.status).toBe('DELIVERED');

    const finalAssignment = await ctx.prisma.deliveryAssignment.findUniqueOrThrow({
      where: { id: assignment.id },
    });
    expect(finalAssignment.status).toBe('DELIVERED');
    expect(finalAssignment.deliveredAt).not.toBeNull();

    // …and takes the stock out of inventory, exactly once.
    inventory = await readInventory(ctx.prisma);
    expect(inventory.quantityOnHand).toBe(INITIAL_STOCK - ORDERED_QUANTITY);
    expect(inventory.quantityReserved).toBe(0);

    const sales = await ctx.prisma.inventoryMovement.findMany({
      where: { variantId: VARIANT_ID, storeId: STORE_ID, type: 'SALE' },
    });
    expect(sales).toHaveLength(1);
    expect(sales[0]!.quantityDelta).toBe(-ORDERED_QUANTITY);
    expect(sales[0]!.quantityAfter).toBe(INITIAL_STOCK - ORDERED_QUANTITY);
    expect(sales[0]!.referenceId).toBe(order.id);

    // The order's own audit trail records the closing transition.
    const deliveredHistory = await ctx.prisma.orderStatusHistory.findMany({
      where: { orderId: order.id, toStatus: 'DELIVERED' },
    });
    expect(deliveredHistory).toHaveLength(1);
    expect(deliveredHistory[0]!.fromStatus).toBe('READY_FOR_PICKUP');
  });

  it('rejects invalid delivery transitions and cannot deduct twice after delivery', async () => {
    const http = api(ctx);
    const order = await placeOrder(ctx, 'fulfilment-key-2');
    await advanceToReadyForPickup(ctx, order.id);
    const { shipment, assignment } = await dispatch(ctx, order.id);

    // ASSIGNED → PICKED_UP skips acceptance.
    const skipped = await http.partner.patch(`/delivery/assignments/${assignment.id}`, {
      status: 'PICKED_UP',
    });
    expect(skipped.status).toBe(400);
    expect(
      (await ctx.prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: assignment.id } }))
        .status,
    ).toBe('ASSIGNED');

    await http.partner.patch(`/delivery/assignments/${assignment.id}`, { status: 'ACCEPTED' });
    await http.partner.patch(`/delivery/assignments/${assignment.id}`, { status: 'PICKED_UP' });
    const delivered = await http.partner.patch(`/delivery/assignments/${assignment.id}`, {
      status: 'DELIVERED',
    });
    expect(delivered.status).toBe(200);

    // DELIVERED is terminal: a repeat is refused and must not move stock again.
    const repeat = await http.partner.patch(`/delivery/assignments/${assignment.id}`, {
      status: 'DELIVERED',
    });
    expect(repeat.status).toBe(400);

    const inventory = await readInventory(ctx.prisma);
    expect(inventory.quantityOnHand).toBe(INITIAL_STOCK - ORDERED_QUANTITY);
    expect(await countMovements(ctx.prisma, 'SALE', order.id)).toBe(1);
    expect(
      await ctx.prisma.orderStatusHistory.count({
        where: { orderId: order.id, toStatus: 'DELIVERED' },
      }),
    ).toBe(1);
    expect(shipment.id).toBe(assignment.shipmentId);
  });

  it('refuses a second partner and a second shipment for the same order', async () => {
    const http = api(ctx);
    const order = await placeOrder(ctx, 'fulfilment-key-3');
    await advanceToReadyForPickup(ctx, order.id);
    const { shipment, assignment } = await dispatch(ctx, order.id);

    // Another partner cannot drive someone else's delivery.
    const foreign = await http.otherPartner.patch(`/delivery/assignments/${assignment.id}`, {
      status: 'ACCEPTED',
    });
    expect(foreign.status).toBe(409);
    expect(
      (await ctx.prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: assignment.id } }))
        .status,
    ).toBe('ASSIGNED');

    // One shipment per order.
    const duplicateShipment = await http.admin.post(`/admin/orders/${order.id}/shipment`, {
      carrier: 'Other Carrier',
    });
    expect(duplicateShipment.status).toBe(409);
    expect(await ctx.prisma.shipment.count({ where: { orderId: order.id } })).toBe(1);

    // One active assignment per order.
    const duplicateAssignment = await http.admin.post(`/admin/orders/${order.id}/assign`, {
      deliveryPartnerUserId: ctx.otherPartner.id,
    });
    expect(duplicateAssignment.status).toBe(409);
    expect(await ctx.prisma.deliveryAssignment.count({ where: { orderId: order.id } })).toBe(1);
    expect(shipment.id).toBe(assignment.shipmentId);
  });

  it('cannot oversell stock when two delivery completions race', async () => {
    const http = api(ctx);
    const order = await placeOrder(ctx, 'fulfilment-key-4');
    await advanceToReadyForPickup(ctx, order.id);
    const { assignment } = await dispatch(ctx, order.id);

    await http.partner.patch(`/delivery/assignments/${assignment.id}`, { status: 'ACCEPTED' });
    await http.partner.patch(`/delivery/assignments/${assignment.id}`, { status: 'PICKED_UP' });

    // Two simultaneous completions of the same delivery.
    const [first, second] = await Promise.all([
      http.partner.patch(`/delivery/assignments/${assignment.id}`, { status: 'DELIVERED' }),
      http.partner.patch(`/delivery/assignments/${assignment.id}`, { status: 'DELIVERED' }),
    ]);

    // Either both converge on the same terminal state or the loser is refused —
    // but the outcome must never be a server error.
    expect(first.status).toBeLessThan(500);
    expect(second.status).toBeLessThan(500);

    const inventory = await readInventory(ctx.prisma);
    expect(inventory.quantityOnHand).toBe(INITIAL_STOCK - ORDERED_QUANTITY);
    expect(inventory.quantityReserved).toBe(0);
    expect(await countMovements(ctx.prisma, 'SALE', order.id)).toBe(1);
  });

  it('cancels the order without leaking stock when the delivery is cancelled', async () => {
    const http = api(ctx);
    const order = await placeOrder(ctx, 'fulfilment-key-5');
    await advanceToReadyForPickup(ctx, order.id);
    const { assignment } = await dispatch(ctx, order.id);

    const cancelled = await http.admin.patch(`/admin/assignments/${assignment.id}/cancel`, {
      reason: 'Customer unreachable',
    });
    expect(cancelled.status).toBe(200);

    // A failed delivery does not consume stock: the order is still open, so its
    // hold must remain, and nothing may be recorded as sold.
    let inventory = await readInventory(ctx.prisma);
    expect(inventory.quantityReserved).toBe(ORDERED_QUANTITY);
    expect(await countMovements(ctx.prisma, 'SALE', order.id)).toBe(0);

    // Cancelling the order itself does release the hold, exactly once.
    const orderCancelled = await http.customer.post(`/orders/${order.id}/cancel`, {
      reason: 'Changed mind',
    });
    expect(orderCancelled.status).toBe(200);

    inventory = await readInventory(ctx.prisma);
    expect(inventory.quantityOnHand).toBe(INITIAL_STOCK);
    expect(inventory.quantityReserved).toBe(0);
    expect(await countMovements(ctx.prisma, 'RESERVATION_RELEASE', order.id)).toBe(1);
    expect(await countMovements(ctx.prisma, 'SALE', order.id)).toBe(0);
  });

  it('enforces store-scoped order access and store picking rules', async () => {
    const http = api(ctx);
    const order = await placeOrder(ctx, 'fulfilment-key-6');

    // The customer cannot use store order endpoints.
    const asCustomer = await http.customer.get(`/stores/${STORE_ID}/orders`);
    expect(asCustomer.status).toBe(403);

    // The store can only move the order through picking states.
    const deliveryOwned = await http.storeManager.patch(
      `/stores/${STORE_ID}/orders/${order.id}/status`,
      { status: 'DELIVERED' },
    );
    expect(deliveryOwned.status).toBe(400);

    // …and cannot skip a step.
    const skipped = await http.storeManager.patch(
      `/stores/${STORE_ID}/orders/${order.id}/status`,
      { status: 'READY_FOR_PICKUP' },
    );
    expect(skipped.status).toBe(400);

    // The store can see its own order and the reserved stock.
    const list = await http.storeManager.get(`/stores/${STORE_ID}/orders`);
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { items: Array<{ id: string }> };
    expect(listed.items.some((item) => item.id === order.id)).toBe(true);

    // A store the manager is not a member of stays off limits.
    const otherStore = await http.storeManager.get(
      '/stores/a1111111-1111-4111-8111-111111111111/orders',
    );
    expect(otherStore.status).toBe(403);
  });
});
