import { router } from 'expo-router';

/** The Home tab, expressed as a route the shop Stack can resolve. */
export const HOME_ROUTE = '/(shop)' as const;

/**
 * Go back exactly one screen, falling back to Home when there is no history.
 *
 * Why this exists: with the (shop) Stack in place every pushed screen's back
 * button pops to the *previous* screen. The fallback only matters for cold
 * entries — a deep link or a push notification opened the app straight onto a
 * detail route, where there is nothing behind it. Before this helper those
 * screens called a bare `router.back()`, which on a cold entry silently did
 * nothing (the button looked broken) or exited the app on Android.
 */
export function goBackOrHome(): void {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace(HOME_ROUTE);
}
