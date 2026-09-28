/**
 * The customer's last-used payment method.
 *
 * Checkout offers COD + online methods; remembering the last choice keeps a
 * repeat purchase to Add → Checkout → Pay Now with no re-selection. Persisted
 * like the last address (SecureStore on native, localStorage on web).
 */

import { Platform } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type LastPaymentMethod = 'COD' | 'UPI' | 'CARD' | 'NET_BANKING';

const PAYMENT_KEY = 'sakya.customer.last-payment-method';

interface LastPaymentMethodState {
  method: LastPaymentMethod | null;
  remember: (method: LastPaymentMethod) => void;
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

export const useLastPaymentMethodStore = create<LastPaymentMethodState>()(
  persist(
    (set) => ({
      method: null,
      remember: (method) => set({ method }),
    }),
    {
      name: PAYMENT_KEY,
      storage: createJSONStorage(() => storage),
    },
  ),
);
