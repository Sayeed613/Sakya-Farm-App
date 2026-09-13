import {
  Controller,
  Get,
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
  deliveryAssignmentListQuerySchema,
  deliveryStatusUpdateSchema,
  deliveryAssignmentIdParamSchema,
  type DeliveryAssignmentListQuery,
  type DeliveryStatusUpdateRequest,
  type DeliveryAssignmentIdParam,
} from '@sakya/validation';
import type {
  PaginatedDeliveryAssignments,
  DeliveryAssignmentDetail,
} from '@sakya/types';
import { DeliveryService } from './delivery.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

/**
 * Delivery partner endpoints.
 *
 * Delivery partners can only see and update their own assignments.
 * All endpoints require authentication and the DELIVERY_PARTNER role.
 *
 * Endpoints:
 *   GET    /api/v1/delivery/assignments          list my assignments
 *   GET    /api/v1/delivery/assignments/:id      assignment detail
 *   PATCH  /api/v1/delivery/assignments/:id      update status (accept, pickup, deliver, fail)
 */

@Controller('delivery/assignments')
@UseGuards(PermissionsGuard)
@Roles('DELIVERY_PARTNER', 'ADMIN', 'SUPER_ADMIN')
export class DeliveryController {
  constructor(private readonly deliveryService: DeliveryService) {}

  // -----------------------------------------------------------------------
  // My assignments (delivery partner's own)
  // -----------------------------------------------------------------------

  @Permissions('delivery:read')
  @Get()
  async getMyAssignments(
    @CurrentUser('id') userId: string,
    @Query(new ZodValidationPipe(deliveryAssignmentListQuerySchema))
    query: DeliveryAssignmentListQuery,
  ): Promise<PaginatedDeliveryAssignments> {
    return this.deliveryService.getMyAssignments(userId, query);
  }

  @Permissions('delivery:read')
  @Get(':id')
  async getAssignment(
    @Param(new ZodValidationPipe(deliveryAssignmentIdParamSchema)) params: DeliveryAssignmentIdParam,
    @CurrentUser('id') userId: string,
  ): Promise<DeliveryAssignmentDetail> {
    return this.deliveryService.getAssignmentForPartner(params.id, userId);
  }

  // -----------------------------------------------------------------------
  // Status updates (delivery partner actions)
  // -----------------------------------------------------------------------

  @Permissions('delivery:update:status')
  @Patch(':id')
  async updateStatus(
    @Param(new ZodValidationPipe(deliveryAssignmentIdParamSchema)) params: DeliveryAssignmentIdParam,
    @Body(new ZodValidationPipe(deliveryStatusUpdateSchema)) body: DeliveryStatusUpdateRequest,
    @CurrentUser('id') userId: string,
  ): Promise<DeliveryAssignmentDetail> {
    return this.deliveryService.updateAssignmentStatus(params.id, body, userId);
  }
}
