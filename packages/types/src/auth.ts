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
  /** The customer's own profile photo, when they added one. */
  avatarUrl: string | null;
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
 * The single message surfaced for SMS delivery failures.
 *
 * Provider detail (rejection reason, transport error) stays in the server log;
 * callers only ever see this retryable 503 body, so no internals leak.
 */
export const SMS_UNAVAILABLE_MESSAGE = 'SMS delivery is temporarily unavailable. Please try again shortly.';

/** What the delivery hook reports for one issued code. */
export interface OtpDeliveryResult {
  /** The normalised E.164 phone the code was issued for. */
  phone: string;
  /** Whether delivery was accepted by the provider (or the dev channel). */
  accepted: boolean;
  /**
   * The code recorded on the development channel. Never present when a real
   * provider accepted the send — production echo-by-devCode is impossible.
   */
  devCode?: string;
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
  /** Whether the delivery hook accepted the issue call. */
  accepted: boolean;
  /** Seconds before a new code can be requested. */
  resendAfterSeconds: number;
  /** Seconds the code stays valid. */
  expiresInSeconds: number;
  /**
   * Development convenience only. Present in non-production responses when
   * the code was delivered through the dev channel (demo mode or no SMS
   * provider) and the request targeted the configured temporary test number;
   * absent in production — the send path there is the real MSG91 channel,
   * which never records a dev code.
   */
  devCode?: string;
}
