/**
 * Log-redaction and serializer policy for the pino HTTP logger.
 *
 * Extracted from the `LoggerModule` factory in `app.module.ts` so the policy
 * is unit-testable (`test/pino-config.spec.ts`) instead of being an inline
 * literal nobody can assert against. The factory imports these directly —
 * there is exactly one definition of what may reach a log sink.
 *
 * Two independent layers:
 *
 *  1. The serializers below shape what `pino-http` puts on automatic request /
 *     completion lines: identity and routing only — no headers, no body.
 *  2. The redact paths scrub sensitive keys from any object that DOES reach
 *     pino (child-logger bindings, custom payloads, nested error context).
 *     Belt-and-braces: today the serializers keep bodies out entirely, but a
 *     future `logger.warn({ body })` must still never leak a password or a
 *     webhook signature.
 */

/**
 * Paths pino censors with `[redacted]` before serialising.
 *
 * Keep this list aligned with what the API actually accepts: credentials and
 * session material (passwords, refresh tokens, OTP codes), transport secrets
 * (cookies, provider webhook signatures), and nothing that would gut useful
 * log context if blanked.
 */
export const REDACT_PATHS: string[] = [
  // Transport-level credentials.
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  // Provider webhook signatures — the shared secret's derived value; logging
  // one would let an attacker replay a captured body against the endpoint.
  'req.headers["x-mock-signature"]',
  'req.headers["x-razorpay-signature"]',
  // Credentials and session material in JSON bodies (never serialised today,
  // redacted defensively for any future payload log).
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.body.refreshToken',
  'req.body.otp',
  'req.body.code',
];

/** Minimal shapes the two serializers read; extra fields are dropped by design. */
interface RequestLike {
  id?: string;
  method?: string;
  url?: string;
}

interface ResponseLike {
  statusCode?: number;
}

/**
 * Automatic request lines carry identity and routing ONLY. Headers and bodies
 * are excluded structurally here rather than filtered key-by-key — the safest
 * redaction is the one that never serialises the secret in the first place.
 */
export function requestSerializer(request: RequestLike): {
  id: string | undefined;
  method: string | undefined;
  url: string | undefined;
} {
  return { id: request.id, method: request.method, url: request.url };
}

/** Completion lines carry the status code only. */
export function responseSerializer(response: ResponseLike): { statusCode: number | undefined } {
  return { statusCode: response.statusCode };
}
