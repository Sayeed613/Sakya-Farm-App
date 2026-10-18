import { createSakyaApiClient } from '@sakya/api-client';
import NetInfo from '@react-native-community/netinfo';
import { useAuthStore } from '../stores/auth-store';

const baseUrl = process.env.EXPO_PUBLIC_API_URL;

/**
 * Latest known connectivity for the http layer's offline gate.
 *
 * Thread the live SubscribedState through here directly instead of a cached
 * boolean, so this module (and the http offline gate) always see the OS answer
 * the instant it arrives. `isOnline` returns the latest known state and is
 * safe to call from request-time paths that do not own a subscription.
 */
let lastKnownOnline = true;
export function setConnectivityForHttpGate(connected: boolean): void {
  lastKnownOnline = connected;
}

function isOnline(): boolean {
  // Refresh the gate before answering so a slow/reordered NetInfo response
  // (or a change that lands after the cached flag) can never return a stale
  // value. Best-effort: failures here (no NetInfo, dropped event) must not
  // silently stall a request; the cached value is the fallback, not the
  // primary answer.
  const pending = NetInfo.fetch().then((state) => {
    const connected = state.isConnected ?? false;
    lastKnownOnline = connected;
  }).catch(() => undefined);
  void pending;
  return lastKnownOnline;
}

/**
 * Single-flight refresh.
 *
 * The HTTP client fires `onUnauthorized` once per burst of 401s (it must be
 * single-flight: the server rotates refresh tokens and revokes the family on
 * replay, so two concurrent refreshes would log the user out). The shared
 * promise below guarantees that: parallel 401s across many requests await the
 * SAME refresh round. Resolves `true` when a fresh session is in the store —
 * the client then retries the failed request once with the new token.
 *
 * `false` means recovery is impossible (no refresh token, or the refresh was
 * rejected): the hook clears the dead session and the 401 surfaces to the
 * caller, which renders its signed-out/error state as usual.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSessionOnce(): Promise<boolean> {
  const current = useAuthStore.getState().session;
  if (current === null || current.refreshToken === '') return false;

  // Capture the logout generation AT THE START of the refresh round.
  // This is passed to updateSession so it can verify the generation hasn't
  // changed (i.e., the user didn't log out during the refresh).
  const refreshGeneration = useAuthStore.getState().logoutGeneration;

  if (refreshInFlight === null) {
    refreshInFlight = (async () => {
      try {
        // Lazy import: this module's own client is mid-construction on the
        // first call path, and the api layer builds on it.
        const { authApi } = await import('./auth');
        const renewed = await authApi.refresh({ refreshToken: current.refreshToken });
        // Pass the captured generation — if the user logged out during the
        // refresh, logoutGeneration will have changed and the renewed session
        // will be dropped.
        useAuthStore.getState().updateSession(renewed, refreshGeneration);
        return true;
      } catch {
        // The refresh token is expired/revoked too — the session is dead.
        // Only call logout if we haven't already logged out (check generation).
        const state = useAuthStore.getState();
        if (state.logoutGeneration === 0) {
          void state.logout();
        }
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }

  // Sharing the round with parallel 401s is safe only because the refresh
  // request itself can never re-enter this function: `authApi.refresh` is
  // sent with `auth: 'none'` (public route, see resources/auth-api.ts), so a
  // 401 on the refresh exchange does not fire `onUnauthorized`. If it ever
  // did, this return would hand that request its own pending promise and the
  // round would await itself forever.
  return refreshInFlight;
}

export const apiClient = baseUrl
  ? createSakyaApiClient({
      baseUrl,
      getAccessToken: () => useAuthStore.getState().session?.accessToken ?? null,
      onUnauthorized: refreshSessionOnce,
      isOnline,
    })
  : null;

export function requireApiClient() {
  if (!apiClient) {
    throw new Error(
      'EXPO_PUBLIC_API_URL is not configured. Set it in apps/customer/.env.',
    );
  }

  return apiClient;
}
