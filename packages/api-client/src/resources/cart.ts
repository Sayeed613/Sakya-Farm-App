import type { CartResponse } from '@sakya/types';
import {
  addCartItemSchema,
  applyCouponSchema,
  mergeGuestCartSchema,
  updateCartItemSchema,
  uuidSchema,
  type AddCartItemRequest,
  type ApplyCouponRequest,
  type MergeGuestCartRequest,
  type UpdateCartItemRequest,
} from '@sakya/validation';

import type { HttpClient } from '../http';
import { parseInput } from '../schema';

/**
 * The signed-in customer's cart.
 *
 * Every route requires `cart:read` / `cart:write`, so each call needs a session.
 *
 * The client never sends prices. Line totals, subtotal, discount, tax, shipping
 * and total are computed by the server on every read, and this resource returns
 * that response verbatim — the app renders the server's numbers rather than
 * re-deriving them.
 *
 * `AddCartItemRequest.storeId` comes from the API, not from the app: the server
 * decides which store fulfils an order. No public store endpoint exists yet, so
 * the app cannot resolve that value on its own (see the report).
 *
 * Every method is `async` so validation failures arrive as rejections rather than
 * synchronous throws; see `catalog.ts` for the same reasoning.
 */
export interface CartResource {
  /** The current cart, with server-computed totals. */
  getCart(): Promise<CartResponse>;

  /** Add a variant, or increase its quantity if it is already in the cart. */
  addItem(input: AddCartItemRequest): Promise<CartResponse>;

  /** Replace the quantity of one line. */
  updateItem(itemId: string, input: UpdateCartItemRequest): Promise<CartResponse>;

  /** Remove one line. */
  removeItem(itemId: string): Promise<CartResponse>;

  /** Remove every line. */
  clearCart(): Promise<CartResponse>;

  /** Apply a coupon code. Answers `200`: it changes an existing cart. */
  applyCoupon(input: ApplyCouponRequest): Promise<CartResponse>;

  /** Remove the applied coupon. */
  removeCoupon(): Promise<CartResponse>;

  /**
   * Merge the guest cart accumulated before authentication. Sends variant ids
   * and quantities only; the server revalidates price, availability, stock and
   * the fulfillment store, and folds duplicates. Returns the merged cart.
   */
  mergeGuestCart(input: MergeGuestCartRequest): Promise<CartResponse>;
}

export function createCartResource(http: HttpClient): CartResource {
  function itemPath(itemId: string): string {
    const parsed = parseInput(uuidSchema, itemId, 'Cart item id');
    return `/cart/items/${encodeURIComponent(parsed)}`;
  }

  return {
    async getCart(): Promise<CartResponse> {
      return http.request<CartResponse>('/cart');
    },

    async addItem(input: AddCartItemRequest): Promise<CartResponse> {
      const body = parseInput(addCartItemSchema, input, 'Cart item');

      return http.request<CartResponse>('/cart/items', { method: 'POST', body });
    },

    async updateItem(itemId: string, input: UpdateCartItemRequest): Promise<CartResponse> {
      const body = parseInput(updateCartItemSchema, input, 'Cart item');

      return http.request<CartResponse>(itemPath(itemId), { method: 'PATCH', body });
    },

    async removeItem(itemId: string): Promise<CartResponse> {
      return http.request<CartResponse>(itemPath(itemId), { method: 'DELETE' });
    },

    async clearCart(): Promise<CartResponse> {
      return http.request<CartResponse>('/cart', { method: 'DELETE' });
    },

    async applyCoupon(input: ApplyCouponRequest): Promise<CartResponse> {
      const body = parseInput(applyCouponSchema, input, 'Coupon code');

      return http.request<CartResponse>('/cart/coupon', { method: 'POST', body });
    },

    async removeCoupon(): Promise<CartResponse> {
      return http.request<CartResponse>('/cart/coupon', { method: 'DELETE' });
    },

    async mergeGuestCart(input: MergeGuestCartRequest): Promise<CartResponse> {
      const body = parseInput(mergeGuestCartSchema, input, 'Guest cart');

      return http.request<CartResponse>('/cart/merge-guest-cart', { method: 'POST', body });
    },
  };
}
