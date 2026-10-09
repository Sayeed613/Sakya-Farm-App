import { describe, expect, it } from 'vitest';

import { resolveInitialPaymentMethod } from './payment-restore';

/**
 * Regression suite for the checkout payment-flag defect: a remembered online
 * method used to be restored even when online payments were disabled, making
 * an un-selectable (and submittable) method active. The resolver is pure, so
 * the full flag × saved-method matrix is verified here; what a unit test
 * cannot prove — that checkout.tsx actually feeds ONLINE_PAYMENTS_ENABLED
 * into it — is a render concern for device QA.
 */
describe('resolveInitialPaymentMethod', () => {
  it('starts with COD when nothing was remembered (both flag states)', () => {
    expect(resolveInitialPaymentMethod(null, true)).toBe('COD');
    expect(resolveInitialPaymentMethod(null, false)).toBe('COD');
  });

  it('keeps a remembered COD regardless of the flag', () => {
    expect(resolveInitialPaymentMethod('COD', true)).toBe('COD');
    expect(resolveInitialPaymentMethod('COD', false)).toBe('COD');
  });

  it('restores remembered online methods while online payments are ENABLED', () => {
    expect(resolveInitialPaymentMethod('UPI', true)).toBe('UPI');
    expect(resolveInitialPaymentMethod('CARD', true)).toBe('CARD');
    expect(resolveInitialPaymentMethod('NET_BANKING', true)).toBe('NET_BANKING');
  });

  // The core regression: saved UPI/CARD/NET_BANKING with the flag OFF used to
  // come back as-is, while the UPI/Card tiles were hidden from the sheet.
  it('falls back to COD for remembered online methods while online payments are DISABLED', () => {
    expect(resolveInitialPaymentMethod('UPI', false)).toBe('COD');
    expect(resolveInitialPaymentMethod('CARD', false)).toBe('COD');
    expect(resolveInitialPaymentMethod('NET_BANKING', false)).toBe('COD');
  });
});
