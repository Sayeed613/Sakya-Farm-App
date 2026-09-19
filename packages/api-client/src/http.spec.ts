import { describe, expect, it } from 'vitest';

import { createFetchDouble } from './__testing__/fetch-double';
import { ApiError, configurationError } from './errors';
import { createHttpClient } from './http';

const BASE_URL = 'https://api.sakyafarms.test/api/v1';

describe('createHttpClient configuration', () => {
  it('rejects a missing base URL with a configuration error', () => {
    expect(() => createHttpClient({ baseUrl: '   ', fetchImpl: createFetchDouble().fetchImpl }))
      .toThrowError(/No API base URL configured/);
  });

  it('rejects a relative base URL so a shipped build cannot fall back to localhost', () => {
    try {
      createHttpClient({ baseUrl: '/api/v1', fetchImpl: createFetchDouble().fetchImpl });
      throw new Error('expected createHttpClient to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe('CONFIGURATION_ERROR');
    }
  });

  it('normalizes a trailing slash so paths are not doubled', async () => {
    const double = createFetchDouble({ body: {} });
    const client = createHttpClient({ baseUrl: `${BASE_URL}/`, fetchImpl: double.fetchImpl });

    await client.request('/health');

    expect(client.baseUrl).toBe(BASE_URL);
    expect(double.lastCall().url).toBe(`${BASE_URL}/health`);
  });
});

describe('request shape', () => {
  it('sends a GET with accept but no content-type', async () => {
    const double = createFetchDouble({ body: { status: 'ok' } });
    const client = createHttpClient({ baseUrl: BASE_URL, fetchImpl: double.fetchImpl });

    await client.request('/health');

    const { init } = double.lastCall();
    expect(init.method).toBe('GET');
    expect(init.headers.accept).toBe('application/json');
    expect(init.headers['content-type']).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it('serializes a body and sets content-type for a POST', async () => {
    const double = createFetchDouble({ body: {} });
    const client = createHttpClient({ baseUrl: BASE_URL, fetchImpl: double.fetchImpl });

    await client.request('/cart/items', {
      method: 'POST',
      body: { variantId: 'v1', quantity: 2 },
    });

    expect(double.lastCall().init.headers['content-type']).toBe('application/json');
    expect(double.lastBody()).toEqual({ variantId: 'v1', quantity: 2 });
  });

  it('appends query parameters', async () => {
    const double = createFetchDouble({ body: { items: [] } });
    const client = createHttpClient({ baseUrl: BASE_URL, fetchImpl: double.fetchImpl });

    await client.request('/products', { query: { page: 2, limit: 20, search: undefined } });

    expect(double.lastCall().url).toBe(`${BASE_URL}/products?limit=20&page=2`);
  });

  it('normalizes a path given without a leading slash', async () => {
    const double = createFetchDouble({ body: {} });
    const client = createHttpClient({ baseUrl: BASE_URL, fetchImpl: double.fetchImpl });

    await client.request('health');

    expect(double.lastCall().url).toBe(`${BASE_URL}/health`);
  });
});

describe('auth header', () => {
  it('attaches the bearer token from a synchronous provider', async () => {
    const double = createFetchDouble({ body: {} });
    const client = createHttpClient({
      baseUrl: BASE_URL,
      fetchImpl: double.fetchImpl,
      getAccessToken: () => 'access-token-1',
    });

    await client.request('/cart');

    expect(double.lastCall().init.headers.authorization).toBe('Bearer access-token-1');
  });

  it('awaits an asynchronous provider, as a keychain read is', async () => {
    const double = createFetchDouble({ body: {} });
    const client = createHttpClient({
      baseUrl: BASE_URL,
      fetchImpl: double.fetchImpl,
      getAccessToken: () => Promise.resolve('access-token-2'),
    });

    await client.request('/cart');

    expect(double.lastCall().init.headers.authorization).toBe('Bearer access-token-2');
  });

  it('re-reads the token per request so a refresh is picked up', async () => {
    const double = createFetchDouble({ body: {} }, { body: {} });
    let token = 'first';
    const client = createHttpClient({
      baseUrl: BASE_URL,
      fetchImpl: double.fetchImpl,
      getAccessToken: () => token,
    });

    await client.request('/cart');
    token = 'second';
    await client.request('/cart');

    expect(double.calls[0]?.init.headers.authorization).toBe('Bearer first');
    expect(double.calls[1]?.init.headers.authorization).toBe('Bearer second');
  });

  it('omits the header when there is no session', async () => {
    const double = createFetchDouble({ body: {} });
    const client = createHttpClient({
      baseUrl: BASE_URL,
      fetchImpl: double.fetchImpl,
      getAccessToken: () => null,
    });

    await client.request('/products');

    expect(double.lastCall().init.headers.authorization).toBeUndefined();
  });

  it('omits the header when auth is explicitly disabled', async () => {
    const double = createFetchDouble({ body: {} });
    const client = createHttpClient({
      baseUrl: BASE_URL,
      fetchImpl: double.fetchImpl,
      getAccessToken: () => 'should-not-be-sent',
    });

    await client.request('/products', { auth: 'none' });

    expect(double.lastCall().init.headers.authorization).toBeUndefined();
  });
});

describe('responses', () => {
  it('returns parsed JSON for a success', async () => {
    const double = createFetchDouble({ body: { id: 'p1', title: 'Ghee' } });
    const client = createHttpClient({ baseUrl: BASE_URL, fetchImpl: double.fetchImpl });

    await expect(client.request('/products/ghee')).resolves.toEqual({ id: 'p1', title: 'Ghee' });
  });

  it('returns undefined for 204 rather than throwing on an empty body', async () => {
    const double = createFetchDouble({ status: 204 });
    const client = createHttpClient({ baseUrl: BASE_URL, fetchImpl: double.fetchImpl });

    await expect(client.request('/cart/items/i1', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('surfaces the envelope code and issues on a 400', async () => {
    const double = createFetchDouble({
      status: 400,
      headers: { 'x-request-id': 'req-1' },
      body: {
        success: false,
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed (1 issue)',
        issues: [{ path: 'quantity', message: 'Quantity must be a whole number' }],
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    });
    const client = createHttpClient({ baseUrl: BASE_URL, fetchImpl: double.fetchImpl });

    await expect(client.request('/cart/items', { method: 'POST', body: {} })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      statusCode: 400,
      requestId: 'req-1',
      issues: [{ path: 'quantity', message: 'Quantity must be a whole number' }],
    });
  });

  it('falls back to the status when the body is not the envelope', async () => {
    const double = createFetchDouble({
      status: 401,
      text: '<html>Unauthorized</html>',
      headers: { 'x-request-id': 'req-2' },
    });
    const client = createHttpClient({ baseUrl: BASE_URL, fetchImpl: double.fetchImpl });

    const error = await client.request('/cart').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('UNAUTHENTICATED');
    expect((error as ApiError).message).not.toContain('html');
    expect((error as ApiError).requestId).toBe('req-2');
  });

  it('reports a success payload that is not JSON as an invalid response', async () => {
    const double = createFetchDouble({ status: 200, text: 'not json' });
    const client = createHttpClient({ baseUrl: BASE_URL, fetchImpl: double.fetchImpl });

    await expect(client.request('/products')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      statusCode: 200,
    });
  });

  it('normalizes a transport failure into a retryable network error', async () => {
    const double = createFetchDouble({ rejectWith: new TypeError('Network request failed') });
    const client = createHttpClient({ baseUrl: BASE_URL, fetchImpl: double.fetchImpl });

    await expect(client.request('/products')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      statusCode: 0,
    });
  });

  it('aborts a request that outlives the timeout', async () => {
    const double = createFetchDouble({ holdUntilAborted: true });
    const client = createHttpClient({ baseUrl: BASE_URL, fetchImpl: double.fetchImpl, timeoutMs: 5 });

    await expect(client.request('/products')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});

describe('cancellation', () => {
  it('forwards a caller abort to the request', async () => {
    const double = createFetchDouble({ holdUntilAborted: true });
    const client = createHttpClient({
      baseUrl: BASE_URL,
      fetchImpl: double.fetchImpl,
      timeoutMs: 5_000,
    });

    const controller = new AbortController();
    const pending = client.request('/products', { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('aborts immediately when the signal is already aborted', async () => {
    const double = createFetchDouble({ holdUntilAborted: true });
    const client = createHttpClient({
      baseUrl: BASE_URL,
      fetchImpl: double.fetchImpl,
      timeoutMs: 5_000,
    });

    const controller = new AbortController();
    controller.abort();

    await expect(client.request('/products', { signal: controller.signal })).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });
});

describe('configuration errors are not network errors', () => {
  it('exposes the helper used for a bad base URL', () => {
    expect(configurationError('nope').code).toBe('CONFIGURATION_ERROR');
  });
});
