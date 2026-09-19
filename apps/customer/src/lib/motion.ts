import { useCallback } from 'react';
import { Pressable as RNPressable } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

/**
 * A Pressable that accepts Reanimated animated styles. RN's own Pressable
 * rejects `AnimatedStyleHandle` values, so press-scale feedback must render
 * through this component.
 */
export const AnimatedPressable = Animated.createAnimatedComponent(RNPressable);

/**
 * Shared motion vocabulary for the whole app.
 *
 * One place defines durations, easing and the press-scale contract, so screens
 * never hand-roll their own springs. Everything here is intentionally subtle:
 * animations communicate state, they are not decoration.
 */

export const MOTION = {
  /** Press feedback, quantity changes. */
  fast: 120,
  /** Add→stepper morph, small state changes. */
  base: 180,
  /** Section entrance. */
  enter: 260,
  easing: Easing.out(Easing.cubic),
  /** Press-scale for tappables: subtle, never bouncy. */
  pressScale: 0.97,
  /** Entrance translateY for text blocks. */
  enterY: 12,
} as const;

/**
 * Reusable press-scale driver. Returns a style to spread onto an animated
 * container inside a `Pressable`. The scale returns on release with the same
 * timing, so the feedback is symmetrical.
 */
export function usePressScale(enabled = true) {
  const scale = useSharedValue(1);
  const animateTo = useCallback(
    (value: number) => {
      'worklet';
      scale.value = withTiming(value, { duration: MOTION.fast, easing: MOTION.easing });
    },
    [scale],
  );
  const onPressIn = useCallback(() => {
    if (enabled) animateTo(MOTION.pressScale);
  }, [animateTo, enabled]);
  const onPressOut = useCallback(() => {
    if (enabled) animateTo(1);
  }, [animateTo, enabled]);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return { onPressIn, onPressOut, animatedStyle };
}

/** Section entrance: fade + slight upward settle. */
export const enterDown = FadeInDown.duration(MOTION.enter).easing(MOTION.easing).delay(40);
