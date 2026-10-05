import { afterAll, describe, expect, it, vi } from 'vitest';
import type { AuthSessionResponse } from '@sakya/types';

import { useAuthStore } from '../stores/auth-store';

/**
 * Regression tests for the 401 refresh deadlock (audit finding: the refresh
 * request re-entered its own single-flight recovery hook).
 *
 * `refreshSessionOnce` shares ONE refresh round across parallel 401s. The round
 * must never be able to await itself: if the refresh request's own 401 fired
 * `onUnauthorized`, the http layer would await the pending round promise from
 * inside that same round — nothing would ever settle and every later refresh
 * would hang forever. `authApi.refresh` is sent with `auth: 'none'` (public
 * route), so its 401 surfaces as a plain error to the round instead.
 */

const BASE_URL = 'https://api.sakyafarms.test/api/v1';
const REFRESH_TOKEN = 'refresh-token-abc';

// Native modules do not load in Node — same stubbing approach as
// phone-auth.spec.ts. The auth store itself is the REAL store.
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined),
}));
vi.mock('@react-native-community/netinfo', () => ({
  default: { fetch: vi.fn(async () => ({ isConnected: true })) },
}));

interface RecordedInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
}

interface StubReply {
  status: number;
  body?: unknown;
}

const fetchCalls: Array<{ url: string; init: RecordedInit }> = [];
let respond: (url: string, init: RecordedInit) => StubReply = () => ({ status: 500 });

// The api client captures globalThis.fetch and reads EXPO_PUBLIC_API_URL at
// module load, so both must be stubbed BEFORE the client module is imported
// (done in each test via the dynamic import below).
vi.stubEnv('EXPO_PUBLIC_API_URL', BASE_URL);
vi.stubGlobal('fetch', (url: string, init: RecordedInit) => {
  fetchCalls.push({ url, init });
  const { status, body } = respond(url, init);
  const text = body === undefined ? '' : JSON.stringify(body);
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: () => Promise.resolve(text),
  });
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const UNAUTHENTICATED_401: StubReply = {
  status: 401,
  body: {
    success: false,
    statusCode: 401,
    code: 'UNAUTHENTICATED',
    message: 'Your session has expired. Please sign in again.',
  },
};

function fakeSession(overrides: Partial<AuthSessionResponse> = {}): AuthSessionResponse {
  return {
    user: {
      id: 'u1',
      email: null,
      phone: '+919876543210',
      firstName: 'Customer',
      lastName: null,
      avatarUrl: null,
    },
    accessToken: 'at',
    refreshToken: REFRESH_TOKEN,
    accessTokenExpiresIn: '15m',
    refreshTokenExpiresIn: '30d',
    isNewUser: true,
    ...overrides,
  };
}

async function loadClient() {
  const mod = await import('./client');
  return mod.requireApiClient();
}

function callsTo(suffix: string) {
  return fetchCalls.filter((call) => call.url.endsWith(suffix));
}

describe('401 refresh deadlock', () => {
  it('settles the failed request instead of awaiting its own refresh round', async () => {
    useAuthStore.getState().updateSession(fakeSession());
    fetchCalls.length = 0;
    respond = (url) => {
      if (url.endsWith('/auth/refresh')) return UNAUTHENTICATED_401;
      if (url.endsWith('/auth/logout')) return { status: 200, body: { success: true } };
      return UNAUTHENTICATED_401;
    };

    const client = await loadClient();

    // Before the fix this promise NEVER settled: the refresh request's 401
    // re-entered refreshSessionOnce, which returned the pending round — so the
    // round awaited itself. The test times out (red) on a regression.
    await expect(client.http.request('/cart')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      statusCode: 401,
    });

    const refreshCalls = callsTo('/auth/refresh');
    // Exactly one refresh round — a recursive recovery loop would add more.
    expect(refreshCalls).toHaveLength(1);
    // Public route: no bearer, so the http recovery gate can never fire for it.
    expect(refreshCalls[0]?.init.headers.authorization).toBeUndefined();
    // Rotation rides in the body.
    expect(JSON.parse(refreshCalls[0]?.init.body ?? '{}')).toEqual({ refreshToken: REFRESH_TOKEN });

    // The round completed its failure path (session cleared by logout)
    // rather than hanging with `refreshInFlight` stuck forever.
    await vi.waitFor(() => {
      expect(useAuthStore.getState().session).toBeNull();
    });
  });

  it('shares one refresh round across parallel 401s and retries with the new token', async () => {
    useAuthStore.getState().updateSession(fakeSession());
    fetchCalls.length = 0;
    respond = (url, init) => {
      if (url.endsWith('/auth/refresh')) {
        return { status: 200, body: fakeSession({ accessToken: 'at2', refreshToken: 'rt2' }) };
      }
      if (init.headers.authorization === 'Bearer at2') {
        return { status: 200, body: { ok: true } };
      }
      return UNAUTHENTICATED_401;
    };

    const client = await loadClient();

    const [cart, orders] = await Promise.all([
      client.http.request('/cart'),
      client.http.request('/orders'),
    ]);

    expect(cart).toEqual({ ok: true });
    expect(orders).toEqual({ ok: true });

    // Single-flight: both 401s shared ONE rotation (two would risk a
    // replay-family revocation server-side).
    expect(callsTo('/auth/refresh')).toHaveLength(1);
    expect(callsTo('/auth/refresh')[0]?.init.headers.authorization).toBeUndefined();
    // Both failed requests were retried after recovery, with the renewed token.
    expect(fetchCalls.filter((c) => c.init.headers.authorization === 'Bearer at2')).toHaveLength(2);
    // The original attempts carried the stale token.
    expect(
      callsTo('/cart').filter((c) => c.init.headers.authorization === 'Bearer at'),
    ).toHaveLength(1);
  });
});
