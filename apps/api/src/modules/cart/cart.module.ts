import { Module } from '@nestjs/common';

import { CartController } from './cart.controller';
import { CartService } from './cart.service';

/**
 * Carts.
 *
 * Implemented:
 *
 *   GET    /                       the current cart with server-computed totals
 *   POST   /items                  add an item
 *   PATCH  /items/:itemId          change a quantity
 *   DELETE /items/:itemId          remove an item
 *   DELETE /                       empty the cart
 *   POST   /coupon                 apply a coupon code
 *   DELETE /coupon                 remove the applied coupon
 *
 * The client sends only variant ids and quantities. Unit prices, line totals,
 * discounts, tax and shipping are all computed server-side on every read:
 * anything a client sends about money is ignored.
 *
 * `CartService` is exported so `OrdersModule` can place orders from the current
 * cart using the same totals and coupon logic.
 */
@Module({
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
