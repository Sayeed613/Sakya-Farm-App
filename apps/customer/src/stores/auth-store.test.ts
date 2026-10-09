import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Tests for the local-first logout behavior in auth-store.ts.
 *
 * These tests verify that:
 * - Local session clears immediately (before network calls)
 * - Server logout and push unregister are non-blocking
 * - API logout failure still leaves the user logged out
 * - Push unregister failure still leaves the user logged out
 * - In-flight refresh cannot restore the old session after logout
 * - Repeated logout is safe/idempotent
 */

// Stub React Native native modules for Node environment
vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
}));

// Stub expo-secure-store for Node environment
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined),
}));

// Mock the auth API
const mockAuthApi = {
  logout: vi.fn(async () => ({ success: true })),
  mergeGuestCart: vi.fn(async () => ({})),
  sendOtp: vi.fn(async () => ({})),
  verifyOtp: vi.fn(async () => ({})),
  refresh: vi.fn(async () => ({})),
};

vi.mock('../api/auth', () => ({
  authApi: mockAuthApi,
}));

// Mock push notifications
const mockUnregisterPushToken = vi.fn(async () => {});
vi.mock('../push/push-notifications', () => ({
  unregisterPushToken: mockUnregisterPushToken,
}));

import { useAuthStore } from './auth-store';
import type { AuthSessionResponse } from '@sakya/types';

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
    accessToken: 'access-token-abc',
    refreshToken: 'refresh-token-xyz',
    accessTokenExpiresIn: '15m',
    refreshTokenExpiresIn: '30d',
    isNewUser: true,
    ...overrides,
  };
}

