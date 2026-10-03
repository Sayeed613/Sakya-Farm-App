# Security Audit — Sakya Farm App

**Date:** 2026-10-03 · **Scope:** API auth/authz, payment integrity, injection, secrets, dependencies, logging

## 1. Authentication & authorization (verified by code trace + tests)

**Guard chain (global `APP_GUARD`):** `UserAwareThrottlerGuard` → `JwtAuthGuard` → `RolesGuard` → `PermissionsGuard`.
Auth is **on by default**; `@Public()` opts out explicitly. No route found relying on client-supplied identity.

**Ownership scoping (confirmed per module):**

| Resource | Enforcement | Failure mode |
|---|---|---|
| Addresses | `where: { id, userId }` in `addresses.service.ts` | 404 (no existence leak) |
| Returns / invoices / reorders | `customer-journey.service.ts`: `where: { …, order: { userId } }` | 404, not 403 |
| Notifications | scoped to caller in `notifications.service.ts` | 404 |
| Payments | `getOwnedPaymentOrThrow` in `payments.service.ts` | 403 for non-owner |
| Orders | `getOrderById(orderId, userId)` | 404 for other users' orders (e2e-verified) |

**OTP:** SHA-256 hashed at rest, single-use, 5 wrong attempts burn it, resend cooldown + rolling hourly cap, generic responses (no account enumeration — e2e verified). Demo mode (`OTP_DEMO_MODE`) refuses to engage when `NODE_ENV=production`.

## 2. Payment integrity

- Payment state changes only via **signed Razorpay webhooks** or the demo simulate route (production returns 404 for simulate). No confirm/mark-paid client endpoint exists.
- `POST /orders` idempotency: pre-check + cart-row `FOR UPDATE` lock + under-lock replay check — a retried checkout returns the original order; a cancelled/refunded key reuse throws 409 (unit + e2e verified).
- **Web `postMessage` hardening (fixed, IR-005):** `razorpay-checkout.ts` now requires `event.origin === window.location.origin` **and** `event.source === popup`; popup relay uses `window.location.origin` instead of `"*"`. Client message remains a HINT — success is confirmed server-side.
- Coupon redemptions claimed atomically inside the checkout transaction (conditional `UPDATE` guarded by `is_active`, `usage_limit`, `starts_at`, `ends_at`) — concurrent checkouts cannot double-spend the last redemption (unit verified).

## 3. Injection & input handling

- Prisma parameterizes all queries; the two raw statements (`FOR UPDATE` cart lock, coupon claim `UPDATE`) bind values via tagged templates with explicit `::uuid` casts — no string interpolation.
- Zod validation pipe on every route; checkout re-validates pincode format and Bengaluru-only fresh-produce rule server-side.
- Prices, discounts, shipping and totals are always recomputed server-side (`recomputeOrderTotals`); client-sent amounts are never trusted.

## 4. Secrets & logging

- Repo grep sweep: no hardcoded API keys/passwords; `.env` is gitignored (confirmed via `git check-ignore`).
- **Fixed (IR-009):** dev OTP log line now masks the phone (`•••XXXX`) and never logs the code. Response-body `devCode` remains a development affordance, gated on non-production.
- Pino structured logging; no `console.log` anywhere in source (sweep clean).

## 5. Dependencies (`pnpm audit`)

18 → **6** advisories via `pnpm-workspace.yaml` overrides (multer 2.4.0 — production avatar upload path, js-yaml, brace-expansion, fast-uri, mysql2).

**Residual 6 (documented, not fixable today):** uuid<11.1.1, deepmerge-ts<8, decode-uri-component≤0.4.2 (ESM-only 0.5.0, non-overridable under `query-string`), basic-ftp≤6.2.0, node-forge≤1.4.0, braces≤3.0.3 — patched versions unpublished or would require unsafe major bumps; all reachable only via dev tooling (Prisma Studio, Expo CLI), not the shipped API/mobile bundles.

## 6. Headers/CORS/transport

- CORS allowlist from env (`CORS_ORIGINS`), not `*`; trust-proxy configurable; throttling enabled globally.
- Production requires HTTPS termination at the host (SPA + API) — deployment concern, noted in RELEASE_READINESS.

## 7. Findings summary

| ID | Sev | Item | Status |
|---|---|---|---|
| IR-002/003 | P0 | Checkout double-place & coupon double-spend races | ✅ Fixed + regression tests |
| IR-005 | P1 | Web postMessage origin/source validation | ✅ Fixed (browser flow = manual verify) |
| IR-009 | P2 | OTP phone+code log leak | ✅ Fixed |
| IR-006/012 | P1/P2 | 18 → 6 advisories; 6 residual dev-only | ✅ Fixed / ⚠️ Documented |
| — | — | Ownership scoping, OTP enumeration, webhook-only payments | ✅ Verified |

**No open security P0s/P1s.** Outstanding items are manual verifications (real webhook replay, popup flow), listed in RELEASE_READINESS.
