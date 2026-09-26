import { percentageOf, subtractPaise, sumPaise, toPaise } from '@sakya/utils';
import type { Paise } from '@sakya/types';

/**
 * Server-owned pricing.
 *
 * One module computes every total for BOTH the cart preview and the order
 * snapshot, so the number a customer approves at checkout is bit-for-bit the
 * number the order stores. Previously cart and order each had their own copy
 * of the same constants and math, with tax and shipping as placeholders (0)
 * — the bill a customer saw was not the bill an order would carry.
 *
 * Rules (all values integer paise, floats never touch a total):
 * - discount applies to the subtotal first
 * - GST is charged on the DISCOUNTED subtotal (inclusive-of-discount basis)
 * - shipping is flat per config, free at/above the configured threshold
 * - the COD fee, when configured, is collected into `shippingInPaise` so the
 *   existing bill breakdown keeps its four rows
 * - FREE_SHIPPING coupons zero the shipping charge
 */

export interface PricingCouponInput {
  type: 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FREE_SHIPPING';
  /** PERCENTAGE: basis points (1250 = 12.5%). FIXED_AMOUNT: paise. */
  valueInPaise: number;
  minOrderInPaise: number;
  maxDiscountInPaise: number | null;
}

export interface PricingInput {
  /** Line totals in paise: unit price × quantity, already summed. */
  subtotalInPaise: number;
  coupon: PricingCouponInput | null;
  /** Cash on Delivery selected — adds the configured COD fee when non-zero. */
  isCod?: boolean;
}

export interface PricingResult {
  subtotalInPaise: Paise;
  discountInPaise: Paise;
  taxInPaise: Paise;
  shippingInPaise: Paise;
  totalInPaise: Paise;
  /** Which portion of shippingInPaise is the COD fee, for honest receipts. */
  codFeeInPaise: Paise;
}

export interface PricingConfig {
  taxRatePercent: number;
  shippingFeeInPaise: number;
  freeShippingThresholdInPaise: number | null;
  codFeeInPaise: number;
}

export function computeTotals(
  input: PricingInput,
  config: PricingConfig,
): PricingResult {
  const subtotal = toPaise(input.subtotalInPaise);

  // An empty cart is never charged anything — shipping in particular must
  // not appear before the first item exists.
  if (subtotal <= 0) {
    return {
      subtotalInPaise: subtotal,
      discountInPaise: toPaise(0),
      taxInPaise: toPaise(0),
      shippingInPaise: toPaise(0),
      totalInPaise: toPaise(0),
      codFeeInPaise: toPaise(0),
    };
  }

  let discount: Paise = toPaise(0);
  const coupon = input.coupon;
  // Legacy coupon rows may predate the min-order column; a missing value
  // means "no minimum", not "never applies".
  const couponMinOrder =
    coupon !== null && Number.isFinite(coupon.minOrderInPaise) ? coupon.minOrderInPaise : 0;
  if (coupon !== null && subtotal >= couponMinOrder) {
    if (coupon.type === 'PERCENTAGE') {
      // Basis points → percent: 1250 basis points = 12.5%.
      discount = percentageOf(subtotal, coupon.valueInPaise / 100);
      // Legacy rows may predate the max-discount column; a missing value
      // means "no cap", not NaN.
      if (coupon.maxDiscountInPaise != null && Number.isFinite(coupon.maxDiscountInPaise)) {
        discount = toPaise(Math.min(discount, coupon.maxDiscountInPaise));
      }
    } else if (coupon.type === 'FIXED_AMOUNT') {
      discount = toPaise(Math.min(coupon.valueInPaise, subtotal));
    }
    // FREE_SHIPPING: discount stays 0; shipping is zeroed below.
  }

  const afterDiscount = subtractPaise(subtotal, discount);

  const tax = percentageOf(afterDiscount, config.taxRatePercent);

  let shipping: Paise;
  const threshold = config.freeShippingThresholdInPaise;
  const freeByThreshold = threshold !== null && afterDiscount >= threshold;
  const freeByCoupon = coupon?.type === 'FREE_SHIPPING' && subtotal >= couponMinOrder;
  if (freeByThreshold || freeByCoupon) {
    shipping = toPaise(0);
  } else {
    shipping = toPaise(config.shippingFeeInPaise);
  }

  // COD fee rides inside the shipping row so the bill keeps its shape.
  const codFee: Paise = input.isCod === true ? toPaise(config.codFeeInPaise) : toPaise(0);
  if (codFee > 0) {
    shipping = sumPaise(shipping, codFee);
  }

  return {
    subtotalInPaise: subtotal,
    discountInPaise: discount,
    taxInPaise: tax,
    shippingInPaise: shipping,
    totalInPaise: subtractPaise(sumPaise(subtotal, tax, shipping), discount),
    codFeeInPaise: codFee,
  };
}
