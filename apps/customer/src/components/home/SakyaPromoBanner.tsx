import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo } from 'react';
import { Dimensions, Text as RNText, View } from 'react-native';

import { AnimatedPressable, usePressScale } from '../../lib/motion';
import type { PromoBannerDef } from '../../config/home-content';

const BRAND = '#0B594C';
const BRAND_DARK = '#073F36';

const W = Dimensions.get('window').width - 32;
/**
 * The banner creatives (src/banner/*.png) are all ~3.08:1 (637×207). The
 * artwork box matches that ratio EXACTLY, so nothing is cropped off the
 * left/right edges. The text-only fallback keeps taller proportions.
 */
const IMAGE_BANNER_H = Math.round(W / 3.08);
const TEXT_BANNER_H = Math.round((W * 6.5) / 16);

/**
 * One promotional banner: the supplied creative as a full-bleed image when
 * the definition carries artwork, otherwise a text-only banner composed on
 * the deep brand surface with real gradient depth (not a flat slab):
 * brand-green gradient, serif headline, quiet CTA. Tapping opens the
 * banner's category.
 */
function SakyaPromoBannerInner({
  banner,
  onPress,
}: {
  banner: PromoBannerDef;
  onPress: (handle: string) => void;
}) {
  const press = usePressScale();

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={`${banner.headline} — ${banner.cta}`}
      onPress={() => onPress(banner.handle)}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={press.animatedStyle}
      className="mx-4 overflow-hidden rounded-2xl"
    >
      {banner.image ? (
        <View style={{ width: W, height: IMAGE_BANNER_H }}>
          <Image
            source={banner.image}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            cachePolicy="disk"
            transition={180}
          />
        </View>
      ) : (
        <View
          className="justify-between gap-2 px-4 py-4"
          style={{ width: W, height: TEXT_BANNER_H, backgroundColor: BRAND }}
        >
          {/* Gradient depth — exposed via expo-linear-gradient when the
              project adds it; until then, layered translucent washes give
              the same diagonal-light effect without a new dependency. */}
          <View
            pointerEvents="none"
            style={{
              ...({ position: 'absolute' } as const),
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(255,255,255,0.05)',
              // Diagonal sheen: lighter at the top-left, deep at the bottom.
              borderTopLeftRadius: 0,
            }}
          />
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: -TEXT_BANNER_H * 0.4,
              left: -W * 0.2,
              width: W * 0.9,
              height: TEXT_BANNER_H * 0.9,
              borderRadius: TEXT_BANNER_H,
              backgroundColor: 'rgba(255,255,255,0.07)',
            }}
          />
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              bottom: -TEXT_BANNER_H * 0.5,
              right: -W * 0.15,
              width: W * 0.7,
              height: TEXT_BANNER_H * 0.8,
              borderRadius: TEXT_BANNER_H,
              backgroundColor: 'rgba(7,63,54,0.35)',
            }}
          />

          <View className="gap-1">
            <RNText className="text-[9.5px] font-bold uppercase tracking-widest text-white/60">
              {banner.eyebrow}
            </RNText>
            <RNText className="text-[18px] font-bold leading-6" style={{ color: '#F5F2E8' }}>
              {banner.headline}
            </RNText>
            <RNText className="text-[12px] leading-4 text-white/75" numberOfLines={2}>
              {banner.body}
            </RNText>
          </View>
          <View className="flex-row items-center gap-1.5">
            <View className="rounded-full bg-white px-3.5 py-1.5">
              <RNText className="text-[11.5px] font-extrabold" style={{ color: BRAND_DARK }}>
                {banner.cta}
              </RNText>
            </View>
            <Ionicons name="arrow-forward" size={14} color="rgba(255,255,255,0.9)" />
          </View>
        </View>
      )}
    </AnimatedPressable>
  );
}

export const SakyaPromoBanner = memo(SakyaPromoBannerInner);
