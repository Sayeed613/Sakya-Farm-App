import * as Sentry from '@sentry/nestjs';

/**
 * Error tracking via Sentry, wired so the API behaves exactly as it did before
 * when no DSN is configured: every helper here is a no-op unless `initSentry`
 * ran with a real DSN, so an environment without credentials (or with tracking
 * deliberately switched off) produces zero Sentry traffic.
 *
 * Design note — process-level errors: Sentry ships `OnUncaughtException` /
 * `OnUnhandledRejection` integrations that register their own process
 * listeners. Those would race `installProcessLevelGuards` in `main.ts`: our
 * guard is registered first, prints `FATAL ...` and calls `process.exit(1)`
 * before Sentry's listener ever runs, so the event would be lost. Those two
 * integrations are therefore removed, and the fatal path reports through
 * `captureFatal` explicitly — exactly one event, flushed with a bounded wait,
 * then the same non-zero exit PM2 has always seen.
 *
 * Request-scoped errors do NOT come through here: `AllExceptionsFilter` turns
 * them into responses and reports the 5xx ones via `captureRequestError`.
 */

/**
 * Ship a fatal (process-killing) error to Sentry and wait — bounded — for the
 * flush. Never throws and never hangs: the observability layer must not be
 * able to delay or break the exit path that hands the process to PM2.
 */
export async function captureFatal(kind: string, cause: unknown): Promise<void> {
  if (!Sentry.isInitialized()) return;

  try {
    Sentry.withScope((scope) => {
      scope.setTag('fatal.kind', kind);
      Sentry.captureException(cause);
    });
    // `close()` flushes and shuts the SDK down; the race guarantees a hard
    // 2-second ceiling even if the transport is wedged.
    await Promise.race([
      Sentry.close(2000),
      new Promise<void>((resolve) => {
        setTimeout(resolve, 2000);
      }),
    ]);
  } catch {
    // Reporting failures are swallowed on purpose: this runs while the
    // process is on its way out.
  }
}

/**
 * Report a request-scoped 5xx (the ones `AllExceptionsFilter` already logged
 * and answered). Tagged with the correlation id that appears in the structured
 * logs, so an event and its log lines can be tied together. No-op when Sentry
 * is not initialised.
 */
export function captureRequestError(
  exception: unknown,
  meta: { method: string; url: string; requestId: string | null; statusCode: number },
): void {
  if (!Sentry.isInitialized()) return;

  Sentry.withScope((scope) => {
    scope.setTag('http.status_code', meta.statusCode);
    scope.setContext('request', {
      method: meta.method,
      url: meta.url,
      requestId: meta.requestId,
    });
    Sentry.captureException(exception);
  });
}

/**
 * Initialise the SDK. A null DSN leaves everything disabled — every other
 * helper in this module checks `Sentry.isInitialized()` and returns early.
 */
export function initSentry(options: { dsn: string | null; environment: string }): void {
  if (options.dsn === null) return;

  Sentry.init({
    dsn: options.dsn,
    environment: options.environment,
    integrations: (defaults) =>
      // Keep every default integration EXCEPT the process-level ones — see the
      // module comment. Fatals are captured by our own guard instead, so each
      // crash produces exactly one event that is flushed before exit.
      defaults.filter(
        (integration) =>
          integration.name !== 'OnUncaughtException' && integration.name !== 'OnUnhandledRejection',
      ),
  });
}
