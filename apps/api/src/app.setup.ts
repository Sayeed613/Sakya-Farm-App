import { VersioningType, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { json } from 'express';
import helmet from 'helmet';

import { requestIdMiddleware } from './common/middleware/request-id.middleware';

/** Attribute carrying the exact request bytes for webhook signature checks. */
export const RAW_BODY_ATTRIBUTE = 'rawBody';

/**
 * Everything the HTTP layer needs, applied in one place.
 *
 * This lives outside `main.ts` so integration tests configure the app exactly as
 * production does. A test that re-implements the prefix and versioning would pass
 * while a routing change broke real clients.
 *
 * `listen()` and `enableShutdownHooks()` are deliberately left to the caller:
 * the first is environment-specific and the second registers process listeners
 * that do not belong in a test process.
 */
export function configureApp(app: INestApplication): void {
  const configService = app.get(ConfigService);

  const prefix = configService.getOrThrow<string>('app.apiPrefix');
  const version = configService.getOrThrow<string>('app.apiVersion');
  const corsOrigins = configService.getOrThrow<string[]>('app.corsOrigins');
  const trustProxy = configService.getOrThrow<boolean>('app.trustProxy');

  /**
   * Only trust X-Forwarded-For when we are actually behind a proxy we control.
   * Trusting it unconditionally would let any client spoof its IP, defeating
   * rate limiting and poisoning the audit trail.
   */
  if (trustProxy) {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }

  // Secure HTTP headers. The API returns JSON only, so a content security policy
  // buys nothing here; the remaining headers still apply.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  // Correlation ids must cover unmatched paths (404s) too, so this is attached to
  // the Express instance rather than to a route.
  app.use(requestIdMiddleware);

  /**
   * Preserve the exact request bytes for webhook signature verification.
   *
   * Gateway signatures (and the MOCK HMAC adapter) are computed over the raw
   * body, not over a parsed-then-reserialized object: key order and whitespace
   * differ after a JSON round trip. The `verify` hook stashes the buffer on the
   * request before parsing, so the webhook controller can verify against the
   * bytes the provider actually signed while every other route keeps the
   * parsed `req.body` it already uses.
   */
  app.use(
    json({
      verify: (request, _response, buffer) => {
        (request as unknown as Record<string, unknown>)[RAW_BODY_ATTRIBUTE] = Buffer.from(buffer);
      },
    }),
  );

  /**
   * CORS uses an explicit allow-list from configuration. A wildcard is not used,
   * and `credentials: true` is safe precisely because the origin list is fixed.
   */
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id'],
    exposedHeaders: ['x-request-id'],
    maxAge: 86_400,
  });

  /**
   * Routes are served under `/{prefix}/v{version}/...`, e.g. `/api/v1/health`.
   * Versioning is in the path so that a future `/api/v2` can coexist without
   * breaking clients that are still on v1.
   */
  app.setGlobalPrefix(prefix);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: version });
}
