/**
 * Design tokens.
 *
 * One file owns every number and colour the UI uses, so the visual language can
 * be adjusted here rather than screen by screen. The palette mirrors
 * `tailwind.config.js` — keep the two in sync when changing either.
 *
 * Brand: deep field green (#0B594C) on a warm cream canvas, near-black ink,
 * terracotta reserved for emphasis (prices, badges). All text/background pairs
 * used in the app clear WCAG AA: `ink` on `canvas` ≈ 13:1, `ink-soft` on
 * `canvas` ≈ 5:1, white on `brand` ≈ 7.4:1.
 */

export const colors = {
  /** Screen background. Warm off-white; photography is the bright element. */
  canvas: '#FBF7F0',
  /** Cards, sheets and inputs. */
  surface: '#FFFFFF',
  /** Recessed fills: image placeholders, category chips, skeleton blocks. */
  surfaceMuted: '#F3EDE3',
  border: '#E4DACA',
  borderStrong: '#D2C4AE',

  /** Warm near-black for primary copy. */
  text: '#171A18',
  textMuted: '#6F6C63',
  textSubtle: '#8C8A80',
  textInverse: '#FFFFFF',

  /** Deep field green: the brand's action colour. */
  primary: '#0B594C',
  primaryPressed: '#08483E',
  primaryMuted: '#E4EFE7',

  /** Dark green surface used behind white brand elements (hero, auth hero). */
  hero: '#26332B',

  /** Terracotta: price emphasis and premium accents. */
  accent: '#B4612F',
  accentMuted: '#F7E9DD',

  danger: '#B42318',
  dangerMuted: '#FBE9E7',
  success: '#2E7D4F',
  warning: '#8A5B0F',
} as const;

/** 4-point scale. Use these instead of raw numbers in styles. */
export const spacing = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

/**
 * Minimum touch target. Both platforms' guidance lands at ~44pt; buttons and
 * quantity steppers honour it so the app is usable one-handed.
 */
export const touchTarget = 48;

export const typography = {
  display: { fontSize: 30, lineHeight: 36, fontWeight: '700' },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
  /** Wide letter spacing, upper case: section eyebrows. */
  overline: { fontSize: 11, lineHeight: 16, fontWeight: '700' },
} as const;

export const layout = {
  screenPaddingHorizontal: 16,
  /** Cards in a list breathe off each other rather than using hairline dividers. */
  cardGap: 12,
  /** Product imagery is 1:1; the catalog is image-led. */
  productImageAspectRatio: 1,
  maxContentWidth: 720,
} as const;

/**
 * Elevation. Deliberately minimal: at most a hairline shadow. Large soft
 * shadows read as generic SaaS; the Sakya language is flat and calm.
 */
export const elevation = {
  /** Hairline: cards over the canvas. */
  card: {
    shadowColor: '#171A18',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  /** Floating: sticky bars and sheets over content. */
  bar: {
    shadowColor: '#171A18',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 6,
  },
} as const;

export const theme = { colors, spacing, radii, typography, layout, touchTarget, elevation } as const;

export type Theme = typeof theme;
