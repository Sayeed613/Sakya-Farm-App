/**
 * Scroll → header collapse bus.
 *
 * Same pattern as nav-visibility (directional pub-sub, not a per-frame
 * shared value): the home list publishes scroll intent, the fixed HomeHeader
 * subscribes and animates itself from the full band down to its compact
 * form — search pill + cart + category strip.
 */

type Listener = (collapsed: boolean) => void;

let current = false;
const listeners = new Set<Listener>();

export const headerCollapse = {
  get(): boolean {
    return current;
  },
  set(next: boolean): void {
    if (next === current) return;
    current = next;
    listeners.forEach((listener) => listener(next));
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/**
 * Position-threshold collapse rule — deliberately NOT directional.
 *
 * The user's complaint: flicking down collapsed the band and flicking up
 * re-opened it mid-list, so the header kept opening/closing while reading.
 * The desired behaviour (quick-commerce standard): the FULL band stays up
 * while the top of the list (hero banner) is still in view; once the user
 * scrolls PAST the banner the band collapses to the compact bar and stays
 * collapsed — until they scroll back above the threshold.
 *
 * `threshold` is the offset past which the banner is considered scrolled
 * away (supplied by the screen from its measured header height + one hero
 * height). Hysteresis (collapse sooner than expand) prevents jitter when
 * the resting offset sits near the threshold.
 */
export function headerCollapsedFromScroll(
  offset: number,
  _previousOffset: number,
  currentCollapsed: boolean,
  threshold = 320,
): boolean {
  if (offset < 24) return false;
  if (currentCollapsed) return offset > threshold - 48;
  return offset > threshold;
}
