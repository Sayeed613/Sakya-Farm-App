import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

/**
 * Correlation id attached to every request.
 *
 * A caller-supplied `x-request-id` is honoured so a gateway or mobile client can
 * propagate its own trace id, but only when it looks like a safe token: an
 * attacker-supplied header goes straight into log output, so arbitrary length or
 * control characters must not be accepted.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export function resolveRequestId(candidate: unknown): string {
  return typeof candidate === 'string' && SAFE_REQUEST_ID.test(candidate)
    ? candidate
    : randomUUID();
}

/**
 * Ensures every response carries the correlation id, including errors and 404s.
 *
 * Registered directly on the Express instance (`app.use`) rather than through
 * Nest's router, so it also runs for unmatched paths.
 */
export function requestIdMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  // pino-http runs earlier and may already have assigned `req.id`.
  const fromLogger = (request as Request & { id?: unknown }).id;
  const requestId = resolveRequestId(
    typeof fromLogger === 'string' && fromLogger.length > 0
      ? fromLogger
      : request.headers['x-request-id'],
  );

  request.requestId = requestId;
  response.setHeader('x-request-id', requestId);

  next();
}
