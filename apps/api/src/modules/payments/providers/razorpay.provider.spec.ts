import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RazorpayProvider } from './razorpay.provider';

const WEBHOOK_SECRET = 'razorpay-webhook-secret-for-tests';

function signedPayload(payload: Record<string, unknown>) {
  const body = JSON.stringify(payload);
  const signature = createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
  return { body, headers: { 'x-razorpay-signature': signature } };
}

describe('RazorpayProvider', () => {
  const provider = new RazorpayProvider('rzp_test_key', 'key-secret', WEBHOOK_SECRET);

  it('verifies signatures against the exact raw request body', () => {
    const signed = signedPayload({ event: 'payment.captured' });

    expect(provider.verifyWebhookSignature(signed.body, signed.headers)).toBe(true);
    expect(provider.verifyWebhookSignature(`${signed.body} `, signed.headers)).toBe(false);
    expect(provider.verifyWebhookSignature(signed.body, {})).toBe(false);
  });

  it('normalizes a captured payment and preserves its Razorpay order id', () => {
    const signed = signedPayload({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_test_1',
            order_id: 'order_test_1',
            amount: 12500,
            currency: 'INR',
          },
        },
      },
    });

    const event = provider.parseWebhookEvent(Buffer.from(signed.body));

    expect(event).toMatchObject({
      type: 'captured',
      providerPaymentId: 'pay_test_1',
      providerOrderId: 'order_test_1',
      amountInPaise: 12500,
      currency: 'INR',
    });
  });

  it('rejects webhook payloads that cannot be safely correlated', () => {
    expect(() => provider.parseWebhookEvent({ event: 'payment.captured', payload: {} })).toThrow(
      'Razorpay webhook does not contain a valid payment entity',
    );
    expect(() => provider.parseWebhookEvent({ event: 'subscription.activated' })).toThrow(
      'Unsupported Razorpay webhook event',
    );
  });
});

describe('RazorpayProvider capturePayment', () => {
  const provider = new RazorpayProvider('rzp_test_key', 'key-secret', WEBHOOK_SECRET);
  const fetchMock = vi.fn();
  const input = { providerPaymentId: 'pay_test_1', amountInPaise: 12500, currency: 'INR' };

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('captures the full authorized amount at the gateway', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: 'pay_test_1', status: 'captured' }), { status: 200 }),
    );

    await provider.capturePayment(input);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.razorpay.com/v1/payments/pay_test_1/capture');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ amount: 12500, currency: 'INR' });
  });

  it('treats "already captured" as success so a repeated reconcile is harmless', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { description: 'The payment is already captured' } }), {
        status: 400,
      }),
    );

    await expect(provider.capturePayment(input)).resolves.toBeUndefined();
  });

  it('throws on any other capture failure so the caller retries next reconcile', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { description: 'Bad request' } }), { status: 400 }),
    );

    await expect(provider.capturePayment(input)).rejects.toThrow(
      'Razorpay could not capture the payment',
    );
  });

  it('throws when the gateway is unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(provider.capturePayment(input)).rejects.toThrow(
      'Razorpay could not capture the payment',
    );
  });
});