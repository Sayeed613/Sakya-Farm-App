/**
 * Pure layout-sizing rules, isolated from React Native so they are unit
 * testable in a plain Node process (the vitest setup deliberately loads no RN).
 *
 * Two rules live here because both were previously hard-coded numbers that
 * misbehaved on particular screens: the invoice sheet's content cap (a flat
 * 480 clipped on short phones) and the sticky cart pill's lift above the
 * floating tab bar.
 */

/**
 * Max content height for a bottom-sheet's inner ScrollView, derived from the
 * real screen height instead of one flat constant.
 *
 * - scales with the screen (62% of height) so short phones (568pt SE-class)
 *   keep the sheet's header, the scrollable body AND the safe-area padding
 *   inside the viewport — nothing clips, and long invoices still scroll to
 *   the total;
 * - clamped to the design range so very tall phones don't turn the sheet
 *   into a full-screen takeover, and absurdly small windows still get a
 *   usable scroll area.
 */
export function sheetMaxContentHeight(screenHeight: number): number {
  return Math.round(Math.min(Math.max(screenHeight * 0.62, 280), 560));
}

/**
 * Bottom offset for the floating "View cart" pill.
 *
 * The pill is a sibling of the bottom tab bar (not a child), so it must clear
 * the bar's own height: the bar is content (~64pt) above
 * `max(insets.bottom, 10)` padding. The pill therefore sits at
 * insets + bar + gap, and never behind the bar or a scrim.
 */
export function stickyCartBarBottomOffset(insetsBottom: number, extraLift = 0): number {
  return Math.max(insetsBottom, 10) + 64 + 22 + extraLift;
}
