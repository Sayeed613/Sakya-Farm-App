import type { OrderResponse } from '@sakya/types';
import type { CancelOrderRequest } from '@sakya/validation';

import { requireApiClient } from './client';

/**
 * Order actions the customer can perform on their own orders.
 *
 * `cancel` posts a required human-readable reason; the server re-checks the
 * ownership, the legal status transition (`canTransitionOrder`) and the
 * reservation ledger, so a cancelled order always releases its stock exactly
 * once. Errors surface as rejections the screen can render.
 */
export const orderActionsApi = {
  cancel: (orderId: string, input: CancelOrderRequest): Promise<OrderResponse> =>
    requireApiClient().http.request<OrderResponse>(`/orders/${encodeURIComponent(orderId)}/cancel`, {
      method: 'POST',
      body: input,
    }),
};
