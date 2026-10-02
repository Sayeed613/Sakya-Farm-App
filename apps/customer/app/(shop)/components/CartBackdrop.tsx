import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

export default function CartBackdrop() {
  return (
    <View
      style={{
        pointerEvents: 'none',
      }}
      className="absolute left-0 right-0 top-0 h-[230px]"
    >
      <Image
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        source={require('../../../src/images/cart-header.png')}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy="memory-disk"
        accessibilityIgnoresInvertColors
      />

      {/* Light frost under the fixed chrome — keeps the photo textured while
          the header row stays readable. */}
      <BlurView
        pointerEvents="none"
        intensity={28}
        tint="light"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 72 }}
      />

      {/* Vertical: light header strip → photo → parchment feather. */}
      <LinearGradient
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        colors={[
          'rgba(255,255,255,0.72)',
          'rgba(255,255,255,0)',
          'rgba(255,255,255,0.22)',
          'rgba(247,243,233,0.98)',
        ]}
        locations={[0, 0.26, 0.62, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* Horizontal: calm the left edge under the serif copy. */}
      <LinearGradient
        start={{ x: 0, y: 0.5 }}
        end={{ x: 0.72, y: 0.5 }}
        colors={['rgba(255,255,255,0.62)', 'rgba(255,255,255,0)']}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}