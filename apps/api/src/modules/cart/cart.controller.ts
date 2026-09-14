import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  addCartItemSchema,
  applyCouponSchema,
  updateCartItemSchema,
  type AddCartItemRequest,
  type ApplyCouponRequest,
  type UpdateCartItemRequest,
} from '@sakya/validation';
import type { CartResponse } from '@sakya/types';
import { CartService } from './cart.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

@Controller('cart')
@UseGuards(PermissionsGuard)
export class CartController {
  constructor(private readonly cartService: CartService) {}

  /** The current cart with server-computed totals. */
  @Permissions('cart:read')
  @Get()
  async getCart(@CurrentUser('id') userId: string): Promise<CartResponse> {
    return this.cartService.getCurrentCart(userId);
  }

  /** Add an item to the current cart. */
  @Permissions('cart:write')
  @Post('items')
  async addItem(
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(addCartItemSchema)) body: AddCartItemRequest,
  ): Promise<CartResponse> {
    return this.cartService.addItem(userId, body);
  }

  /** Change the quantity of one cart item. */
  @Permissions('cart:write')
  @Patch('items/:itemId')
  async updateItem(
    @CurrentUser('id') userId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(updateCartItemSchema)) body: UpdateCartItemRequest,
  ): Promise<CartResponse> {
    return this.cartService.updateItem(userId, itemId, body);
  }

  /** Remove one cart item. */
  @Permissions('cart:write')
  @Delete('items/:itemId')
  async removeItem(
    @CurrentUser('id') userId: string,
    @Param('itemId') itemId: string,
  ): Promise<CartResponse> {
    return this.cartService.removeItem(userId, itemId);
  }

  /** Empty the current cart. */
  @Permissions('cart:write')
  @Delete()
  async clearCart(@CurrentUser('id') userId: string): Promise<CartResponse> {
    return this.cartService.clearCart(userId);
  }

  /**
   * Apply a coupon code to the current cart.
   *
   * Applying a coupon changes an existing cart and creates no new resource, so
   * this answers `200 OK` rather than the `201` a POST defaults to.
   */
  @Permissions('cart:write')
  @HttpCode(HttpStatus.OK)
  @Post('coupon')
  async applyCoupon(
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(applyCouponSchema)) body: ApplyCouponRequest,
  ): Promise<CartResponse> {
    return this.cartService.applyCoupon(userId, body);
  }

  /** Remove the coupon applied to the current cart. */
  @Permissions('cart:write')
  @Delete('coupon')
  async removeCoupon(@CurrentUser('id') userId: string): Promise<CartResponse> {
    return this.cartService.removeCoupon(userId);
  }
}
