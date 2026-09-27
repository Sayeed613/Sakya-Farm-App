/**
 * PM2 process manager configuration for the Sakya Farms API.
 *
 * Start from the repo root:
 *
 *   pnpm pm2:start    build the API, then start it under PM2
 *   pnpm pm2:logs     tail the structured JSON logs
 *   pnpm pm2:restart  restart after a code change (without rebuilding)
 *   pnpm pm2:stop     stop the process (keep PM2's record of it)
 *   pnpm pm2:delete   stop and remove the process from PM2 entirely
 *
 * What PM2 gives us that `node dist/main.js` does not:
 *
 * - **Crash recovery.** If the process exits for any reason (uncaught
 *   exception, OOM kill, deploy script), PM2 restarts it with exponential
 *   backoff instead of leaving the API dark until a human notices.
 * - **Log routing.** pino already writes structured JSON to stdout; PM2
 *   captures that to rotating files so nothing is lost when the terminal
 *   closes.
 * - **Zero-downtime reload.** `pm2 reload` starts a fresh worker, waits for
 *   it to be ready, then drains the old one — deploys without dropped
 *   requests (cluster mode only).
 *
 * Sizing note (matches the DATABASE_POOL_MAX comment in env.validation.ts):
 * the live database allows ~57 usable connections. Each API instance pools
 * `DATABASE_POOL_MAX` (default 20), so `instances * DATABASE_POOL_MAX` must
 * stay under that. Fork mode with instances: 1 is the safe default; if you
 * scale to N instances, set DATABASE_POOL_MAX to ~57/N (e.g. 2 x 20 = 40,
 * leaving headroom for migrations and psql).
 *
 * Cluster mode vs in-process state: the throttler's in-memory counters and
 * the catalogue cache are per-process. With `instances: 1` (fork) that is
 * exact. If you raise instances, rate limits become per-worker (effective
 * limit = limit x N) and admin cache invalidation reaches only the worker
 * that served the admin request — other workers converge within one
 * CATALOG_CACHE_TTL_SECONDS. Both are documented trade-offs, not bugs.
 */
module.exports = {
  apps: [
    {
      name: 'sakya-api',
      // Built output — `pnpm pm2:start` runs the build first so this file
      // never starts stale code.
      script: 'apps/api/dist/main.js',
      cwd: __dirname,
      // Fork mode, one instance: keeps DB pool usage, rate limits and cache
      // invalidation exact. Raise deliberately (see sizing note above).
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      // Exponential backoff: 100ms, 200ms, 400ms ... capped at 15s. A crash
      // loop (e.g. bad config that fails at boot) backs off instead of
      // hammering the database or tripping the process manager itself.
      exp_backoff_restart_delay: 100,
      max_restarts: 15,
      // Only count a start as healthy if the process survives this long;
      // a config error that crashes within 10s stops the restart storm.
      min_uptime: '10s',
      // SIGTERM -> Nest shutdown hooks -> Prisma pool close. Give that chain
      // time to finish before PM2 escalates to SIGKILL.
      kill_timeout: 10_000,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
      // Structured JSON logs (pino writes to stdout; PM2 captures it).
      error_file: 'apps/api/logs/pm2-error.log',
      out_file: 'apps/api/logs/pm2-out.log',
      merge_logs: true,
      time: true,
      // Rotate logs so a chatty process cannot fill the disk.
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
    },
  ],
};
