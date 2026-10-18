import { Image } from 'expo-image';
import { memo, useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';

const CREAM = '#FBF7F0';
const WHITE = '#FFFFFF';

/**
 * Splash screen for Sakya Farms.
 *
 * The launch experience before the expo-router stack lifts:
 *  1. The supplied artwork (`src/images/splash-screen-bg.png`) fills the
 *     screen edge-to-edge as a background only — `contentFit="cover"` never
 *     stretches it.
 *  2. The real Sakya Farms logo mark sits at the top.
 *  3. The `Farm to Home` tagline sits directly beneath the logo.
 *  4. A restrained vertical loader sits at the bottom of the screen.
 *
 * The two images are `require`d statically (the same convention as every
 * other bundled asset in this app), so Metro packages them in the bundle and
 * they paint with the very first frame instead of resolving after mount.
 */
export function SplashScreenInner() {
  // Vertical loader: a single bar travels up and down its track. Driven by
  // the classic Animated API so it also runs on web and needs no worklets.
  const travel = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // `transform` is one of the few properties the JS driver animates exactly
    // as the native driver does, so dropping the native driver on web changes
    // nothing visually. Web has no native animated module: keeping
    // `useNativeDriver: true` there logs
    // "Animated: `useNativeDriver` is not supported because the native
    // animated module is missing" on every boot. Native keeps the native
    // driver (off-main-thread animation, no dropped frames on the splash).
    const useNativeDriver = Platform.OS !== 'web';
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(travel, {
          toValue: 1,
          duration: 720,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver,
        }),
        Animated.timing(travel, {
          toValue: 0,
          duration: 720,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [travel]);

  return (
    <View style={[styles.fill, { backgroundColor: CREAM }]}>
      {/* Background edge-to-edge, never stretched. */}
      <Image
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        source={require('../../images/splash-screen-bg.png')}
        style={styles.background}
        contentFit="cover"
        cachePolicy="disk"
      />

      {/* Logo at the top, tagline directly beneath it. */}
      <View style={styles.topBlock}>
        <Image
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          source={require('../../images/sakya logo.avif')}
          style={styles.logo}
          contentFit="contain"
          cachePolicy="memory"
          accessibilityLabel="Sakya Farms logo"
        />
        <Text style={styles.tagline}>Farm to Home</Text>
      </View>

      {/* Vertical loader near the bottom. */}
      <View style={styles.footer}>
        <View style={styles.loaderTrack}>
          <Animated.View
            style={[
              styles.loaderBar,
              {
                transform: [
                  {
                    // Travel inside the 36pt track; the bar itself is 14pt.
                    translateY: travel.interpolate({
                      inputRange: [0, 1],
                      outputRange: [22, -22],
                    }),
                  },
                ],
              },
            ]}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  background: {
    ...StyleSheet.absoluteFill,
  },
  topBlock: {
    position: 'absolute',
    top: 96,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 14,
  },
  logo: {
    width: 148,
    height: 74,
  },
  tagline: {
    color: WHITE,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '700',
    letterSpacing: 2.4,
    textTransform: 'uppercase',
  },
  footer: {
    position: 'absolute',
    bottom: 64,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  loaderTrack: {
    width: 4,
    height: 52,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.35)',
    overflow: 'hidden',
    justifyContent: 'flex-start',
  },
  loaderBar: {
    width: 4,
    height: 14,
    borderRadius: 2,
    backgroundColor: WHITE,
  },
});

export const SplashScreen = memo(SplashScreenInner);