describe('auth-store logout', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    useAuthStore.setState({
      session: null,
      restoring: false,
      pendingRedirect: null,
      merging: false,
      logoutGeneration: 0,
    });
    // Reset SecureStore mock
    const { getItemAsync, setItemAsync, deleteItemAsync } = await import('expo-secure-store');
    (getItemAsync as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (setItemAsync as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (deleteItemAsync as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it('clears local session immediately without waiting for network logout', async () => {
    useAuthStore.setState({ session: fakeSession() });

    const logoutPromise = useAuthStore.getState().logout();

    // Local state should be cleared immediately, before the promise resolves
    expect(useAuthStore.getState().session).toBeNull();
    expect(useAuthStore.getState().pendingRedirect).toBeNull();
    expect(useAuthStore.getState().logoutGeneration).toBe(1);

    // Wait for background cleanup to complete
    await logoutPromise;

    // Storage should be cleared
    const { deleteItemAsync } = await import('expo-secure-store');
    expect(deleteItemAsync).toHaveBeenCalledTimes(1);
  });

  it('does not wait for API logout before clearing local state', async () => {
    useAuthStore.setState({ session: fakeSession() });

    // Make logout slow to simulate network delay
    mockAuthApi.logout.mockImplementation(
      async () =>
        new Promise((resolve) => {
          setTimeout(resolve, 100);
        }),
    );

    const startTime = Date.now();
    const logoutPromise = useAuthStore.getState().logout();

    // Local state should be cleared immediately (within a few ms)
    await new Promise((r) => setTimeout(r, 10));
    expect(useAuthStore.getState().session).toBeNull();
    const localClearTime = Date.now() - startTime;

    // Wait for the full logout to complete
    await logoutPromise;
    const totalTime = Date.now() - startTime;

    // The local clear should happen almost immediately, not wait for the slow API call
    expect(localClearTime).toBeLessThan(50);
    expect(totalTime).toBeGreaterThanOrEqual(100);
  });

  it('leaves the user logged out even if API logout fails', async () => {
    useAuthStore.setState({ session: fakeSession() });

    mockAuthApi.logout.mockImplementation(async () => {
      throw new Error('Network unavailable');
    });

    await useAuthStore.getState().logout();

    // User should still be logged out despite API failure
    expect(useAuthStore.getState().session).toBeNull();
    expect(useAuthStore.getState().logoutGeneration).toBe(1);

    // API logout should have been attempted
    expect(mockAuthApi.logout).toHaveBeenCalledWith({ refreshToken: 'refresh-token-xyz' });
  });

  it('leaves the user logged out even if push unregister fails', async () => {
    useAuthStore.setState({ session: fakeSession() });

    mockUnregisterPushToken.mockImplementation(async () => {
      throw new Error('Push service unavailable');
    });

    await useAuthStore.getState().logout();

    // User should still be logged out despite push failure
    expect(useAuthStore.getState().session).toBeNull();
    expect(useAuthStore.getState().logoutGeneration).toBe(1);
  });

  it('attempts to revoke refresh token on logout', async () => {
    useAuthStore.setState({ session: fakeSession() });

    await useAuthStore.getState().logout();

    expect(mockAuthApi.logout).toHaveBeenCalledWith({ refreshToken: 'refresh-token-xyz' });
  });

  it('does nothing when there is no session to logout from', async () => {
    useAuthStore.setState({ session: null });

    await useAuthStore.getState().logout();

    expect(useAuthStore.getState().session).toBeNull();
    expect(mockAuthApi.logout).not.toHaveBeenCalled();
    const { deleteItemAsync } = await import('expo-secure-store');
    expect(deleteItemAsync).not.toHaveBeenCalled();
  });

  it('increments logout generation on each logout', async () => {
    useAuthStore.setState({ session: fakeSession(), logoutGeneration: 0 });

    await useAuthStore.getState().logout();
    expect(useAuthStore.getState().logoutGeneration).toBe(1);

    // Setting a new session and logging out again
    useAuthStore.getState().setSession(fakeSession());
    await useAuthStore.getState().logout();
    expect(useAuthStore.getState().logoutGeneration).toBe(2);
  });

  it('prevents in-flight refresh from restoring session after logout', async () => {
    useAuthStore.setState({ session: fakeSession() });

    // Start logout and ensure generation is incremented
    await useAuthStore.getState().logout();

    // Apply a renewed session (simulating what refreshSessionOnce does)
    const renewedSession = fakeSession({ accessToken: 'new-at', refreshToken: 'new-rt' });
    useAuthStore.getState().updateSession(renewedSession);

    // The session should NOT be restored because logout generation > 0
    expect(useAuthStore.getState().session).toBeNull();
  });

  it('updateSession drops renewed session when logoutGeneration > 0', async () => {
    useAuthStore.setState({ session: fakeSession(), logoutGeneration: 0 });

    // Logout increments generation
    await useAuthStore.getState().logout();
    expect(useAuthStore.getState().logoutGeneration).toBe(1);
    expect(useAuthStore.getState().session).toBeNull();

    // Attempt to apply a renewed session (simulating in-flight refresh completion)
    const renewedSession = fakeSession({ accessToken: 'new-at', refreshToken: 'new-rt' });
    useAuthStore.getState().updateSession(renewedSession);

    // Session should remain null — refresh cannot resurrect logged-out state
    expect(useAuthStore.getState().session).toBeNull();
  });

  it('updateSession applies renewed session when not logged out', async () => {
    useAuthStore.setState({ session: fakeSession(), logoutGeneration: 0 });

    const renewedSession = fakeSession({ accessToken: 'new-at', refreshToken: 'new-rt' });
    useAuthStore.getState().updateSession(renewedSession);

    // Session should be updated
    expect(useAuthStore.getState().session?.accessToken).toBe('new-at');
    expect(useAuthStore.getState().session?.refreshToken).toBe('new-rt');
    expect(useAuthStore.getState().logoutGeneration).toBe(0);
  });

  it('is idempotent — repeated logout calls are safe', async () => {
    useAuthStore.setState({ session: fakeSession() });

    // First logout
    await useAuthStore.getState().logout();
    expect(useAuthStore.getState().session).toBeNull();
    expect(useAuthStore.getState().logoutGeneration).toBe(1);

    // Second logout (should be safe, no errors)
    await useAuthStore.getState().logout();
    expect(useAuthStore.getState().session).toBeNull();
    expect(useAuthStore.getState().logoutGeneration).toBe(2);

    // API logout should have been called twice (once per logout)
    expect(mockAuthApi.logout).toHaveBeenCalledTimes(2);
  });

  it('clears pending redirect on logout', async () => {
    useAuthStore.setState({
      session: fakeSession(),
      pendingRedirect: '/(shop)/checkout',
    });

    await useAuthStore.getState().logout();

    expect(useAuthStore.getState().pendingRedirect).toBeNull();
  });

  it('does not log token values', async () => {
    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = vi.fn((...args) => warnings.push(args.join(' ')));

    useAuthStore.setState({ session: fakeSession() });

    mockAuthApi.logout.mockImplementation(async () => {
      throw new Error('fail');
    });

    await useAuthStore.getState().logout();

    console.warn = originalWarn;

    // Verify no token values leaked into logs
    const logOutput = warnings.join(' ');
    expect(logOutput).not.toContain('refresh-token-xyz');
    expect(logOutput).not.toContain('access-token-abc');
  });

  it('updateSession applies renewed session when not logged out', async () => {
    useAuthStore.setState({ session: fakeSession(), logoutGeneration: 0 });

    const renewedSession = fakeSession({ accessToken: 'new-at', refreshToken: 'new-rt' });
    useAuthStore.getState().updateSession(renewedSession);

    // Session should be updated
    expect(useAuthStore.getState().session?.accessToken).toBe('new-at');
    expect(useAuthStore.getState().session?.refreshToken).toBe('new-rt');
    expect(useAuthStore.getState().logoutGeneration).toBe(0);
  });

  it('updateSession drops renewed session when generation mismatch', async () => {
    useAuthStore.setState({ session: fakeSession(), logoutGeneration: 1 });

    // updateSession with expectedGeneration=0 should drop the session because
    // current generation (1) doesn't match
    const renewedSession = fakeSession({ accessToken: 'new-at', refreshToken: 'new-rt' });
    useAuthStore.getState().updateSession(renewedSession, 0);

    // Session should remain unchanged
    expect(useAuthStore.getState().session?.accessToken).toBe('access-token-abc');
    expect(useAuthStore.getState().logoutGeneration).toBe(1);
  });

  it('updateSession applies session when generation matches', async () => {
    useAuthStore.setState({ session: fakeSession(), logoutGeneration: 1 });

    const renewedSession = fakeSession({ accessToken: 'new-at', refreshToken: 'new-rt' });
    useAuthStore.getState().updateSession(renewedSession, 1);

    // Session should be updated because generation matches
    expect(useAuthStore.getState().session?.accessToken).toBe('new-at');
    expect(useAuthStore.getState().logoutGeneration).toBe(1);
  });

  it('setSession resets logoutGeneration to 0 for fresh login', async () => {
    useAuthStore.setState({ session: fakeSession(), logoutGeneration: 5 });

    const newSession = fakeSession({ accessToken: 'fresh-at', refreshToken: 'fresh-rt' });
    await useAuthStore.getState().setSession(newSession);

    // After fresh login, logoutGeneration should be reset to 0
    expect(useAuthStore.getState().session?.accessToken).toBe('fresh-at');
    expect(useAuthStore.getState().logoutGeneration).toBe(0);
  });

  it('login -> logout -> login -> refresh works normally', async () => {
    // First login
    await useAuthStore.getState().setSession(fakeSession({ accessToken: 'at1', refreshToken: 'rt1' }));
    expect(useAuthStore.getState().logoutGeneration).toBe(0);

    // Logout increments generation
    await useAuthStore.getState().logout();
    expect(useAuthStore.getState().session).toBeNull();
    expect(useAuthStore.getState().logoutGeneration).toBe(1);

    // Second login resets generation
    await useAuthStore.getState().setSession(fakeSession({ accessToken: 'at2', refreshToken: 'rt2' }));
    expect(useAuthStore.getState().session?.accessToken).toBe('at2');
    expect(useAuthStore.getState().logoutGeneration).toBe(0);

    // Now a refresh should work normally (generation is 0)
    const renewedSession = fakeSession({ accessToken: 'at3', refreshToken: 'rt3' });
    useAuthStore.getState().updateSession(renewedSession, 0);
    expect(useAuthStore.getState().session?.accessToken).toBe('at3');
  });
});



