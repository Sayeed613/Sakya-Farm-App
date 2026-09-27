import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

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