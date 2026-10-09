import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  ORDER_EXPIRY_JOB,
  releaseJobLock,
  tryAcquireJobLock,
} from '../src/common/job-lock';
import { PrismaClient } from '../src/generated/prisma/client';
import { OrderExpiryService } from '../src/modules/orders/order-expiry.service';

/**
 * Step 11 — order-expiry overlap safety, proven against PostgreSQL.
 *
 * The unit specs pin the business ladder (money never cancelled, idempotent
 * transitions); this suite pins the claim that CANNOT come from a mock:
 * "two API instances cannot run this job simultaneously". Each side here is a
 * SEPARATE PrismaClient — its own connection pool, exactly like two containers
 * behind a load balancer — contending for the same `job_locks` row.
 *
 * Runs only when `RUN_DB_E2E=1` and a disposable `DATABASE_URL` is configured
 * (same convention as the other DB e2e specs).
 */

const runDatabaseE2e = process.env.RUN_DB_E2E === '1';

// Fixture ids — fixed UUIDs keep reruns idempotent; the EXP-TEST- order-number
// prefix scopes the sweep and the cleanup to rows this suite created.
const USER_EMAIL = 'order-expiry-e2e@sakyafarms.example';
const STORE_ID = 'e1111111-1111-4111-8111-111111111111';
const PRODUCT_ID = 'e2111111-2222-4222-8222-222222222222';
const VARIANT_ID = 'e3111111-3333-4333-8333-333333333333';
const ORDER_A_ID = 'e4111111-4444-4444-8444-444444444444'; // unpaid → expires
const ORDER_B_ID = 'e5111111-5555-4555-8555-555555555555'; // CAPTURED money → survives
const ORDER_C_ID = 'e6111111-6666-4666-8666-666666666666'; // crash-retry case

/**
 * The suite runs the REAL sweep, so its candidate query must not see the
 * database's other rows. A huge expiry window pushes the cutoff ~694 days into
 * the past and the fixtures are seeded even older, so only this suite's orders
 * are eligible — and the pre-flight assertion below fails loudly if any
 * stranger order would match.
 */
const EXPIRY_MINUTES = 1_000_000;
const ANTIQUE = new Date(Date.now() - 700 * 24 * 60 * 60 * 1000);

function makeService(client: PrismaClient) {
  // The gateway is external to this suite: reconcile answers "no decisive
  // outcome" and webhook application is observed, never executed for real.
  const payments = {
    processWebhookEvent: vi.fn(async () => ({})),
    reconcilePayment: vi.fn(async () => null),
  };
  const config = { get: vi.fn(() => EXPIRY_MINUTES) };
  const service = new OrderExpiryService(client as never, config as never, payments as never);
  return { service, payments };
}

/** Watch a run's logger for the lock-held skip (the loser's signature). */
function watchLockSkips(instance: object) {
  const logger = (instance as unknown as { logger: { warn: (...args: unknown[]) => void } })
    .logger;
  return vi.spyOn(logger, 'warn');
}

function lockSkipCount(spy: ReturnType<typeof watchLockSkips>): number {
  return spy.mock.calls.filter((call) => String(call[0]).includes('job lock held')).length;
}

