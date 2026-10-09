import type { CartResponse } from '@sakya/types';
import { toPaise } from '@sakya/utils';
import { describe, expect, it, vi } from 'vitest';

import { createCartMutations, type CartGateway } from './cart-mutations';

/**
 * Step 9 — cart mutation safety.
 *
 * These pin the behaviour the card, quick-view and product-screen steppers all
 * depend on, driven through the REAL controller with a fake gateway so request
 * counts are exact. No React, no rendering, no timers: concurrency is expressed
 * with deferreds, so every assertion is deterministic.
 *
 * Mapping to the Step 9 requirements:
 *   A. two immediate Add taps     -> one network mutation
 *   B. overlapping Increment taps -> gated, no uncontrolled duplicates
 *   C. success                    -> lock released, server response applied
 *   D. failure                    -> lock released, nothing written, UI usable
 *   E. concurrent same-item       -> same key blocked, other keys unaffected
 *   G. optimistic update          -> N/A; nothing optimistic is written, which
 *                                    is asserted below instead
 */

/** Deterministic deferred — stands in for an in-flight HTTP response. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Minimal valid CartResponse with server-computed totals. */
function cart(
  items: Array<{ id: string; variantId: string; quantity: number; productSlug?: string }> = [],
): CartResponse {
  return {
    id: 'cart-1',
    anonymousId: null,
    status: 'ACTIVE',
    currency: 'INR',
    expiresAt: null,
    items: items.map((item) => ({
      id: item.id,
      variantId: item.variantId,
      productTitle: 'Mango',
      variantTitle: '500 g',
      productImageUrl: null,
      productSlug: item.productSlug ?? 'mango',
      categorySlugs: ['fruits'],
      sku: null,
      quantity: item.quantity,
      lineTotalInPaise: toPaise(item.quantity * 2400),
      unitPriceInPaise: toPaise(2400),
      isAvailable: true,
    })),
    subtotalInPaise: toPaise(0),
    discountInPaise: toPaise(0),
    taxInPaise: toPaise(0),
    shippingInPaise: toPaise(0),
    totalInPaise: toPaise(0),
    coupon: null,
  };
}

function fakeGateway() {
  return {
    addItem: vi.fn(async (_input: { variantId: string; quantity: number }) => cart()),
    updateItem: vi.fn(async (_itemId: string, _input: { quantity: number }) => cart()),
    removeItem: vi.fn(async (_itemId: string) => cart()),
  };
}

function setup(gateway: ReturnType<typeof fakeGateway> = fakeGateway()) {
  const apply = vi.fn();
  const mutations = createCartMutations({ gateway: gateway as CartGateway, apply });
  return { gateway, apply, mutations };
}

/** The shape the hooks use: a tap runs the whole operation under the lock. */
function tapOn(
  mutations: ReturnType<typeof createCartMutations>,
  key: string,
  op: () => Promise<unknown>,
) {
  return mutations.runExclusive(key, op);
}

