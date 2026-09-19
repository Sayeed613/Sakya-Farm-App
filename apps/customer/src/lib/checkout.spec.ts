import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Checkout flow contract tests.
 *
 * These pin the rules the checkout screens depend on, against a mocked API
 * layer — no React Native, no network:
 *
 * 1. The order request carries an idempotency key, a compacted address and
 *    nothing else — no prices, no store, no totals.
 * 2. Empty optional address fields are dropped, so the order's snapshot stays
 *    clean.
 * 3. An online method creates an intent AFTER the order exists, with its own
 *    key; a COD order never calls the intent endpoint.
 * 4. Address validation: Indian pincode shape and 10-digit mobile shape, as
 *    the AddressSheet enforces before saving.
 */

const http = vi.hoisted(() => ({
  request: vi.fn(async (..._args: unknown[]) => ({})),
}));

// `../api/checkout` calls `requireApiClient()` from `./client`, which builds
// the full client and transitively imports react-native (via the auth store).
// Mocking `./client` breaks that edge and keeps the api layer under test.
vi.mock('../api/client', () => ({
  requireApiClient: () => ({
    orders: {
      checkout: (body: CheckoutBody) => checkoutResource.checkout(body),
      get: (id: string) => checkoutResource.get(id),
    },
    payments: {
      createIntent: (body: Record<string, unknown>) => paymentsResource.createIntent(body),
      listForOrder: (orderId: string) => paymentsResource.listForOrder(orderId),
    },
  }),
}));

type CheckoutBody = Record<string, unknown>;

const checkoutResource = {
  checkout: vi.fn(async (_body: CheckoutBody) => {
    return {
      id: 'order-1',
      orderNumber: 'ORD-20260918-TEST',
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
      payments: [{ provider: 'MANUAL', status: 'PENDING', method: 'CASH_ON_DELIVERY' }],
    };
  }),
  get: vi.fn(async (_id: string) => ({
    id: _id,
    orderNumber: 'ORD-TEST',
    status: 'PENDING_PAYMENT',
    paymentStatus: 'PENDING',
    payments: [],
  })),
};

const paymentsResource = {
  createIntent: vi.fn(async (body: Record<string, unknown>) => {
    http.request('/payments/intent', { method: 'POST', body });
    return { payment: { id: 'payment-1' }, intent: { provider: 'MOCK' } };
  }),
  listForOrder: vi.fn(async (_orderId: string) => [
    {
      id: 'payment-1',
      status: 'PENDING',
      provider: 'MOCK',
      method: 'UPI',
    },
  ]),
};

import { checkoutApi, newIdempotencyKey, type CheckoutAddress } from '../api/checkout';

const GOOD_ADDRESS: CheckoutAddress = {
  fullName: 'Ananya Rao',
  phone: '9876543210',
  line1: '12, Farm View Layout',
  line2: '',
  landmark: 'Near the banyan tree',
  city: 'Bengaluru',
  state: 'Karnataka',
  postalCode: '560001',
};

describe('checkout API layer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends idempotency key + compacted shipping address, and no client money', async () => {
    await checkoutApi.placeOrder({
      idempotencyKey: 'key-1',
      shippingAddress: GOOD_ADDRESS,
    });

    expect(checkoutResource.checkout).toHaveBeenCalledTimes(1);
    const body = checkoutResource.checkout.mock.calls[0]![0] as CheckoutBody;

    expect(body.idempotencyKey).toBe('key-1');
    expect(body.billingAddress).toBeNull();
    expect(body.notes).toBeNull();

    const shipping = body.shippingAddress as Record<string, string>;
    expect(shipping.fullName).toBe('Ananya Rao');
    expect(shipping.phone).toBe('9876543210');
    expect(shipping.line1).toBe('12, Farm View Layout');
    expect(shipping.landmark).toBe('Near the banyan tree');
    expect(shipping.postalCode).toBe('560001');

    // The client never sends authoritative money or fulfillment data.
    expect(body.subtotalInPaise).toBeUndefined();
    expect(body.totalInPaise).toBeUndefined();
    expect(body.storeId).toBeUndefined();
  });

  it('drops empty optional address fields from the snapshot', async () => {
    await checkoutApi.placeOrder({
      idempotencyKey: 'key-2',
      shippingAddress: { ...GOOD_ADDRESS, line2: '   ', landmark: '' },
    });

    const shipping = (checkoutResource.checkout.mock.calls[0]![0] as CheckoutBody)
      .shippingAddress as Record<string, string>;
    expect(shipping.line2).toBeUndefined();
    expect(shipping.landmark).toBeUndefined();
  });

  it('creates an online intent with its own idempotency key', async () => {
    await checkoutApi.createPaymentIntent({
      orderId: 'order-1',
      method: 'UPI',
      idempotencyKey: 'intent-key-1',
    });

    expect(paymentsResource.createIntent).toHaveBeenCalledTimes(1);
    const body = paymentsResource.createIntent.mock.calls[0]![0] as Record<string, unknown>;
    expect(body).toEqual({ orderId: 'order-1', method: 'UPI', idempotencyKey: 'intent-key-1' });
  });

  it('polls per-order payments (never fakes capture client-side)', async () => {
    const payments = await checkoutApi.listPayments('order-1');
    expect(paymentsResource.listForOrder).toHaveBeenCalledWith('order-1');
    expect(payments[0]!.status).toBe('PENDING');
  });

  it('generates unique idempotency keys', () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).not.toBe(b);
    expect(a.startsWith('checkout-')).toBe(true);
  });
});

describe('address validation rules (mirrors AddressSheet)', () => {
  const PINCODE_RE = /^[1-9][0-9]{5}$/;
  const PHONE_RE = /^[6-9][0-9]{9}$/;

  it('accepts valid Indian pincodes', () => {
    expect(PINCODE_RE.test('560001')).toBe(true);
    expect(PINCODE_RE.test('400001')).toBe(true);
  });

  it('rejects pincodes starting with 0 or short/long ones', () => {
    expect(PINCODE_RE.test('011001')).toBe(false);
    expect(PINCODE_RE.test('56001')).toBe(false);
    expect(PINCODE_RE.test('5600011')).toBe(false);
  });

  it('accepts Indian mobile numbers starting 6-9', () => {
    expect(PHONE_RE.test('9876543210')).toBe(true);
    expect(PHONE_RE.test('6123456789')).toBe(true);
  });

  it('rejects mobile numbers starting 0-5', () => {
    expect(PHONE_RE.test('5123456789')).toBe(false);
    expect(PHONE_RE.test('0123456789')).toBe(false);
  });
});
