import Head from 'expo-router/head';
import { usePathname } from 'expo-router';
import type React from 'react';
import { Platform } from 'react-native';

/**
 * Private route prefixes — everything behind a session. `/(auth)` paths are
 * flattened by expo-router's usePathname (group segments never appear in the
 * URL), so the prefixes below match the URLs crawlers actually request.
 */
const PRIVATE_PREFIXES = [
  '/cart',
  '/checkout',
  '/orders',
  '/settings',
  '/edit-profile',
  '/delete-account',
  '/address-book',
  '/notifications',
  '/wishlist',
  '/profile',
  '/phone',
  '/verify-otp',
  '/complete-profile',
] as const;

function isPrivateRoute(pathname: string): boolean {
  return PRIVATE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * `noindex` marker for private screens (cart, checkout, orders, account).
 *
 * robots.txt Disallow stops crawling but NOT indexing — a private URL that
 * gets linked from elsewhere can still appear in results. The meta tag is the
 * directive search engines actually honour for "do not list this page".
 *
 * Mounted ONCE in the root layout: it watches the current pathname and hoists
 * (or removes) the meta tag through expo-router's helmet as the customer
 * navigates. Renders nothing on native (Head is a no-op there).
 */
export function SeoRobots(): React.ReactElement | null {
  // Hook runs unconditionally (rules of hooks); Platform.OS never changes
  // after mount.
  const pathname = usePathname();
  if (Platform.OS !== 'web') return null;
  if (!isPrivateRoute(pathname)) return null;
  return (
    <Head>
      <meta name="robots" content="noindex, nofollow" />
      <meta name="googlebot" content="noindex, nofollow" />
    </Head>
  );
}