describe('cart mutation duplicate-tap safety', () => {
  it('A: two immediate Add taps dispatch exactly one network request', async () => {
    const { gateway, apply, mutations } = setup();
    const gate = deferred<CartResponse>();
    gateway.addItem.mockReturnValue(gate.promise);

    // Two taps in the same tick — no await between them, exactly the race a
    // double-tap produces.
    const first = tapOn(mutations, 'product:mango', () => mutations.addItem('v1', 1));
    const second = tapOn(mutations, 'product:mango', () => mutations.addItem('v1', 1));

    gate.resolve(cart([{ id: 'line-1', variantId: 'v1', quantity: 1 }]));
    const [r1, r2] = await Promise.all([first, second]);

    expect(gateway.addItem).toHaveBeenCalledTimes(1);
    expect(r1.ran).toBe(true);
    expect(r2).toEqual({ ran: false });
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('B: overlapping Increment taps are gated to a single request, then the next tap works', async () => {
    const { gateway, mutations } = setup();
    const gate = deferred<CartResponse>();
    gateway.addItem.mockReturnValue(gate.promise);

    const taps = [
      tapOn(mutations, 'product:mango', () => mutations.addItem('v1', 1)),
      tapOn(mutations, 'product:mango', () => mutations.addItem('v1', 1)),
      tapOn(mutations, 'product:mango', () => mutations.addItem('v1', 1)),
    ];

    // Three taps, one dispatch — the extra taps are dropped, not queued up as
    // uncontrolled requests.
    expect(gateway.addItem).toHaveBeenCalledTimes(1);
    expect(mutations.isBusy('product:mango')).toBe(true);

    gate.resolve(cart([{ id: 'line-1', variantId: 'v1', quantity: 1 }]));
    const results = await Promise.all(taps);

    expect(results.filter((result) => result.ran)).toHaveLength(1);
    expect(gateway.addItem).toHaveBeenCalledTimes(1);

    // The lock released, so a deliberate later tap still dispatches.
    await tapOn(mutations, 'product:mango', () => mutations.addItem('v1', 1));
    expect(gateway.addItem).toHaveBeenCalledTimes(2);
  });

  it('C: on success the lock releases and the SERVER response becomes the cart state', async () => {
    const { gateway, apply, mutations } = setup();
    const serverCart = cart([{ id: 'line-1', variantId: 'v1', quantity: 3 }]);
    gateway.addItem.mockResolvedValue(serverCart);

    const result = await tapOn(mutations, 'product:mango', () => mutations.addItem('v1', 1));

    expect(result.ran).toBe(true);
    // Exactly the response the server sent — never a locally computed cart.
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(serverCart);
    expect(apply.mock.calls[0]?.[0]).toBe(serverCart);
    expect(mutations.isBusy('product:mango')).toBe(false);
    expect(mutations.busyCount()).toBe(0);
  });

  it('D: on failure the lock releases, nothing is written, and the control stays usable', async () => {
    const { gateway, apply, mutations } = setup();
    gateway.addItem.mockRejectedValueOnce(new Error('network down'));

    await expect(
      tapOn(mutations, 'product:mango', () => mutations.addItem('v1', 1)),
    ).rejects.toThrow('network down');

    // No false increment: the failed request must not reach the cache.
    expect(apply).not.toHaveBeenCalled();
    // Not stuck: the gate is free again.
    expect(mutations.isBusy('product:mango')).toBe(false);

    // ...so the very next tap runs normally.
    const retry = await tapOn(mutations, 'product:mango', () => mutations.addItem('v1', 1));

    expect(retry.ran).toBe(true);
    expect(gateway.addItem).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('D: a failed setLine leaves the last known server quantity untouched', async () => {
    const { gateway, apply, mutations } = setup();
    gateway.updateItem.mockRejectedValueOnce(new Error('boom'));

    await expect(
      tapOn(mutations, 'product:mango', () => mutations.setLine('line-1', 4)),
    ).rejects.toThrow('boom');

    expect(apply).not.toHaveBeenCalled();
    expect(mutations.isBusy('product:mango')).toBe(false);
  });

  it('E: the same product is gated while other products run concurrently', async () => {
    const { gateway, mutations } = setup();
    const mango = deferred<CartResponse>();
    const banana = deferred<CartResponse>();
    gateway.addItem.mockImplementation((input) =>
      input.variantId === 'v-mango' ? mango.promise : banana.promise,
    );

    const mangoTap = tapOn(mutations, 'product:mango', () => mutations.addItem('v-mango', 1));
    const mangoDup = tapOn(mutations, 'product:mango', () => mutations.addItem('v-mango', 1));
    const bananaTap = tapOn(mutations, 'product:banana', () => mutations.addItem('v-banana', 1));

    // Different product → not blocked, so unrelated UI never waits.
    expect(mutations.isBusy('product:mango')).toBe(true);
    expect(mutations.isBusy('product:banana')).toBe(true);
    expect(mutations.busyCount()).toBe(2);
    expect(gateway.addItem).toHaveBeenCalledTimes(2);

    mango.resolve(cart([{ id: 'line-1', variantId: 'v-mango', quantity: 1 }]));
    banana.resolve(cart([{ id: 'line-2', variantId: 'v-banana', quantity: 1 }]));

    const [m1, m2, b1] = await Promise.all([mangoTap, mangoDup, bananaTap]);

    expect(m1.ran).toBe(true);
    expect(m2.ran).toBe(false);
    expect(b1.ran).toBe(true);
    expect(mutations.busyCount()).toBe(0);
  });
});

describe('cart mutation request shapes', () => {
  it('increment sends a RELATIVE +1, leaving the arithmetic to the server', async () => {
    const { gateway, mutations } = setup();

    await tapOn(mutations, 'product:mango', () => mutations.addItem('v1', 1));

    expect(gateway.addItem).toHaveBeenCalledWith({ variantId: 'v1', quantity: 1 });
    expect(gateway.updateItem).not.toHaveBeenCalled();
  });

  it('setLine writes an absolute quantity taken from server state, and removes at 0', async () => {
    const { gateway, mutations } = setup();

    await tapOn(mutations, 'product:mango', () => mutations.setLine('line-1', 4));
    expect(gateway.updateItem).toHaveBeenCalledWith('line-1', { quantity: 4 });

    await tapOn(mutations, 'product:mango', () => mutations.setLine('line-1', 0));
    expect(gateway.removeItem).toHaveBeenCalledWith('line-1');
    expect(gateway.updateItem).toHaveBeenCalledTimes(1);
  });

  it('upsertLine adds when there is no line yet and updates when there is one', async () => {
    const { gateway, mutations } = setup();

    await tapOn(mutations, 'product:mango', () => mutations.upsertLine('v1', null, 2));
    expect(gateway.addItem).toHaveBeenCalledWith({ variantId: 'v1', quantity: 2 });

    await tapOn(mutations, 'product:mango', () => mutations.upsertLine('v1', 'line-1', 3));
    expect(gateway.updateItem).toHaveBeenCalledWith('line-1', { quantity: 3 });
    expect(gateway.addItem).toHaveBeenCalledTimes(1);
  });

  it('upsertLine never issues a request when the line is already gone', async () => {
    const { gateway, mutations } = setup();

    const result = await tapOn(mutations, 'product:mango', () =>
      mutations.upsertLine('v1', null, 0),
    );

    expect(result.ran).toBe(true);
    expect(gateway.addItem).not.toHaveBeenCalled();
    expect(gateway.updateItem).not.toHaveBeenCalled();
    expect(gateway.removeItem).not.toHaveBeenCalled();
  });

  it('G (no optimistic UI): only a real server response ever reaches the cache', async () => {
    const { gateway, apply, mutations } = setup();
    const serverCart = cart([{ id: 'line-9', variantId: 'v1', quantity: 7 }]);
    gateway.addItem.mockResolvedValue(serverCart);

    await tapOn(mutations, 'product:mango', () => mutations.addItem('v1', 1));

    // The cache received the response object by identity — so no locally
    // fabricated or pre-emptively incremented cart can appear, and there is no
    // optimistic state that would need rolling back.
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(serverCart);
    expect(apply.mock.calls[0]?.[0]).toBe(serverCart);
  });
});
