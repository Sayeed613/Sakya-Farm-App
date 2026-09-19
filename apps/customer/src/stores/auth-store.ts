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
  restore: () => Promise<void>;
  setPendingRedirect: (route: string | null) => void;
  /**
   * Persist a session AND merge the guest cart into the server cart.
   *
   * Every authentication path (OTP screen, auth gates) goes through here, so
   * merging behaviour is identical everywhere: guest lines are sent to the
   * server, revalidated, and only then cleared locally.
   */
  setSession: (session: AuthSessionResponse) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  session: null,
  restoring: true,
  pendingRedirect: null,
  merging: false,
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
  setSession: async (session) => {
    await sessionStorage.setItem(JSON.stringify(session));
    set({ session });

    // Register this device for order-status pushes, best-effort. Lazily
    // imported so the push module's api import cannot cycle the store.
    void (async () => {
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
    const refreshToken = get().session?.refreshToken;
    if (refreshToken) {
      // Revoke server-side, best effort: clearing the local session must not
      // depend on the network.
      try {
        const { authApi } = await import('../api/auth');
        await authApi.logout({ refreshToken });
      } catch {
        // Local session is cleared below regardless.
      }
    }
    // Remove this device's push registration so no further order pushes are
    // delivered to a logged-out device. Best-effort, like every logout step.
    try {
      const { unregisterPushToken } = await import('../push/push-notifications');
      await unregisterPushToken();
    } catch {
      // Local session is cleared below regardless.
    }
    await sessionStorage.removeItem();
    set({ session: null, pendingRedirect: null });
  },
}));
