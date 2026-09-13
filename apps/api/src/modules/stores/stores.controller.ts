import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  storeListQuerySchema,
  storeStaffListQuerySchema,
  createStoreSchema,
  updateStoreSchema,
  assignStoreStaffSchema,
  updateStoreStaffSchema,
  storeIdParamSchema,
  storeStaffIdParamSchema,
  type StoreListQuery,
  type StoreStaffListQuery,
  type CreateStoreRequest,
  type UpdateStoreRequest,
  type AssignStoreStaffRequest,
  type UpdateStoreStaffRequest,
  type StoreIdParam,
  type StoreStaffIdParam,
} from '@sakya/validation';
import type {
  StoreDetail,
  PaginatedStores,
  StoreStaffDetail,
  PaginatedStoreStaff,
} from '@sakya/types';
import { StoresService } from './stores.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

/** Admin store management endpoints.
 *
 * All endpoints require ADMIN or SUPER_ADMIN role plus specific permissions.
 * Store managers can be granted scoped access via store_staff.
 */
@Controller('admin/stores')
@UseGuards(PermissionsGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
export class StoresController {
  constructor(private readonly storesService: StoresService) {}

  // -----------------------------------------------------------------------
  // Store CRUD
  // -----------------------------------------------------------------------

  @Permissions('stores:read')
  @Get()
  async listStores(
    @Query(new ZodValidationPipe(storeListQuerySchema)) query: StoreListQuery,
  ): Promise<PaginatedStores> {
    return this.storesService.listStores(query);
  }

  @Permissions('stores:read')
  @Get(':storeId')
  async getStore(
    @Param(new ZodValidationPipe(storeIdParamSchema)) params: StoreIdParam,
  ): Promise<StoreDetail> {
    return this.storesService.getStoreById(params.storeId);
  }

  @Permissions('stores:write')
  @Post()
  async createStore(
    @Body(new ZodValidationPipe(createStoreSchema)) body: CreateStoreRequest,
  ): Promise<StoreDetail> {
    return this.storesService.createStore(body);
  }

  @Permissions('stores:write')
  @Patch(':storeId')
  async updateStore(
    @Param(new ZodValidationPipe(storeIdParamSchema)) params: StoreIdParam,
    @Body(new ZodValidationPipe(updateStoreSchema)) body: UpdateStoreRequest,
  ): Promise<StoreDetail> {
    return this.storesService.updateStore(params.storeId, body);
  }

  @Permissions('stores:write')
  @Delete(':storeId')
  async deleteStore(
    @Param(new ZodValidationPipe(storeIdParamSchema)) params: StoreIdParam,
  ): Promise<{ message: string }> {
    // Soft delete: deactivate the store
    await this.storesService.updateStore(params.storeId, { isActive: false });
    return { message: 'Store deactivated successfully' };
  }

  // -----------------------------------------------------------------------
  // Store staff management
  // -----------------------------------------------------------------------

  @Permissions('stores:read', 'stores:staff:manage')
  @Get(':storeId/staff')
  async listStoreStaff(
    @Param(new ZodValidationPipe(storeIdParamSchema)) params: StoreIdParam,
    @Query(new ZodValidationPipe(storeStaffListQuerySchema)) query: StoreStaffListQuery,
  ): Promise<PaginatedStoreStaff> {
    return this.storesService.listStoreStaff(params.storeId, query);
  }

  @Permissions('stores:staff:manage')
  @Get(':storeId/staff/:userId')
  async getStoreStaff(
    @Param(new ZodValidationPipe(storeStaffIdParamSchema)) params: StoreStaffIdParam,
  ): Promise<StoreStaffDetail> {
    return this.storesService.getStoreStaff(params.storeId, params.userId);
  }

  @Permissions('stores:staff:manage')
  @Post(':storeId/staff')
  async assignStoreStaff(
    @Param(new ZodValidationPipe(storeIdParamSchema)) params: StoreIdParam,
    @Body(new ZodValidationPipe(assignStoreStaffSchema)) body: AssignStoreStaffRequest,
  ): Promise<StoreStaffDetail> {
    return this.storesService.assignStoreStaff(params.storeId, body);
  }

  @Permissions('stores:staff:manage')
  @Patch(':storeId/staff/:userId')
  async updateStoreStaff(
    @Param(new ZodValidationPipe(storeStaffIdParamSchema)) params: StoreStaffIdParam,
    @Body(new ZodValidationPipe(updateStoreStaffSchema)) body: UpdateStoreStaffRequest,
  ): Promise<StoreStaffDetail> {
    return this.storesService.updateStoreStaff(params.storeId, params.userId, body);
  }

  @Permissions('stores:staff:manage')
  @Delete(':storeId/staff/:userId')
  async removeStoreStaff(
    @Param(new ZodValidationPipe(storeStaffIdParamSchema)) params: StoreStaffIdParam,
  ): Promise<{ message: string }> {
    await this.storesService.removeStoreStaff(params.storeId, params.userId);
    return { message: 'Staff member removed from store' };
  }
}
