import type { OrderResponse, OrdersResponse } from '@sakya/types';

import { requireApiClient } from './client';

/**
 * Orders — the caller's own orders only (server enforces `orders:read:own`).
 *
 * Used by the Orders tab (replacing Cart there) and the Orders page; the cart
 * pill keeps navigating to the cart screen.
 */
export const ordersApi = {
  list: (page = 1, limit = 20) =>
    requireApiClient().http.request<OrdersResponse>('/orders', {
      query: { page: String(page), limit: String(limit) },
    }),
  get: (orderId: string) =>
    requireApiClient().http.request<OrderResponse>(`/orders/${encodeURIComponent(orderId)}`),
};
