import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { colors } from '../src/theme';

/**
 * Root entry.
 *
 * Home is the app: every launch — guest or signed-in — lands on the shop.
 * Login appears only when a protected action needs it (Blinkit-style entry),
 * so this route redirects unconditionally and never reads the session.
 *
 * The redirect runs in a focus effect instead of a render-time <Redirect>:
 * firing a replace during the initial render can resolve before the root
 * navigator has mounted its groups, which previously landed users on the
 * first-registered group instead of the shop.
 */
export default function HomeRoute() {
  useFocusEffect(
    useCallback(() => {
      router.replace('/(shop)');
    }, []),
  );

  return (
    <View style={{ alignItems: 'center', backgroundColor: colors.canvas, flex: 1, justifyContent: 'center' }}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}
