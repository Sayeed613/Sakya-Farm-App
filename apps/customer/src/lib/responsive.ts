import { useWindowDimensions } from 'react-native';

/**
 * Responsive layout helpers.
 *
 * The app is designed phone-first (390dp reference), but it must stay aligned
 * on every screen: small phones (320–360dp), large phones, and desktop
 * browsers where the window can be 1500px wide. Everything adaptive keys off
 * the real viewport instead of hardcoded pixel widths.
 */

/** Design reference width the visual density was tuned for. */
export const DESIGN_WIDTH = 390;

/**
 * Beyond this width the app is centred in a phone-shaped shell.
 *
 * Applies on every platform, not just the web: a tablet was previously left to
 * stretch the phone layout edge-to-edge with no cap at all.
 */
export const MAX_APP_WIDTH = 480;

/** Below this the viewport is a small phone — density tightens. */
export const COMPACT_WIDTH = 360;

export interface ResponsiveMetrics {
  /** Actual viewport width in px. */
  width: number;
  /** Viewport height in px. */
  height: number;
  /**
   * Width the app CONTENT actually occupies: the full viewport on native,
   * clamped to the phone shell on web (the shell caps layout at MAX_APP_WIDTH,
   * so measuring the raw window would oversize hero slides and rails).
   */
  contentWidth: number;
  /** Horizontal padding scaled from the 16px design value (13–19px). */
  screenPadding: number;
  /** Width for a horizontally-scrolling product-rail card (2.2 cards visible). */
  railCardWidth: number;
  /** Discovery/category tile width when the grid needs explicit px. */
  gridTileWidth: number;
  /** True on the web when the window is wider than the phone shell. */
  isWideViewport: boolean;
  /** True on small phones (< 360dp): tighter type/spacing allowances. */
  isCompact: boolean;
}

/**
 * One hook, used wherever layout previously hardcoded pixel widths. It
 * re-renders on rotation/resize so the layout truly follows the screen.
 */
export function useResponsive(): ResponsiveMetrics {
  const { width, height } = useWindowDimensions();
  // The shell caps the visible layout even though the window is wider — on web
  // AND on tablets. Everything adaptive must measure the capped width, or rails
  // and tiles oversize relative to the shell they sit in.
  const contentWidth = Math.min(width, MAX_APP_WIDTH);
  const isWideViewport = width > MAX_APP_WIDTH;
  const isCompact = contentWidth < COMPACT_WIDTH;

  // Scale factor clamped so 320dp phones don't crush and 480dp shells don't
  // balloon: 320/390 ≈ 0.82 → floor 0.84; 480/390 ≈ 1.23 → ceiling 1.18.
  const scale = Math.min(1.18, Math.max(0.84, contentWidth / DESIGN_WIDTH));

  const screenPadding = Math.round(16 * scale);

  // A rail shows ~2.2 cards on a phone: (content − padding − one peek)
  // divided by 2.2, clamped to the design range so nothing gets silly.
  const railCardWidth = Math.round(
    Math.min(190, Math.max(136, (contentWidth - screenPadding * 2 - 24) / 2.2)),
  );

  // Discovery grid keeps 3 columns with 10px gaps + padding on phones.
  const gridTileWidth = Math.round((contentWidth - screenPadding * 2 - 20) / 3);

  return {
    width,
    height,
    contentWidth,
    screenPadding,
    railCardWidth,
    gridTileWidth,
    isWideViewport,
    isCompact,
  };
}
