import { Ionicons } from '@expo/vector-icons';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useFonts } from 'expo-font';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import * as Notifications from 'expo-notifications';

import '../global.css';

import { colors } from '../src/theme';
import { useAuthStore } from '../src/stores/auth-store';
import {
  configureNotificationHandler,
  initialNotificationRoute,
  routeForNotificationData,
} from '../src/push/push-notifications';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

/**
 * The icon font must be loaded before any screen that renders an icon mounts,
 * otherwise the glyphs render as empty boxes. `Ionicons.font` maps the family
 * name to the bundled TTF, so `@expo/vector-icons` can find it at draw time.
 */
export default function RootLayout() {
  const restore = useAuthStore((state) => state.restore);
  const [fontsLoaded, fontsError] = useFonts(Ionicons.font);
  const router = useRouter();

  // Foreground presentation: banners + list entry, sound on.
  useEffect(() => {
    configureNotificationHandler();
  }, []);

  /** Tap routing — order pushes deep-link to the order detail screen. */
  useEffect(() => {
    // Cold start: the app was closed when the push was tapped.
    void initialNotificationRoute().then((route) => {
      if (route !== null) router.replace(route as never);
    });

    // App open: respond to the tap whenever it lands.
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const route = routeForNotificationData(response.notification.request.content.data);
      if (route !== null) router.push(route as never);
    });
    return () => subscription.remove();
  }, [router]);

  useEffect(() => {
    void restore();
  }, [restore]);

  useEffect(() => {
    if (fontsError !== undefined && fontsError !== null) {
      // Icons degrade to placeholders; the app itself stays usable.
      console.warn('[customer] icon font failed to load', fontsError);
    }
  }, [fontsError]);

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(shop)" />
      </Stack>
    </QueryClientProvider>
  );
}
