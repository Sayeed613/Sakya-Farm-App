import type { OrderResponse, PaymentDetail, PaymentIntentResponse } from '@sakya/types';
import type { CheckoutRequest, CreatePaymentIntentRequest } from '@sakya/validation';

import { requireApiClient } from './client';

/**
 * Checkout + payment API surface.
 *
 * Every total in every response is the server's. The client sends an address,
 * a note, an idempotency key and a payment-method choice — nothing else. A
 * retried `placeOrder` cannot double-place: the key returns the original order.
 */

/** The checkout payload the UI builds. Address is a typed view; the API takes a record. */
export type CheckoutAddress = {
  fullName: string;
  phone: string;
  line1: string;
  line2?: string;
  landmark?: string;
  city: string;
  state: string;
  postalCode: string;
};

/** Online payment methods the customer UI offers. COD never reaches here. */
export type OnlinePaymentMethod = 'UPI' | 'CARD' | 'NET_BANKING';

export const checkoutApi = {
  /** Place the order from the current server cart. */
  placeOrder: (input: {
    idempotencyKey: string;
    shippingAddress: CheckoutAddress;
    billingAddress?: CheckoutAddress | null;
    notes?: string | null;
  }): Promise<OrderResponse> => {
    const body: CheckoutRequest = {
      idempotencyKey: input.idempotencyKey,
      shippingAddress: compactAddress(input.shippingAddress),
      billingAddress:
        input.billingAddress === undefined || input.billingAddress === null
          ? null
          : compactAddress(input.billingAddress),
      notes: input.notes ?? null,
    };
    return requireApiClient().orders.checkout(body);
  },

  /** Create an online payment intent for a placed order. */
  createPaymentIntent: (input: {
    orderId: string;
    method: OnlinePaymentMethod;
    idempotencyKey: string;
  }): Promise<PaymentIntentResponse> => {
    const body: CreatePaymentIntentRequest = {
      orderId: input.orderId,
      method: input.method,
      idempotencyKey: input.idempotencyKey,
    };
    return requireApiClient().payments.createIntent(body);
  },

  /** Every payment attempt against an order, oldest first. Polled, never trusted. */
  listPayments: (orderId: string): Promise<PaymentDetail[]> =>
    requireApiClient().payments.listForOrder(orderId),

  /**
   * Demo builds only: simulate the provider's answer for a MOCK payment.
   * Goes through the server's real webhook state machine; production builds
   * never construct this call (the server 404s the route).
   */
  simulatePayment: (input: { paymentId: string; outcome: 'success' | 'failure' }): Promise<PaymentDetail> =>
    requireApiClient().paymentsDemo.simulate(input),
};

/** Drop empty optional fields so the order's address snapshot stays clean. */
function compactAddress(address: CheckoutAddress): Record<string, string> {
  const record: Record<string, string> = {
    fullName: address.fullName,
    phone: address.phone,
    line1: address.line1,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
  };
  if (address.line2 !== undefined && address.line2.trim() !== '') {
    record.line2 = address.line2.trim();
  }
  if (address.landmark !== undefined && address.landmark.trim() !== '') {
    record.landmark = address.landmark.trim();
  }
  return record;
}

/** A fresh idempotency key for one place-order / pay attempt. */
export function newIdempotencyKey(): string {
  // Uniqueness only — the server dedupes on this key, it is not a secret.
  // `crypto.randomUUID` is unavailable in React Native, so build a v4-format
  // UUID from `Math.random` (sufficient for idempotency-key purposes).
  const hex = '0123456789abcdef';
  let uuid = '';
  for (let i = 0; i < 32; i += 1) {
    if (i === 12) uuid += '4';
    else if (i === 16) uuid += hex[8 + Math.floor(Math.random() * 4)];
    else uuid += hex[Math.floor(Math.random() * 16)];
  }
  return `checkout-${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`;
}
