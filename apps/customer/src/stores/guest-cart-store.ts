import { Platform } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * The guest cart.
 *
 * Guests can add items before they have an account, so quantities live here,
 * keyed by variant id. Money stays server-owned: `priceTotals` is display-only
 * and everything is recomputed at merge/checkout time.
 *
 * `display` is a client-side snapshot of the catalog data the customer saw
 * when adding (title, variant title, thumbnail). It exists purely so the cart
 * screen can render a human-readable line instead of a variant UUID; the
 * server cart re-resolves real titles/availability at merge time, so a stale
 * snapshot can never affect pricing or what is actually ordered.
 *
 * Storage: SecureStore on native, localStorage on web — the same split the
 * auth store makes, extracted into a tiny adapter both can use.
 */

const GUEST_CART_KEY = 'sakya.customer.guest-cart';

/** Display snapshot captured from catalog data at add time. */
export interface GuestCartLineDisplay {
  productTitle: string;
  variantTitle: string;
  imageUrl: string | null;
  slug: string;
}

/** One guest cart line: the minimum the server needs to revalidate a line. */
export interface GuestCartLine {
  variantId: string;
  quantity: number;
  display: GuestCartLineDisplay | null;
}

interface GuestCartState {
  lines: GuestCartLine[];
  /**
   * Informational unit prices (paise) per variant, captured from product
   * details the app already fetched. Display-only: the server owns real
   * pricing and recomputes everything at checkout.
   */
  priceTotals: Record<string, number>;
  /** Slug + thumbnail of the most recently added item, for the cart pill. */
  lastAdded: { slug: string; imageUrl: string | null } | null;
  rememberPrice: (variantId: string, unitPriceInPaise: number) => void;
  rememberLastAdded: (slug: string, imageUrl: string | null) => void;
  addLine: (
    variantId: string,
    quantity: number,
    display?: { productTitle: string; variantTitle: string; imageUrl: string | null; slug: string },
  ) => void;
  setQuantity: (variantId: string, quantity: number) => void;
  removeLine: (variantId: string) => void;
  clear: () => void;
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
    // Async signatures match the persist middleware's StateStorage contract,
    // which is fixed per store instance — it cannot mix sync and async.
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

export const useGuestCartStore = create<GuestCartState>()(
  persist(
    (set) => ({
      lines: [],
      priceTotals: {},
      lastAdded: null,
      rememberPrice: (variantId, unitPriceInPaise) =>
        set((state) => ({ priceTotals: { ...state.priceTotals, [variantId]: unitPriceInPaise } })),
      rememberLastAdded: (slug, imageUrl) =>
        set({ lastAdded: { slug, imageUrl } }),
      addLine: (variantId, quantity, display) =>
        set((state) => {
          const existing = state.lines.find((line) => line.variantId === variantId);
          if (existing) {
            return {
              lines: state.lines.map((line) =>
                line.variantId === variantId
                  ? {
                      ...line,
                      quantity: Math.min(99, line.quantity + quantity),
                      // Refresh the snapshot if a better one arrives.
                      display: display ?? line.display,
                    }
                  : line,
              ),
            };
          }
          return {
            lines: [
              ...state.lines,
              { variantId, quantity: Math.min(99, quantity), display: display ?? null },
            ],
          };
        }),
      setQuantity: (variantId, quantity) =>
        set((state) => ({
          lines:
            quantity <= 0
              ? state.lines.filter((line) => line.variantId !== variantId)
              : state.lines.map((line) =>
                  line.variantId === variantId
                    ? { ...line, quantity: Math.min(99, quantity) }
                    : line,
                ),
        })),
      removeLine: (variantId) =>
        set((state) => ({ lines: state.lines.filter((line) => line.variantId !== variantId) })),
      // Also drops the pill's last-added thumbnail: after a merge the server
      // cart is authoritative, so a guest-era thumbnail would be stale.
      clear: () => set({ lines: [], lastAdded: null }),
    }),
    {
      name: GUEST_CART_KEY,
      storage: createJSONStorage(() => storage),
    },
  ),
);

/** Total item count for badge display. */
export function guestCartCount(lines: GuestCartLine[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}
