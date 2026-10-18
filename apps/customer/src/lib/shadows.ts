import { Platform, type ViewStyle } from 'react-native';

/**
 * Elevation system for the app.
 *
 * One place defines the card shadows so every surface shares the same
 * depth vocabulary — iOS uses shadow*, Android uses elevation, and web uses
 * box-shadow directly.
 *
 * Never sprinkle raw shadow objects in screens; import a token from here.
 *
 * Why web is special-cased: react-native-web 0.21 still accepts the
 * `shadow*` style props, but logs
 *   `"shadow*" style props are deprecated. Use "boxShadow".`
 * on every boot in dev. Its own conversion is
 *   `${offsetX}px ${offsetY}px ${blurRadius}px ${colorWithOpacity}`
 * so the `boxShadow` string below is byte-for-byte what RNW used to derive —
 * the rendered shadow is identical, only the warning is gone. Native keeps
 * the `shadow*` props + `elevation` untouched.
 */

const INK_SHADOW = '#1D2119';

/** `#RRGGBBAA` from a hex colour + an opacity, matching normalizeColor(). */
function hexToRgba(hex: string, opacity: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  const alpha = Math.round(opacity * 255)
    .toString(16)
    .padStart(2, '0');
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function makeShadow(
  opacity: number,
  radius: number,
  height: number,
  elevation: number,
): ViewStyle {
  if (Platform.OS === 'web') {
    return {
      // offset-x offset-y blur-radius colour — the shape react-native-web
      // itself produced from the four shadow* props.
      boxShadow: `0px ${height}px ${radius}px ${hexToRgba(INK_SHADOW, opacity)}`,
    } as ViewStyle;
  }

  return {
    shadowColor: INK_SHADOW,
    shadowOpacity: opacity,
    shadowRadius: radius,
    shadowOffset: { width: 0, height },
    // Android only — ignored on iOS/web. Requires a solid backgroundColor
    // on the same view to render.
    elevation,
  };
}

/** Listing cards, media cards — the primary surface elevation. */
export const cardShadow = makeShadow(0.08, 18, 8, 6);

/** Small cards and secondary surfaces. */
export const softShadow = makeShadow(0.06, 12, 4, 3);

/**
 * Escape hatch for the handful of screens that shadow a specific surface
 * with its own colour instead of the shared ink token. Same platform split
 * as the tokens above — always prefer a token when the colour matches.
 */
export function customShadow(options: {
  color: string;
  opacity: number;
  radius: number;
  height: number;
  elevation: number;
}): ViewStyle {
  const { color, opacity, radius, height, elevation } = options;

  if (Platform.OS === 'web') {
    return {
      boxShadow: `0px ${height}px ${radius}px ${hexToRgba(color, opacity)}`,
    } as ViewStyle;
  }

  return {
    shadowColor: color,
    shadowOpacity: opacity,
    shadowRadius: radius,
    shadowOffset: { width: 0, height },
    elevation,
  };
}
