import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, Text as RNText, View } from 'react-native';

import { useReducedMotionSafe } from '../../lib/motion-safe';

const CREAM = '#FBF7F0';
const BRAND = '#0B594C';

export interface HeroBannerProps {
  imageUrl?: string | null;
  heading: string;
  supporting: string;
  ctaLabel?: string;
  onPressCta?: () => void;
}

/**
 * The hero: one strong brand statement with real imagery when the API has it.
 *
 * Entrance is staged (image fade/scale → text rise → CTA), each a short
 * one-shot animation. All of it is skipped under reduced motion.
 */
export function HeroBanner({ imageUrl, heading, supporting, ctaLabel, onPressCta }: HeroBannerProps) {
  const reduceMotion = useReducedMotionSafe();
  const image = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const text = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const cta = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) return;
    const timing = (value: Animated.Value, to: number, delay: number) =>
      Animated.timing(value, {
        toValue: to,
        duration: 320,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });
    Animated.parallel([
      timing(image, 1, 40),
      timing(text, 1, 110),
      timing(cta, 1, 180),
    ]).start();
  }, [image, text, cta, reduceMotion]);

  return (
    <View className="mx-4 overflow-hidden rounded-2xl bg-hero">
      <View className="h-44 w-full">
        {imageUrl ? (
          <Animated.Image
            accessibilityRole="image"
            accessibilityLabel="Farm produce"
            source={{ uri: imageUrl }}
            className="h-full w-full"
            resizeMode="cover"
            style={{
              opacity: image,
              transform: [
                {
                  scale: image.interpolate({ inputRange: [0, 1], outputRange: [1.04, 1] }),
                },
              ],
            }}
          />
        ) : (
          <Animated.View
            className="h-full w-full items-center justify-center bg-hero"
            style={{ opacity: image }}
          >
            <Ionicons name="leaf" size={44} color="#E4EFE7" />
          </Animated.View>
        )}
      </View>

      <Animated.View
        className="gap-1 px-4 pb-4 pt-3"
        style={{
          opacity: text,
          transform: [
            {
              translateY: text.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }),
            },
          ],
        }}
      >
        <RNText className="text-[20px] font-bold leading-6" style={{ color: CREAM }}>
          {heading}
        </RNText>
        <RNText className="text-[13.5px] leading-5" style={{ color: '#D7DED6' }}>
          {supporting}
        </RNText>
        {ctaLabel && onPressCta ? (
          <Animated.View
            style={{
              opacity: cta,
              transform: [
                { translateY: cta.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
              ],
            }}
          >
            <Pressable
              onPress={onPressCta}
              accessibilityRole="button"
              accessibilityLabel={ctaLabel}
              className="mt-2.5 self-start rounded-full bg-[color:#E4EFE7] px-4 py-2 active:opacity-80"
            >
              <RNText className="text-[12.5px] font-bold" style={{ color: BRAND }}>
                {ctaLabel}
              </RNText>
            </Pressable>
          </Animated.View>
        ) : null}
      </Animated.View>
    </View>
  );
}
