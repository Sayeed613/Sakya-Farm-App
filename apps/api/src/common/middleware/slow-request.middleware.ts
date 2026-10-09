import { Logger } from '@nestjs/common';

import type { NextFunction, Request, Response } from 'express';

/**
 * One slow-request warning's structured payload. Deliberately small: route,
 * correlation id, timing and the identifiers an operator needs to find the
 * request — never a body, header or query string.
 */
export interface SlowRequestLog {
  requestId: string | null;
  /** Matched route template (e.g. `/api/v1/orders/:id`), or the bare path on a 404. */
  route: string | null;
  method: string;
  statusCode: number;
  durationMs: number;
  /** Time this request spent in Prisma, when a metrics bucket exists. */
  db?: { ms: number; queries: number };
  /** Caller's id, when the request carried a valid token. */
  userId?: string;
}

export interface SlowRequestMiddlewareOptions {
  /**
   * Warn when a request takes at least this many milliseconds. 0 disables the
   * check entirely and the middleware becomes a pass-through.
   */
  thresholdMs: number;
  /** Clock, injectable so tests are deterministic instead of sleep-based. */
  now?: () => number;
  /** Sink for the warn line; defaults to the request's pino child logger. */
  warn?: (payload: SlowRequestLog) => void;
}

/** Used only when a request somehow has no pino child logger attached. */
const fallbackLogger = new Logger('SlowRequest');

/** Route template if Express matched one, else the path (no query string). */
function routeOf(request: Request): string | null {
  const route = (request as Request & { route?: { path?: string | string[] } }).route;
  const path = route?.path;
  if (path === undefined) return null;
  return Array.isArray(path) ? (path[0] ?? null) : path;
}

function buildPayload(request: Request, response: Response, durationMs: number): SlowRequestLog {
  const metrics = request.metrics;
  const user = (request as Request & { user?: { id?: string } }).user;
  return {
    requestId: request.requestId ?? null,
    route: routeOf(request) ?? request.path ?? null,
    method: request.method,
    statusCode: response.statusCode,
    durationMs: Math.round(durationMs),
    ...(metrics === undefined
      ? {}
      : { db: { ms: Math.round(metrics.dbMs), queries: metrics.dbQueries } }),
    ...(user?.id === undefined ? {} : { userId: user.id }),
  };
}

function emit(request: Request, payload: SlowRequestLog): void {
  const log = (request as Request & { log?: { warn: (obj: object, msg: string) => void } }).log;
  if (log !== undefined && typeof log.warn === 'function') {
    log.warn(payload, 'slow request');
    return;
  }
  // No pino child logger (a test driving the middleware directly, or an
  // unexpected ordering): still surface the warning rather than lose it.
  fallbackLogger.warn(payload, 'slow request');
}

/**
 * Logs a structured `slow request` warning for any response that took at
 * least `thresholdMs`, measured from this middleware's entry (correlation id
 * and metrics bucket are already attached by the middlewares registered
 * before it; routing has happened by the time `finish` fires, so the matched
 * route template is available).
 *
 * Registered directly on the Express instance in `app.setup.ts`. Instrumentation
 * only: it attaches one `finish` listener, never writes to the response, never
 * throws (the listener body is guarded), and calls `next()` synchronously with
 * the same semantics Express expects.
 */
export function slowRequestMiddleware(options: SlowRequestMiddlewareOptions): (
  request: Request,
  response: Response,
  next: NextFunction,
) => void {
  const { thresholdMs } = options;
  // 0 (or any falsy/garbage threshold) disables the check with zero per-request cost.
  if (!thresholdMs) {
    return (_request, _response, next) => next();
  }

  const now = options.now ?? Date.now;

  return (request, response, next) => {
    const startedAt = now();

    response.on('finish', () => {
      try {
        const durationMs = now() - startedAt;
        if (durationMs < thresholdMs) return;
        const payload = buildPayload(request, response, durationMs);
        if (options.warn !== undefined) options.warn(payload);
        else emit(request, payload);
      } catch {
        // Instrumentation must never surface an error into an already-finished
        // response path; a broken warning is logged nowhere rather than thrown.
      }
    });

    next();
  };
}
