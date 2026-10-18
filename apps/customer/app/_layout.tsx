import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { QueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useFonts } from 'expo-font';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';

import '../global.css';
import { prefetchHomeCatalog } from '../src/api/catalog-query-options';
import {
  CATALOG_PERSIST_MAX_AGE_MS,
  CATALOG_PERSIST_STORAGE_KEY,
  shouldPersistCatalogQuery,
} from '../src/lib/catalog-persist';
import { MAX_APP_WIDTH } from '../src/lib/responsive';
import { initSentryIfConfigured } from '../src/lib/sentry';

import { colors } from '../src/theme';
import { useAuthStore } from '../src/stores/auth-store';
import { useConnectivity } from '../src/hooks/use-connectivity';
import { OfflineBanner } from '../src/components/OfflineBanner';
import { RazorpaySheetHost } from '../src/components/RazorpaySheetHost';
import { SeoRobots } from '../src/components/Seo';
import { SplashScreen } from '../src/components/navigation/SplashScreen';

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

const IS_WEB = Platform.OS === 'web';

/**
 * Icon-font gate.
 *
 * NATIVE keeps the classic `useFonts(Ionicons.font)` path unchanged.
 *
 * WEB is different, and the difference is the reason the app used to log
 * "Customer icon font failed to load: Error: 12000ms timeout exceeded". On
 * web, `useFonts` injects an `@font-face` and then waits on expo-font's
 * FontObserver, which gives up after a hard-coded 12 000 ms. That deadline
 * could not be met because the font is only *requested* once the whole JS
 * bundle has downloaded and parsed — on a cold dev server that leaves far
 * less than 12 s of budget, so the gate failed even though the asset itself
 * is fine (it is served with 200 and the right content-type).
 *
 * The fix is structural, not a longer timeout:
 *  1. `public/index.html` declares the SAME `ionicons` family as a static
 *     `@font-face` pointing at `public/fonts/ionicons.ttf`, so the browser
 *     starts downloading the glyph data together with the HTML — in
 *     parallel with the bundle instead of after it. Icons therefore paint
 *     as soon as the text does, with no JS round-trip.
 *  2. Web then waits on `document.fonts` — which resolves as soon as that
 *     face is usable — behind a short, deliberate cap we own. A failure
 *     degrades to placeholder glyphs instead of parking the whole app on
 *     the splash screen.
 *
 * `font-display: block` in the stylesheet keeps the brief pre-load moment
 * blank rather than showing tofu boxes.
 */
const ICON_FONT_FAMILY = 'ionicons';
const ICON_FONT_SPEC = `12px ${ICON_FONT_FAMILY}`;
/** Web-only ceiling for the boot gate; never reached while the font loads. */
const ICON_FONT_WAIT_CAP_MS = 4_000;

function useIconFontReady(): { ready: boolean; error: Error | null } {
  // Empty map on web: nothing to download through expo-font there (the
  // static @font-face owns it), so the native-only hook still resolves fast.
  const [nativeLoaded, nativeError] = useFonts(IS_WEB ? {} : Ionicons.font);
  const [webReady, setWebReady] = useState(false);

  useEffect(() => {
    if (!IS_WEB) return;

    let cancelled = false;
    const settle = () => {
      if (!cancelled) setWebReady(true);
    };
    // The cap is the fallback: if `document.fonts` is unavailable, hangs, or
    // rejects, the gate still lifts and the app boots.
    const cap = setTimeout(settle, ICON_FONT_WAIT_CAP_MS);

    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (fonts == null) {
      clearTimeout(cap);
      settle();
      return () => {
        cancelled = true;
      };
    }

    void fonts
      .load(ICON_FONT_SPEC)
      .catch(() => {
        // Degrade to placeholder glyphs — same contract the native warning
        // has always promised. Never blocks the UI.
        console.warn(
          `[customer] icon font (${ICON_FONT_FAMILY}) did not load; icons will render as placeholders`,
        );
      })
      .finally(() => {
        clearTimeout(cap);
        settle();
      });

    return () => {
      cancelled = true;
      clearTimeout(cap);
    };
  }, []);

  return {
    ready: IS_WEB ? webReady : nativeLoaded || nativeError != null,
    error: nativeError ?? null,
  };
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

/**
 * Catalogue persistence: the dehydrated cache is written to AsyncStorage
 * (localStorage-backed on web) through a persister that throttles writes and
 * degrades to "no persistence" — never to a crash — when storage is full or
 * unavailable. Only queries passing `shouldPersistCatalogQuery` (successful
 * `['catalog', …]` reads) are ever written; see catalog-persist.ts.
 */
const catalogPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: CATALOG_PERSIST_STORAGE_KEY,
});

