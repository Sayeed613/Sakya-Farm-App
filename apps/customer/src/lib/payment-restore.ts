import type { OnlinePaymentMethod } from '../api/checkout';

export type PaymentMethodChoice = 'COD' | OnlinePaymentMethod;

/**
 * Checkout's initial payment method, resolved from the customer's remembered
 * choice AND the payment feature flags.
 *
 * Regression guard: the previous checkout initializer restored any saved
 * online method without consulting `ONLINE_PAYMENTS_ENABLED`. When online
 * payments were off, the UPI/Card tiles were hidden but the collapsed row
 * still showed (and would submit) the saved online method — an un-selectable
 * state that could implicitly aim an order at a disabled payment rail.
 *
 * Rules (pure, so the whole flag matrix is unit-testable):
 * - no saved choice, or a remembered COD → COD;
 * - a remembered online method (UPI/CARD/NET_BANKING) is restored ONLY while
 *   online payments are enabled; otherwise fall back to COD, the one method
 *   that is always offered.
 *
 * This never enables Razorpay/demo mode — it only decides which method the
 * UI starts with. Backend payment safety is untouched.
 */
export function resolveInitialPaymentMethod(
  saved: PaymentMethodChoice | null,
  onlinePaymentsEnabled: boolean,
): PaymentMethodChoice {
  if (saved === 'COD' || saved === null) return 'COD';
  // An online method was remembered.
  return onlinePaymentsEnabled ? saved : 'COD';
}
