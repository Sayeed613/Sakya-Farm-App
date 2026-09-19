import { ConflictException } from '@nestjs/common';

import type { Prisma } from '../../generated/prisma/client';

/**
 * Order-driven inventory reservations.
 *
 * `InventoryService` owns the admin/store stock operations, but each of those
 * opens its own transaction. Checkout and cancellation need to change stock
 * **inside** a larger transaction that also writes the order, so the two
 * operations live here as plain functions that take the caller's
 * `TransactionClient`.
 *
 * Keeping them as functions (rather than an injected service) also avoids an
 * Orders <-> Inventory module dependency, which would be circular: the admin
 * order service needs the same release on cancellation.
 *
 * Invariants upheld here:
 * - `quantityReserved` never exceeds `quantityOnHand`
 * - `quantityReserved` never goes negative
 * - a reservation fails when no stock row exists or available stock is short
 * - a reservation is recorded exactly once per (order, variant) in the ledger
 * - a release is recorded exactly once per (order, variant) in the ledger
 * - a sale is recorded exactly once per (order, variant) in the ledger
 */

export interface OrderReservationLine {
  variantId: string;
  /** Only used to make the failure message readable. */
  variantTitle: string;
  quantity: number;
}

/**
 * Reserve stock for one order line.
 *
 * The guard is a single conditional `UPDATE`: the row is only incremented while
 * enough stock is still unreserved. That makes the check-and-increment atomic in
 * PostgreSQL, so two concurrent checkouts for the same variant cannot both pass
 * and oversell it (a read-then-write would let them).
 */
export async function reserveOrderLine(
  tx: Prisma.TransactionClient,
  orderId: string,
  storeId: string,
  line: OrderReservationLine,
): Promise<void> {
  const inventory = await tx.inventory.findUnique({
    where: { variantId_storeId: { variantId: line.variantId, storeId } },
    select: {
      id: true,
      variantId: true,
      storeId: true,
      quantityOnHand: true,
    },
  });

  if (inventory === null) {
    throw new ConflictException(
      `No stock is configured for "${line.variantTitle}" at the selected store`,
    );
  }

  // `updated !== 1` means the WHERE guard matched nothing, i.e. available stock
  // (quantity_on_hand - quantity_reserved) was less than the requested quantity.
  const updated = await tx.$executeRaw`
    UPDATE "inventory"
    SET "quantity_reserved" = "quantity_reserved" + ${line.quantity}::int
    WHERE "id" = ${inventory.id}::uuid
      AND "quantity_reserved" + ${line.quantity}::int <= "quantity_on_hand"
  `;

  if (updated !== 1) {
    throw new ConflictException(`Insufficient stock for "${line.variantTitle}"`);
  }

  await tx.inventoryMovement.create({
    data: {
      inventoryId: inventory.id,
      variantId: inventory.variantId,
      storeId: inventory.storeId,
      type: 'RESERVATION',
      quantityDelta: line.quantity,
      // A reservation does not move physical stock, so on-hand is unchanged.
      quantityAfter: inventory.quantityOnHand,
      reason: 'Checkout reservation',
      referenceType: 'ORDER',
      referenceId: orderId,
    },
  });
}

/**
 * Release every reservation an order still holds.
 *
 * Idempotency comes from the append-only ledger: if a `RESERVATION_RELEASE`
 * movement already exists for this order and variant, the stock has been
 * returned once and a repeat call is a no-op. That is what makes a double
 * cancellation (or a retried request) safe.
 */
