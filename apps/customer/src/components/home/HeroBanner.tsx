import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { memo } from 'react';
import { Text as RNText, View } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

import { AnimatedPressable, usePressScale } from '../../lib/motion';
import { useResponsive } from '../../lib/responsive';
import { useRouter } from 'expo-router';

const BOTANICAL = '#0B594C';
const IVORY = '#FBF7F0';
const FIELD_GREEN = '#26332B';

export interface HeroBannerProps {
  /**
   * The hero photograph — art-directed so the subject sits in the upper
   * third; the scrim's calm zone at the bottom carries the copy.
   */
  image: number | { uri: string };
  accessibilityLabel: string;
  /** Category handle the CTA shops into. */
  ctaHandle: string;
}

/**
 * HeroBanner — the editorial home hero.
 *
 * Composition (one photo, one message, one CTA):
 *
 *   ┌──────────────────────────────┐  inset 20, radius 28
 *   │        (farm photography)    │  contentFit cover, parallax 0.85x
 *   │  ✦ SAKYA FARMS               │  frosted brand chip
 *   │                              │
 *   │  ──                          │  40px hairline rule, ivory 70%
 *   │  Pure food.                  │  serif display 34/40 ivory
 *   │  Rooted in tradition.        │
 *   │  Supporting line, two lines… │  14/20 ivory 78%
 *   │  [ SHOP NOW            → ]   │  botanical green pill, h52
 *   └──────────────────────────────┘
 *
 * The scrim (deep field green, transparent → 88%) is the ONLY thing that
 * makes text readable — no solid bands, no boxes over the photo. The photo
 * IS the premium surface; type and CTA stay quiet on top of it.
 */
function HeroBannerInner({ image, accessibilityLabel, ctaHandle }: HeroBannerProps) {
  const router = useRouter();
  const { contentWidth, screenPadding } = useResponsive();
  const width = contentWidth - screenPadding * 2;
  // 62vh-equivalent on a phone viewport: tall enough for editorial presence,
  // short enough that the category strip still teases below the fold.
  const height = Math.round(width * 1.18);

  const scrollParallax = useSharedValue(0);
  void scrollParallax; // wired by parent scroll if desired; harmless unused

  const parallaxStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: scrollParallax.value * 0.15 }],
  }));

  const press = usePressScale();

  function shopNow() {
    router.push(`/(shop)/categories/${ctaHandle}`);
  }

  return (
    <Animated.View entering={FadeInDown.duration(320).easing(Easing.out(Easing.cubic))}>
      <View style={{ width, height: undefined }}>
        <View
          className="overflow-hidden"
          style={{ borderRadius: 28, height }}
        >
          {/* Photography, with the subtle vertical parallax mask */}
          <Animated.View style={[{ position: 'absolute', inset: 0 }, parallaxStyle]}>
            <Image
              source={image as never}
              style={{ width: '100%', height: '112%' }}
              contentFit="cover"
              cachePolicy="disk"
              transition={220}
              accessibilityRole="image"
              accessibilityLabel={accessibilityLabel}
              pointerEvents="none"
            />
          </Animated.View>

          {/* The scrim: transparency at the top, deep field green below */}
          <LinearGradient
            pointerEvents="none"
            colors={[`${FIELD_GREEN}00`, `${FIELD_GREEN}55`, `${FIELD_GREEN}E0`]}
            locations={[0.32, 0.58, 1]}
            style={{ position: 'absolute', inset: 0 }}
          />

          {/* Content column, anchored to the scrim's calm zone */}
          <View
            className="flex-1 justify-end"
            style={{ padding: 24 }}
            pointerEvents="box-none"
          >
            {/* Brand chip */}
            <Animated.View entering={FadeIn.delay(90).duration(260)} style={{ alignSelf: 'flex-start' }}>
              <View
                className="flex-row items-center gap-2 rounded-full"
                style={{
                  borderWidth: 1,
                  borderColor: 'rgba(251,247,240,0.4)',
                  backgroundColor: 'rgba(251,247,240,0.14)',
                  paddingVertical: 7,
                  paddingHorizontal: 14,
                }}
              >
                <Ionicons name="leaf" size={13} color={IVORY} />
                <RNText
                  className="text-[10.5px] font-bold uppercase"
                  style={{ color: IVORY, letterSpacing: 2.4 }}
                >
                  Sakya Farms
                </RNText>
              </View>
            </Animated.View>

            {/* Hairline rule — the editorial pause before the headline */}
            <View
              style={{
                marginTop: 18,
                width: 40,
                height: 2,
                backgroundColor: 'rgba(251,247,240,0.7)',
                borderRadius: 1,
              }}
            />

            {/* Display headline — brand serif, two deliberate lines */}
            <RNText
              className="font-serif mt-3"
              style={{
                fontSize: 34,
                lineHeight: 40,
                fontWeight: '600',
                letterSpacing: -0.5,
                color: IVORY,
              }}
            >
              {'Pure food.\nRooted in tradition.'}
            </RNText>

            {/* Supporting copy — one thought, two lines max */}
            <RNText
              style={{
                marginTop: 10,
                fontSize: 14,
                lineHeight: 20,
                color: 'rgba(251,247,240,0.78)',
              }}
            >
              Single-origin staples, cold-pressed oils and heritage pickles — from our fields to
              your kitchen.
            </RNText>

            {/* The one CTA */}
            <AnimatedPressable
              onPress={shopNow}
              onPressIn={press.onPressIn}
              onPressOut={press.onPressOut}
              style={press.animatedStyle}
              accessibilityRole="button"
              accessibilityLabel="Shop now"
              className="mt-6 flex-row items-center justify-between"
            >
              <View
                className="flex-row items-center justify-between"
                style={{
                  backgroundColor: BOTANICAL,
                  borderRadius: 999,
                  height: 52,
                  paddingLeft: 26,
                  paddingRight: 22,
                  alignSelf: 'flex-start',
                  minWidth: 190,
                  shadowColor: BOTANICAL,
                  shadowOpacity: 0.25,
                  shadowRadius: 24,
                  shadowOffset: { width: 0, height: 8 },
                  elevation: 8,
                }}
              >
                <RNText
                  className="text-[15px] font-bold"
                  style={{ color: '#FFFFFF', letterSpacing: 4 }}
                >
                  SHOP NOW
                </RNText>
                <Ionicons name="arrow-forward" size={17} color="#FFFFFF" style={{ marginLeft: 12 }} />
              </View>
            </AnimatedPressable>
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

export const HeroBanner = memo(HeroBannerInner);
