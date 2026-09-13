import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  shipmentListQuerySchema,
  deliveryAssignmentListQuerySchema,
  createShipmentSchema,
  assignDeliverySchema,
  deliveryStatusUpdateSchema,
  shipmentIdParamSchema,
  deliveryAssignmentIdParamSchema,
  orderIdParamSchema,
  type ShipmentListQuery,
  type DeliveryAssignmentListQuery,
  type CreateShipmentRequest,
  type AssignDeliveryRequest,
  type DeliveryStatusUpdateRequest,
  type ShipmentIdParam,
  type DeliveryAssignmentIdParam,
  type OrderIdParam,
} from '@sakya/validation';
import type {
  PaginatedShipments,
  ShipmentDetail,
  PaginatedDeliveryAssignments,
  DeliveryAssignmentDetail,
} from '@sakya/types';
import { DeliveryService } from './delivery.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

/**
 * Admin delivery management endpoints.
 *
 * Admins can:
 *   - List and view all shipments
 *   - Create shipments for orders
 *   - Assign delivery partners to orders
 *   - Update delivery assignment status (override)
 *   - Cancel deliveries
 *
 * All endpoints sit behind `@Roles('ADMIN', 'SUPER_ADMIN')` in addition to
 * per-endpoint permissions.
 *
 * Endpoints:
 *   GET    /api/v1/admin/shipments              list all shipments
 *   GET    /api/v1/admin/shipments/:id          shipment detail
 *   POST   /api/v1/admin/orders/:id/shipment    create shipment for order
 *   GET    /api/v1/admin/assignments            list all assignments
 *   GET    /api/v1/admin/assignments/:id        assignment detail
 *   POST   /api/v1/admin/orders/:id/assign      assign delivery partner
 *   PATCH  /api/v1/admin/assignments/:id        update assignment status
 *   PATCH  /api/v1/admin/assignments/:id/cancel cancel delivery
 */

@Controller('admin')
@UseGuards(PermissionsGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
export class AdminDeliveryController {
  constructor(private readonly deliveryService: DeliveryService) {}

  // -----------------------------------------------------------------------
  // Shipments
  // -----------------------------------------------------------------------

  @Permissions('delivery:read')
  @Get('shipments')
  async listShipments(
    @Query(new ZodValidationPipe(shipmentListQuerySchema)) query: ShipmentListQuery,
  ): Promise<PaginatedShipments> {
    return this.deliveryService.listShipments(query);
  }

  @Permissions('delivery:read')
  @Get('shipments/:id')
  async getShipment(
    @Param(new ZodValidationPipe(shipmentIdParamSchema)) params: ShipmentIdParam,
  ): Promise<ShipmentDetail> {
    return this.deliveryService.getShipment(params.id);
  }

  @Permissions('delivery:assign')
  @Post('orders/:id/shipment')
  async createShipment(
    @Param(new ZodValidationPipe(orderIdParamSchema)) params: OrderIdParam,
    @Body(new ZodValidationPipe(createShipmentSchema)) body: CreateShipmentRequest,
  ): Promise<ShipmentDetail> {
    return this.deliveryService.createShipment(params.id, body);
  }

  // -----------------------------------------------------------------------
  // Delivery assignments
  // -----------------------------------------------------------------------

  @Permissions('delivery:read')
  @Get('assignments')
  async listAssignments(
    @Query(new ZodValidationPipe(deliveryAssignmentListQuerySchema))
    query: DeliveryAssignmentListQuery,
  ): Promise<PaginatedDeliveryAssignments> {
    return this.deliveryService.listAssignments(query);
  }

  @Permissions('delivery:read')
  @Get('assignments/:id')
  async getAssignment(
    @Param(new ZodValidationPipe(deliveryAssignmentIdParamSchema)) params: DeliveryAssignmentIdParam,
  ): Promise<DeliveryAssignmentDetail> {
    return this.deliveryService.getAssignment(params.id);
  }

  @Permissions('delivery:assign')
  @Post('orders/:id/assign')
  async assignDelivery(
    @Param(new ZodValidationPipe(orderIdParamSchema)) params: OrderIdParam,
    @Body(new ZodValidationPipe(assignDeliverySchema)) body: AssignDeliveryRequest,
  ): Promise<DeliveryAssignmentDetail> {
    return this.deliveryService.assignDelivery(params.id, body);
  }

  @Permissions('delivery:update:status')
  @Patch('assignments/:id')
  async updateAssignmentStatus(
    @Param(new ZodValidationPipe(deliveryAssignmentIdParamSchema)) params: DeliveryAssignmentIdParam,
    @Body(new ZodValidationPipe(deliveryStatusUpdateSchema)) body: DeliveryStatusUpdateRequest,
    @CurrentUser('id') userId: string,
  ): Promise<DeliveryAssignmentDetail> {
    return this.deliveryService.updateAssignmentStatus(params.id, body, userId);
  }

  @Permissions('delivery:update:status')
  @Patch('assignments/:id/cancel')
  async cancelDelivery(
    @Param(new ZodValidationPipe(deliveryAssignmentIdParamSchema)) params: DeliveryAssignmentIdParam,
    @Body() body: { reason: string },
  ): Promise<DeliveryAssignmentDetail> {
    if (!body.reason || body.reason.trim().length === 0) {
      throw new Error('Cancel reason is required');
    }
    return this.deliveryService.cancelDelivery(params.id, body.reason);
  }
}
