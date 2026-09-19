import { describe, expect, it } from 'vitest';

import { createFetchDouble, type ResponseSpec } from '../__testing__/fetch-double';
import { createHttpClient } from '../http';
import { createCartResource } from './cart';

const BASE_URL = 'https://api.sakyafarms.test/api/v1';
const VARIANT_ID = '22222222-2222-4222-8222-222222222222';
const STORE_ID = '33333333-3333-4333-8333-333333333333';
const ITEM_ID = '44444444-4444-4444-8444-444444444444';

function build(...queue: ResponseSpec[]) {
  const double = createFetchDouble(...queue);
  const http = createHttpClient({
    baseUrl: BASE_URL,
    fetchImpl: double.fetchImpl,
    getAccessToken: () => 'token',
  });
  return { double, cart: createCartResource(http) };
}

const CART = { id: 'c1', items: [], totalInPaise: 0 };

describe('getCart', () => {
  it('reads the current cart with the bearer token attached', async () => {
    const { cart, double } = build({ body: CART });

    await cart.getCart();

    expect(double.lastCall().url).toBe(`${BASE_URL}/cart`);
    expect(double.lastCall().init.headers.authorization).toBe('Bearer token');
  });
});

describe('addItem', () => {
  it('posts the validated item body', async () => {
    const { cart, double } = build({ status: 201, body: CART });

    await cart.addItem({ variantId: VARIANT_ID, storeId: STORE_ID, quantity: 2 });

    expect(double.lastCall().url).toBe(`${BASE_URL}/cart/items`);
    expect(double.lastCall().init.method).toBe('POST');
    expect(double.lastBody()).toEqual({ variantId: VARIANT_ID, storeId: STORE_ID, quantity: 2 });
  });

  it('rejects a non-integer quantity before making a request', async () => {
    const { cart, double } = build({ body: CART });

    await expect(
      cart.addItem({ variantId: VARIANT_ID, storeId: STORE_ID, quantity: 1.5 }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', issues: [{ path: 'quantity' }] });
    expect(double.calls).toHaveLength(0);
  });

  it('rejects a missing store, which the server requires to fulfil the order', async () => {
    const { cart, double } = build({ body: CART });

    await expect(
      cart.addItem({ variantId: VARIANT_ID, storeId: '', quantity: 1 }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', issues: [{ path: 'storeId' }] });
    expect(double.calls).toHaveLength(0);
  });
});

describe('updateItem', () => {
  it('patches one line by id', async () => {
    const { cart, double } = build({ body: CART });

    await cart.updateItem(ITEM_ID, { quantity: 3 });

    expect(double.lastCall().url).toBe(`${BASE_URL}/cart/items/${ITEM_ID}`);
    expect(double.lastCall().init.method).toBe('PATCH');
    expect(double.lastBody()).toEqual({ quantity: 3 });
  });

  it('rejects a zero quantity, which would not be a valid line', async () => {
    const { cart, double } = build({ body: CART });

    await expect(cart.updateItem(ITEM_ID, { quantity: 0 })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(double.calls).toHaveLength(0);
  });
});

describe('removeItem and clearCart', () => {
  it('deletes one line', async () => {
    const { cart, double } = build({ body: CART });

    await cart.removeItem(ITEM_ID);

    expect(double.lastCall().url).toBe(`${BASE_URL}/cart/items/${ITEM_ID}`);
    expect(double.lastCall().init.method).toBe('DELETE');
  });

  it('deletes the whole cart', async () => {
    const { cart, double } = build({ body: CART });

    await cart.clearCart();

    expect(double.lastCall().url).toBe(`${BASE_URL}/cart`);
    expect(double.lastCall().init.method).toBe('DELETE');
  });

  it('rejects a malformed item id rather than building a broken URL', async () => {
    const { cart, double } = build({ body: CART });

    await expect(cart.removeItem('123')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(double.calls).toHaveLength(0);
  });
});

describe('coupons', () => {
  it('applies a coupon and upper-cases the code, as the API stores it', async () => {
    const { cart, double } = build({ body: CART });

    await cart.applyCoupon({ code: 'save10' });

    expect(double.lastCall().url).toBe(`${BASE_URL}/cart/coupon`);
    expect(double.lastCall().init.method).toBe('POST');
    expect(double.lastBody()).toEqual({ code: 'SAVE10' });
  });

  it('rejects a coupon code containing characters the API forbids', async () => {
    const { cart, double } = build({ body: CART });

    await expect(cart.applyCoupon({ code: 'SAVE 10%' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(double.calls).toHaveLength(0);
  });

  it('removes the applied coupon', async () => {
    const { cart, double } = build({ body: CART });

    await cart.removeCoupon();

    expect(double.lastCall().url).toBe(`${BASE_URL}/cart/coupon`);
    expect(double.lastCall().init.method).toBe('DELETE');
  });
});
