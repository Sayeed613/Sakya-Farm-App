import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client';
import { validateEnvironment } from '../src/config/env.validation';

/**
 * Shop bootstrap — takes a database from "migrations applied" to "a real
 * checkout can complete end to end" with zero manual SQL.
 *
 * It deliberately does NOT duplicate the other seeds' jobs:
 *   - roles / permissions / optional admin  -> prisma/seed.ts  (db:seed)
 *   - catalog products & variants           -> prisma/import-catalog.ts
 * This script fills the remaining gap that made the very first QA checkout
 * fail with 400/409:
 *
 *   1. An active fulfilment STORE. Carts resolve to the oldest active store
 *      when their first item is added, so checkout needs one to exist.
 *   2. An active ServiceabilityZone covering real pincodes. The server's
 *      order gate rejects any shipping pincode outside an active zone
 *      ("We do not deliver to this pincode yet").
 *   3. Starting INVENTORY for every ProductVariant in the catalog, at that
 *      same store, each with its append-only PURCHASE movement. Stock is
 *      never derived from the catalog: without an Inventory row the order
 *      reservation fails ("No stock is configured for ... at the selected
 *      store"), and the movement keeps the ledger's append-only invariant.
 *
 * Idempotent by construction — every step is create-if-missing (and the
 * inventory row + movement are written in one transaction), so running it
 * twice neither duplicates rows nor tops up stock that has since moved.
 *
 * Run from the repository root:
 *   pnpm --filter @sakya/api db:bootstrap
 * or from apps/api:
 *   pnpm db:bootstrap
 */

/** Identity of the store this script creates when the database has none. */
const STORE_CODE = 'SAKYA-FARMS';
const STORE_NAME = 'Sakya Farms';

/** Zone label, matched per store so re-runs update it in place. */
const ZONE_NAME = 'Bengaluru city';

/**
 * Real Bengaluru pincodes the demo zone serves. The schema stores exact-match
 * strings (ranges would be a second model), so this is an explicit list, not
 * a 5600xx wildcard.
 */
const ZONE_PINCODES = [
  '560001',
  '560002',
  '560003',
  '560004',
  '560016',
  '560034',
  '560038',
  '560068',
  '560076',
  '560103',
] as const;

/** Opening units per variant. Fixed, so re-runs stay predictable. */
const OPEN_STOCK_QTY = 100;

/** Delivery promise shown by the serviceability endpoint for this zone. */
const ZONE_MIN_DELIVERY_DAYS = 1;
const ZONE_MAX_DELIVERY_DAYS = 3;

async function main(): Promise<void> {
  const env = validateEnvironment(process.env);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  });

  try {
    // -- 1. Fulfilment store ------------------------------------------------
    // Mirror the cart's own resolution (oldest active store) so the zone and
    // the stock below attach to the store fulfilment will actually use.
    let store = await prisma.store.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    let storeAction: 'reused' | 'created';
    if (store !== null) {
      storeAction = 'reused';
    } else {
      store = await prisma.store.upsert({
        where: { code: STORE_CODE },
        // A previously bootstrapped store that was later deactivated is
        // reactivated rather than replaced (code is unique).
        update: { isActive: true },
        create: {
          code: STORE_CODE,
          name: STORE_NAME,
          isActive: true,
          timezone: 'Asia/Kolkata',
        },
      });
      storeAction = 'created';
    }
    console.log(`Store ${storeAction}: ${store.code} (${store.id})`);

    // -- 2. Serviceability zone --------------------------------------------
    const shippingFeeInPaise = env.SHIPPING_FEE_IN_PAISE;
    const freeShippingThresholdInPaise = env.FREE_SHIPPING_THRESHOLD_IN_PAISE ?? null;
    const zoneValues = {
      pincodes: [...ZONE_PINCODES],
      minDeliveryDays: ZONE_MIN_DELIVERY_DAYS,
      maxDeliveryDays: ZONE_MAX_DELIVERY_DAYS,
      codAvailable: true,
      // Kept in step with the commerce config the order totals use, so the
      // "delivery charges" a customer sees pre-order match what they pay.
      shippingFeeInPaise,
      freeShippingThresholdInPaise,
      isActive: true,
    };
    const existingZone = await prisma.serviceabilityZone.findFirst({
      where: { storeId: store.id, name: ZONE_NAME },
    });
    const zone =
      existingZone === null
        ? await prisma.serviceabilityZone.create({
            data: { storeId: store.id, name: ZONE_NAME, ...zoneValues },
          })
        : await prisma.serviceabilityZone.update({
            where: { id: existingZone.id },
            data: zoneValues,
          });
    console.log(
      `Zone ${existingZone === null ? 'created' : 'updated'}: ${zone.name} ` +
        `(${zone.pincodes.length} pincodes, ${zone.minDeliveryDays}-${zone.maxDeliveryDays} days)`,
    );

    // -- 3. Inventory for every catalog variant -----------------------------
    const variants = await prisma.productVariant.findMany({
      select: { id: true, title: true },
      orderBy: { id: 'asc' },
    });
    if (variants.length === 0) {
      console.warn(
        'WARNING: the catalog has no product variants. Run the catalog import ' +
          '(pnpm --filter @sakya/api catalog:import) — checkout cannot work without products.',
      );
    }

    let opened = 0;
    let existingRows = 0;
    for (const variant of variants) {
      const existing = await prisma.inventory.findUnique({
        where: {
          variantId_storeId: { variantId: variant.id, storeId: store.id },
        },
      });
      if (existing !== null) {
        existingRows += 1;
        continue;
      }

      // Row + ledger movement atomically: the ledger is append-only and must
      // always explain the row's opening balance.
      const created = await prisma.$transaction(async (tx) => {
        const row = await tx.inventory.create({
          data: {
            variantId: variant.id,
            storeId: store.id,
            quantityOnHand: OPEN_STOCK_QTY,
            quantityReserved: 0,
            lastCountedAt: new Date(),
          },
        });
        await tx.inventoryMovement.create({
          data: {
            inventoryId: row.id,
            variantId: variant.id,
            storeId: store.id,
            type: 'PURCHASE',
            quantityDelta: OPEN_STOCK_QTY,
            quantityAfter: OPEN_STOCK_QTY,
            reason: 'Bootstrap opening stock',
            performedByUserId: null,
          },
        });
        return row;
      });
      if (created !== undefined) opened += 1;
    }
    console.log(
      `Inventory: opened ${opened} variant(s) at ${OPEN_STOCK_QTY} units, ` +
        `${existingRows} already had a row (left untouched).`,
    );

    // -- 4. Soft prerequisite warnings --------------------------------------
    const roleCount = await prisma.role.count();
    if (roleCount === 0) {
      console.warn('WARNING: no roles seeded — run `pnpm --filter @sakya/api db:seed` before sign-in.');
    }

    console.log('Bootstrap complete. A checkout can now complete end to end.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Bootstrap failed:', error);
  process.exit(1);
});
