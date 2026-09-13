import { Module } from '@nestjs/common';

import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

/**
 * Per-store stock and the stock ledger.
 *
 * Inventory is tracked at the (variant, store) level:
 *   - `quantityOnHand`: total physical stock
 *   - `quantityReserved`: stock reserved for orders but not yet deducted
 *   - `availableQuantity`: derived as `quantityOnHand - quantityReserved`
 *
 * Every quantity change creates an append-only `InventoryMovement` record with
 * a signed `quantityDelta` and the resulting `quantityAfter`. Stock is never
 * silently overwritten, and movements are never updated or deleted.
 *
 * Endpoints under `/api/v1/admin/inventory`:
 *   GET    /                        list inventory, filterable by store/variant/low-stock
 *   GET    /low-stock               items at or below reorder level
 *   GET    /:id                      inventory detail with variant and store
 *   GET    /:id/movements           movement ledger for one inventory entry
 *   POST   /:id/receive             receive stock (add to on-hand)
 *   POST   /:id/adjust              adjust stock (positive or negative delta)
 *   POST   /:id/reserve             reserve stock for an order
 *   POST   /:id/release              release a reservation
 *   POST   /:id/deduct              deduct stock (for fulfilled orders)
 *
 * Stock rules:
 *   - `quantityOnHand` must never become negative
 *   - `quantityReserved` must never exceed `quantityOnHand`
 *   - `quantityReserved` must never become negative
 *   - Reservations fail if insufficient available stock exists
 *   - Releases fail if requested amount exceeds reserved quantity
 *
 * All stock-changing operations use database transactions to prevent race
 * conditions on concurrent reservations for the same variant/store.
 */
@Module({
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
