import { requireApiClient } from './client';

export const cartApi = {
  getCart: () => requireApiClient().cart.getCart(),
  /** Add a variant; the server resolves the fulfillment store. */
  addItem: (input: { variantId: string; quantity: number }) =>
    requireApiClient().cart.addItem(input),
  updateItem: (itemId: string, input: { quantity: number }) =>
    requireApiClient().cart.updateItem(itemId, input),
  removeItem: (itemId: string) => requireApiClient().cart.removeItem(itemId),
  /** Apply a coupon code; the server validates limits and computes the discount. */
  applyCoupon: (code: string) => requireApiClient().cart.applyCoupon({ code }),
  removeCoupon: () => requireApiClient().cart.removeCoupon(),
};
