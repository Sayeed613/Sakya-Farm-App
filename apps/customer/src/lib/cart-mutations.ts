import type { CartResponse } from '@sakya/types';

import { createKeyedMutationLock, type KeyedMutationLock } from './mutation-lock';

/**
 * Cart mutation controller — lock, network, cache write, release.
 *
 * Extracted as a pure factory (no React, no React Query, no React Native) so
 * the duplicate-tap contract is testable in a Node environment without
 * rendering hooks. The two hooks that mutate the cart — `useProductAdd`
 * (cards, quick view, related rail) and `useDetailCartControls` (the product
 * screen) — both build one of these, so they share a single implementation of
 * the rules instead of re-deriving them:
 *
 * 1. One mutation per product at a time — a second tap for the SAME product is
 *    dropped rather than dispatched. Different products stay independent, so
 *    this is never a global queue.
 * 2. The lock is taken before any `await`, so two taps in one tick cannot both
 *    get in, and released in `finally` so a failure cannot wedge the control.
 * 3. Only a real server response reaches the cache. A failed request writes
 *    nothing, so the UI can never show a quantity the server never confirmed.
 *
 * The gateway is injected, so tests drive it with a fake and count requests.
 */
export interface CartGateway {
  addItem(input: { variantId: string; quantity: number }): Promise<CartResponse>;
  updateItem(itemId: string, input: { quantity: number }): Promise<CartResponse>;
  removeItem(itemId: string): Promise<CartResponse>;
}

export interface CartMutationDeps {
  /** Server cart endpoints (the real `cartApi` in the app, a fake in tests). */
  gateway: CartGateway;
  /** Applies an authoritative server response to the cart cache. */
  apply: (cart: CartResponse) => void;
  /** Injectable so tests can observe/replace the lock; a fresh one by default. */
  lock?: KeyedMutationLock;
}

export interface CartMutations {
  /** `true` while a mutation for this product is in flight (drives disabled UI). */
  isBusy(key: string): boolean;
  /** Number of products with a mutation in flight. */
  busyCount(): number;
  /**
   * Runs `fn` exclusively for `key`, dropping the call when one is already in
   * flight. Used to wrap a WHOLE operation — including any product-detail
   * fetch that has to happen first, which is why the lock must be outermost.
   */
  runExclusive<T>(key: string, fn: () => Promise<T>): ReturnType<KeyedMutationLock['runGuarded']>;
  /** Relative `+quantity`; the server owns the arithmetic. */
  addItem(variantId: string, quantity?: number): Promise<CartResponse | null>;
  /** Absolute quantity for a known line; `<= 0` removes it. */
  setLine(itemId: string, quantity: number): Promise<CartResponse | null>;
  /** Creates the line when absent, otherwise sets it absolutely. */
  upsertLine(
    variantId: string,
    itemId: string | null,
    quantity: number,
  ): Promise<CartResponse | null>;
}

export function createCartMutations(deps: CartMutationDeps): CartMutations {
  const lock = deps.lock ?? createKeyedMutationLock();

  /**
   * Runs one request and writes the response back. The response is the ONLY
   * thing that reaches the cache — no client-side arithmetic, no optimistic
   * guess — and a rejection propagates with nothing written.
   */
  async function write(op: () => Promise<CartResponse | null>): Promise<CartResponse | null> {
    const cart = await op();
    if (cart !== null) deps.apply(cart);
    return cart;
  }

  return {
    isBusy: (key) => lock.isLocked(key),
    busyCount: () => lock.heldCount(),

    runExclusive: <T>(key: string, fn: () => Promise<T>) => lock.runGuarded(key, fn),

    addItem: (variantId, quantity = 1) =>
      write(() => deps.gateway.addItem({ variantId, quantity })),

    setLine: (itemId, quantity) =>
      write(() =>
        quantity <= 0
          ? deps.gateway.removeItem(itemId)
          : deps.gateway.updateItem(itemId, { quantity }),
      ),

    upsertLine: (variantId, itemId, quantity) =>
      write(() => {
        if (quantity <= 0) {
          // No line to remove — a decrement that would go negative is a no-op,
          // never a request.
          return itemId !== null ? deps.gateway.removeItem(itemId) : Promise.resolve(null);
        }
        return itemId !== null
          ? deps.gateway.updateItem(itemId, { quantity })
          : deps.gateway.addItem({ variantId, quantity });
      }),
  };
}
