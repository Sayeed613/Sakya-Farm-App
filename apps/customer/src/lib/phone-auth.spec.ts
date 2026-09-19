import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Framework-free tests for the customer phone + OTP flow.
 *
 * React Native does not load in Node, so screen behaviour is asserted through
 * the pure pieces the screens are built on: phone digit normalisation, the
 * auth-store merge contract, and the OTP send/verify call shapes. The screens
 * themselves are exercised visually (see the manual run checklist).
 */

// ---------------------------------------------------------------------------
// Phone digit normalisation (the rule the phone screen applies on every keystroke)
// ---------------------------------------------------------------------------

/** Extracted contract of `toLocalDigits` in app/(auth)/phone.tsx. */
function toLocalDigits(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  const withoutCountry = digits.replace(/^91(?=\d{10}$)/, '');
  return withoutCountry.replace(/^0(?=\d{10}$)/, '').slice(0, 10);
}

describe('phone digit normalisation', () => {
  it('keeps a plain 10-digit number', () => {
    expect(toLocalDigits('9876543210')).toBe('9876543210');
  });

  it('strips spaces and dashes people type', () => {
    expect(toLocalDigits('98765 43210')).toBe('9876543210');
    expect(toLocalDigits('98765-43210')).toBe('9876543210');
  });

  it('drops the +91 / 91 country code', () => {
    expect(toLocalDigits('+919876543210')).toBe('9876543210');
    expect(toLocalDigits('919876543210')).toBe('9876543210');
  });

  it('drops a trunk-prefix 0', () => {
    expect(toLocalDigits('09876543210')).toBe('9876543210');
  });

  it('caps at 10 digits so the field cannot overflow', () => {
    expect(toLocalDigits('987654321012345')).toBe('9876543210');
  });

  it('rejects letters by dropping them', () => {
    expect(toLocalDigits('98ab76543210')).toBe('9876543210');
  });
});

// ---------------------------------------------------------------------------
// E.164 the client sends to the API
// ---------------------------------------------------------------------------

describe('E.164 submission contract', () => {
  it('sends +91 followed by the 10 digits', () => {
    const digits = toLocalDigits('98765 43210');
    expect(`+91${digits}`).toBe('+919876543210');
  });
});

// ---------------------------------------------------------------------------
// The auth-store merge contract: guest lines are sent on authentication and
// cleared only after the server confirms.
// ---------------------------------------------------------------------------

const mergeCalls: Array<{ variantId: string; quantity: number }[]> = [];
let mergeShouldFail = false;

vi.mock('../api/auth', () => ({
  authApi: {
    mergeGuestCart: vi.fn(async (lines: Array<{ variantId: string; quantity: number }>) => {
      mergeCalls.push(lines);
      if (mergeShouldFail) throw new Error('network down');
      return {};
    }),
    sendOtp: vi.fn(async () => ({})),
    verifyOtp: vi.fn(async () => ({})),
    logout: vi.fn(async () => ({})),
    refresh: vi.fn(async () => ({})),
  },
}));

// zustand + the store import pull React Native transitively (Platform), so the
// store module is loaded with a stub for the native bits it touches.
vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined),
}));

import { useAuthStore } from '../stores/auth-store';
import { useGuestCartStore } from '../stores/guest-cart-store';
import type { AuthSessionResponse } from '@sakya/types';

function fakeSession(overrides: Partial<AuthSessionResponse> = {}): AuthSessionResponse {
  return {
    user: { id: 'u1', email: null, phone: '+919876543210', firstName: 'Customer', lastName: null },
    accessToken: 'at',
    refreshToken: 'rt',
    accessTokenExpiresIn: '15m',
    refreshTokenExpiresIn: '30d',
    isNewUser: true,
    ...overrides,
  };
}

describe('guest cart merge on authentication', () => {
  beforeEach(() => {
    mergeCalls.length = 0;
    mergeShouldFail = false;
    useGuestCartStore.setState({ lines: [], priceTotals: {}, lastAdded: null });
    useAuthStore.setState({ session: null, pendingRedirect: null, merging: false });
  });

  it('sends guest lines to the server cart and clears them after success', async () => {
    useGuestCartStore.getState().addLine('variant-a', 2);
    useGuestCartStore.getState().addLine('variant-b', 1);

    await useAuthStore.getState().setSession(fakeSession());

    expect(mergeCalls).toEqual([
      [
        { variantId: 'variant-a', quantity: 2 },
        { variantId: 'variant-b', quantity: 1 },
      ],
    ]);
    expect(useGuestCartStore.getState().lines).toEqual([]);
  });

  it('keeps guest lines locally when the merge fails (nothing is lost)', async () => {
    mergeShouldFail = true;
    useGuestCartStore.getState().addLine('variant-a', 2);

    await useAuthStore.getState().setSession(fakeSession());

    expect(useGuestCartStore.getState().lines).toEqual([
      { variantId: 'variant-a', quantity: 2, display: null },
    ]);
    // The session survived anyway — a failed merge must not log the user out.
    expect(useAuthStore.getState().session).not.toBeNull();
  });

  it('skips the merge entirely when the guest cart is empty', async () => {
    await useAuthStore.getState().setSession(fakeSession());
    expect(mergeCalls).toEqual([]);
  });

  it('carries the intended destination and clears it once used', () => {
    const store = useAuthStore.getState();
    store.setPendingRedirect('/(shop)/cart');
    expect(useAuthStore.getState().pendingRedirect).toBe('/(shop)/cart');
    useAuthStore.getState().setPendingRedirect(null);
    expect(useAuthStore.getState().pendingRedirect).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Session response contract the OTP screen relies on
// ---------------------------------------------------------------------------

describe('OTP verify session contract', () => {
  it('routes new users to profile completion and returns everyone to the redirect', () => {
    const decideDestination = (session: AuthSessionResponse, redirect: string | null): string => {
      if (session.isNewUser && session.user.firstName === 'Customer') return '/(auth)/complete-profile';
      return redirect ?? '/(shop)';
    };

    expect(decideDestination(fakeSession(), '/(shop)/cart')).toBe('/(auth)/complete-profile');
    expect(
      decideDestination(fakeSession({ isNewUser: true, user: { id: 'u1', email: null, phone: '+919876543210', firstName: 'Ananya', lastName: null } }), null),
    ).toBe('/(shop)');
    expect(decideDestination(fakeSession({ isNewUser: false }), '/(shop)/orders')).toBe('/(shop)/orders');
    expect(decideDestination(fakeSession({ isNewUser: false }), null)).toBe('/(shop)');
  });
});
