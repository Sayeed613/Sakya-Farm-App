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
    /**
     * Hermetic commerce/auth config for the whole suite.
     *
     * The DB e2e specs boot the real app, which reads `.env` — and a
     * developer's local values (a flat shipping fee, OTP demo mode) silently
     * change the numbers and codes the tests assert on. Vitest sets these
     * BEFORE the test files import, and dotenv never overwrites existing
     * `process.env` keys, so the suite asserts on fixed config regardless of
     * which `.env` the machine carries.
     */
    env: {
      SHIPPING_FEE_IN_PAISE: '0',
      TAX_RATE_PERCENT: '0',
      COD_FEE_IN_PAISE: '0',
      OTP_DEMO_MODE: 'false',
      // The notification worker's cron must never fire during tests: a tick
      // would make REAL Expo calls and race suite-owned queue rows. Tests
      // drive NotificationWorkerService.processQueuedNotifications() directly
      // instead (production default: unset = enabled).
      NOTIFICATIONS_WORKER_DISABLED: '1',
    },
  },
});
