# Release Readiness — Sakya Farm App

**Date:** 2026-10-03 · **Decision:** ✅ **READY WITH DOCUMENTED MANUAL VERIFICATION**

No open P0/P1 defects. All automated gates green; a short list of environment/device-dependent
checks cannot be executed on this machine and must be done before/after deploy.

## 1. Gate summary

| Gate | Status | Evidence |
|---|---|---|
| Typecheck | ✅ | `pnpm typecheck` 10/10 tasks |
| Lint | ✅ | `pnpm lint` 6/6 tasks, 0 errors (20 pre-existing `no-explicit-any` warnings) |
| Unit/integration tests | ✅ | `pnpm test` 9/9 tasks — 474+ passed across packages |
| DB e2e tests | ✅ | `RUN_DB_E2E=1 --no-file-parallelism` → 325 passed / 2 intentional skips |
| Build (android) | ✅ | `pnpm build` export OK |
| Build (web) | ✅ | `expo export --platform web` OK, robots/sitemap/JSON-LD present |
| Dependency audit | ✅ w/ notes | 18 → 6 advisories; 6 residual are dev-only, not fixable upstream today |
| Secrets sweep | ✅ | No hardcoded secrets; `.env` gitignored; no TODO/FIXME/HACK, no `console.log`, no `@ts-ignore` |
| Formatting gate | ⚠️ | `pnpm format:check` fails on 149 pre-existing files — standalone formatting commit recommended |

## 2. Required manual verification (before/with launch)

1. **Accessibility:** TalkBack (Android) and VoiceOver (iOS) pass over home, cart, checkout, order tracking — static coverage looks good (122/155 Pressables labeled, 157 roles) but screen-reader behavior must be heard, not assumed.
2. **Payments:** replay a **real** Razorpay webhook (signature valid + signature invalid) against staging; exercise the web popup payment flow in a browser.
3. **Sitemap in deploy pipeline:** run `API_URL=<prod-api> node scripts/generate-sitemap.mjs` before each web deploy (not wired into CI).
4. **Re-measure cold `GET /products`** co-located with the DB (remote measurement this session was ~6 s cold / ~0.5 s warm).
5. **P1017 soak:** confirm keepalive holds over a multi-day production run.
6. **DB e2e in CI:** use a disposable local/ephemeral Postgres and `--no-file-parallelism` (Docker was unavailable on this machine; suites ran against the configured remote DB with user approval).

## 3. Production configuration checklist

- `NODE_ENV=production`
- `OTP_DEMO_MODE=false` (and remove/rotate `OTP_DEMO_CODE`) + real `MSG91_*` credentials
- Rotate `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`, set `RAZORPAY_WEBHOOK_SECRET`
- `CORS_ORIGINS` restricted to the real web origin; `TRUST_PROXY` set behind the load balancer
- HTTPS termination verified; `DATABASE_URL` points at the production pooler with SSL
- Run `pnpm db:migrate:deploy` on release

## 4. Deferred (accepted) items

| Item | Ref | Why deferred |
|---|---|---|
| SSR/prerender for per-route HTML | SEO_AEO §2 | Framework migration explicitly out of scope |
| 6 residual npm advisories | IR-012 | Upstream patches unpublished / unsafe majors / dev-only |
| Repo-wide Prettier run | IR-014 | Would drown audit diff; do as standalone commit |
| PNG → WebP + bundle diet | IR-016 | Needs design sign-off |
| Nest 12 peer range for `@nestjs/throttler` | IR-015 | Pre-existing; awaiting upstream release |
