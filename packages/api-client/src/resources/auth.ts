import { authUnavailableError } from '../errors';

/**
 * The sign-in seam.
 *
 * ## Status of the API
 *
 * The API has **no authentication endpoints today**. There is no auth controller
 * in `apps/api/src/modules/auth`, `auth.module.ts` documents sign-up / sign-in /
 * refresh / sign-out as "the next increment", and `docs/api-conventions.md` lists
 * `/api/v1/auth` as *"not implemented yet"*. Nothing in the repository defines
 * the request or response shape of those routes.
 *
 * The app therefore must not pretend to authenticate, and equally must not invent
 * paths a future endpoint might not use. So this is written as a **port**: the
 * surface the app needs, with exactly one implementation available today —
 * {@link createUnavailableAuthPort}, which fails loudly. When the endpoints ship,
 * add a second implementation that talks to them; no screen changes.
 *
 * ## Provisional shapes
 *
 * `AuthSession` and `SessionUser` describe what the app stores *locally*. They are
 * not a wire contract: whoever implements the real port must map the API's actual
 * response onto them, and should move the canonical shapes into `@sakya/types`
 * where the API can share them.
 */

export interface SignInInput {
  readonly email: string;
  readonly password: string;
}

export interface RegisterInput {
  readonly email: string;
  readonly password: string;
  readonly firstName: string;
  readonly lastName: string;
  /** E.164, e.g. `+919876543210`. */
  readonly phone?: string;
}

/** The customer identity the app keeps for display and ownership decisions. */
export interface SessionUser {
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly phone: string | null;
}

/**
 * A signed-in session.
 *
 * Both tokens are opaque: the app stores them and sends the access token back,
 * and never inspects their contents. Access tokens are short-lived and refreshing
 * is the port's job.
 */
export interface AuthSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** ISO 8601 instant the access token expires, when the API reports one. */
  readonly expiresAt: string | null;
  readonly user: SessionUser;
}

export interface AuthPort {
  /** False when no implementation can talk to a real endpoint yet. */
  readonly isAvailable: boolean;

  /** Why sign-in is unavailable, for display. Null when it is available. */
  readonly unavailableReason: string | null;

  signIn(input: SignInInput): Promise<AuthSession>;
  register(input: RegisterInput): Promise<AuthSession>;
  /** Exchange a refresh token for a new session. */
  refresh(refreshToken: string): Promise<AuthSession>;
  /** Revoke the current session server-side. */
  signOut(): Promise<void>;
}

export const AUTH_UNAVAILABLE_REASON =
  'Sign-in is not available yet: the API does not expose its authentication endpoints ' +
  '(/api/v1/auth is documented as "not implemented yet"). Catalogue browsing works ' +
  'without an account.';

/**
 * The only auth implementation in this build.
 *
 * Every method rejects with `AUTH_UNAVAILABLE` rather than returning a fabricated
 * session. A fake success here would be the worst outcome available: the app would
 * believe it was authenticated, present cart and checkout, and fail at the first
 * real request.
 */
export function createUnavailableAuthPort(
  reason: string = AUTH_UNAVAILABLE_REASON,
): AuthPort {
  return {
    isAvailable: false,
    unavailableReason: reason,

    signIn(): Promise<AuthSession> {
      return Promise.reject(authUnavailableError(reason));
    },

    register(): Promise<AuthSession> {
      return Promise.reject(authUnavailableError(reason));
    },

    refresh(): Promise<AuthSession> {
      return Promise.reject(authUnavailableError(reason));
    },

    signOut(): Promise<void> {
      // Signing out of nothing is a no-op, not an error: a screen that clears
      // local state must not be blocked by it.
      return Promise.resolve();
    },
  };
}
