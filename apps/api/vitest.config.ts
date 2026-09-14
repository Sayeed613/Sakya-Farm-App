import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for the API workspace.
 *
 * The integration specs (`test/*.e2e.spec.ts`) boot the real Nest application
 * against the PostgreSQL database in `DATABASE_URL`, which may be remote — a
 * single round trip there can take seconds. The defaults (5s per test, 10s per
 * hook) therefore fail on latency rather than on behaviour, which reads as a
 * flaky suite and hides real regressions.
 *
 * Raising the ceiling cannot weaken a unit spec: a fast test still passes in
 * milliseconds.
 */
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 90_000,
  },
});
