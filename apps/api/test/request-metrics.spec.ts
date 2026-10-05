import { describe, expect, it } from 'vitest';

import {
  createRequestMetrics,
  currentRequestMetrics,
  recordDbDuration,
  runWithRequestMetrics,
  timeExternal,
} from '../src/observability/request-metrics';

/**
 * Baseline instrumentation contract (Step 0).
 *
 * These assert the two properties the whole logging pipeline depends on:
 * a request's work records into THAT request's bucket (never a shared global,
 * never a neighbour's), and instrumentation never changes what a caller sees.
 */
describe('request metrics', () => {
  it('attributes db and external durations to the request that ran them', async () => {
    const metrics = createRequestMetrics();

    await runWithRequestMetrics(metrics, async () => {
      recordDbDuration(12);
      recordDbDuration(8);
      const rows = await timeExternal('msg91', async () => ['row']);
      expect(rows).toEqual(['row']);
      recordDbDuration(5);
    });

    expect(metrics.dbQueries).toBe(3);
    expect(metrics.dbMs).toBe(25);
    expect(metrics.externalMs.msg91).toBeGreaterThanOrEqual(0);
    expect(metrics.externalCalls.msg91).toBe(1);
  });

  it('keeps concurrent requests in separate buckets', async () => {
    const first = createRequestMetrics();
    const second = createRequestMetrics();

    await Promise.all([
      runWithRequestMetrics(first, async () => {
        recordDbDuration(10);
        await timeExternal('razorpay', async () => new Promise((resolve) => setTimeout(resolve, 20)));
        recordDbDuration(10);
      }),
      runWithRequestMetrics(second, async () => {
        recordDbDuration(2);
      }),
    ]);

    expect(first.dbQueries).toBe(2);
    expect(first.dbMs).toBe(20);
    expect(first.externalCalls.razorpay).toBe(1);
    expect(second.dbQueries).toBe(1);
    expect(second.dbMs).toBe(2);
    expect(second.externalCalls.razorpay).toBeUndefined();
  });

  it('records nothing outside a request, without throwing', async () => {
    expect(currentRequestMetrics()).toBeUndefined();

    expect(() => recordDbDuration(50)).not.toThrow();
    await expect(timeExternal('expo', async () => 'ok')).resolves.toBe('ok');
  });

  it('never changes the result or error of a timed call', async () => {
    const metrics = createRequestMetrics();

    await runWithRequestMetrics(metrics, async () => {
      const failure = timeExternal('razorpay', async () => {
        throw new Error('gateway down');
      });
      await expect(failure).rejects.toThrow('gateway down');
      // A failing call is still measured: a provider that fails slowly is
      // exactly what this instrumentation must surface.
      expect(metrics.externalCalls.razorpay).toBe(1);
    });
  });

  it('propagates synchronous middleware semantics', () => {
    const metrics = createRequestMetrics();
    let ran = false;

    runWithRequestMetrics(metrics, () => {
      ran = true;
      expect(currentRequestMetrics()).toBe(metrics);
    });

    expect(ran).toBe(true);
  });
});
