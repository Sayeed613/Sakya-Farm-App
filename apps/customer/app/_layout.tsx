import { Ionicons } from '@expo/vector-icons';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useFonts } from 'expo-font';
import { useEffect } from 'react';
import { Platform, ActivityIndicator, StyleSheet, useWindowDimensions, View } from 'react-native';

import '../global.css';
import { MAX_APP_WIDTH } from '../src/lib/responsive';
import { initSentryIfConfigured } from '../src/lib/sentry';

import { colors } from '../src/theme';
import { useAuthStore } from '../src/stores/auth-store';
import { useConnectivity } from '../src/hooks/use-connectivity';
import { OfflineBanner } from '../src/components/OfflineBanner';
import { RazorpaySheetHost } from '../src/components/RazorpaySheetHost';
import { SeoRobots } from '../src/components/Seo';

/**
 * Push support loads lazily and natively only. Merely importing
 * expo-notifications on web registers push-token listeners that are
 * unsupported there (console warning on every boot), so web never loads the
 * module at all.
 */
type PushModule = typeof import('../src/push/push-notifications');
function loadPushModule(): Promise<PushModule | null> {
  return Platform.OS === 'web' ? Promise.resolve(null) : import('../src/push/push-notifications');
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

// Error tracking initialises before any screen mounts, so even a crash during
// the first render is captured. No-op unless EXPO_PUBLIC_SENTRY_DSN was set at
// bundle time — without it the SDK is never switched on at all.
initSentryIfConfigured();

/**
 * The icon font must be loaded before any screen that renders an icon mounts,
 * otherwise the glyphs render as empty boxes. `Ionicons.font` maps the family
 * name to the bundled TTF, so `@expo/vector-icons` can find it at draw time.
 */
export default function RootLayout() {
  const restore = useAuthStore((state) => state.restore);
  const [fontsLoaded, fontsError] = useFonts(Ionicons.font);
  const router = useRouter();
  const { isConnected } = useConnectivity();
  const offline = isConnected === false;
  // Any viewport wider than the phone shell (desktop browser OR tablet) gets
  // the centred shell. Previously this was web-only, so an iPad stretched the
  // phone layout edge-to-edge.
  const { width } = useWindowDimensions();
  const constrainWidth = width > MAX_APP_WIDTH;

  // Foreground presentation: banners + list entry, sound on.
  useEffect(() => {
    void loadPushModule().then((push) => push?.configureNotificationHandler());
  }, []);

  /** Tap routing — order pushes deep-link to the order detail screen. */
  useEffect(() => {
    let cancelled = false;
    let subscription: { remove: () => void } | null = null;

    void (async () => {
      const push = await loadPushModule();
      if (push === null) return;
      const Notifications = await import('expo-notifications');

      // Cold start: the app was closed when the push was tapped.
      void push.initialNotificationRoute().then((route) => {
        if (route !== null && !cancelled) router.replace(route as never);
      });

      // App open: respond to the tap whenever it lands.
      subscription = Notifications.addNotificationResponseReceivedListener((response) => {
        const route = push.routeForNotificationData(response.notification.request.content.data);
        if (route !== null) router.push(route as never);
      });
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
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
      {/* Phone-shaped shell: any viewport wider than MAX_APP_WIDTH (desktop
          browser or tablet) shows the app centred at phone width instead of
          stretched edge-to-edge — which broke alignment and pushed content
          off-screen. Phone-sized viewports fill the screen exactly. */}
      <View style={constrainWidth ? styles.webShell : styles.fill}>
        <View style={constrainWidth ? styles.webShellInner : styles.fill}>
          {/* Global offline state — sits above every screen so no flow can
              pretend the network is fine. Mutations are gated in the http
              layer; React Query keeps serving cached reads. */}
          {offline ? <OfflineBanner /> : null}
          {/* Web-only: private routes (cart, checkout, orders, account) carry
              a noindex meta tag so search results never surface session
              screens. No-op on native. */}
          <SeoRobots />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(shop)" />
          </Stack>
          {/* In-app Razorpay sheet for builds without the native SDK (Expo
              Go). Renders null on web and whenever no checkout is pending. */}
          <RazorpaySheetHost />
        </View>
      </View>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  webShell: {
    flex: 1,
    alignItems: 'center',
    // Matches the canvas so the desktop shell reads as one warm surface
    // instead of a cool grey gutter around the phone column.
    backgroundColor: colors.canvas,
  },
  webShellInner: {
    width: '100%',
    maxWidth: MAX_APP_WIDTH,
    flex: 1,
    backgroundColor: '#FFFFFF',
    ...Platform.select({ web: { boxShadow: '0 0 32px rgba(23,26,24,0.14)' } as never, default: {} }),
  },
});
