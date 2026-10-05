import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request performance buckets for baseline instrumentation.
 *
 * The HTTP layer creates one bucket per request (see
 * `common/middleware/request-metrics.middleware.ts`) and puts it on
 * `request.metrics`. Two producers then fill it from wherever they run:
 *
 *  - Prisma's `query` event listener (`database/prisma.service.ts`) adds the
 *    time of every query the request issued;
 *  - `timeExternal` wraps outbound provider calls (MSG91, Expo push,
 *    Razorpay) and adds their duration.
 *
 * The bucket reaches those producers through `AsyncLocalStorage`, because they
 * never see the Express request: Prisma fires its event from inside the query
 * promise chain, and the providers are awaited deep inside services. Express
 * runs the whole downstream handler inside the middleware's `storage.run`, so
 * every async continuation of a request inherits the same bucket.
 *
 * Timings recorded outside a request (the pending-order expiry sweep, other
 * cron work) find no bucket and are dropped: there is no request line to attach
 * them to. That is deliberate — the sweep's latency is not a user-facing
 * measurement, and silently writing to a shared global would mix background
 * numbers into request lines.
 *
 * This module is instrumentation only: it never throws (every recorder is a
 * no-op without a bucket), never buffers, and has no effect on request
 * behaviour.
 */

/** Durations are milliseconds, summed exactly as the producers report them. */
export interface RequestMetrics {
  /** Total time this request spent inside Prisma queries. */
  dbMs: number;
  /** Number of Prisma queries attributed to this request. */
  dbQueries: number;
  /** External-service time per provider label, e.g. `{ razorpay: 812 }`. */
  externalMs: Record<string, number>;
  /** External call count per provider label. */
  externalCalls: Record<string, number>;
}

const storage = new AsyncLocalStorage<RequestMetrics>();

/** A fresh, empty bucket for one request. */
export function createRequestMetrics(): RequestMetrics {
  return { dbMs: 0, dbQueries: 0, externalMs: {}, externalCalls: {} };
}

/**
 * Run `work` with `metrics` as the current bucket, so every async continuation
 * it starts records into it. Express middleware semantics are preserved: the
 * return value and any synchronous throw of `work` pass straight through.
 */
export function runWithRequestMetrics<T>(metrics: RequestMetrics, work: () => T): T {
  return storage.run(metrics, work);
}

/** The current request's bucket, or undefined outside a request. */
export function currentRequestMetrics(): RequestMetrics | undefined {
  return storage.getStore();
}

/** Attribute one Prisma query's duration to the current request. */
export function recordDbDuration(durationMs: number): void {
  const metrics = storage.getStore();
  if (metrics === undefined) return;
  metrics.dbMs += durationMs;
  metrics.dbQueries += 1;
}

/** Attribute one outbound call's duration to the current request. */
export function recordExternalDuration(label: string, durationMs: number): void {
  const metrics = storage.getStore();
  if (metrics === undefined) return;
  metrics.externalMs[label] = (metrics.externalMs[label] ?? 0) + durationMs;
  metrics.externalCalls[label] = (metrics.externalCalls[label] ?? 0) + 1;
}

/**
 * Time an external-service call and attribute it to the current request.
 *
 * The timing is recorded in a `finally`, so a rejected call is still measured —
 * a provider that fails slowly is exactly what this must surface. The original
 * result or error propagates unchanged: instrumentation never changes what a
 * caller sees.
 */
export async function timeExternal<T>(label: string, call: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    return await call();
  } finally {
    recordExternalDuration(label, Date.now() - startedAt);
  }
}
