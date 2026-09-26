import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View, type ImageSourcePropType } from 'react-native';

/**
 * ImagePageBackdrop — the home header's image treatment, generalized.
 *
 * The home screen layers `header-bg.png` inside its glass band and melts it
 * into the page with a white→clear gradient. This is the same recipe for
 * full screens: the artwork fills the top of the page, then a gradient
 * feathers it out into the canvas so content below reads normally. The
 * screen's own header (ivory bar / green band / title row) sits ON TOP of
 * the photo, the way home's logo + address sit on top of the texture.
 *
 * Purely decorative: pointerEvents="none" so it never intercepts scrolls
 * or taps, and it must be rendered as the FIRST child of the screen with
 * the real content stacked above it (position absolute).
 *
 * The feather gradient is vertical on purpose — a full opaque wash would
 * hide the artwork (the thing we're adding), while a pure clear gradient
 * leaves the photo fighting the content. White→clear top→bottom fades the
 * photo out by the backdrop's lower edge, exactly like home's bottom
 * feather melts the artwork into the glass.
 */
export function ImagePageBackdrop({
  image,
  height = 230,
  tint = 'rgba(255,255,255,0.30)',
}: {
  /** Artwork source (cart-header.png / checkout-header.png / profile-header.png). */
  image: ImageSourcePropType;
  /** How far down the page the photo reaches before the feather takes over. */
  height?: number;
  /** Optional translucent tint over the photo to calm it under header ink. */
  tint?: string;
}) {
  return (
    <View pointerEvents="none" style={[styles.root, { height }]}>
      <Image
        source={image}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy="memory-disk"
        accessibilityIgnoresInvertColors
      />
      {tint !== 'transparent' ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: tint }]} />
      ) : null}
      {/* Top→bottom feather: photo → page canvas, no hard seam. */}
      <LinearGradient
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.30)', 'rgba(247,243,233,0.96)']}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {/* Horizontal calm: white at the trailing edge so header controls
          (search / chevrons / lock) keep contrast, mirroring home's
          left→right gradient that keeps the cart control side calm. */}
      <LinearGradient
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.42)']}
        locations={[0.55, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
});
