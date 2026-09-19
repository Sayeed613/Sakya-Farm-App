import { Module } from '@nestjs/common';

import { CartModule } from '../cart/cart.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

/**
 * Orders and their lifecycle.
 *
 * Implemented:
 *
 *   POST   /                       place an order from the cart    (orders:write)
 *   GET    /                       list the caller's orders         (orders:read:own)
 *   GET    /:id                    order detail                     (orders:read:own)
 *   POST   /:id/cancel             cancel an order                  (orders:cancel)
 *   GET    /:id/status-history    status history for an order      (orders:read:own)
 *
 * Admin endpoints (orders:read, orders:update:status) and delivery/payment
 * advances are planned but not implemented here yet.
 *
 * Order status is only ever changed here, and only along the transitions in
 * ORDER_STATUS_TRANSITIONS (`@sakya/types`). Every change writes an
 * `OrderStatusHistory` row recording the actor and reason. Order items snapshot
 * product and variant titles, so a later catalog edit cannot rewrite history.
 *
 * `OrdersService` is exported so admin and future fulfilment modules can reuse
 * the same placement and transition logic.
 */
@Module({
  imports: [CartModule, DeliveryModule, NotificationsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
