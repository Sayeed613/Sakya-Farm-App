import { describe, expect, it } from 'vitest';

import { canTransitionPayment, PAYMENT_TRANSITIONS } from './payment-transitions';

describe('payment state machine', () => {
  it('allows the capture path PENDING -> AUTHORIZED -> CAPTURED', () => {
    expect(canTransitionPayment('PENDING', 'AUTHORIZED')).toBe(true);
    expect(canTransitionPayment('AUTHORIZED', 'CAPTURED')).toBe(true);
  });

  it('allows direct PENDING -> CAPTURED for providers without authorization', () => {
    expect(canTransitionPayment('PENDING', 'CAPTURED')).toBe(true);
  });

  it('allows the refund path CAPTURED -> PARTIALLY_REFUNDED -> REFUNDED', () => {
    expect(canTransitionPayment('CAPTURED', 'PARTIALLY_REFUNDED')).toBe(true);
    expect(canTransitionPayment('PARTIALLY_REFUNDED', 'REFUNDED')).toBe(true);
  });

  it('treats same-state redelivery as idempotent', () => {
    for (const status of Object.keys(PAYMENT_TRANSITIONS)) {
      expect(canTransitionPayment(status as never, status as never)).toBe(true);
    }
  });

  it('rejects transitions out of terminal states', () => {
    expect(canTransitionPayment('FAILED', 'CAPTURED')).toBe(false);
    expect(canTransitionPayment('CANCELLED', 'PENDING')).toBe(false);
    expect(canTransitionPayment('REFUNDED', 'PARTIALLY_REFUNDED')).toBe(false);
  });

  it('rejects capture of never-authorized money and refund of pending money', () => {
    expect(canTransitionPayment('PENDING', 'REFUNDED')).toBe(false);
    expect(canTransitionPayment('AUTHORIZED', 'REFUNDED')).toBe(false);
    expect(canTransitionPayment('FAILED', 'REFUNDED')).toBe(false);
  });
});
