import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo } from 'react';
import { Text as RNText, View } from 'react-native';

import { AnimatedPressable, usePressScale } from '../../lib/motion';
import { useResponsive } from '../../lib/responsive';
import { customShadow } from '../../lib/shadows';
import type { PromoBannerDef } from '../../config/home-content';

const BRAND = '#0B594C';
const BRAND_DARK = '#073F36';
const INK = '#1D2119';
const INK_SOFT = '#68736E';

/**
 * Aligned promotional banner.
 *
 * The artwork IS the banner: the Sakya creative carries its own headline,
 * support line and CTA baked into the image (the same contract the hero
 * carousel honours — see HeroSlide in home-content.ts), so the tile renders
 * the image ALONE. Copy stacked under the artwork used to repeat the design
 * and clip off the right edge — one message, one CTA, one tile now.
 *
 * Width is derived from the responsive shell (not the raw window), so the
 * card always lands exactly inside its mx-4 gutters on phone or desktop.
 * Tapping opens the banner's category; the a11y label still speaks the
 * headline + CTA for VoiceOver/TalkBack.
 */
function SakyaPromoBannerInner({
  banner,
  onPress,
}: {
  banner: PromoBannerDef;
  onPress: (handle: string) => void;
}) {
  const press = usePressScale();
  const { contentWidth } = useResponsive();
  // Card sits in mx-4 gutters (16 + 16) — measured against the capped shell,
  // never the raw window, so it can never overflow the layout it lives in.
  const W = Math.max(0, contentWidth - 32);

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={`${banner.headline} — ${banner.cta}`}
      onPress={() => onPress(banner.handle)}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      // Margins must be INLINE: className (mx-4) never reaches
      // createAnimatedComponent wrappers on web — it measured as 0 and left
      // the card flush against the left edge with dead space on the right.
      style={[press.animatedStyle, { marginHorizontal: 16 }]}
    >
      <View
        className="overflow-hidden rounded-3xl"
        style={{
          width: W,
          backgroundColor: '#FFF8EC',
          borderRadius: 28,
          // boxShadow on web, shadow* + elevation on native — see shadows.ts.
          ...customShadow({
            color: BRAND_DARK,
            opacity: 0.12,
            radius: 22,
            height: 16,
            elevation: 16,
          }),
        }}
      >
        {banner.image ? (
          <Image
            source={banner.image}
            style={{ width: W, height: Math.round(W * (207 / 637)) }}
            contentFit="cover"
            cachePolicy="disk"
            transition={180}
          />
        ) : (
          /* Art-less fallback: a banner defined without a creative still gets
             the full editorial treatment instead of an empty tile. */
          <View className="px-3.5 pb-3 pt-3">
            <View
              className="mx-5 mb-1.5 h-[1px]"
              style={{ backgroundColor: 'rgba(11,89,76,0.25)' }}
            />

            <View className="gap-1">
              <RNText
                className="text-[9.5px] font-bold uppercase tracking-widest"
                style={{ color: 'rgba(11,89,76,0.76)' }}
              >
                {banner.eyebrow}
              </RNText>
              <RNText className="text-[19px] font-serif font-bold leading-7" style={{ color: INK }}>
                {banner.headline}
              </RNText>
              <RNText className="text-[13px] leading-5" style={{ color: INK_SOFT }} numberOfLines={2}>
                {banner.body}
              </RNText>
            </View>

            <View className="mt-2 flex-row items-center gap-1.5">
              <View className="rounded-2xl bg-brand px-4 py-[9px]">
                <RNText className="text-[12.5px] font-extrabold" style={{ color: '#FFFFFF' }}>
                  {banner.cta}
                </RNText>
              </View>
              <Ionicons name="arrow-forward" size={15} color={BRAND} />
            </View>
          </View>
        )}
      </View>
    </AnimatedPressable>
  );
}

export const SakyaPromoBanner = memo(SakyaPromoBannerInner);
