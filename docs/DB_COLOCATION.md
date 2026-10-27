# Database Co-location Runbook

**Owner:** you (infra changes are performed by you, in the Supabase dashboard / cloud console — no repo change does this for you).
**Goal:** remove cross-region network round trips between the API and PostgreSQL, which is the single largest remaining latency floor (the code-side levers — compression, cache prewarm, stale-while-revalidate — are in place; they shrink bytes and eliminate repeated queries, but every *uncached* query still pays one network RTT).

## Why this matters (measured)

From the performance audit (`docs/audits/PERFORMANCE_AUDIT.md`):

| Path | Measured (remote pooler) |
|---|---|
| `GET /products` cold | ~6.0 s |
| `GET /products` warm | ~0.3–0.6 s |
| `POST /orders` checkout | ~3–7 s |

These numbers are **network-dominated, not query-dominated** — the same queries co-located run in single-digit milliseconds. Every API↔DB round trip currently pays the cross-region latency; a single checkout performs 15–30 round trips inside one transaction, so the RTT is multiplied.

## Step 1 — Find where things live

1. **API hosting region**: check your deployment target (the region shown in its dashboard — e.g. Render/Fly/AWS region string).
2. **Database region**: Supabase dashboard → Project Settings → General → shows the region (e.g. `ap-southeast-1`).
3. **Latency between them**: from the API host, measure:
   ```bash
   # replace with your pooler host (connection string host) — do NOT paste credentials into shared logs
   pg_isready -h <db-host> -p 5432
   # or simply time a round trip through the app's own health endpoint:
   curl -s -o /dev/null -w '%{time_total}\n' https://<api-host>/api/v1/health
   ```
   The health endpoint runs `SELECT 1` and returns `checks.database.latencyMs` — that number is your current DB RTT. **Target: < 5 ms.** Anything above ~20 ms means you are paying cross-region cost on every query.

## Step 2 — Choose the fix (in order of preference)

### Option A — Move the API to the database's region (preferred)

Deploy the API service into the same region as the Supabase project. This is a hosting-dashboard change:

1. Create the service in the same region as the Supabase project.
2. Move all environment variables (copy them from the existing deployment — never commit them). The API needs at least: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `APP_ENV`, `PORT`, and any `*_TTL_SECONDS`/throttle values already set. See `apps/api/src/config/env.validation.ts` for the full list of supported keys.
3. Deploy, verify `/api/v1/health` reports `database.latencyMs` under 5 ms.
4. Repoint DNS / the mobile app's `EXPO_PUBLIC_API_URL` at the new deployment.
5. Tear down the old-region deployment after a soak period.

### Option B — Keep the API where it is; use the direct connection string

Supabase's **pooler** (transaction pooling, port 6543) adds a proxy hop on top of the regional distance. If moving the API isn't immediately possible:

1. Supabase dashboard → Connect → choose **Session mode / direct connection** (port 5432) vs **Transaction mode pooler** (port 6543). Session mode has a hard connection ceiling; transaction mode scales but adds a small proxy hop.
2. Because the API is a long-lived Node process with its own pg pool (`DATABASE_POOL_MAX`, default 20), **transaction-pooler mode is the safe default** — the app was designed for it (keepalive settings in `prisma.service.ts` defend against pooler idle-sweeps). Only switch to direct mode if `DATABASE_POOL_MAX` × instance count stays well under the project's connection limit (~57 usable on the current plan).
3. Update `DATABASE_URL` in the deployment env (not in the repo) and restart: `pnpm pm2:restart`.

### Option C — Supabase read replica for catalogue reads (future, optional)

If read traffic grows: point a read-only datasource at a replica in the API's region. This is a Prisma multi-datasource change and needs a code pass — flag it, don't do it ad hoc; the catalogue cache already absorbs most read volume.

## Step 3 — Verify (use the repo's own instrumentation)

After the move, check the numbers the API already emits — no new tooling needed:

1. `pnpm pm2:logs` — every request line carries `"db":{"ms":<db time>,"queries":<n>}`. Compare the `db.ms` distribution before/after on `GET /api/v1/products`.
2. `GET /api/v1/health` — `checks.database.latencyMs` is the raw RTT. Target < 5 ms.
3. Slow-request warnings: lines with `"msg":"slow request"` (threshold from `logging.slowRequestMs`) should disappear from normal traffic.
4. End-to-end feel: cold app start on a real device with the mobile app pointed at the new URL.

**Expected after co-location** (with the Phase-1 code changes already merged):

| Path | Before (remote pooler) | Expected after |
|---|---|---|
| Warm `GET /products` p50 | 300–600 ms | 30–80 ms |
| Checkout (`POST /orders`) | 3–7 s | 200–600 ms |
| Health `database.latencyMs` | tens of ms | < 5 ms |

## Constraints & rollback

- **Connection budget**: `instances × DATABASE_POOL_MAX` must stay under the project's usable-connection limit (~57) — see the sizing note in `ecosystem.config.js`. PM2 runs fork mode with 1 instance by default.
- **No schema changes are involved** — this is pure placement/connection routing. No migrations, no downtime beyond the cutover restart.
- **Rollback**: repoint `DATABASE_URL` (or DNS/`EXPO_PUBLIC_API_URL`) back to the previous value and restart. Nothing in the data is touched by any step here.
- **Never** paste connection strings with credentials into commits, issues, or chat — rotate the database password if a full URL ever lands somewhere it shouldn't.
