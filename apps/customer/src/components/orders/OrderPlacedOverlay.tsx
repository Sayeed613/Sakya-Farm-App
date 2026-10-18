import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { Text as RNText, View } from 'react-native';

import { customShadow } from '../../lib/shadows';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

const BRAND = '#0B594C';
const INK = '#171A18';
const MUTED = '#8C8A80';

/**
 * The confirm-order moment.
 *
 * Shown AFTER the server has placed the order (and captured money, for
 * online payments) and BEFORE the order detail screen mounts — checkout
 * holds it on screen for ~1.4s while the checkmark pops and the copy
 * settles, then routes to `/orders/:id`. Purely presentational
 * (pointer-events: none via style): the navigation it delays is scheduled by
 * the caller, so this component never owns flow logic.
 *
 * It deliberately celebrates only real success — a pending/failed payment
 * skips it entirely and lands straight on the order screen.
 */
export function OrderPlacedOverlay() {
  const scale = useSharedValue(0);
  const ringScale = useSharedValue(0);
  const ringOpacity = useSharedValue(0);
  const copyOpacity = useSharedValue(0);

  useEffect(() => {
    // Checkmark circle springs in; a soft ring breathes out behind it; the
    // copy rises a beat later so the eye lands on the check first.
    scale.value = withDelay(120, withSpring(1, { damping: 12, stiffness: 190 }));
    // One assignment per value: the ring fades in, holds, then releases.
    ringOpacity.value = withDelay(
      180,
      withSequence(
        withTiming(0.35, { duration: 160 }),
        withDelay(240, withTiming(0, { duration: 220 })),
      ),
    );
    ringScale.value = withDelay(180, withTiming(1, { duration: 620 }));
    copyOpacity.value = withDelay(360, withTiming(1, { duration: 260 }));
  }, [copyOpacity, ringOpacity, ringScale, scale]);

  const circleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: ringOpacity.value,
    transform: [{ scale: 0.9 + ringScale.value * 0.35 }],
  }));
  const copyStyle = useAnimatedStyle(() => ({ opacity: copyOpacity.value }));

  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        zIndex: 60,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(251,247,240,0.97)',
        // Pure celebration layer: every tap passes straight through to the
        // screen underneath. style.pointerEvents (not the deprecated prop).
        pointerEvents: 'none',
      }}
    >
      {/* Expanding breath behind the checkmark. */}
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: 132,
            height: 132,
            borderRadius: 999,
            backgroundColor: BRAND,
          },
          ringStyle,
        ]}
      />

      <Animated.View
        style={[
          {
            width: 96,
            height: 96,
            borderRadius: 999,
            backgroundColor: BRAND,
            alignItems: 'center',
            justifyContent: 'center',
            // boxShadow on web, shadow* + elevation on native — see shadows.ts.
            ...customShadow({
              color: '#0B594C',
              opacity: 0.28,
              radius: 18,
              height: 8,
              elevation: 10,
            }),
          },
          circleStyle,
        ]}
      >
        <Ionicons name="checkmark" size={54} color="#FFFFFF" />
      </Animated.View>

      <Animated.View style={[{ alignItems: 'center', marginTop: 20 }, copyStyle]}>
        <RNText style={{ fontSize: 20, fontWeight: '800', color: INK }}>Order placed!</RNText>
        <RNText style={{ marginTop: 5, fontSize: 13, color: MUTED }}>Taking you to your order…</RNText>
      </Animated.View>
    </View>
  );
}
