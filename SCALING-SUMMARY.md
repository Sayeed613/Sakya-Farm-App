# Scaling & Safety — Plain-Language Summary

This covers the five scaling tasks (T1–T5) that were built on top of the earlier audit.
Everything here is already in the code and verified (typecheck, lint and tests pass in
both apps: API **255 tests passed**, customer **63 passed**). Nothing below needs
further work to be safe to run — the only optional items are the two accounts you'd
create yourself (Sentry, UptimeRobot), marked "your move" at the end.

---

## What changed, one item at a time

### T1 — Database pool sized for launch (config only)

The number of simultaneous database connections the API is allowed to open was
raised from 10 to **20** (`DATABASE_POOL_MAX`, `apps/api/src/config/env.validation.ts`).

- Why it matters for 100–1000 users: 10 was tight once catalogue reads, cart writes,
  order transactions and the health check all run at once. 20 gives real headroom.
- Why it's safe: your Supabase Postgres allows ~57 usable connections. One API
  instance × 20 leaves over half the server free for migrations, Prisma Studio and
  support sessions.
- Rule of thumb written into the config: if you ever run N API instances behind PM2,
  drop the pool to ~57/N. Two instances → 20 each is fine; four → drop to ~12.

### T2 — Catalogue cache (products & categories served from memory)

Public reads of products, variants and categories are now served from an in-process
cache with a 30-second TTL (`apps/api/src/cache/catalog-cache.service.ts`).

- Effect: browsing the shop no longer touches the database for every product list —
  the single heaviest read path. Product/category **pages** now do.
- Stampede protection is built in: if 200 users hit a cold cache at the same moment,
  exactly one database query runs and the rest share its result.
- Consistency: every admin write (create/update/archive products, add/update
  variants, create/update/deactivate categories) invalidates the cache immediately
  **in that process**. Customers see admin changes within the 30s TTL, instantly in
  the same process.
- One caveat, stated plainly: with **multiple API processes** (PM2 cluster or several
  servers), a write in process A doesn't invalidate process B's cache — B catches up
  within 30 seconds. For a launch of this size that's acceptable; when it isn't, the
  fix is a shared store (Redis pub/sub), already noted as the same dependency PM2
  clustering needs.
- Tuning: `CATALOG_CACHE_TTL_SECONDS` (default 30, `0` disables caching entirely).

### T3 — PM2 keeps the API alive + crashes get handled, not ignored

Two layers were added:

1. **Process manager** (`ecosystem.config.js`, root). `pnpm pm2:start` builds and
   runs the API under PM2: automatic restart with exponential backoff, capped at 15
   fast restarts, restart if memory passes 512 MB, graceful stop window of 10 s.
   Proven end-to-end: process killed → PM2 restarted it → health check green.
2. **Crash policy** (`apps/api/src/main.ts`). An uncaught exception or unhandled
   rejection used to leave a zombie process. Now the process logs a `FATAL` line to
   stderr, (if Sentry is on) ships the event, and exits non-zero so PM2 restarts it.
   Request errors were already answered by the exception filter; these are the two
   cases nothing could answer.

Plain terms: crashes go from "maybe the API is up, maybe it's lying" to "down for a
couple of seconds, then back, with the reason recorded".

### T4 — Error tracking (Sentry) + uptime monitoring

**API** (`apps/api/src/observability/sentry.ts`):
- Every request that fails with a 5xx is reported to Sentry, tagged with the same
  `requestId` the logs carry. 4xx (client mistakes) are deliberately not reported —
  they'd bury the real signal.
