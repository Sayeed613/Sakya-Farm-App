import type { PaymentDetail, PaymentIntentResponse } from '@sakya/types';
import {
  createPaymentIntentSchema,
  paymentOrderIdParamSchema,
  type CreatePaymentIntentRequest,
} from '@sakya/validation';

import type { HttpClient } from '../http';
import { parseInput } from '../schema';

/**
 * Payment endpoints for the signed-in customer.
 *
 * There is deliberately NO confirm endpoint: payment state advances only via
 * provider-signed webhooks on the server. The client creates an intent (COD is
 * already anchored by checkout itself) and then *polls* `listForOrder` until
 * the attempt resolves — the poll is the "did it go through" check, and it
 * cannot be forged, because it reads server state.
 */
export interface PaymentsResource {
  /** Create an online payment intent for one of the caller's orders. */
  createIntent(input: CreatePaymentIntentRequest): Promise<PaymentIntentResponse>;

  /** Every payment attempt against one of the caller's orders, oldest first. */
  listForOrder(orderId: string): Promise<PaymentDetail[]>;
}

export function createPaymentsResource(http: HttpClient): PaymentsResource {
  return {
    async createIntent(input: CreatePaymentIntentRequest): Promise<PaymentIntentResponse> {
      const body = parseInput(createPaymentIntentSchema, input, 'Payment intent');

      return http.request<PaymentIntentResponse>('/payments/intent', { method: 'POST', body });
    },

    async listForOrder(orderId: string): Promise<PaymentDetail[]> {
      const { orderId: parsed } = parseInput(paymentOrderIdParamSchema, { orderId }, 'Order id');

      return http.request<PaymentDetail[]>(`/payments/orders/${encodeURIComponent(parsed)}`);
    },
  };
}
