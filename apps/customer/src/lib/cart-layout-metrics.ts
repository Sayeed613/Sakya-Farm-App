/**
 * Layout rules specific to the floating cart pill.
 *
 * The pill is a child of the tab-screen's scene (index / fresh / categories
 * are all tab screens), and the bottom tab bar is now rendered in-flow below
 * the scene. Before this era the bar floated over the content and the pill
 * had to clear the bar's own height (`insets + 64 + 22`); that made the pill
 * hover ~96pt above the tab bar, sitting dead centre over product cards and
 * hiding titles, prices and ADD buttons as the user scrolled.
 *
 * Now the pill is placed just above the in-flow bar's top edge, and every
 * tab screen reserves its scroller bottom padding so the last product row
 * can always scroll fully above the pill:
 *
 *   - `stickyCartPillOffset` — the lift of the pill above the scene bottom
 *     (the bar's own height is no longer subtracted, and so is no longer
 *     double-counted). A small, consistent gap that holds at every font
 *     scale and on every screen size.
 *   - `stickyCartContentClearance` — scrollable content bottom padding that
 *     accounts for the pill's full height plus a gap, so the cart count,
 *     product names, prices and ADD buttons on the last row are always
 *     reachable (never permanently covered by the pill).
 *
 * One source of truth, tested without a device or a renderer: the pill never
 * overlaps the last row of a tab screen.
 */

/** Height in pt of the pill, computed from its fixed internal metrics:
 *  `py-1.5` → 12 -top/bottom, inside a 32pt circle row. A single number
 *  here is what every content padding references; if the pill grows the
 *  clearances below grow with it automatically. */
export const STICKY_CART_PILL_HEIGHT = 44;

/**
 * Lift of the pill above the scene bottom on tab screens.
 *
 * The scene's bottom edge IS the top edge of the in-flow tab bar, so the
 * pill needs only a small gap above it — not the bar's full height plus
 * the safe-area inset that the old, pre-in-flow metric assumed. A fixed 16pt
 * lift keeps the pill off product names/prices/ADD buttons and centered
 * horizontally (the wrapper spans the width and centres its children).
 *
 * The safe area inside the scene is irrelevant: the in-flow bar below the
 * scene already consumes `insets.bottom` in its own `paddingBottom`.
 */
export function stickyCartPillOffset(extraLift = 0): number {
  return 16 + extraLift;
}

/**
 * Minimum bottom padding for scrolled content on a tab screen.
 *
 * The last item row (the cart count, the product name, its price and its
 * ADD button) must always be able to scroll fully above the pill. This
 * combines the pill offset with the pill's own height plus a 14pt gap;
 * raising `stickyCartPillHeight` (or the pill's internal metrics) automatically
 * enlarges required padding. A single number here is the load-bearing rule;
 * hard-coded numbers in screens were the original defect.
 */
export function stickyCartContentClearance(extraLift = 0): number {
  return stickyCartPillOffset(extraLift) + STICKY_CART_PILL_HEIGHT + 14;
}
