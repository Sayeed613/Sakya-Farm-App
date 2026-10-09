import { describe, expect, it, vi } from 'vitest';

import { createKeyedMutationLock, createMutationLock } from './mutation-lock';

/**
 * Contract tests for the ref-based mutation lock used by `useProductAdd` to
 * prevent duplicate add-to-cart taps.
 *
 * The lock is a pure factory (no React), so tests run in a Node environment
 * without rendering hooks. The hook in `use-product-add.ts` wraps this factory
 * to drive UI state; the three protected call sites (add, increment,
 * decrement) all pass their async work through `runGuarded`, so guarding the
 * factory's contract covers all three.
 */
describe('createMutationLock', () => {
  it('is not locked initially', () => {
    const lock = createMutationLock();
    expect(lock.isLocked()).toBe(false);
  });

  it('runs the callback when the lock is free', async () => {
    const lock = createMutationLock();
    const fn = vi.fn(async () => undefined);

    await lock.runGuarded(fn);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(lock.isLocked()).toBe(false);
  });

  it('prevents a concurrent call while a mutation is in flight', async () => {
    const lock = createMutationLock();

    // Hold the lock with an unresolved promise.
    let resolveFirst: (value: void) => void = () => {};
    const first = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const firstFn = vi.fn(() => first);

    // Start the first mutation (does not resolve yet).
    const firstPromise = lock.runGuarded(firstFn);

    // The lock should now be held.
    expect(lock.isLocked()).toBe(true);

    // A second call while locked should be a no-op.
    const secondFn = vi.fn(async () => undefined);
    await lock.runGuarded(secondFn);

    expect(secondFn).not.toHaveBeenCalled();

    // Release the first mutation.
    resolveFirst();
    await firstPromise;

    expect(lock.isLocked()).toBe(false);
  });

  it('releases the lock after the callback succeeds', async () => {
    const lock = createMutationLock();
    const fn = vi.fn(async () => undefined);

    await lock.runGuarded(fn);

    expect(lock.isLocked()).toBe(false);

    // A second call after release should run.
    const fn2 = vi.fn(async () => undefined);
    await lock.runGuarded(fn2);

    expect(fn2).toHaveBeenCalledTimes(1);
    expect(lock.isLocked()).toBe(false);
  });

  it('releases the lock even when the callback throws', async () => {
    const lock = createMutationLock();
    const fn = vi.fn(async () => {
      throw new Error('network down');
    });

    await expect(lock.runGuarded(fn)).rejects.toThrow('network down');

    // The lock must NOT be stuck open after a failure.
    expect(lock.isLocked()).toBe(false);

    // A subsequent call should work.
    const fn2 = vi.fn(async () => undefined);
    await lock.runGuarded(fn2);

    expect(fn2).toHaveBeenCalledTimes(1);
    expect(lock.isLocked()).toBe(false);
  });

  it('drops all queued synchronous double-taps to a single dispatch', async () => {
    const lock = createMutationLock();
    let resolveMutation: (value: void) => void = () => {};
    const inner = vi.fn(() => new Promise<void>((resolve) => (resolveMutation = resolve)));

    // Simulate two rapid synchronous taps.
    const p1 = lock.runGuarded(inner);
    const p2 = lock.runGuarded(inner);

    // Only the first should dispatch; the second is a no-op.
    expect(inner).toHaveBeenCalledTimes(1);
    expect(lock.isLocked()).toBe(true);

    // Resolve and verify the second call already completed (as a no-op).
    resolveMutation();
    await p2;
    await p1;

    expect(lock.isLocked()).toBe(false);
    expect(inner).toHaveBeenCalledTimes(1); // still only 1 — not called again
  });
});

/**
 * The keyed lock is what the cart actually uses: the card, the quick view and
 * the product screen each hold their own instance, so the gate has to be keyed
 * by PRODUCT for them to agree on who is mutating. Two components mutating the
 * same product must collapse to one request; two different products must not
 * wait on each other.
 */
describe('createKeyedMutationLock', () => {
  it('is not locked for any key initially', () => {
    const lock = createKeyedMutationLock();

    expect(lock.isLocked('product:mango')).toBe(false);
    expect(lock.heldCount()).toBe(0);
  });

  it('drops a second tap for the SAME key while one is in flight', async () => {
    const lock = createKeyedMutationLock();
    let release: (value: string) => void = () => {};
    const inFlight = new Promise<string>((resolve) => {
      release = resolve;
    });
    const fn = vi.fn(() => inFlight);

    const first = lock.runGuarded('product:mango', fn);
    // Same key, same tick: must not run.
    const second = lock.runGuarded('product:mango', fn);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(lock.isLocked('product:mango')).toBe(true);
    expect(await second).toEqual({ ran: false });

    release('done');
    expect(await first).toEqual({ ran: true, value: 'done' });
    expect(lock.isLocked('product:mango')).toBe(false);
  });

  it('does not block a DIFFERENT key while one is held', async () => {
    const lock = createKeyedMutationLock();
    const held = deferred<string>();

    const mango = lock.runGuarded('product:mango', () => held.promise);
    const banana = lock.runGuarded('product:banana', async () => 'banana-ran');

    // Unrelated products run concurrently — this is not a global queue.
    expect(await banana).toEqual({ ran: true, value: 'banana-ran' });
    expect(lock.heldCount()).toBe(1);

    held.resolve('mango-ran');
    await mango;
    expect(lock.heldCount()).toBe(0);
  });

  it('releases on success so a later tap runs', async () => {
    const lock = createKeyedMutationLock();

    await lock.runGuarded('k', async () => 1);
    expect(lock.isLocked('k')).toBe(false);

    const again = await lock.runGuarded('k', async () => 2);
    expect(again).toEqual({ ran: true, value: 2 });
  });

  it('releases on failure so the control is never wedged', async () => {
    const lock = createKeyedMutationLock();

    await expect(
      lock.runGuarded('k', async () => {
        throw new Error('network down');
      }),
    ).rejects.toThrow('network down');

    expect(lock.isLocked('k')).toBe(false);
    expect(lock.heldCount()).toBe(0);

    // The gate is usable again after the failure.
    const retry = await lock.runGuarded('k', async () => 'ok');
    expect(retry).toEqual({ ran: true, value: 'ok' });
  });

  it('releases ONLY the failed key, leaving other in-flight keys untouched', async () => {
    const lock = createKeyedMutationLock();
    const held = deferred<string>();

    const mango = lock.runGuarded('product:mango', () => held.promise);
    await expect(
      lock.runGuarded('product:banana', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(lock.isLocked('product:mango')).toBe(true);
    expect(lock.isLocked('product:banana')).toBe(false);
    expect(lock.heldCount()).toBe(1);

    held.resolve('still going');
    await mango;
    expect(lock.heldCount()).toBe(0);
  });
});

/** Deterministic deferred for lock concurrency tests. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
