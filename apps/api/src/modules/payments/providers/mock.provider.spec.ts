import { describe, expect, it } from 'vitest';

import { MOCK_WEBHOOK_SIGNATURE_HEADER, MockProvider, signMockWebhookBody } from './mock.provider';

const SECRET = 'test-only-mock-secret-that-is-long-enough';

function signedBody(payload: Record<string, unknown>): { raw: string; headers: Record<string, string> } {
  const raw = JSON.stringify(payload);
  return { raw, headers: { [MOCK_WEBHOOK_SIGNATURE_HEADER]: signMockWebhookBody(raw, SECRET) } };
}

describe('MockProvider signature boundary', () => {
  it('verifies a correctly signed body', () => {
    const { raw, headers } = signedBody({ type: 'captured', providerPaymentId: 'mock_1' });
    expect(new MockProvider(SECRET).verifyWebhookSignature(raw, headers)).toBe(true);
  });

  it('rejects a forged signature', () => {
    expect(
      new MockProvider(SECRET).verifyWebhookSignature('{"type":"captured"}', {
        [MOCK_WEBHOOK_SIGNATURE_HEADER]: 'deadbeef',
      }),
    ).toBe(false);
  });

  it('rejects a missing signature header', () => {
    expect(new MockProvider(SECRET).verifyWebhookSignature('{}', {})).toBe(false);
  });

  it('rejects a body signed with a different secret', () => {
    const { raw, headers } = signedBody({ type: 'captured', providerPaymentId: 'mock_1' });
    expect(new MockProvider('a-completely-different-secret-value').verifyWebhookSignature(raw, headers)).toBe(false);
  });

  it('rejects tampered bodies', () => {
    const { headers } = signedBody({ type: 'captured', providerPaymentId: 'mock_1' });
    expect(
      new MockProvider(SECRET).verifyWebhookSignature(
        JSON.stringify({ type: 'captured', providerPaymentId: 'mock_2', amountInPaise: 1 }),
        headers,
      ),
    ).toBe(false);
  });

  it('parses a valid normalised event', () => {
    const { raw } = signedBody({ type: 'captured', providerPaymentId: 'mock_1', amountInPaise: 49900 });
    const event = new MockProvider(SECRET).parseWebhookEvent(raw);
    expect(event).toMatchObject({ type: 'captured', providerPaymentId: 'mock_1', amountInPaise: 49900 });
  });

  it('rejects an unknown event type without state implications', () => {
    expect(() =>
      new MockProvider(SECRET).parseWebhookEvent(JSON.stringify({ type: 'moon', providerPaymentId: 'x' })),
    ).toThrow();
  });
});