- Fatal crashes (T3's path) are reported too, with a bounded 2-second flush so
  reporting can never delay the restart.
- Sentry's own process-level integrations are switched off so a crash produces
  exactly one event, not a race between two handlers.

**Customer app** (`apps/customer/src/lib/sentry.ts`):
- Crashes and errors on phones and web are reported, initialised before the first
  screen mounts so even a first-render crash is captured.

**Both are DSN-gated**: with no DSN set (the state today), the SDK is never
initialised — zero traffic, zero behaviour change. This was a hard requirement since
no Sentry account exists yet.

**Uptime monitoring — recommendation:** use **UptimeRobot** (free tier) to ping
`https://<your-api-domain>/api/v1/health` every 5 minutes. It emails you when the
API is unreachable — the thing Sentry can't tell you (if the server is fully down,
Sentry's SDK goes down with it). Sentry = *why* it broke; UptimeRobot = *that* it's
down. Two checks on the same free plan: one for the API health URL, one for the
storefront URL.

### T5 — Rate limiting now keys by user, not just IP

The global rate limiter previously counted requests per IP address. On Indian mobile
networks (carrier-grade NAT) thousands of unrelated customers share one IP, so one
noisy neighbour could get the whole neighbourhood blocked.

Now (`apps/api/src/common/guards/user-aware-throttler.guard.ts`):
- **Signed-in caller (valid access token)** → counted per **user id**. Everyone gets
  their own bucket.
- **Everyone else** (no token, expired, tampered, wrong secret, garbage) → counted
  per **IP**, exactly as before. An invalid token never buys more quota than being
  anonymous.

How it stays safe and fast:
- The guard runs **before** authentication, exactly as the flood-rejection order
  demands. It does its own JWT verification — one HMAC check, **no database, no
  I/O** — using the identical secret/issuer/audience as the real auth strategy, so a
  token the API accepts always lands in the user bucket.
- 9 unit tests pin the contract: valid token → `user:<id>`; expired, wrong-secret,
  refresh-token, garbage, non-bearer → `ip:<address>`; distinct users never share a
  bucket.
- The in-memory limit store is per process (unchanged). Several instances behind PM2
  each count separately; the fix — a shared Redis store — is the same one T2/T3 note.

---

## Two known issues NOT fixed (on purpose — awaiting your call)

1. **COD orders auto-cancel after 2 hours** (HANDOFF §5.1). Nothing advances a
   Cash-on-Delivery order out of `PENDING_PAYMENT`, so the expiry service cancels it
   with "Payment was not completed in time". Proven with a real order. This is the
   single most customer-visible defect at launch.
2. Nothing here fixes the stock race discussion (two buyers, one unit). The existing
   transactional checks make overselling unlikely, not impossible.

---

## Your move — two accounts, ~15 minutes

**Sentry** (error dashboard):
1. Create a project at sentry.io — one **Node/Express** project (API), one
   **React-Native** project (customer app).
2. API: put the DSN in `apps/api/.env` as `SENTRY_DSN=...` → restart. Done.
3. App: put the DSN in `apps/customer/.env` as `EXPO_PUBLIC_SENTRY_DSN=...` and
   rebuild the app. Done.
4. Optional, for native crash symbols (production builds only): add the Sentry
   config plugin to `app.json` with org/project names and a `SENTRY_AUTH_TOKEN`.
   Skip it until you ship real native builds.

**UptimeRobot** (uptime emails):
1. Add a monitor → type HTTP(s) → URL `https://<api-domain>/api/v1/health`.
2. Set the interval to 5 minutes, and add your email for alerts.

Neither requires any further code change — the integrations are waiting for the DSNs.

---

## Environment variables added (all optional)

| Variable | Where | Default | Meaning |
|---|---|---|---|
| `SENTRY_DSN` | `apps/api/.env` | unset (Sentry off) | API error tracking |
| `EXPO_PUBLIC_SENTRY_DSN` | `apps/customer/.env` | unset (Sentry off) | App error tracking |
| `CATALOG_CACHE_TTL_SECONDS` | `apps/api/.env` | 30 (0 = off) | Catalogue cache lifetime |
| `DATABASE_POOL_MAX` | `apps/api/.env` | 20 (was 10) | DB connections per instance |

No migrations, no schema changes, no breaking API changes. Existing `.env` files
keep working untouched.
