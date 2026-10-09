import { describe, expect, it } from 'vitest';

import { sheetMaxContentHeight, stickyCartBarBottomOffset } from './layout-metrics';

/**
 * Regression suite for the two previously hard-coded layout numbers:
 *
 * - the invoice sheet capped its ScrollView at a flat 480, which on a short
 *   phone (568pt SE-class) pushed the header/actions out of the viewport;
 * - the sticky cart pill's lift above the floating tab bar was inline math,
 *   untestable and easy to drift out of sync with the tab bar's own padding.
 *
 * These tests prove the RULES (scaling, clamping, inset handling). They do
 * not prove the rendered pixels — that needs a device/emulator.
 */
describe('sheetMaxContentHeight', () => {
  it('scales down on short phones so the sheet fits the viewport', () => {
    // 568pt SE-class screen: 62% → ~352, well inside the viewport once the
    // sheet header + safe-area padding are added.
    expect(sheetMaxContentHeight(568)).toBe(352);
    expect(sheetMaxContentHeight(568)).toBeLessThan(568);
  });

  it('scales with a standard phone height', () => {
    // 844pt (iPhone 14 class): 62% ≈ 523.
    expect(sheetMaxContentHeight(844)).toBe(523);
  });

  it('clamps very tall screens to the design ceiling', () => {
    expect(sheetMaxContentHeight(926)).toBe(560);
    expect(sheetMaxContentHeight(1200)).toBe(560);
  });

  it('clamps absurdly small windows to a usable floor', () => {
    expect(sheetMaxContentHeight(200)).toBe(280);
    expect(sheetMaxContentHeight(0)).toBe(280);
  });

  it('always returns a positive integer height', () => {
    for (const h of [320, 568, 667, 844, 926, 1440]) {
      const value = sheetMaxContentHeight(h);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
  });
});

describe('stickyCartBarBottomOffset', () => {
  it('clears the floating tab bar: insets floor + 64 bar + 22 gap', () => {
    // No home-indicator inset (Android gesture nav 0): floor of 10 applies.
    expect(stickyCartBarBottomOffset(0)).toBe(96);
  });

  it('adapts to a real bottom inset (iOS home indicator)', () => {
    expect(stickyCartBarBottomOffset(34)).toBe(120);
  });

  it('ignores insets below the 10pt floor', () => {
    expect(stickyCartBarBottomOffset(4)).toBe(96);
  });

  it('applies the caller extra lift on top (quick-view layering)', () => {
    expect(stickyCartBarBottomOffset(0, 40)).toBe(136);
    expect(stickyCartBarBottomOffset(34, 40)).toBe(160);
  });

  it('always stays above the tab bar itself (insets + 64)', () => {
    for (const insets of [0, 8, 10, 24, 34, 48]) {
      expect(stickyCartBarBottomOffset(insets)).toBeGreaterThan(insets + 64);
    }
  });
});
