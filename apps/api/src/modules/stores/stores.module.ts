import { Module } from '@nestjs/common';

import { StoresService } from './stores.service';
import { StoresController } from './stores.controller';
import { StoreOrdersService } from './store-orders.service';
import { StoreOrdersController } from './store-orders.controller';
import { StoreInventoryService } from './store-inventory.service';
import { StoreInventoryController } from './store-inventory.controller';
import { InventoryModule } from '../inventory/inventory.module';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * Stores and store staff.
 *
 * Store-scoped endpoints:
 *   GET    /stores/:storeId/orders           list orders for this store
 *   GET    /stores/:storeId/orders/:orderId  order detail
 *   PATCH  /stores/:storeId/orders/:orderId/status  update order status
 *   GET    /stores/:storeId/inventory        list inventory for this store
 *   GET    /stores/:storeId/inventory/low-stock  low stock items
 *   GET    /stores/:storeId/inventory/:inventoryId  inventory detail
 *   POST   /stores/:storeId/inventory/:inventoryId/receive  receive stock
 *   POST   /stores/:storeId/inventory/:inventoryId/adjust  adjust stock
 *
 * Admin endpoints (via StoresController):
 *   GET    /admin/stores                     list stores
 *   POST   /admin/stores                     create store
 *   GET    /admin/stores/:storeId            store detail
 *   PATCH  /admin/stores/:storeId            update store
 *   DELETE /admin/stores/:storeId            deactivate store
 *   GET    /admin/stores/:storeId/staff      list store staff
 *   POST   /admin/stores/:storeId/staff      assign staff
 *   PATCH  /admin/stores/:storeId/staff/:userId  update staff
 *   DELETE /admin/stores/:storeId/staff/:userId  remove staff
 *
 * Store-scoped permissions (who may adjust which store's stock) are enforced in
 * the service layer against `store_staff`, in addition to the platform-level
 * permission guards.
 */
@Module({
  imports: [InventoryModule, NotificationsModule],
  controllers: [StoresController, StoreOrdersController, StoreInventoryController],
  providers: [StoresService, StoreOrdersService, StoreInventoryService],
  exports: [StoresService, StoreOrdersService, StoreInventoryService],
})
export class StoresModule {}
