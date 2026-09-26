import type { ViewStyle } from 'react-native';

/**
 * Elevation system for the app.
 *
 * One place defines the card shadows so every surface shares the same
 * depth vocabulary — iOS uses shadow*, Android uses elevation, and
 * react-native-web maps shadow* to box-shadow automatically.
 *
 * Never sprinkle raw shadow objects in screens; import a token from here.
 */

const INK_SHADOW = '#1D2119';

function makeShadow(
  opacity: number,
  radius: number,
  height: number,
  elevation: number,
): ViewStyle {
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
