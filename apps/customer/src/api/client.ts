import { createSakyaApiClient } from '@sakya/api-client';
import NetInfo from '@react-native-community/netinfo';
import { useAuthStore } from '../stores/auth-store';

const baseUrl = process.env.EXPO_PUBLIC_API_URL;

/**
 * Latest known connectivity for the http layer's offline gate.
 *
 * The root layout's `useConnectivity` hook keeps a live subscription, and its
 * state is mirrored here on every network change so the http layer can read
 * connectivity synchronously. Requests made offline fail immediately with a
 * retryable NETWORK_ERROR instead of hanging until a transport timeout.
 */
let lastKnownOnline = true;

export function setConnectivityForHttpGate(connected: boolean): void {
  lastKnownOnline = connected;
}

function isOnline(): boolean {
  // Opportunistic refresh keeps the OS state fresh without blocking.
  void NetInfo.fetch().catch(() => undefined);
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

  if (refreshInFlight === null) {
    refreshInFlight = (async () => {
      try {
        // Lazy import: this module's own client is mid-construction on the
        // first call path, and the api layer builds on it.
        const { authApi } = await import('./auth');
        const renewed = await authApi.refresh({ refreshToken: current.refreshToken });
        useAuthStore.getState().updateSession(renewed);
        return true;
      } catch {
        // The refresh token is expired/revoked too — the session is dead.
        void useAuthStore.getState().logout();
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
