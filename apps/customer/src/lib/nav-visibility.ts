/**
 * Scroll → navbar visibility bus.
 *
 * Screens publish scroll intent; the floating tab bar subscribes and animates
 * itself out of the way. Kept as a plain pub-sub (not a Reanimated shared
 * value) because the signal is *directional* — a few events per gesture — not
 * a per-frame value. The bar's own withTiming animation does the smoothing.
 */

type Listener = (visible: boolean) => void;

let current = true;
const listeners = new Set<Listener>();

export const navBarVisibility = {
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
 * Directional visibility rule: scroll down → hide; scroll up or near top →
 * show. Dead-band of 2px prevents jitter from momentum rounding.
 */
export function navVisibleFromScroll(
  offset: number,
  previousOffset: number,
  currentVisible: boolean,
): boolean {
  if (offset < 24) return true;
  const delta = offset - previousOffset;
  if (delta < -2) return true;
  if (delta > 2) return false;
  return currentVisible;
}
