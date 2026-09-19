import { Module } from '@nestjs/common';

import { NotificationsModule } from '../notifications/notifications.module';
import { DeliveryController } from './delivery.controller';
import { AdminDeliveryController } from './admin-delivery.controller';
import { DeliveryService } from './delivery.service';

/**
 * Shipments and delivery partner assignments.
 *
 * Endpoints under `/api/v1`:
 *
 * Customer:
 *   GET    /orders/:id/delivery          shipment info for my order
 *
 * Delivery partner:
 *   GET    /delivery/assignments               my assignments
 *   GET    /delivery/assignments/:id           assignment detail
 *   PATCH  /delivery/assignments/:id           update status (accept, pickup, deliver, fail)
 *
 * Admin:
 *   GET    /admin/shipments                     list all shipments
 *   GET    /admin/shipments/:id                 shipment detail
 *   POST   /admin/orders/:id/shipment           create shipment for order
 *   GET    /admin/assignments                   list all assignments
 *   GET    /admin/assignments/:id               assignment detail
 *   POST   /admin/orders/:id/assign             assign delivery partner
 *   PATCH  /admin/assignments/:id               update assignment status
 *   PATCH  /admin/assignments/:id/cancel        cancel delivery
 *
 * Delivery lifecycle:
 *   Order placed → shipment created (PENDING)
 *   → delivery partner assigned (ASSIGNED)
 *   → partner accepts (ACCEPTED)
 *   → package picked up (PICKED_UP)
 *   → out for delivery (OUT_FOR_DELIVERY via DISPATCHED)
 *   → delivered (DELIVERED) → order marked DELIVERED
 *   → or failed (FAILED) → can be reassigned
 *
 * Delivery partners can only see and update their own assignments.
 * Admins can manage all deliveries and assignments.
 *
 * Every status change is validated against allowed transitions and
 * recorded for auditability.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [DeliveryController, AdminDeliveryController],
  providers: [DeliveryService],
  exports: [DeliveryService],
})
export class DeliveryModule {}
