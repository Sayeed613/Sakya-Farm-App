import { describe, expect, it } from 'vitest';

import { ManualProvider } from './manual.provider';

describe('ManualProvider', () => {
  it('never verifies a webhook signature (COD has no webhooks)', () => {
    expect(new ManualProvider().verifyWebhookSignature('{}', { host: 'x' })).toBe(false);
  });

  it('rejects webhook parsing (COD emits no events)', () => {
    expect(() => new ManualProvider().parseWebhookEvent({})).toThrow();
  });

  it('builds a COD intent without secrets', () => {
    const intent = new ManualProvider().buildIntentResponse({
      paymentId: 'pay_1',
      provider: 'MANUAL',
      providerPaymentId: null,
      amountInPaise: 49900,
      currency: 'INR',
      method: 'CASH_ON_DELIVERY',
    });
    expect(intent).toEqual({
      method: 'CASH_ON_DELIVERY',
      payableOnDeliveryInPaise: 49900,
      currency: 'INR',
    });
  });
});
