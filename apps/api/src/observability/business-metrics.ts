/**
 * In-process business counters — the smallest mechanism that satisfies
 * "count the events an operator would page on".
 *
 * Deliberately NOT a metrics platform: no labels, no histograms, no export
 * endpoint, no dependency. A plain object of monotonically increasing numbers
 * that any log line, health payload or admin endpoint can snapshot. Counters
 * are per process (like the in-memory throttler); with PM2 fork mode at
 * `instances: 1` that is exact, and with more instances each process reports
 * its own slice — documented rather than hidden behind a store.
 *
 * Every mutation is synchronous and cannot throw, so call sites inside
 * checkout/payment/notification paths are never at risk from observability
 * (see test L: instrumentation must not alter business outcomes).
 */

/** The events worth counting. Extend this union when adding a counter. */
export type BusinessMetric =
  | 'ordersCreated'
  | 'ordersCancelled'
  | 'checkoutFailures'
  | 'paymentFailures'
  | 'webhookFailures'
  | 'inventoryReservationFailures'
  | 'notificationQueueFailures'
  | 'notificationRetries'
  | 'notificationPermanentFailures';

export type BusinessMetricsSnapshot = Record<BusinessMetric, number>;

const metrics: BusinessMetricsSnapshot = {
  ordersCreated: 0,
  ordersCancelled: 0,
  checkoutFailures: 0,
  paymentFailures: 0,
  webhookFailures: 0,
  inventoryReservationFailures: 0,
  notificationQueueFailures: 0,
  notificationRetries: 0,
  notificationPermanentFailures: 0,
};

/** Increment a counter by `by` (default 1). Never throws; ignores bad input. */
export function incrementMetric(name: BusinessMetric, by = 1): void {
  if (typeof by !== 'number' || !Number.isFinite(by) || by <= 0) return;
  if (!(name in metrics)) return;
  metrics[name] += by;
}

/** Point-in-time copy for logging, health payloads or admin responses. */
export function snapshotMetrics(): BusinessMetricsSnapshot {
  return { ...metrics };
}

/** Reset all counters (tests only). */
export function resetMetrics(): void {
  for (const key of Object.keys(metrics) as BusinessMetric[]) {
    metrics[key] = 0;
  }
}
