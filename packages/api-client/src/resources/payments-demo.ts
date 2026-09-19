import type { PaymentDetail } from '@sakya/types';
import { paymentIdParamSchema, simulatePaymentSchema, type SimulatePaymentRequest } from '@sakya/validation';

import type { HttpClient } from '../http';
import { parseInput } from '../schema';

/**
 * Demo payment surface — present only while the platform runs on the MOCK
 * provider. Drives a real provider-outcome through the server's webhook state
 * machine for a demo build; production builds never construct this resource.
 */
export interface PaymentsDemoResource {
  /**
   * Simulate the provider's answer for one of the caller's open MOCK
   * payments: `success` captures through the normal webhook path, `failure`
   * declines it the same way. The returned detail is the post-transition
   * server state — the UI polls `listForOrder`, never trusts this alone.
   */
  simulate(input: { paymentId: string } & SimulatePaymentRequest): Promise<PaymentDetail>;
}

export function createPaymentsDemoResource(http: HttpClient): PaymentsDemoResource {
  return {
    async simulate(input) {
      const { id } = parseInput(paymentIdParamSchema, { id: input.paymentId }, 'Payment id');
      const body = parseInput(simulatePaymentSchema, { outcome: input.outcome }, 'Payment simulation');

      return http.request<PaymentDetail>(`/payments/${encodeURIComponent(id)}/simulate`, {
        method: 'POST',
        body,
      });
    },
  };
}
