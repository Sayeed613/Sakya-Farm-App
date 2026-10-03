# Master Audit — Sakya Farm App Production Hardening

**Date:** 2026-10-03 · **Repo:** `Sayeed613/Sakya-Farm-App` · **Method:** INSPECT → TRACE → FIX → TEST → VERIFY → HARDEN → DOCUMENT
**Stack:** pnpm + Turborepo · `apps/api` (NestJS 12 / Prisma 7 / PostgreSQL) · `apps/customer` (Expo 57 / React Native / Expo Router) · `packages/{types,validation,utils,api-client}`

## 1. Baseline (Phase 0, captured before any edit)

| Check | Result |
|---|---|
| `pnpm typecheck` | **FAILED** — 24 TS errors, all in `apps/customer` (wrong named imports of default-exported components, one `shipingInPaise` typo) |
| `pnpm lint` | Passed — 20 pre-existing `no-explicit-any` warnings (mostly `orders.service.ts`, `stores/*.ts`) |
| `pnpm test` | 283 passed / 37 skipped (37 = 5 DB e2e suites gated on `RUN_DB_E2E=1` + 2 intentional `it.skip`) |
| `pnpm build` | Passed (Expo android export) |
| `pnpm format:check` | **FAILED** — 149 files unformatted (pre-existing; deliberately NOT auto-run, see ISSUE_REGISTER IR-014) |
| `pnpm audit` | 18 advisories |

## 2. What was audited (phase coverage)

- **Checkout/order pipeline (10/12):** idempotency, concurrency, coupon integrity, stock reservation, deadlock ordering — *fixed* (IR-002/003/004).
- **Payments (14):** webhook-only state transitions verified; web `postMessage` origin/source validation *fixed* (IR-005); no client-reachable confirm/mark-paid endpoint exists.
- **Auth/ownership (11):** guard chain, per-resource scoping (addresses, returns, notifications, payments), OTP single-use/rate-limit — verified by trace + e2e.
- **DB reliability (20):** Prisma → `@prisma/adapter-pg` pool; TCP keepalive added against historical P1017 (IR-007); no raw `pg.Client`, no interactive-tx `Promise.all`.
- **Dependencies (34):** 18 → 6 advisories via documented `overrides` (IR-006); residual 6 triaged as not-fixable/dev-only (IR-012).
- **SEO/AEO (27/28):** robots.txt, generated sitemap (89 URLs), JSON-LD (Product/WebSite/Organization), private-route noindex, `?q=` search support (IR-013).
- **UX/a11y (24/26):** pull-to-refresh await fix (IR-010); 155 Pressables — 122 with `accessibilityLabel`, 157 with `accessibilityRole`, 0 `Touchable`; **TalkBack/VoiceOver run is a manual item**.
- **Logging (33):** OTP phone+code log leak *fixed* (IR-009); repo-wide grep sweep: no `console.log`, no `TODO/FIXME/HACK`, no `@ts-ignore`, no hardcoded secrets, no LAN IPs outside documented CORS/boot defaults.
- **Test infra (Phase 12/40):** DB e2e suites had drifted from current env/validation rules — made hermetic and all green (IR-011, IR-017).

## 3. Final state (all re-verified after last change)

| Check | Result |
|---|---|
| `pnpm typecheck` | **10/10 tasks pass** |
| `pnpm lint` | **6/6 tasks pass** (same 20 pre-existing warnings, 0 errors) |
| `pnpm test` (default) | **9/9 tasks** — utils 30, validation 11, customer 63, api-client 80, api 290 passed / 37 skipped |
| `RUN_DB_E2E=1 vitest run --no-file-parallelism` | **32/32 files, 325 passed, 2 skipped** (both skips are intentional `it.skip`) |
| `pnpm build` | Passed (android export) |
| `expo export --platform web` | Passed — robots.txt + sitemap.xml in output, 2 JSON-LD blocks in `index.html` |
| `pnpm audit` | **6 advisories** (down from 18; remainder documented as not-fixable/dev-only) |
| Sitemap generator | Ran against live API: `5 static + 84 product URLs` written |

## 4. Known limitations (honest list — not "perfect")

1. **Web is an SPA** (`web.output: "single"`): crawlers index one HTML shell; per-route metadata needs SSR/a framework migration — explicitly out of scope this pass.
2. **6 residual npm advisories** not fixable without unsafe majors or unpublished upstream patches (dev tooling only).
3. **`pnpm format:check` fails** on 149 pre-existing files — needs a standalone formatting commit.
4. **Manual verification outstanding:** TalkBack/VoiceOver, real-Razorpay webhook replay, popup payment flow in a browser, P1017 long-run soak, image asset optimization.
5. **DB e2e must run sequentially** (or on a local disposable DB); Docker unavailable on this machine, suites were run against the configured remote Supabase DB with user approval.

Companion documents: `ISSUE_REGISTER.md`, `SECURITY_AUDIT.md`, `PERFORMANCE_AUDIT.md`, `SEO_AEO_AUDIT.md`, `TEST_REPORT.md`, `RELEASE_READINESS.md`.
