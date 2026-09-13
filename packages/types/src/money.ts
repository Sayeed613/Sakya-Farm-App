/**
 * Money is ALWAYS stored and transported as an integer number of paise.
 *
 * Rupee amounts are never represented as floating point: `0.1 + 0.2 !== 0.3`
 * corrupts totals, and Indian pricing uses two decimal places (paise) that map
 * exactly onto integers. Formatting to a display string happens at the edge.
 *
 * The brand makes accidental mixing of rupees and paise a compile error.
 */
declare const paiseBrand: unique symbol;

export type Paise = number & { readonly [paiseBrand]: true };

/** ISO 4217 code. Only INR is used today, but every amount carries its currency. */
export type CurrencyCode = 'INR';

/** The default currency for the platform. */
export const DEFAULT_CURRENCY: CurrencyCode = 'INR';
