import type { OnlinePaymentMethod } from '../../../src/api/checkout';

/**
 * Copy for the collapsed Payment Method row (mirrors the method radios).
 */
export function paymentCopy(method: 'COD' | OnlinePaymentMethod): {
  title: string;
  blurb: string;
} {
  if (method === 'COD') {
    return { title: 'Cash on Delivery', blurb: 'Pay when your order arrives' };
  }
  if (method === 'UPI') {
    return { title: 'UPI', blurb: 'GPay, PhonePe, Paytm & all UPI apps' };
  }
  return { title: 'Card', blurb: 'Credit / debit card — Visa, Mastercard, RuPay' };
}
