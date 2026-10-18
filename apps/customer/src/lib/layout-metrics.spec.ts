import { describe, expect, it } from 'vitest';

import {
  isPhoneSizedViewport,
  sheetMaxContentHeight,
  stickyCartBarBottomOffset,
} from './layout-metrics';

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

describe('isPhoneSizedViewport', () => {
  /**
   * Regression suite for the checkout crash on the Android APK:
   * `ReferenceError: Property 'document' doesn't exist`.
   *
   * The tab-bar clearance hook used to read `window.innerWidth` /
   * `window.innerHeight` directly in its render path. Hermes evaluates those
   * identifiers fine (React Native defines a `window` global), but the same
   * hook ALSO read `document.documentElement`, which does not exist on
   * native. The platform gate is now the load-bearing rule, and this viewport
   * predicate is its render-path half — so the thresholds and the
   * conservative behaviour for garbage input are pinned here.
   */
  it('matches the original thresholds: width <= 480 AND height <= 720', () => {
    // The exact phone-window pair the old inline check admitted.
    expect(isPhoneSizedViewport(480, 720)).toBe(true);
    expect(isPhoneSizedViewport(390, 720)).toBe(true);
    expect(isPhoneSizedViewport(480, 667)).toBe(true);
  });

  it('rejects a window that exceeds either bound', () => {
    expect(isPhoneSizedViewport(481, 720)).toBe(false);
    expect(isPhoneSizedViewport(480, 721)).toBe(false);
    expect(isPhoneSizedViewport(1024, 768)).toBe(false);
  });

  it('fails closed on non-numeric sizes (unset dimensions, resize races)', () => {
    // `undefined <= 480` is false, so garbage never enables the spacer.
    expect(isPhoneSizedViewport(Number.NaN, 720)).toBe(false);
    expect(isPhoneSizedViewport(390, Number.NaN)).toBe(false);
    expect(isPhoneSizedViewport(Number.NaN, Number.NaN)).toBe(false);
  });

  it('treats zero-sized windows as not phone-sized', () => {
    expect(isPhoneSizedViewport(0, 0)).toBe(true);
    expect(isPhoneSizedViewport(0, 720)).toBe(true);
    // Zero width with a normal height is a real degenerate mid-teardown state;
    // it must not crash — the predicate is total over all number inputs.
    expect(() => isPhoneSizedViewport(0, 1920)).not.toThrow();
  });
});
