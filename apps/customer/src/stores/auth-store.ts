import type { AuthSessionResponse } from '@sakya/types';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import { useGuestCartStore } from './guest-cart-store';

const SESSION_KEY = 'sakya.customer.session';

/*
 * expo-secure-store has no web implementation in this SDK version (its web
 * build is an empty stub), so `getItemAsync` throws
 * "ExpoSecureStore.default.getValueWithKeyAsync is not a function" in browsers.
 * Use localStorage on web and SecureStore on native.
 */

const isWeb = Platform.OS === 'web';

const sessionStorage = {
  async getItem(): Promise<string | null> {
    if (isWeb) {
      return typeof window === 'undefined' ? null : window.localStorage.getItem(SESSION_KEY);
    }
    return SecureStore.getItemAsync(SESSION_KEY);
  },
  async setItem(value: string): Promise<void> {
    if (isWeb) {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(SESSION_KEY, value);
      }
      return;
    }
    await SecureStore.setItemAsync(SESSION_KEY, value);
  },
  async removeItem(): Promise<void> {
    if (isWeb) {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(SESSION_KEY);
      }
      return;
    }
    await SecureStore.deleteItemAsync(SESSION_KEY);
  },
};

/**
 * Fold the guest cart into the server cart.
 *
 * The client sends variantId + quantity only — never prices, never a store.
 * The server revalidates price, availability, stock and the fulfillment store,
 * and folds duplicates. The local guest cart is cleared only after the server
 * confirms, so a failed merge loses nothing.
 */
async function mergeGuestCartIntoServer(lines: { variantId: string; quantity: number }[]): Promise<void> {
  // Imported lazily: the api layer builds on this store's access token, so a
  // top-level import would be a cycle.
  const { authApi } = await import('../api/auth');
  await authApi.mergeGuestCart(lines);
  useGuestCartStore.getState().clear();
}

