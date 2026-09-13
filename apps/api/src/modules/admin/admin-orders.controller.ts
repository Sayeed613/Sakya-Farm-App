import { Controller, Get, Param, Query, Patch, Body, UseGuards } from '@nestjs/common';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  adminOrderListQuerySchema,
  adminOrderIdParamSchema,
  type AdminOrderListQuery,
  type AdminOrderIdParam,
} from '@sakya/validation';
import type { AdminOrderSummary, AdminOrderDetail, OrderStatus } from '@sakya/types';
import { AdminOrdersService } from './admin-orders.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { z } from 'zod';

/**
 * Admin order management.
 *
 *   GET    /api/v1/admin/orders                 list all orders, filterable      (orders:read)
 *   GET    /api/v1/admin/orders/:id             order detail with items/payments (orders:read)
 *   PATCH  /api/v1/admin/orders/:id/status      transition order status          (orders:update:status)
 *
 * All endpoints sit behind `@Roles('ADMIN', 'SUPER_ADMIN')` in addition to
 * per-endpoint permissions.
 */
@Controller('admin/orders')
@UseGuards(PermissionsGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
export class AdminOrdersController {
  constructor(private readonly ordersService: AdminOrdersService) {}

  /** List all orders with status, payment, date range and search filters. */
  @Permissions('orders:read')
  @Get()
  async list(
    @Query(new ZodValidationPipe(adminOrderListQuerySchema)) query: AdminOrderListQuery,
  ): Promise<{ items: AdminOrderSummary[]; meta: unknown }> {
    return this.ordersService.list(query);
  }

  /** Full order detail including items, payments and status history. */
  @Permissions('orders:read')
  @Get(':id')
  async getById(
    @Param(new ZodValidationPipe(adminOrderIdParamSchema)) params: AdminOrderIdParam,
  ): Promise<AdminOrderDetail> {
    return this.ordersService.getById(params.id);
  }

  /** Transition an order to a new status. Only legal transitions are allowed. */
  @Permissions('orders:update:status')
  @Patch(':id/status')
  async updateStatus(
    @Param(new ZodValidationPipe(adminOrderIdParamSchema)) params: AdminOrderIdParam,
    @Body(new ZodValidationPipe(z.object({
      status: z.enum([
        'PENDING_PAYMENT',
        'CONFIRMED',
        'PROCESSING',
        'PACKED',
        'READY_FOR_PICKUP',
        'OUT_FOR_DELIVERY',
        'DELIVERED',
        'CANCELLED',
        'REFUNDED',
        'FAILED',
      ]),
      reason: z.string().trim().max(500).optional(),
    }))) body: { status: string; reason?: string },
  ): Promise<AdminOrderDetail> {
    return this.ordersService.updateStatus(params.id, body.status as OrderStatus, body.reason);
  }
}
