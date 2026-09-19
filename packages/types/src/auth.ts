/**
 * The authenticated identity the API reports.
 *
 * `email` is optional because customers authenticate with phone + OTP only:
 * many customers will never have an email on file. `phone` is the primary
 * identity and is present for any phone-authenticated session.
 */
export interface AuthUser {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string;
  lastName: string | null;
}

export interface AuthSessionResponse {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: string;
  refreshTokenExpiresIn: string;
  /** True when verify created the account — the client shows profile completion. */
  isNewUser: boolean;
}

/**
 * `POST /auth/otp/send`.
 *
 * Deliberately says nothing about whether the phone has an account before: an
 * attacker must not be able to enumerate customers. `devCode` is present only
 * when the API runs without an SMS provider configured — never in production.
 */
export interface OtpSendResponse {
  /** The normalised E.164 phone the code was sent to. */
  phone: string;
  /** Seconds before a new code can be requested. */
  resendAfterSeconds: number;
  /** Seconds the code stays valid. */
  expiresInSeconds: number;
  /** Development convenience only; stripped in production responses. */
  devCode?: string;
}
