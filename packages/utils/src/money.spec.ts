import { describe, expect, it } from 'vitest';

import {
  formatPaise,
  multiplyPaise,
  paiseToRupees,
  percentageOf,
  rupeesToPaise,
  subtractPaise,
  sumPaise,
  toPaise,
} from './money';

describe('toPaise', () => {
  it('accepts safe integers', () => {
    expect(toPaise(0)).toBe(0);
    expect(toPaise(123456)).toBe(123456);
  });

  it('rejects floats and non-finite values', () => {
    expect(() => toPaise(1.5)).toThrow(RangeError);
    expect(() => toPaise(Number.NaN)).toThrow(RangeError);
    expect(() => toPaise(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('sumPaise', () => {
  it('adds without floating point drift', () => {
    // The classic float failure: 0.1 + 0.2 !== 0.3. In paise this is exact.
    expect(sumPaise(toPaise(10), toPaise(20))).toBe(30);
  });

  it('returns 0 for no arguments', () => {
    expect(sumPaise()).toBe(0);
  });

  it('handles negative adjustments from the inventory and refund paths', () => {
    expect(sumPaise(toPaise(500), toPaise(-200))).toBe(300);
  });
});

describe('subtractPaise', () => {
  it('subtracts a discount from a subtotal', () => {
    expect(subtractPaise(toPaise(10000), toPaise(2500))).toBe(7500);
  });
});

describe('multiplyPaise', () => {
  it('computes a line total', () => {
    expect(multiplyPaise(toPaise(4999), 3)).toBe(14997);
  });

  it('rejects negative or fractional quantities', () => {
    expect(() => multiplyPaise(toPaise(100), -1)).toThrow(RangeError);
    expect(() => multiplyPaise(toPaise(100), 1.5)).toThrow(RangeError);
  });
});

describe('percentageOf', () => {
  it('rounds half up to the nearest paise', () => {
    // 5% of 999 paise = 49.95 -> 50
    expect(percentageOf(toPaise(999), 5)).toBe(50);
  });

  it('applies GST-style rates exactly', () => {
    expect(percentageOf(toPaise(100000), 18)).toBe(18000);
  });

  it('applies a maximum cap', () => {
    expect(percentageOf(toPaise(100000), 50, { max: toPaise(20000) })).toBe(20000);
    expect(percentageOf(toPaise(1000), 10, { max: toPaise(20000) })).toBe(100);
  });

  it('rejects negative rates', () => {
    expect(() => percentageOf(toPaise(1000), -5)).toThrow(RangeError);
  });
});

describe('formatPaise', () => {
  it('formats with Indian digit grouping and two decimals', () => {
    expect(formatPaise(toPaise(123456))).toBe('\u20B91,234.56');
  });

  it('pads single-digit paise', () => {
    expect(formatPaise(toPaise(105))).toBe('\u20B91.05');
  });

  it('formats negative amounts with a leading sign', () => {
    expect(formatPaise(toPaise(-105))).toBe('-\u20B91.05');
  });

  it('can trim a zero paise component', () => {
    expect(formatPaise(toPaise(50000), 'INR', { trimZeroPaise: true })).toBe('\u20B9500');
  });
});

describe('rupee conversion', () => {
  it('converts both ways without losing paise', () => {
    expect(rupeesToPaise(1234.56)).toBe(123456);
    expect(paiseToRupees(toPaise(123456))).toBe(1234.56);
  });

  it('rounds half up when converting an over-precise rupee amount', () => {
    expect(rupeesToPaise(10.005)).toBe(1001);
  });
});
