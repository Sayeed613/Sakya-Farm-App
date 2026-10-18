import { Platform } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { CheckoutAddress } from '../api/checkout';

/** The customer's last-used delivery address.

 * Keyed by the device, not the account: there is no owner identity in this
 * store, so it has no way to know who is signed in or out. That is also the
 * whole reason a logout that only clears the session store still leaves a
 * real address behind, ready to autofill the next person's checkout: the
 * prefill survives whenever someone forgets to clear the store by hand.
 *
 * The server is the system of record for anything that matters — checkout
 * snapshots the delivered-to address into the order at placement, and the
 * signed-in session owns the address book. This store is only a convenience
 * prefiller for the form.
 *
 * Storage matches the guest cart: SecureStore on native, localStorage on web.
 */

const ADDRESS_KEY = 'sakya.customer.last-address';

interface LastAddressState {
  address: CheckoutAddress | null;
  remember: (address: CheckoutAddress) => void;
  forget: () => void;
  /** Log the customer out: drop the remembered address so a new sign-in
   * cannot prefill the form with it. The two stores are deliberately
   * independent — the session store owns credentials; this store owns the
   * convenience prefill — but logout is the one event that must clear both.
   */
  logout: () => void;
}

function secureStorage() {
  // Required lazily so web bundles never evaluate the native module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const SecureStore = require('expo-secure-store') as typeof import('expo-secure-store');
  return {
    getItem: (key: string) => SecureStore.getItemAsync(key),
    setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
    removeItem: (key: string) => SecureStore.deleteItemAsync(key),
  };
}

function localStorageAdapter() {
  return {
    getItem: async (key: string) => {
      if (typeof window === 'undefined') return null;
      return window.localStorage.getItem(key);
    },
    setItem: async (key: string, value: string) => {
      if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
    },
    removeItem: async (key: string) => {
      if (typeof window !== 'undefined') window.localStorage.removeItem(key);
    },
  };
}

const storage = Platform.OS === 'web' ? localStorageAdapter() : secureStorage();

export const useLastAddressStore = create<LastAddressState>()(
  persist(
    (set) => ({
      address: null,
      remember: (address) => set({ address }),
      forget: () => set({ address: null }),
      logout: () => set({ address: null }),
    }),
    {
      name: ADDRESS_KEY,
      storage: createJSONStorage(() => storage),
    },
  ),
);
