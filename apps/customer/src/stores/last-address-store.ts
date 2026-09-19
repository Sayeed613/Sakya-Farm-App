import { Platform } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { CheckoutAddress } from '../api/checkout';

/**
 * The customer's last-used delivery address.
 *
 * There is no full address book yet — the backend has no address endpoints —
 * so checkout persists exactly one address locally and prefills the form with
 * it next time. The address travels to the order as a snapshot at placement;
 * the server is the system of record for the placed order, this is only a
 * convenience for the form.
 *
 * Storage matches the guest cart: SecureStore on native, localStorage on web.
 */

const ADDRESS_KEY = 'sakya.customer.last-address';

interface LastAddressState {
  address: CheckoutAddress | null;
  remember: (address: CheckoutAddress) => void;
  forget: () => void;
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
    }),
    {
      name: ADDRESS_KEY,
      storage: createJSONStorage(() => storage),
    },
  ),
);
