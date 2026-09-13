import { Module } from '@nestjs/common';

/**
 * Coupons and their redemption.
 *
 * Scaffolded only. Planned endpoints under `/api/v1/coupons`:
 *
 *   POST   /validate              check a code against a cart (no redemption)
 *   GET    /                      list coupons                   (coupons:read)
 *   POST   /                      create a coupon                (coupons:write)
 *   PATCH  /:id                   update a coupon                (coupons:write)
 *   PATCH  /:id/active            enable or disable a coupon     (coupons:write)
 *   GET    /:id/redemptions       redemption history             (coupons:read)
 *
 * `value` is interpreted by `type`: basis points for PERCENTAGE (so no float
 * ever touches a total), paise for FIXED_AMOUNT, and ignored for FREE_SHIPPING.
 * A redemption is recorded in `coupon_redemptions`, whose unique `order_id`
 * makes retrying an order safe; `redeemed_count` is incremented in the same
 * transaction as the redemption.
 */
@Module({})
export class CouponsModule {}
