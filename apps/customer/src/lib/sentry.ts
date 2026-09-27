import * as Sentry from '@sentry/react-native';

/**
 * Error tracking for the customer app, gated on a DSN.
 *
 * The SDK is initialised only when `EXPO_PUBLIC_SENTRY_DSN` is set at bundle
 * time (Expo inlines EXPO_PUBLIC_* into the JS bundle). With no DSN — the
 * state of this repo today — `initSentryIfConfigured` is a no-op and the app
 * behaves exactly as it did before Sentry existed here: zero SDK traffic, no
 * extra listeners, nothing to configure locally.
 *
 * This module must stay import-safe on every platform: `@sentry/react-native`
 * supports iOS, Android and web, and no call here touches a native module
 * before `init` runs (and `init` itself no-ops without a DSN).
 */

/**
 * True when the app was bundled with a real DSN. Kept as its own helper so
 * the gate is testable and the empty-string case (`.env` line present but
 * blank) is treated the same as unset.
 */
export function hasSentryDsn(): boolean {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  return typeof dsn === 'string' && dsn.trim().length > 0;
}

/**
 * Initialise error tracking if (and only if) a DSN is baked into the bundle.
 * Called once from the root layout before any screen mounts, so crashes from
 * the very first render are captured.
 */
export function initSentryIfConfigured(): void {
  if (!hasSentryDsn()) return;

  Sentry.init({
    dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
    // `app.env` equivalent: Expo's own release/channel env vars when present.
    environment: process.env.EXPO_PUBLIC_APP_ENV ?? 'development',
    // Screens are the natural grouping for a shop app; auto-tracing stays off
    // until there is a reason to pay for it.
    enableUserInteractionTracing: false,
  });
}

/** True when the SDK is live; used to avoid dead work in the layout. */
export function isSentryActive(): boolean {
  return hasSentryDsn();
}