const catalogPersistOptions = {
  persister: catalogPersister,
  maxAge: CATALOG_PERSIST_MAX_AGE_MS,
  // Force-discard blobs written by an older cache shape when it changes.
  buster: 'sakya-catalog-v1',
  dehydrateOptions: { shouldDehydrateQuery: shouldPersistCatalogQuery },
} as const;

// Error tracking initialises before any screen mounts, so even a crash during
// the first render is captured. No-op unless EXPO_PUBLIC_SENTRY_DSN was set at
// bundle time — without it the SDK is never switched on at all.
initSentryIfConfigured();

/**
 * The icon font must be loaded before any screen that renders an icon mounts,
 * otherwise the glyphs render as empty boxes. `Ionicons.font` maps the family
 * name to the bundled TTF, so `@expo/vector-icons` can find it at draw time.
 *
 * The gate below covers only the VISUAL tree (the Stack). The query client,
 * its disk hydration and the boot warm-up all start immediately, so catalogue
 * data loads and restores from disk WHILE the font loads — the gate no longer
 * serialises data behind font download. If the font fails to load the gate
 * lifts anyway (icons degrade to placeholders, as the warning below has
 * always promised) instead of spinning forever.
 *
 * How that load happens is platform-specific — see useIconFontReady below.
 */
export default function RootLayout() {
  const restore = useAuthStore((state) => state.restore);
  const { ready: fontsReady, error: fontsError } = useIconFontReady();
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

  /**
   * Boot warm-up: start Home's two catalogue requests as soon as the app
   * process exists rather than after the font gate lifts. Fire-and-forget by
   * contract — the screens that mount later observe the SAME keys and join
   * this request instead of issuing a second one (single-flight coalescing),
   * and a failure or an offline boot simply leaves their own queries to run.
   */
  useEffect(() => {
    void prefetchHomeCatalog(queryClient);
  }, []);

  useEffect(() => {
    if (fontsError != null) {
      // Native path: expo-font reports its own failure. Icons degrade to
      // placeholders; the app itself stays usable.
      console.warn('[customer] icon font failed to load', fontsError);
    }
  }, [fontsError]);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={catalogPersistOptions}
      // Hydration failures (corrupt blob, storage denial) degrade to an empty
      // cache — surfaced for diagnostics only, never blocking boot.
      onError={() => console.warn('[customer] catalogue cache restore failed')}
    >
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
          {/* Font gate: covers the icon-rendering tree only. Data fetching,
              cache hydration and the boot warm-up all run above it. */}
          {fontsReady ? (
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(shop)" />
            </Stack>
          ) : (
            // Boot gate: the branded splash (bg + logo + Farm to Home +
            // vertical loader) covers the screen while the icon font loads,
            // replacing the bare spinner. Data loading runs ABOVE this gate,
            // so the splash never delays the catalog warm-up.
            <SplashScreen />
          )}
          {/* In-app Razorpay sheet for builds without the native SDK (Expo
              Go). Renders null on web and whenever no checkout is pending. */}
          <RazorpaySheetHost />
        </View>
      </View>
    </PersistQueryClientProvider>
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
