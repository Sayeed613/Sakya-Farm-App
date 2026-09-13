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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  checkoutSchema,
  cancelReasonSchema,
  orderIdParamSchema,
  orderListQuerySchema,
  type OrderIdParam,
  type OrderListQuery,
} from '@sakya/validation';
import type { CheckoutRequest } from '@sakya/validation';
import type { OrderResponse, OrdersResponse, ShipmentDetail } from '@sakya/types';
import { OrdersService } from './orders.service';
import { DeliveryService } from '../delivery/delivery.service';
import { PrismaService } from '../../database/prisma.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

@Controller('orders')
@UseGuards(PermissionsGuard)
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly deliveryService: DeliveryService,
    private readonly prisma: PrismaService,
  ) {}

  /** Place an order from the current cart. Totals are recomputed server-side. */
  @Permissions('orders:write')
  @Post()
  async checkout(
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(checkoutSchema)) body: CheckoutRequest,
  ): Promise<OrderResponse> {
    return this.ordersService.checkout(userId, body);
  }

  /** List the caller's orders, optionally filtered by status. */
  @Permissions('orders:read:own')
  @Get()
  async listOwnOrders(
    @CurrentUser('id') userId: string,
    @Query(new ZodValidationPipe(orderListQuerySchema)) query: OrderListQuery,
  ): Promise<OrdersResponse> {
    return this.ordersService.listOwnOrders(userId, query);
  }

  /** Detail for one of the caller's orders. */
  @Permissions('orders:read:own')
  @Get(':id')
  async getOrder(
    @CurrentUser('id') userId: string,
    @Param(new ZodValidationPipe(orderIdParamSchema)) params: OrderIdParam,
  ): Promise<OrderResponse> {
    return this.ordersService.getOrderById(params.id, userId);
  }

  /** Cancel one of the caller's orders, when the transition is allowed. */
  @Permissions('orders:cancel')
  @Post(':id/cancel')
  async cancelOrder(
    @CurrentUser('id') userId: string,
    @Param(new ZodValidationPipe(orderIdParamSchema)) params: OrderIdParam,
    @Body(new ZodValidationPipe(cancelReasonSchema)) body: { reason: string },
  ): Promise<OrderResponse> {
    return this.ordersService.cancelOrder(params.id, userId, body.reason);
  }

  /** Status history for one of the caller's orders. */
  @Permissions('orders:read:own')
  @Get(':id/status-history')
  async statusHistory(
    @CurrentUser('id') userId: string,
    @Param(new ZodValidationPipe(orderIdParamSchema)) params: OrderIdParam,
  ): Promise<Array<{
    id: string;
    fromStatus: string | null;
    toStatus: string;
    reason: string | null;
    changedByUserId: string | null;
    createdAt: string;
  }>> {
    const order = await this.ordersService.getOrderById(params.id, userId);
    return order.statusHistory;
  }

  /** Delivery/shipping information for the caller's order. */
  @Permissions('orders:read:own')
  @Get(':id/delivery')
  async getDelivery(
    @CurrentUser('id') userId: string,
    @Param(new ZodValidationPipe(orderIdParamSchema)) params: OrderIdParam,
  ): Promise<ShipmentDetail | { message: string }> {
    const shipment = await this.deliveryService.getShipmentForOrder(params.id, userId);
    if (shipment === null) {
      return { message: 'No shipment created for this order yet' };
    }
    return shipment;
  }

  /** Store information for the caller's order. */
  @Permissions('orders:read:own')
  @Get(':id/store')
  async getStoreForOrder(
    @CurrentUser('id') userId: string,
    @Param(new ZodValidationPipe(orderIdParamSchema)) params: OrderIdParam,
  ): Promise<{ storeId: string; storeName: string; storeCode: string } | { message: string }> {
    const order = await this.prisma.order.findFirst({
      where: { id: params.id, userId },
      include: { store: { select: { id: true, name: true, code: true } } },
    });

    if (order === null || order.store === null) {
      return { message: 'No store assigned to this order' };
    }

    return {
      storeId: order.store.id,
      storeName: order.store.name,
      storeCode: order.store.code,
    };
  }
}
