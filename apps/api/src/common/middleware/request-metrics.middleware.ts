import type { NextFunction, Request, Response } from 'express';

import {
  createRequestMetrics,
  runWithRequestMetrics,
} from '../../observability/request-metrics';

/**
 * Creates the metrics bucket for one request and runs the rest of the request
 * inside it, so Prisma query events and external-service timers started later
 * record into this request's bucket rather than a shared global.
 *
 * Registered directly on the Express instance (`app.use`), before routing:
 * Express calls `next()` synchronously from inside `storage.run`, which is what
 * puts the routing, guards, handlers and every promise they start into the
 * bucket's async context.
 *
 * The bucket itself is also hung on the request object, because the pino
 * completion hook reads it from there (it has the request, not the context).
 */
export function requestMetricsMiddleware(
  request: Request,
  _response: Response,
  next: NextFunction,
): void {
  const metrics = createRequestMetrics();
  request.metrics = metrics;
  runWithRequestMetrics(metrics, next);
}