export async function releaseOrderReservations(
  tx: Prisma.TransactionClient,
  orderId: string,
  reason: string,
): Promise<void> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      storeId: true,
      items: { select: { variantId: true, quantity: true } },
    },
  });

  // No order, or an order placed before store fulfilment existed: nothing held.
  if (order === null || order.storeId === null) return;

  for (const item of order.items) {
    if (item.variantId === null) continue;

    const inventory = await tx.inventory.findUnique({
      where: {
        variantId_storeId: { variantId: item.variantId, storeId: order.storeId },
      },
      select: {
        id: true,
        variantId: true,
        storeId: true,
        quantityOnHand: true,
      },
    });

    if (inventory === null) continue;

    const alreadyReleased = await tx.inventoryMovement.findFirst({
      where: {
        inventoryId: inventory.id,
        referenceType: 'ORDER',
        referenceId: orderId,
        type: 'RESERVATION_RELEASE',
      },
      select: { id: true },
    });

    if (alreadyReleased !== null) continue;

    // The `gte` guard keeps quantityReserved from going negative even if the
    // row was adjusted by hand between checkout and cancellation.
    const released = await tx.inventory.updateMany({
      where: { id: inventory.id, quantityReserved: { gte: item.quantity } },
      data: { quantityReserved: { decrement: item.quantity } },
    });

    if (released.count !== 1) continue;

    await tx.inventoryMovement.create({
      data: {
        inventoryId: inventory.id,
        variantId: inventory.variantId,
        storeId: inventory.storeId,
        type: 'RESERVATION_RELEASE',
        quantityDelta: -item.quantity,
        quantityAfter: inventory.quantityOnHand,
        reason,
        referenceType: 'ORDER',
        referenceId: orderId,
      },
    });
  }
}

/**
 * Turn an order's reservations into a sale: `quantityOnHand` falls by the
 * quantity actually shipped out, and the corresponding hold is consumed.
 *
 * Without this, marking an order delivered left its stock reserved forever —
 * the units were neither sellable again nor recorded as gone, so the same
 * physical stock could be sold repeatedly.
 *
 * Exactly-once comes from the ledger plus a conditional update:
 * - a `SALE` movement for this order and inventory means the stock has already
 *   been taken, so a repeated call is a no-op
 * - the `UPDATE` decrements only while the hold covers the quantity, so two
 *   concurrent completions cannot both succeed
 */
export async function deductOrderReservations(
  tx: Prisma.TransactionClient,
  orderId: string,
  reason: string,
  performedByUserId?: string,
): Promise<void> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      storeId: true,
      items: { select: { variantId: true, quantity: true } },
    },
  });

  if (order === null || order.storeId === null) return;

  for (const item of order.items) {
    if (item.variantId === null) continue;

    const inventory = await tx.inventory.findUnique({
      where: {
        variantId_storeId: { variantId: item.variantId, storeId: order.storeId },
      },
      select: {
        id: true,
        variantId: true,
        storeId: true,
        quantityOnHand: true,
        quantityReserved: true,
      },
    });

    if (inventory === null) continue;

    const alreadySold = await tx.inventoryMovement.findFirst({
      where: {
        inventoryId: inventory.id,
        referenceType: 'ORDER',
        referenceId: orderId,
        type: 'SALE',
      },
      select: { id: true },
    });

    if (alreadySold !== null) continue;

    // One statement so the two quantities can never disagree, and so the guard
    // is evaluated against the committed row rather than a stale read.
    const deducted = await tx.$executeRaw`
      UPDATE "inventory"
      SET "quantity_on_hand" = "quantity_on_hand" - ${item.quantity}::int,
          "quantity_reserved" = "quantity_reserved" - ${item.quantity}::int
      WHERE "id" = ${inventory.id}::uuid
        AND "quantity_reserved" >= ${item.quantity}::int
        AND "quantity_on_hand" >= ${item.quantity}::int
    `;

    // The hold was already released (or the stock was adjusted away): leave the
    // ledger alone rather than inventing a negative sale.
    if (deducted !== 1) continue;

    const quantityAfter = inventory.quantityOnHand - item.quantity;

    await tx.inventoryMovement.create({
      data: {
        inventoryId: inventory.id,
        variantId: inventory.variantId,
        storeId: inventory.storeId,
        type: 'SALE',
        quantityDelta: -item.quantity,
        quantityAfter,
        reason,
        referenceType: 'ORDER',
        referenceId: orderId,
        performedByUserId: performedByUserId ?? null,
      },
    });

    await tx.inventoryMovement.create({
      data: {
        inventoryId: inventory.id,
        variantId: inventory.variantId,
        storeId: inventory.storeId,
        type: 'RESERVATION_RELEASE',
        quantityDelta: -item.quantity,
        quantityAfter,
        reason,
        referenceType: 'ORDER',
        referenceId: orderId,
        performedByUserId: performedByUserId ?? null,
      },
    });
  }
}
