import { ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Prisma } from '../src/generated/prisma/client';
import {
  deductOrderReservations,
  releaseOrderReservations,
  reserveOrderLine,
} from '../src/modules/inventory/order-reservations';

/**
 * The helpers below are the only place order-driven stock movements are written,
 * and they are shared by three callers (customer checkout, customer cancellation
 * and admin cancellation). They are therefore tested directly, against a
 * transaction double, so every guard is pinned independently of an HTTP route.
 */

function createTx() {
  return {
    inventory: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    inventoryMovement: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    order: {
      findUnique: vi.fn(),
    },
    $executeRaw: vi.fn(),
  };
}

type Tx = ReturnType<typeof createTx>;

/** The helpers only use the transaction client, so a structural double is enough. */
function asTx(tx: Tx): Prisma.TransactionClient {
  return tx as unknown as Prisma.TransactionClient;
}

const inventoryRow = {
  id: 'inv-1',
  variantId: 'variant-1',
  storeId: 'store-1',
  quantityOnHand: 10,
};

describe('reserveOrderLine', () => {
  let tx: Tx;

  beforeEach(() => {
    tx = createTx();
  });

  it('refuses to reserve when no stock row is configured for the variant and store', async () => {
    tx.inventory.findUnique.mockResolvedValue(null);

    await expect(
      reserveOrderLine(asTx(tx), 'order-1', 'store-1', {
        variantId: 'variant-1',
        variantTitle: '1 kg',
        quantity: 1,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    // Nothing may be written if the variant is not stocked at this store.
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('refuses to reserve when the conditional update matches no row', async () => {
    tx.inventory.findUnique.mockResolvedValue(inventoryRow);
    // Guard failed: available stock was less than requested.
    tx.$executeRaw.mockResolvedValue(0);

    await expect(
      reserveOrderLine(asTx(tx), 'order-1', 'store-1', {
        variantId: 'variant-1',
        variantTitle: '1 kg',
        quantity: 99,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('records a RESERVATION movement that leaves on-hand untouched', async () => {
    tx.inventory.findUnique.mockResolvedValue(inventoryRow);
    tx.$executeRaw.mockResolvedValue(1);

    await reserveOrderLine(asTx(tx), 'order-1', 'store-1', {
      variantId: 'variant-1',
      variantTitle: '1 kg',
      quantity: 2,
    });

    expect(tx.inventoryMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inventoryId: 'inv-1',
        variantId: 'variant-1',
        storeId: 'store-1',
        type: 'RESERVATION',
        quantityDelta: 2,
        // A reservation holds stock; it does not remove it.
        quantityAfter: 10,
        referenceType: 'ORDER',
        referenceId: 'order-1',
      }),
    });
  });
});

describe('releaseOrderReservations', () => {
  let tx: Tx;

  beforeEach(() => {
    tx = createTx();
  });

  it('does nothing when the order cannot be found', async () => {
    tx.order.findUnique.mockResolvedValue(null);

    await releaseOrderReservations(asTx(tx), 'order-1', 'Order cancelled');

    expect(tx.inventory.findUnique).not.toHaveBeenCalled();
    expect(tx.inventory.updateMany).not.toHaveBeenCalled();
  });

  it('does nothing when the order has no fulfilment store', async () => {
    tx.order.findUnique.mockResolvedValue({ storeId: null, items: [] });

    await releaseOrderReservations(asTx(tx), 'order-1', 'Order cancelled');

    expect(tx.inventory.updateMany).not.toHaveBeenCalled();
  });

  it('gives the reserved quantity back and records a RELEASE movement', async () => {
    tx.order.findUnique.mockResolvedValue({
      storeId: 'store-1',
      items: [{ variantId: 'variant-1', quantity: 2 }],
    });
    tx.inventory.findUnique.mockResolvedValue(inventoryRow);
    tx.inventoryMovement.findFirst.mockResolvedValue(null);
    tx.inventory.updateMany.mockResolvedValue({ count: 1 });

    await releaseOrderReservations(asTx(tx), 'order-1', 'Order cancelled');

    expect(tx.inventory.updateMany).toHaveBeenCalledWith({
      where: { id: 'inv-1', quantityReserved: { gte: 2 } },
      data: { quantityReserved: { decrement: 2 } },
    });
    expect(tx.inventoryMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'RESERVATION_RELEASE',
        quantityDelta: -2,
        referenceType: 'ORDER',
        referenceId: 'order-1',
        reason: 'Order cancelled',
      }),
    });
  });

  it('does not release twice when the ledger already holds a release for the order', async () => {
    tx.order.findUnique.mockResolvedValue({
      storeId: 'store-1',
      items: [{ variantId: 'variant-1', quantity: 2 }],
    });
    tx.inventory.findUnique.mockResolvedValue(inventoryRow);
    tx.inventoryMovement.findFirst.mockResolvedValue({ id: 'mov-existing' });

    await releaseOrderReservations(asTx(tx), 'order-1', 'Order cancelled');

    expect(tx.inventory.updateMany).not.toHaveBeenCalled();
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('skips the decrement when reserved stock is short of the ordered quantity', async () => {
    tx.order.findUnique.mockResolvedValue({
      storeId: 'store-1',
      items: [{ variantId: 'variant-1', quantity: 2 }],
    });
    tx.inventory.findUnique.mockResolvedValue(inventoryRow);
    tx.inventoryMovement.findFirst.mockResolvedValue(null);
    // The `gte` guard refused the decrement, so reserved stays correct.
    tx.inventory.updateMany.mockResolvedValue({ count: 0 });

    await releaseOrderReservations(asTx(tx), 'order-1', 'Order cancelled');

    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('ignores order lines whose variant has since been removed', async () => {
    tx.order.findUnique.mockResolvedValue({
      storeId: 'store-1',
      items: [
        { variantId: null, quantity: 1 },
        { variantId: 'variant-1', quantity: 1 },
      ],
    });
    tx.inventory.findUnique.mockResolvedValue(inventoryRow);
    tx.inventoryMovement.findFirst.mockResolvedValue(null);
    tx.inventory.updateMany.mockResolvedValue({ count: 1 });

    await releaseOrderReservations(asTx(tx), 'order-1', 'Order cancelled');

    // Only the surviving variant is looked up.
    expect(tx.inventory.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.inventory.updateMany).toHaveBeenCalledTimes(1);
  });

  it('ignores a line whose stock row no longer exists', async () => {
    tx.order.findUnique.mockResolvedValue({
      storeId: 'store-1',
      items: [{ variantId: 'variant-1', quantity: 1 }],
    });
    tx.inventory.findUnique.mockResolvedValue(null);

    await releaseOrderReservations(asTx(tx), 'order-1', 'Order cancelled');

    expect(tx.inventory.updateMany).not.toHaveBeenCalled();
  });
});

describe('deductOrderReservations', () => {
  let tx: Tx;

  beforeEach(() => {
    tx = createTx();
  });

  it('does nothing when the order has no fulfilment store', async () => {
    tx.order.findUnique.mockResolvedValue({ storeId: null, items: [] });

    await deductOrderReservations(asTx(tx), 'order-1', 'Order delivered');

    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('takes the stock out of on-hand and consumes the hold', async () => {
    tx.order.findUnique.mockResolvedValue({
      storeId: 'store-1',
      items: [{ variantId: 'variant-1', quantity: 2 }],
    });
    tx.inventory.findUnique.mockResolvedValue(inventoryRow);
    tx.inventoryMovement.findFirst.mockResolvedValue(null);
    tx.$executeRaw.mockResolvedValue(1);

    await deductOrderReservations(asTx(tx), 'order-1', 'Order delivered', 'partner-1');

    const created = tx.inventoryMovement.create.mock.calls.map(
      (call) => (call[0] as { data: { type: string } }).data,
    );

    expect(created).toHaveLength(2);
    expect(created[0]).toEqual(
      expect.objectContaining({
        type: 'SALE',
        quantityDelta: -2,
        // 10 on hand less the 2 shipped.
        quantityAfter: 8,
        referenceId: 'order-1',
        performedByUserId: 'partner-1',
      }),
    );
    // Selling the held units also clears the hold.
    expect(created[1]).toEqual(
      expect.objectContaining({ type: 'RESERVATION_RELEASE', quantityDelta: -2 }),
    );
  });

  it('does not deduct twice when the ledger already holds a sale for the order', async () => {
    tx.order.findUnique.mockResolvedValue({
      storeId: 'store-1',
      items: [{ variantId: 'variant-1', quantity: 2 }],
    });
    tx.inventory.findUnique.mockResolvedValue(inventoryRow);
    tx.inventoryMovement.findFirst.mockResolvedValue({ id: 'mov-sale' });

    await deductOrderReservations(asTx(tx), 'order-1', 'Order delivered');

    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('leaves the ledger alone when the hold no longer covers the quantity', async () => {
    tx.order.findUnique.mockResolvedValue({
      storeId: 'store-1',
      items: [{ variantId: 'variant-1', quantity: 2 }],
    });
    tx.inventory.findUnique.mockResolvedValue(inventoryRow);
    tx.inventoryMovement.findFirst.mockResolvedValue(null);
    // The guard refused the update: the stock was already released or adjusted.
    tx.$executeRaw.mockResolvedValue(0);

    await deductOrderReservations(asTx(tx), 'order-1', 'Order delivered');

    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('ignores order lines whose variant has since been removed', async () => {
    tx.order.findUnique.mockResolvedValue({
      storeId: 'store-1',
      items: [
        { variantId: null, quantity: 1 },
        { variantId: 'variant-1', quantity: 1 },
      ],
    });
    tx.inventory.findUnique.mockResolvedValue(inventoryRow);
    tx.inventoryMovement.findFirst.mockResolvedValue(null);
    tx.$executeRaw.mockResolvedValue(1);

    await deductOrderReservations(asTx(tx), 'order-1', 'Order delivered');

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });
});
