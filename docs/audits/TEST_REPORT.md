# Test Report — Sakya Farm App Production Hardening

**Date:** 2026-10-03 · **Runner:** vitest (api, customer, packages) via Turborepo · **Node v25.8.1 / pnpm 11.9.0**

## 1. Final results (after all changes)

### Default run — `pnpm test` (root)

| Suite | Result |
|---|---|
| `@sakya/utils` | 30 passed |
| `@sakya/validation` | 11 passed |
| `@sakya/customer` | 63 passed |
| `@sakya/api-client` | 80 passed |
| `@sakya/api` | **290 passed / 37 skipped** |
| **Turbo** | **9/9 tasks pass** |

### Full DB e2e run — `RUN_DB_E2E=1 pnpm exec vitest run --no-file-parallelism` (apps/api)

**32/32 files · 325 passed · 2 skipped** — includes all 5 previously-gated suites:

| Suite | Tests | Result |
|---|---|---|
| `cart-checkout.e2e.spec.ts` | 12 | ✅ all pass |
| `auth-otp.e2e.spec.ts` | 9 | ✅ all pass |
| `cart-pill.e2e.spec.ts` | 5 | ✅ all pass |
| `payment-idempotency.e2e.spec.ts` | 3 | ✅ all pass |
| `fulfillment-delivery.e2e.spec.ts` | 6 | ✅ all pass |

The 2 remaining skips are intentional `it.skip`s in the delivery spec (documented in `docs/handoff.md`).
DB e2e ran against the configured **remote Supabase** database (user-approved), fixtures are fixed-UUID upserts cleaned per test.

## 2. New regression tests added this audit

`apps/api/test/orders.service.spec.ts` (+7 tests, suite 18 → 25):

1. checkout takes a `FOR UPDATE` lock on the cart row
2. second checkout refused once the cart is emptied under the lock
3. concurrent same-key attempt returns the winner's order under the lock
4. cancelled/refunded order's idempotency key cannot be reused (409)
5. expired coupon rejected at apply time
6. per-user coupon limit re-enforced at checkout
7. atomic global usage-limit claim (conditional UPDATE) enforced

Mock (`createPrismaMock`) extended with `cartItem.count`, `coupon.findUnique`, `couponRedemption.count`, `$queryRaw`.

## 3. Baseline vs final

| Check | Baseline | Final |
|---|---|---|
| typecheck | ❌ 24 errors (customer) | ✅ 10/10 tasks |
| lint | ✅ 20 warnings | ✅ 6/6 tasks, same 20 warnings, 0 errors |
| test (default) | 283 passed / 37 skipped | 290+ passed / 37 skipped (7 new tests) |
| DB e2e | ⚠️ unverified (gated; env-drift would have failed them) | ✅ 325 passed / 2 skipped |
| audit | 18 advisories | 6 (residual documented) |
| build | ✅ android export | ✅ android export + web export |

## 4. Test-infra fixes required to get e2e green (IR-011/IR-017)

The 5 DB e2e suites had silently drifted from live configuration — they had never been run with `RUN_DB_E2E=1` against this `.env`:

- **Env drift:** suites assert zero-shipping totals and a random 6-digit OTP, but `.env` carries `SHIPPING_FEE_IN_PAISE=4900` and `OTP_DEMO_CODE=1234`. Fixed by pinning hermetic values in `vitest.config.ts` (`test.env`: shipping/tax/COD = 0, `OTP_DEMO_MODE=false`) — vitest sets these before file load, and dotenv never overwrites existing `process.env` keys.
- **Fixture drift:** checkout now requires a 6-digit `postalCode` (Zod rule added after the suites were written); fixtures in 3 specs updated to include `postalCode: '560001'`.
- **Parallelism:** 5 Nest apps × 32 workers against one remote DB caused nondeterministic 500s (different failures each run). Running e2e with `--no-file-parallelism` is deterministic and green twice in a row.

## 5. Not run / manual items

| Item | Reason |
|---|---|
| TalkBack / VoiceOver a11y pass | Requires physical devices/emulators with screen readers |
| Real Razorpay webhook replay | Requires real payment events / signing with live secret |
| Browser popup payment flow | Manual browser verification |
| `pnpm format:check` | Fails on 149 pre-existing files — deliberately not auto-run (standalone commit) |
| Image/bundle optimization | Needs design sign-off |
