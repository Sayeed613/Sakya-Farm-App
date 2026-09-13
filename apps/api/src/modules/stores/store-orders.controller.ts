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
  storeOrderListQuerySchema,
  storeOrderStatusUpdateSchema,
  storeIdParamSchema,
  storeOrderIdParamSchema,
  type StoreOrderListQuery,
  type StoreOrderStatusUpdateRequest,
  type StoreIdParam,
  type StoreOrderIdParam,
} from '@sakya/validation';
import type {
  StoreOrderDetail,
  PaginatedStoreOrders,
} from '@sakya/types';
import { StoreOrdersService } from './store-orders.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

/** Store-facing order operations.
 *
 * Requires STORE_MANAGER or STORE_STAFF role.
 * Users can only access orders for stores they are staff members of.
 */
@Controller('stores/:storeId/orders')
@UseGuards(PermissionsGuard)
@Roles('STORE_MANAGER', 'STORE_STAFF')
@Permissions('orders:read:store', 'orders:update:store')
export class StoreOrdersController {
  constructor(private readonly storeOrdersService: StoreOrdersService) {}

  @Get()
  async listOrders(
    @Param(new ZodValidationPipe(storeIdParamSchema)) params: StoreIdParam,
    @CurrentUser('id') userId: string,
    @Query(new ZodValidationPipe(storeOrderListQuerySchema)) query: StoreOrderListQuery,
  ): Promise<PaginatedStoreOrders> {
    return this.storeOrdersService.listStoreOrders(params.storeId, userId, query);
  }

  @Get(':orderId')
  async getOrder(
    @Param(new ZodValidationPipe(storeIdParamSchema)) params: StoreIdParam,
    @Param(new ZodValidationPipe(storeOrderIdParamSchema)) orderParams: StoreOrderIdParam,
    @CurrentUser('id') userId: string,
  ): Promise<StoreOrderDetail> {
    return this.storeOrdersService.getStoreOrder(params.storeId, orderParams.orderId, userId);
  }

  @Patch(':orderId/status')
  async updateOrderStatus(
    @Param(new ZodValidationPipe(storeIdParamSchema)) params: StoreIdParam,
    @Param(new ZodValidationPipe(storeOrderIdParamSchema)) orderParams: StoreOrderIdParam,
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(storeOrderStatusUpdateSchema)) body: StoreOrderStatusUpdateRequest,
  ): Promise<StoreOrderDetail> {
    return this.storeOrdersService.updateStoreOrderStatus(
      params.storeId,
      orderParams.orderId,
      userId,
      body,
    );
  }
}
