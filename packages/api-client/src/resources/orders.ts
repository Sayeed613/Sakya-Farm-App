import type { OrderResponse, OrdersResponse } from '@sakya/types';
import {
  cancelOrderSchema,
  checkoutSchema,
  orderIdParamSchema,
  orderListQuerySchema,
  type CancelOrderRequest,
  type CheckoutRequest,
  type OrderListQuery,
} from '@sakya/validation';

import type { HttpClient } from '../http';
import { parseInput } from '../schema';

/**
 * The signed-in customer's orders.
 *
 * `checkout` is the only write the cart flow performs, and it is fully
 * idempotent: the idempotency key travels with the request, so a retry after a
 * dropped connection returns the original order instead of placing a second
 * one. Every total in the response is server-computed — the client sends no
 * prices and the response's numbers are rendered verbatim.
 *
 * Every method is `async` so validation failures arrive as rejections rather
 * than synchronous throws; see `catalog.ts` for the same reasoning.
 */
export interface OrdersResource {
  /** Place an order from the current server cart. Totals are recomputed server-side. */
  checkout(input: CheckoutRequest): Promise<OrderResponse>;

  /** The caller's orders, newest first, optionally filtered by status. */
  list(query?: OrderListQuery): Promise<OrdersResponse>;

  /** Detail for one of the caller's orders. */
  get(orderId: string): Promise<OrderResponse>;

  /** Cancel one of the caller's orders when the transition is allowed. */
  cancel(orderId: string, input: CancelOrderRequest): Promise<OrderResponse>;
}

export function createOrdersResource(http: HttpClient): OrdersResource {
  return {
    async checkout(input: CheckoutRequest): Promise<OrderResponse> {
      const body = parseInput(checkoutSchema, input, 'Checkout request');

      return http.request<OrderResponse>('/orders', { method: 'POST', body });
    },

    async list(query?: OrderListQuery): Promise<OrdersResponse> {
      const parsed = query === undefined ? undefined : parseInput(orderListQuerySchema, query, 'Order list query');

      return http.request<OrdersResponse>('/orders', {
        query:
          parsed === undefined
            ? undefined
            : {
                page: String(parsed.page),
                limit: String(parsed.limit),
                ...(parsed.status === undefined ? {} : { status: parsed.status }),
              },
      });
    },

    async get(orderId: string): Promise<OrderResponse> {
      const { id } = parseInput(orderIdParamSchema, { id: orderId }, 'Order id');

      return http.request<OrderResponse>(`/orders/${encodeURIComponent(id)}`);
    },

    async cancel(orderId: string, input: CancelOrderRequest): Promise<OrderResponse> {
      const { id } = parseInput(orderIdParamSchema, { id: orderId }, 'Order id');
      const body = parseInput(cancelOrderSchema, input, 'Cancel reason');

      return http.request<OrderResponse>(`/orders/${encodeURIComponent(id)}/cancel`, {
        method: 'POST',
        body,
      });
    },
  };
}
