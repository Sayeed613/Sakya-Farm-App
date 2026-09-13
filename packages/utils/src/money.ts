import { DEFAULT_CURRENCY, type CurrencyCode, type Paise } from '@sakya/types';

/**
 * Money helpers. Every amount in the system is an integer number of paise.
 *
 * All functions are pure and total: they never throw on numeric input and never
 * introduce floating point into a stored amount. Rounding only happens when a
 * percentage is applied, and it is explicit about which way it rounds.
 */

/** Non-negative integer count of paise. */
export function isPaise(value: unknown): value is Paise {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/**
 * Assert that a value is a whole number of paise.
 * Throws on floats, NaN and unsafe integers: those are bugs, not user input.
 */
export function toPaise(value: number): Paise {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Amount must be an integer number of paise, received ${value}`);
  }
  return value as Paise;
}

/** Sum of paise amounts. */
export function sumPaise(...amounts: readonly Paise[]): Paise {
  let total = 0;
  for (const amount of amounts) {
    total += amount;
  }
  return toPaise(total);
}

/** Subtract `deduction` from `amount`, e.g. a discount from a subtotal. */
export function subtractPaise(amount: Paise, deduction: Paise): Paise {
  return toPaise(amount - deduction);
}

/** Multiply a paise amount by an integer quantity (line total). */
export function multiplyPaise(amount: Paise, quantity: number): Paise {
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new RangeError(`Quantity must be a non-negative integer, received ${quantity}`);
  }
  return toPaise(amount * quantity);
}

/**
 * Apply a percentage to a paise amount, rounded half up to the nearest paise.
 *
 * `rate` is the percentage as a number (18 for 18%). Percentages are the one
 * place a fraction legitimately appears, and it is resolved before the result
 * becomes a stored amount. Basis points are used internally to avoid float drift.
 */
export function percentageOf(
  amount: Paise,
  rate: number,
  options: { readonly max?: Paise } = {},
): Paise {
  if (!Number.isFinite(rate) || rate < 0) {
    throw new RangeError(`Percentage rate must be a finite non-negative number, received ${rate}`);
  }
  const basisPoints = Math.round(rate * 100);
  const raw = (amount * basisPoints) / 10_000;
  const rounded = toPaise(Math.round(raw));
  return options.max !== undefined && rounded > options.max ? options.max : rounded;
}

export interface FormatMoneyOptions {
  /** Override the currency symbol. Defaults to the symbol for `currency`. */
  readonly symbol?: string;
  /** Omit paise when the amount is a whole number of rupees. */
  readonly trimZeroPaise?: boolean;
}

const CURRENCY_SYMBOLS: Readonly<Record<CurrencyCode, string>> = {
  INR: '\u20B9',
};

/**
 * Render a paise amount for display, e.g. `123456` -> `₹1,234.56`.
 *
 * Display only: never parse the result back into a stored value.
 */
export function formatPaise(
  amount: Paise,
  currency: CurrencyCode = DEFAULT_CURRENCY,
  options: FormatMoneyOptions = {},
): string {
  const symbol = options.symbol ?? CURRENCY_SYMBOLS[currency];
  const negative = amount < 0;
  const absolute = Math.abs(amount);
  const rupees = Math.trunc(absolute / 100);
  const paise = absolute % 100;

  const groupedRupees = rupees.toLocaleString('en-IN', {
    maximumFractionDigits: 0,
    useGrouping: true,
  });

  const fraction = options.trimZeroPaise && paise === 0 ? '' : `.${String(paise).padStart(2, '0')}`;

  return `${negative ? '-' : ''}${symbol}${groupedRupees}${fraction}`;
}

/** Convert a rupee amount (integer or decimal) to paise, rounding half up. */
export function rupeesToPaise(rupees: number): Paise {
  if (!Number.isFinite(rupees)) {
    throw new RangeError(`Rupee amount must be a finite number, received ${rupees}`);
  }
  return toPaise(Math.round(rupees * 100));
}

/** Convert paise to a rupee number. Only for display or export, never storage. */
export function paiseToRupees(amount: Paise): number {
  return amount / 100;
}
