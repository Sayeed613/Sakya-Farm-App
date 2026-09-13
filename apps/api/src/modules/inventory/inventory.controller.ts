import {
  Controller,
  Get,
  Post,
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
  inventoryListQuerySchema,
  inventoryMovementListQuerySchema,
  receiveStockSchema,
  adjustStockSchema,
  reserveStockSchema,
  releaseStockSchema,
  deductStockSchema,
  inventoryIdParamSchema,
  type InventoryListQuery,
  type InventoryMovementListQuery,
  type ReceiveStockRequest,
  type AdjustStockRequest,
  type ReserveStockRequest,
  type ReleaseStockRequest,
  type DeductStockRequest,
  type InventoryIdParam,
} from '@sakya/validation';
import type {
  PaginatedInventory,
  InventoryDetail,
  PaginatedInventoryMovements,
} from '@sakya/types';
import { InventoryService } from './inventory.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

/**
 * Inventory management endpoints.
 *
 * All endpoints sit behind `@Roles('ADMIN', 'SUPER_ADMIN')` in addition to
 * per-endpoint permissions. Store managers can be granted scoped access.
 *
 * Inventory is per (variant, store). The available-to-sell quantity is computed
 * as `quantityOnHand - quantityReserved`, never from client input.
 *
 * Endpoints:
 *   GET    /api/v1/admin/inventory              list inventory, filterable
 *   GET    /api/v1/admin/inventory/:id          inventory detail
 *   GET    /api/v1/admin/inventory/:id/movements  movement ledger
 *   POST   /api/v1/admin/inventory/:id/receive   receive stock
 *   POST   /api/v1/admin/inventory/:id/adjust    adjust stock
 *   POST   /api/v1/admin/inventory/:id/reserve   reserve stock
 *   POST   /api/v1/admin/inventory/:id/release   release reservation
 *   POST   /api/v1/admin/inventory/:id/deduct    deduct stock (for completed orders)
 *
 * Low-stock endpoint:
 *   GET    /api/v1/admin/inventory/low-stock     items at or below reorder level
 */

@Controller('admin/inventory')
@UseGuards(PermissionsGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  // -----------------------------------------------------------------------
  // List inventory
  // -----------------------------------------------------------------------

  @Permissions('inventory:read')
  @Get()
  async list(
    @Query(new ZodValidationPipe(inventoryListQuerySchema)) query: InventoryListQuery,
  ): Promise<PaginatedInventory> {
    return this.inventoryService.list(query);
  }

  // -----------------------------------------------------------------------
  // Low stock
  // -----------------------------------------------------------------------

  @Permissions('inventory:read')
  @Get('low-stock')
  async lowStock(
    @Query('storeId') storeId?: string,
  ): Promise<PaginatedInventory> {
    return this.inventoryService.getLowStock(storeId ?? undefined);
  }

  // -----------------------------------------------------------------------
  // Inventory detail
  // -----------------------------------------------------------------------

  @Permissions('inventory:read')
  @Get(':id')
  async getById(
    @Param(new ZodValidationPipe(inventoryIdParamSchema)) params: InventoryIdParam,
  ): Promise<InventoryDetail> {
    return this.inventoryService.getById(params.id);
  }

  @Permissions('inventory:read')
  @Get(':id/movements')
  async listMovements(
    @Param(new ZodValidationPipe(inventoryIdParamSchema)) params: InventoryIdParam,
    @Query(new ZodValidationPipe(inventoryMovementListQuerySchema))
    query: InventoryMovementListQuery,
  ): Promise<PaginatedInventoryMovements> {
    return this.inventoryService.listMovements(params.id, query);
  }

  // -----------------------------------------------------------------------
  // Stock operations
  // -----------------------------------------------------------------------

  @Permissions('inventory:adjust')
  @Post(':id/receive')
  async receiveStock(
    @Param(new ZodValidationPipe(inventoryIdParamSchema)) params: InventoryIdParam,
    @Body(new ZodValidationPipe(receiveStockSchema)) body: ReceiveStockRequest,
    @CurrentUser('id') userId: string,
  ): Promise<InventoryDetail> {
    return this.inventoryService.receiveStock(params.id, body, userId);
  }

  @Permissions('inventory:adjust')
  @Post(':id/adjust')
  async adjustStock(
    @Param(new ZodValidationPipe(inventoryIdParamSchema)) params: InventoryIdParam,
    @Body(new ZodValidationPipe(adjustStockSchema)) body: AdjustStockRequest,
    @CurrentUser('id') userId: string,
  ): Promise<InventoryDetail> {
    return this.inventoryService.adjustStock(params.id, body, userId);
  }

  @Permissions('inventory:adjust')
  @Post(':id/reserve')
  async reserveStock(
    @Param(new ZodValidationPipe(inventoryIdParamSchema)) params: InventoryIdParam,
    @Body(new ZodValidationPipe(reserveStockSchema)) body: ReserveStockRequest,
    @CurrentUser('id') userId: string,
  ): Promise<InventoryDetail> {
    return this.inventoryService.reserveStock(params.id, body, userId);
  }

  @Permissions('inventory:adjust')
  @Post(':id/release')
  async releaseStock(
    @Param(new ZodValidationPipe(inventoryIdParamSchema)) params: InventoryIdParam,
    @Body(new ZodValidationPipe(releaseStockSchema)) body: ReleaseStockRequest,
    @CurrentUser('id') userId: string,
  ): Promise<InventoryDetail> {
    return this.inventoryService.releaseStock(params.id, body, userId);
  }

  @Permissions('inventory:adjust')
  @Post(':id/deduct')
  async deductStock(
    @Param(new ZodValidationPipe(inventoryIdParamSchema)) params: InventoryIdParam,
    @Body(new ZodValidationPipe(deductStockSchema)) body: DeductStockRequest,
    @CurrentUser('id') userId: string,
  ): Promise<InventoryDetail> {
    return this.inventoryService.deductStock(params.id, body, userId);
  }
}
