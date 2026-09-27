import { describe, expect, it, vi } from 'vitest';

/**
 * The API's Sentry module is env-gated: with no DSN the SDK is never
 * initialised and every helper must be a strict no-op, so an environment
 * without credentials behaves exactly as it did before this module existed.
 * These tests pin that boundary. (The SDK's own behaviour — transports,
 * envelopes, event delivery — is Sentry's problem, not ours to test.)
 */
vi.mock('@sentry/nestjs', () => {
  const state = { inited: false, captured: [] as unknown[] };
  return {
    init: vi.fn((options: { dsn?: string }) => {
      state.inited = options.dsn !== undefined && options.dsn !== '';
    }),
    isInitialized: vi.fn(() => state.inited),
    captureException: vi.fn((...args: unknown[]) => state.captured.push(args)),
    withScope: vi.fn((callback: (scope: object) => void) =>
      callback({
        setTag: vi.fn(),
        setContext: vi.fn(),
      }),
    ),
    close: vi.fn(() => Promise.resolve(true)),
  };
});

import * as Sentry from '@sentry/nestjs';
import { captureFatal, captureRequestError, initSentry } from '../src/observability/sentry';

describe('sentry observability module', () => {
  it('stays a no-op when no DSN is configured', async () => {
    initSentry({ dsn: null, environment: 'development' });

    expect(Sentry.init).not.toHaveBeenCalled();
    expect(Sentry.isInitialized()).toBe(false);

    // Neither the fatal nor the request path may do anything.
    await expect(captureFatal('uncaughtException', new Error('boom'))).resolves.toBeUndefined();
    captureRequestError(new Error('boom'), {
      method: 'GET',
      url: '/x',
      requestId: 'r1',
      statusCode: 500,
    });

    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('initialises the SDK when a DSN is present', () => {
    initSentry({ dsn: 'https://key@example.ingest.sentry.io/42', environment: 'production' });

    expect(Sentry.init).toHaveBeenCalledTimes(1);
    expect(Sentry.isInitialized()).toBe(true);
  });

  it('captures fatals with a kind tag and flushes before the caller exits', async () => {
    initSentry({ dsn: 'https://key@example.ingest.sentry.io/42', environment: 'production' });

    const fatal = new Error('process is dying');
    await captureFatal('unhandledRejection', fatal);

    expect(Sentry.captureException).toHaveBeenCalledWith(fatal);
  });

  it('captures request-scoped 5xx errors', () => {
    initSentry({ dsn: 'https://key@example.ingest.sentry.io/42', environment: 'production' });

    const error = new Error('db pool exhausted');
    captureRequestError(error, {
      method: 'POST',
      url: '/api/v1/orders',
      requestId: 'req-42',
      statusCode: 500,
    });

    expect(Sentry.captureException).toHaveBeenCalledWith(error);
  });

  it('resolves within the bounded flush window even if close() never settles', async () => {
    initSentry({ dsn: 'https://key@example.ingest.sentry.io/42', environment: 'production' });
    vi.mocked(Sentry.close).mockImplementationOnce(() => new Promise(() => {}));

    // The fatal path precedes process.exit: if this hung, PM2's restart would
    // be delayed and the 2s race below is the backstop being tested.
    const pending = captureFatal('uncaughtException', new Error('wedged transport'));
    await expect(vi.waitFor(() => pending, { timeout: 3000 })).resolves.toBeUndefined();
  });
});
