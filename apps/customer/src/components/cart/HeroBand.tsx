import { Image } from 'expo-image';
import { View, Text as RNText, StyleSheet, type ImageSourcePropType } from 'react-native';

/**
 * Farm hero band — the reference's artwork strip under the header bar.
 *
 * Defaults to the cart's `cart-header.png` artwork (the warm produce photo
 * the brand supplied); checkout passes its own. A light cream wash unifies
 * the photo with the ivory canvas so dark editorial copy stays readable and
 * the band reads as brand texture, not a billboard. Purely decorative:
 * pointerEvents="none" so it never intercepts scrolls or taps.
 */
export function HeroBand({
  title,
  subtitle,
  image,
}: {
  title: string;
  subtitle: string;
  /** Artwork override (e.g. checkout-header.png); defaults to cart-header. */
  image?: ImageSourcePropType;
}) {
  return (
    <View style={styles.band} pointerEvents="none">
      <Image
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        source={image ?? require('../../images/cart-header.png')}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy="memory-disk"
        accessibilityIgnoresInvertColors
      />
      {/* Cream wash: unify the photo with the ivory canvas, keep ink readable. */}
      <View style={[StyleSheet.absoluteFill, styles.wash]} />
      <View style={styles.copy}>
        <RNText style={styles.title}>{title}</RNText>
        <RNText style={styles.subtitle}>{subtitle}</RNText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    height: 118,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },

  wash: {
    backgroundColor: 'rgba(251, 247, 240, 0.40)',
  },

  copy: {
    paddingHorizontal: 18,
    paddingBottom: 14,
    gap: 2,
  },

  title: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '800',
    color: '#171A18',
    fontFamily: 'Georgia',
  },

  subtitle: {
    fontSize: 11.5,
    color: '#56544C',
  },
});
