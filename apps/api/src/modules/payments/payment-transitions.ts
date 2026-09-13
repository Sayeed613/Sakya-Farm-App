import type { PaymentStatus } from '@sakya/types';

/**
 * Payment state machine.
 *
 * PENDING -> AUTHORIZED -> CAPTURED -> PARTIALLY_REFUNDED -> REFUNDED
 * PENDING/AUTHORIZED -> CANCELLED | FAILED
 * CAPTURED -> FAILED is NOT allowed (money moved; refund instead).
 * FAILED, CANCELLED, REFUNDED are terminal.
 *
 * Webhook outcomes map 1:1 onto target statuses except `refunded`, which
 * resolves to PARTIALLY_REFUNDED or REFUNDED depending on the running total.
 */
export const PAYMENT_TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  PENDING: ['AUTHORIZED', 'CAPTURED', 'FAILED', 'CANCELLED'],
  AUTHORIZED: ['CAPTURED', 'FAILED', 'CANCELLED'],
  CAPTURED: ['PARTIALLY_REFUNDED', 'REFUNDED'],
  PARTIALLY_REFUNDED: ['PARTIALLY_REFUNDED', 'REFUNDED'],
  FAILED: [],
  CANCELLED: [],
  REFUNDED: [],
};

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  if (from === to) {
    // Re-delivery of the same outcome is idempotent, not an error. Handled by
    // the service before this map is consulted; listed here for completeness.
    return true;
  }
  return PAYMENT_TRANSITIONS[from].includes(to);
}

export const WEBHOOK_OUTCOME_TO_STATUS = {
  authorized: 'AUTHORIZED',
  captured: 'CAPTURED',
  failed: 'FAILED',
  cancelled: 'CANCELLED',
  refunded: 'REFUNDED',
} as const;