interface AuthState {
  session: AuthSessionResponse | null;
  restoring: boolean;
  /**
   * The route to return to after a successful authentication, captured when an
   * auth gate intercepted the user (checkout, orders, account). Null means
   * "no specific destination" and the app returns to the shop.
   */
  pendingRedirect: string | null;
  /** True between OTP verification and the guest-cart merge finishing. */
  merging: boolean;
  /**
   * Monotonically increasing counter incremented on each logout. The refresh
   * recovery path captures this at the start of the refresh round and passes
   * it to updateSession, so an in-flight refresh cannot resurrect a session
   * that was already logged out.
   */
  logoutGeneration: number;
  restore: () => Promise<void>;
  setPendingRedirect: (route: string | null) => void;
  /**
   * Persist and apply a renewed session (token refresh). Unlike setSession
   * this has NO guest-cart side effects — a mid-session refresh must never
   * trigger a merge. Fire-and-forget from the 401 recovery path, which
   * cannot await a zustand action.
   *
   * If `expectedGeneration` is provided, the session is only applied if the
   * current logoutGeneration still matches — this prevents a stale refresh from
   * resurrecting a session that was logged out during the refresh.
   */
  updateSession: (session: AuthSessionResponse, expectedGeneration?: number) => void;
  /**
   * Persist a session AND merge the guest cart into the server cart.
   *
   * Every authentication path (OTP screen, auth gates) goes through here, so
   * merging behaviour is identical everywhere: guest lines are sent to the
   * server, revalidated, and only then cleared locally.
   *
   * This ALSO resets logoutGeneration to 0, so a fresh login can refresh
   * normally. A previous logout must not permanently disable future refreshes.
   */
  setSession: (session: AuthSessionResponse) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  session: null,
  restoring: true,
  pendingRedirect: null,
  merging: false,
  logoutGeneration: 0,
  restore: async () => {
    const raw = await sessionStorage.getItem();
    let session: AuthSessionResponse | null = null;
    if (raw) {
      try {
        session = JSON.parse(raw) as AuthSessionResponse;
      } catch {
        session = null;
      }
    }
    set({ session, restoring: false });
  },
  setPendingRedirect: (route) => set({ pendingRedirect: route }),
  updateSession: (session, expectedGeneration) => {
    // If expectedGeneration is provided, only apply the renewed session if
    // the current logoutGeneration still matches — this prevents a stale
    // refresh from resurrecting a session that was logged out during the
    // refresh round.
    if (expectedGeneration !== undefined && get().logoutGeneration !== expectedGeneration) {
      // Logout happened after the refresh round started — drop the renewed
      // session. The refresh token is revoked server-side on logout anyway.
      return;
    }
    void sessionStorage.setItem(JSON.stringify(session)).catch(() => {
      // Persistence is best-effort here; the in-memory session is already
      // applied so this process keeps a valid token either way.
    });
    set({ session });
  },
  setSession: async (session) => {
    await sessionStorage.setItem(JSON.stringify(session));
    // Fresh login: reset logout generation so future refreshes work normally.
    // A previous logout must not permanently disable legitimate refreshes.
    set({ session, logoutGeneration: 0 });

    // Register this device for order-status pushes, best-effort. Lazily
    // imported so the push module's api import cannot cycle the store.
    // Web is skipped entirely: expo-notifications does not support push
    // listeners there (console warning on every boot).
    void (async () => {
      if (Platform.OS === 'web') return;
      try {
        const { registerPushToken } = await import('../push/push-notifications');
        await registerPushToken();
      } catch {
        // Push is optional; a failure here must not affect the session.
      }
    })();

    const guest = useGuestCartStore.getState();
    if (guest.lines.length > 0) {
      set({ merging: true });
      try {
        await mergeGuestCartIntoServer(
          guest.lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity })),
        );
      } catch {
        // A failed merge must not log the user out or lose the cart: guest
        // lines stay local and the cart screen retries against the server.
      } finally {
        set({ merging: false });
      }
    }
  },
  logout: async () => {
    // Capture the refresh token and current generation BEFORE clearing local
    // state. The refresh recovery path (client.ts:refreshSessionOnce) reads the
    // session via getAccessToken at request time, so it may still see the old
    // token for in-flight requests — we prevent resurrection via
    // logoutGeneration below.
    const refreshToken = get().session?.refreshToken ?? null;
    const previousGeneration = get().logoutGeneration;

    // ---- LOCAL LOGOUT FIRST (immediate, never waits for network) ----
    // Increment the logout generation so any in-flight refresh cannot restore
    // the session after this point. This is the key race-prevention mechanism:
    // even if a refresh request completes after we clear local state, the
    // updateSession call will see logoutGeneration > previousGeneration and
    // drop the renewed session.
    const newGeneration = previousGeneration + 1;
    set({ logoutGeneration: newGeneration });

    // Clear persisted session storage immediately. This runs before network
    // cleanup so the user is logged out even if the network is offline.
    await sessionStorage.removeItem();

    // Clear in-memory session and pending redirect immediately. The UI
    // re-renders as logged-out without waiting for anything.
    set({ session: null, pendingRedirect: null });

    // ---- BACKGROUND CLEANUP (non-blocking, failures swallowed) ----
    // Revoke the refresh token server-side. Best-effort: if the network is
    // offline or the server is unavailable, the local session is already
    // cleared and the refresh token will expire on its own.
    if (refreshToken) {
      void (async () => {
        try {
          const { authApi } = await import('../api/auth');
          await authApi.logout({ refreshToken });
        } catch (error) {
          // Diagnostic-only logging — never throws, never blocks.
          // Token values are NOT logged (security).
          // Diagnostic-only logging — never throws, never blocks. Token values are NOT logged (security).
        // eslint-disable-next-line no-console
        console.warn('[auth] background logout failed:', error);
      }
      })();
    }

    // Remove this device's push registration so no further order pushes are
    // delivered to a logged-out device. Best-effort, like every logout step.
    // Web never registered, so it has nothing to remove.
    void (async () => {
      if (Platform.OS === 'web') return;
      try {
        const { unregisterPushToken } = await import('../push/push-notifications');
        await unregisterPushToken();
      } catch (error) {
        // Diagnostic-only logging — never throws, never blocks.
        // Diagnostic-only logging — never throws, never blocks.
        // eslint-disable-next-line no-console
        console.warn('[auth] background push unregister failed:', error);
      }
    })();
  },
}));
