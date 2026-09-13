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
  storeInventoryListQuerySchema,
  storeInventoryIdParamSchema,
  storeIdParamSchema,
  receiveStockSchema,
  adjustStockSchema,
  type StoreInventoryListQuery,
  type ReceiveStockRequest,
  type AdjustStockRequest,
  type StoreInventoryIdParam,
  type StoreIdParam,
} from '@sakya/validation';
import type { StoreInventoryEntry } from '@sakya/types';
import { StoreInventoryService } from './store-inventory.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

/** Store-facing inventory operations.
 *
 * Requires STORE_MANAGER or STORE_STAFF role.
 * Users can only access inventory for stores they are staff members of.
 */
@Controller('stores/:storeId/inventory')
@UseGuards(PermissionsGuard)
@Roles('STORE_MANAGER', 'STORE_STAFF')
@Permissions('inventory:read', 'inventory:adjust')
export class StoreInventoryController {
  constructor(private readonly storeInventoryService: StoreInventoryService) {}

  @Get()
  async listInventory(
    @Param(new ZodValidationPipe(storeIdParamSchema)) params: StoreIdParam,
    @CurrentUser('id') userId: string,
    @Query(new ZodValidationPipe(storeInventoryListQuerySchema)) query: StoreInventoryListQuery,
  ): Promise<{ items: StoreInventoryEntry[]; meta: { page: number; perPage: number; total: number; totalPages: number; hasNextPage: boolean; hasPreviousPage: boolean } }> {
    return this.storeInventoryService.listStoreInventory(params.storeId, userId, query);
  }

  @Get('low-stock')
  async lowStock(
    @Param(new ZodValidationPipe(storeIdParamSchema)) params: StoreIdParam,
    @CurrentUser('id') userId: string,
  ): Promise<{ items: StoreInventoryEntry[]; meta: { page: number; perPage: number; total: number; totalPages: number; hasNextPage: boolean; hasPreviousPage: boolean } }> {
    return this.storeInventoryService.listStoreInventory(params.storeId, userId, {
      page: 1,
      limit: 100,
      lowStock: 'true',
    });
  }

  @Get(':inventoryId')
  async getInventory(
    @Param(new ZodValidationPipe(storeIdParamSchema)) params: StoreIdParam,
    @Param(new ZodValidationPipe(storeInventoryIdParamSchema)) invParams: StoreInventoryIdParam,
    @CurrentUser('id') userId: string,
  ): Promise<StoreInventoryEntry> {
    return this.storeInventoryService.getStoreInventory(
      params.storeId,
      invParams.inventoryId,
      userId,
    );
  }

  @Post(':inventoryId/receive')
  async receiveStock(
    @Param(new ZodValidationPipe(storeIdParamSchema)) params: StoreIdParam,
    @Param(new ZodValidationPipe(storeInventoryIdParamSchema)) invParams: StoreInventoryIdParam,
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(receiveStockSchema)) body: ReceiveStockRequest,
  ): Promise<StoreInventoryEntry> {
    return this.storeInventoryService.receiveStock(
      invParams.inventoryId,
      params.storeId,
      userId,
      body.quantity,
      body.reason,
    );
  }

  @Post(':inventoryId/adjust')
  async adjustStock(
    @Param(new ZodValidationPipe(storeIdParamSchema)) params: StoreIdParam,
    @Param(new ZodValidationPipe(storeInventoryIdParamSchema)) invParams: StoreInventoryIdParam,
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(adjustStockSchema)) body: AdjustStockRequest,
  ): Promise<StoreInventoryEntry> {
    return this.storeInventoryService.adjustStock(
      invParams.inventoryId,
      params.storeId,
      userId,
      body.quantityDelta,
      body.reason,
    );
  }
}
