/**
 * Synchronous mutation lock that prevents concurrent async mutations.
 *
 * Checked synchronously: if a mutation is already in flight, `runGuarded`
 * resolves immediately (a no-op) so rapid double-taps cannot dispatch twice.
 * The lock is always released in `finally` — including when the callback throws
 * — so a failed request never leaves the gate stuck open.
 *
 * Extracted as a pure factory (no React dependency) so the locking contract is
 * unit-testable in a Node environment without rendering hooks. The React hook
 * in `use-product-add` wraps this to drive UI state (`mutating`).
 */
export function createMutationLock() {
  let locked = false;

  return {
    /** `true` while a mutation is in flight. */
    isLocked: () => locked,
    /**
     * Runs `fn` if the lock is free; returns immediately without calling `fn`
     * if a mutation is already in progress. Always releases the lock in
     * `finally`, including when `fn` rejects.
     */
    runGuarded: async (fn: () => Promise<void>): Promise<void> => {
      if (locked) return;
      locked = true;
      try {
        await fn();
      } finally {
        locked = false;
      }
    },
  };
}

/** Result of a keyed guard: `ran: false` means the tap was dropped. */
export type KeyedRunResult<T> = { ran: false } | { ran: true; value: T };

export interface KeyedMutationLock {
  /** `true` while a mutation for this key is in flight. */
  isLocked(key: string): boolean;
  /** Number of keys currently held — `0` means no mutation is running. */
  heldCount(): number;
  /**
   * Runs `fn` only if `key` is free; drops the call (no `fn`, no request) when
   * a mutation for the same key is already in flight.
   *
   * The key is acquired SYNCHRONOUSLY — before any `await` inside `fn` — so two
   * taps in the same tick cannot both get in. Always released in `finally`,
   * including when `fn` rejects, so a failed request never wedges the gate.
   *
   * Scope is deliberately per key (one product): unrelated products never wait
   * on each other, which is what keeps this from becoming a global cart queue.
   */
  runGuarded<T>(key: string, fn: () => Promise<T>): Promise<KeyedRunResult<T>>;
}

/**
 * One independent gate per key.
 *
 * The single-key `createMutationLock` above cannot express "the card and the
 * quick-view sheet are mutating the SAME product" — each component would own
 * its own lock and both would fire. Keying by product gives one gate per cart
 * line while leaving every other product free to mutate concurrently.
 */
export function createKeyedMutationLock(): KeyedMutationLock {
  const held = new Set<string>();

  return {
    isLocked: (key) => held.has(key),
    heldCount: () => held.size,
    runGuarded: async <T>(key: string, fn: () => Promise<T>): Promise<KeyedRunResult<T>> => {
      if (held.has(key)) return { ran: false };
      held.add(key);
      try {
        const value = await fn();
        return { ran: true, value };
      } finally {
        held.delete(key);
      }
    },
  };
}
