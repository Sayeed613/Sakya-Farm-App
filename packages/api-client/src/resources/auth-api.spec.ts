import { describe, expect, it } from 'vitest';

import { createFetchDouble, type ResponseSpec } from '../__testing__/fetch-double';
import { createHttpClient } from '../http';
import { createAuthApiResource, type AuthApiResource } from './auth-api';

const BASE_URL = 'https://api.sakyafarms.test/api/v1';
const REFRESH_TOKEN = 'refresh-token-123';

const UNAUTHENTICATED_401 = { status: 401, text: '' };

/**
 * The customer-app wiring in miniature: one client where the 401 hook performs
 * the refresh through the same resource, then the caller retries once with the
 * renewed token. This is the exact shape that used to deadlock — a 401 on the
 * refresh request itself re-entered the hook while the refresh was pending.
 */
function build(...queue: ResponseSpec[]) {
  const double = createFetchDouble(...queue);
  let hookCalls = 0;
  let token = 'stale-access-token';

  const wired: { auth?: AuthApiResource } = {};
  const http = createHttpClient({
    baseUrl: BASE_URL,
    fetchImpl: double.fetchImpl,
    getAccessToken: () => token,
    onUnauthorized: async () => {
      hookCalls += 1;
      try {
        await wired.auth!.refresh({ refreshToken: REFRESH_TOKEN });
        token = 'fresh-access-token';
        return true;
      } catch {
        return false;
      }
    },
  });
  wired.auth = createAuthApiResource(http);

  return {
    double,
    http,
    authApi: wired.auth,
    hookCallCount: () => hookCalls,
  };
}

describe('authApi.refresh', () => {
  it('surfaces a rejected refresh without ever re-entering 401 recovery', async () => {
    // Second queued 401 only matters for a regressed client: it bounds the
    // pre-fix recursion (hook -> refresh -> hook) so the test fails on
    // assertions instead of looping forever.
    const { authApi, double, hookCallCount } = build(UNAUTHENTICATED_401, UNAUTHENTICATED_401);

    await expect(authApi.refresh({ refreshToken: REFRESH_TOKEN })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      statusCode: 401,
    });

    // The deadlock trigger: the refresh request's own 401 must NOT fire
    // onUnauthorized — that is what used to hand the round its own pending
    // promise and hang forever.
    expect(hookCallCount()).toBe(0);
    expect(double.calls).toHaveLength(1);
    expect(double.lastCall().url).toBe(`${BASE_URL}/auth/refresh`);
    expect(double.lastCall().init.method).toBe('POST');
    // Public route: the bearer is omitted, so http's recovery gate can never
    // pass for this request (it requires a sent bearer).
    expect(double.lastCall().init.headers.authorization).toBeUndefined();
    // Rotation still rides in the body, unchanged.
    expect(double.lastBody()).toEqual({ refreshToken: REFRESH_TOKEN });
  });

  it('returns the rotated session on success', async () => {
    const { authApi, double } = build({
      body: { accessToken: 'rotated-at', refreshToken: 'rotated-rt' },
    });

    await expect(authApi.refresh({ refreshToken: REFRESH_TOKEN })).resolves.toEqual({
      accessToken: 'rotated-at',
      refreshToken: 'rotated-rt',
    });

    expect(double.calls).toHaveLength(1);
    expect(double.lastCall().init.headers.authorization).toBeUndefined();
    expect(double.lastBody()).toEqual({ refreshToken: REFRESH_TOKEN });
  });

  it('keeps the normal recovery loop working: 401 -> refresh -> one retry', async () => {
    const { http, double, hookCallCount } = build(
      UNAUTHENTICATED_401,
      { body: { accessToken: 'fresh-at', refreshToken: 'fresh-rt' } },
      { body: { ok: true } },
    );

    await expect(http.request('/cart')).resolves.toEqual({ ok: true });

    expect(hookCallCount()).toBe(1);
    expect(double.calls).toHaveLength(3);
    // Original attempt carries the stale bearer...
    expect(double.calls[0]?.init.headers.authorization).toBe('Bearer stale-access-token');
    // ...the refresh exchange does not...
    expect(double.calls[1]?.url).toBe(`${BASE_URL}/auth/refresh`);
    expect(double.calls[1]?.init.headers.authorization).toBeUndefined();
    // ...and the single retry carries the renewed one.
    expect(double.calls[2]?.init.headers.authorization).toBe('Bearer fresh-access-token');
  });
});