describe.skipIf(!runDatabaseE2e)('Order expiry concurrency (seeded PostgreSQL)', () => {
  let dbA: PrismaClient;
  let dbB: PrismaClient;
  let userId: string;

  async function cleanup(): Promise<void> {
    await dbA.jobLock.deleteMany({ where: { name: ORDER_EXPIRY_JOB } });
    await dbA.payment.deleteMany({
      where: { order: { orderNumber: { startsWith: 'EXP-TEST-' } } },
    });
    await dbA.order.deleteMany({ where: { orderNumber: { startsWith: 'EXP-TEST-' } } });
    await dbA.inventoryMovement.deleteMany({ where: { referenceId: { in: [ORDER_A_ID, ORDER_B_ID, ORDER_C_ID] } } });
    // updateMany (not upsert): this runs BEFORE the product/variant are
    // seeded, so an insert would violate the variant FK on a fresh database.
    await dbA.inventory.updateMany({
      where: { variantId: VARIANT_ID, storeId: STORE_ID },
      data: { quantityOnHand: 10, quantityReserved: 0 },
    });
    await dbA.user.deleteMany({ where: { email: USER_EMAIL } });
  }

  /** One PENDING_PAYMENT order, `quantity` units reserved under it. */
  async function seedOrder(id: string, orderNumber: string, options: {
    withCapturedPayment?: boolean;
    reserveQuantity?: number;
  }): Promise<void> {
    await dbA.order.create({
      data: {
        id,
        orderNumber,
        userId,
        storeId: STORE_ID,
        status: 'PENDING_PAYMENT',
        paymentStatus: 'PENDING',
        subtotalInPaise: 3000,
        totalInPaise: 3000,
        shippingAddress: {},
        createdAt: ANTIQUE, // older than this suite's cutoff → eligible
        items: {
          create: [
            {
              variantId: VARIANT_ID,
              productTitle: 'Order Expiry E2E',
              variantTitle: '250 g',
              quantity: options.reserveQuantity ?? 0,
              unitPriceInPaise: 1500,
              totalInPaise: 3000,
            },
          ],
        },
        ...(options.withCapturedPayment === true
          ? {
              payments: {
                create: [
                  {
                    userId,
                    provider: 'RAZORPAY',
                    providerPaymentId: 'pay_exp_e2e',
                    providerOrderId: 'order_exp_e2e',
                    method: 'UPI',
                    status: 'CAPTURED',
                    amountInPaise: 3000,
                    capturedAt: new Date(),
                  },
                ],
              },
            }
          : {}),
      },
    });

    const quantity = options.reserveQuantity ?? 0;
    if (quantity > 0) {
      // Mirror what checkout did: hold the stock and record the ledger row.
      await dbA.inventory.update({
        where: { variantId_storeId: { variantId: VARIANT_ID, storeId: STORE_ID } },
        data: { quantityReserved: { increment: quantity } },
      });
      const inventory = await dbA.inventory.findUniqueOrThrow({
        where: { variantId_storeId: { variantId: VARIANT_ID, storeId: STORE_ID } },
        select: { id: true, quantityOnHand: true },
      });
      await dbA.inventoryMovement.create({
        data: {
          inventoryId: inventory.id,
          variantId: VARIANT_ID,
          storeId: STORE_ID,
          type: 'RESERVATION',
          quantityDelta: quantity,
          quantityAfter: inventory.quantityOnHand,
          reason: 'Checkout reservation',
          referenceType: 'ORDER',
          referenceId: id,
        },
      });
    }
  }

  beforeAll(async () => {
    const connection = { connectionString: process.env.DATABASE_URL };
    dbA = new PrismaClient({ adapter: new PrismaPg(connection) });
    dbB = new PrismaClient({ adapter: new PrismaPg(connection) });

    await cleanup();

    // Safety rail: with this suite's expiry window, the sweep must see NOTHING
    // but this suite's own orders. If a stranger matched, we would rather fail
    // here than cancel it.
    const cutoff = new Date(Date.now() - EXPIRY_MINUTES * 60 * 1000);
    const strangers = await dbA.order.count({
      where: {
        status: 'PENDING_PAYMENT',
        createdAt: { lt: cutoff },
        orderNumber: { not: { startsWith: 'EXP-TEST-' } },
      },
    });
    expect(strangers).toBe(0);

    const user = await dbA.user.upsert({
      where: { email: USER_EMAIL },
      update: {},
      create: {
        email: USER_EMAIL,
        firstName: 'Expiry',
        lastName: 'E2E',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });
    userId = user.id;

    await dbA.store.upsert({
      where: { id: STORE_ID },
      update: { isActive: true },
      create: { id: STORE_ID, code: 'EXPIRY-TEST', name: 'Expiry Test Store', isActive: true },
    });
    await dbA.product.upsert({
      where: { id: PRODUCT_ID },
      update: {},
      create: {
        id: PRODUCT_ID,
        sourcePlatform: 'MANUAL',
        sourceProductId: 'expiry-test-product',
        sourceHandle: 'expiry-test-product',
        title: 'Order Expiry Test Honey',
        slug: 'order-expiry-test-honey',
        status: 'ACTIVE',
        isAvailable: true,
        publishedAt: new Date(),
      },
    });
    await dbA.productVariant.upsert({
      where: { id: VARIANT_ID },
      update: {},
      create: {
        id: VARIANT_ID,
        productId: PRODUCT_ID,
        title: '250 g',
        sku: 'EXPIRY-250G',
        priceInPaise: 1500,
        currency: 'INR',
        isAvailable: true,
      },
    });
    await dbA.inventory.upsert({
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

    await seedOrder(ORDER_A_ID, 'EXP-TEST-A', { reserveQuantity: 1 });
    await seedOrder(ORDER_B_ID, 'EXP-TEST-B', { withCapturedPayment: true });
  }, 90_000);

  afterAll(async () => {
    await cleanup();
    await dbA.$disconnect();
    await dbB.$disconnect();
  }, 90_000);

  it('D. two independent database sessions cannot hold the job lock at once', async () => {
    // Separate PrismaClients = separate pools = the multi-instance scenario.
    expect(
      await tryAcquireJobLock(dbA, ORDER_EXPIRY_JOB, 'instance-a', 60_000),
    ).toBe(true);
    expect(
      await tryAcquireJobLock(dbB, ORDER_EXPIRY_JOB, 'instance-b', 60_000),
    ).toBe(false);

    // Release is owner-scoped: only the holder frees its claim...
    expect(
      await releaseJobLock(dbA, ORDER_EXPIRY_JOB, 'instance-a'),
    ).toBe(true);
    expect(
      await releaseJobLock(dbB, ORDER_EXPIRY_JOB, 'instance-b'),
    ).toBe(false);

    // ...and once free, the other instance claims it.
    expect(
      await tryAcquireJobLock(dbB, ORDER_EXPIRY_JOB, 'instance-b', 60_000),
    ).toBe(true);
    await releaseJobLock(dbB, ORDER_EXPIRY_JOB, 'instance-b');
  });

  it('H1. a crashed holder frees the job by lease expiry — no manual unlock needed', async () => {
    expect(
      await tryAcquireJobLock(dbA, ORDER_EXPIRY_JOB, 'crashed-instance', 60_000),
    ).toBe(true);
    // Simulate the crash: the holder never releases; its lease simply runs out
    // (backdated here instead of sleeping).
    await dbA.jobLock.updateMany({
      where: { name: ORDER_EXPIRY_JOB, owner: 'crashed-instance' },
      data: { expiresAt: new Date(Date.now() - 1) },
    });

    expect(
      await tryAcquireJobLock(dbB, ORDER_EXPIRY_JOB, 'fresh-instance', 60_000),
    ).toBe(true);
    await releaseJobLock(dbB, ORDER_EXPIRY_JOB, 'fresh-instance');
  });

  it('C/E/F. overlapping sweeps on two instances expire one order exactly once, releasing stock and ledger once', async () => {
    const runA = makeService(dbA);
    const runB = makeService(dbB);
    const skipsA = watchLockSkips(runA.service);
    const skipsB = watchLockSkips(runB.service);

    await Promise.all([
      runA.service.expireStalePendingOrders(),
      runB.service.expireStalePendingOrders(),
    ]);

    // C: exactly one run did the work; the other skipped at the lock.
    expect(lockSkipCount(skipsA) + lockSkipCount(skipsB)).toBe(1);

    const order = await dbA.order.findUniqueOrThrow({ where: { id: ORDER_A_ID } });
    expect(order.status).toBe('CANCELLED');
    const historyRows = await dbA.orderStatusHistory.count({
      where: { orderId: ORDER_A_ID, toStatus: 'CANCELLED' },
    });
    expect(historyRows).toBe(1); // not expired twice

    // E: the reservation came back exactly once...
    const inventory = await dbA.inventory.findUniqueOrThrow({
      where: { variantId_storeId: { variantId: VARIANT_ID, storeId: STORE_ID } },
    });
    expect(inventory.quantityReserved).toBe(0);

    // ...and F: exactly one release movement exists for this order.
    const releases = await dbA.inventoryMovement.count({
      where: { type: 'RESERVATION_RELEASE', referenceType: 'ORDER', referenceId: ORDER_A_ID },
    });
    expect(releases).toBe(1);

    // I: after success the lock is free again (released, not merely leased).
    const lock = await dbA.jobLock.findUniqueOrThrow({
      where: { name: ORDER_EXPIRY_JOB },
    });
    expect(lock.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('G. an order holding CAPTURED money is never expired by the sweep', async () => {
    const run = makeService(dbB);
    await run.service.expireStalePendingOrders();

    const order = await dbA.order.findUniqueOrThrow({ where: { id: ORDER_B_ID } });
    expect(order.status).toBe('PENDING_PAYMENT'); // auto-healed path, never CANCELLED
    const historyRows = await dbA.orderStatusHistory.count({
      where: { orderId: ORDER_B_ID },
    });
    expect(historyRows).toBe(0);
    const releases = await dbA.inventoryMovement.count({
      where: { type: 'RESERVATION_RELEASE', referenceId: ORDER_B_ID },
    });
    expect(releases).toBe(0);
    // It went through the real payment state machine, not around it.
    expect(run.payments.processWebhookEvent).toHaveBeenCalledWith(
      'RAZORPAY',
      expect.objectContaining({ type: 'captured' }),
    );
  });

  it('B. a second execution over an already-processed batch is a no-op', async () => {
    const run = makeService(dbA);
    await run.service.expireStalePendingOrders();

    // Order A is terminal already: nothing new anywhere.
    const historyRows = await dbA.orderStatusHistory.count({
      where: { orderId: ORDER_A_ID, toStatus: 'CANCELLED' },
    });
    expect(historyRows).toBe(1);
    const releases = await dbA.inventoryMovement.count({
      where: { type: 'RESERVATION_RELEASE', referenceId: ORDER_A_ID },
    });
    expect(releases).toBe(1);
    const inventory = await dbA.inventory.findUniqueOrThrow({
      where: { variantId_storeId: { variantId: VARIANT_ID, storeId: STORE_ID } },
    });
    expect(inventory.quantityReserved).toBe(0); // never double-released
  });

  it('H2. after a crash mid-job, a fresh instance takes over and finishes consistently', async () => {
    await seedOrder(ORDER_C_ID, 'EXP-TEST-C', { reserveQuantity: 1 });

    // Plant the crashed holder: claimed, never released, lease already lapsed.
    await dbA.jobLock.upsert({
      where: { name: ORDER_EXPIRY_JOB },
      update: { owner: 'crashed-instance', expiresAt: new Date(Date.now() - 1) },
      create: {
        name: ORDER_EXPIRY_JOB,
        owner: 'crashed-instance',
        acquiredAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() - 1),
      },
    });

    // A different instance runs the sweep: it must take over AND complete.
    const run = makeService(dbB);
    await run.service.expireStalePendingOrders();

    const order = await dbA.order.findUniqueOrThrow({ where: { id: ORDER_C_ID } });
    expect(order.status).toBe('CANCELLED');
    expect(
      await dbA.orderStatusHistory.count({
        where: { orderId: ORDER_C_ID, toStatus: 'CANCELLED' },
      }),
    ).toBe(1);
    expect(
      await dbA.inventoryMovement.count({
        where: { type: 'RESERVATION_RELEASE', referenceId: ORDER_C_ID },
      }),
    ).toBe(1);
    const inventory = await dbA.inventory.findUniqueOrThrow({
      where: { variantId_storeId: { variantId: VARIANT_ID, storeId: STORE_ID } },
    });
    expect(inventory.quantityReserved).toBe(0);

    // And the takeover lock was released after the successful run.
    const lock = await dbA.jobLock.findUniqueOrThrow({
      where: { name: ORDER_EXPIRY_JOB },
    });
    expect(lock.owner).not.toBe('crashed-instance');
    expect(lock.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
  });
});
