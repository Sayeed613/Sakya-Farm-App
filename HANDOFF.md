# HANDOFF — Sakya Farms Commerce Platform

> Audit handoff, 2026-09-26. Every claim below was verified against the code or
> the live database during the audit; line numbers refer to the state of the
> repo at the time of the audit. Commands are run from the repo root unless a
> different working directory is stated.

---

## 1. Repository shape

pnpm + turbo monorepo (`pnpm@11.9.0`, Node ≥ 20.11).

| Path          | What it is                                                          |
| ------------- | ------------------------------------------------------------------- |
| `apps/api`    | NestJS 12 REST API, Prisma 7 + PostgreSQL (`@prisma/adapter-pg`)     |
| `apps/customer` | Expo 57 / React Native 0.86 customer app (expo-router, vitest)     |
| `packages/types` | Shared status machines, permissions, DTO types                    |
| `packages/validation` | Zod schemas — the client/server input boundary                |
| `packages/api-client` | Typed HTTP client used by the customer app                    |
| `packages/utils` | Shared helpers                                                    |

Root scripts: `pnpm build | dev | lint | typecheck | test | format`.
API scripts of note: `pnpm --filter @sakya/api db:migrate`,
`db:migrate:deploy`, `db:seed`, `db:bootstrap` (see §2).

There is **no CI**: no `.github/workflows` (or any other CI config) exists in
the repo. Everything in §6 must be run manually or wired into CI first.

---

## 2. Fresh-database bootstrap

**Command:**

```bash
pnpm --filter @sakya/api db:migrate:deploy   # apply migrations
pnpm --filter @sakya/api db:bootstrap        # idempotent shop setup
```

`apps/api/prisma/bootstrap-shop.ts`:

- Reuses the oldest active store, or upserts the `SAKYA-FARMS` store.
- Finds-or-creates the "Bengaluru city" serviceability zone (10 pincodes,
  560001–560103, 1–3 day ETA, COD enabled, shipping fee from env config).
- Opens inventory for every published variant: 100 units per
  variant × store, inserted together with a `PURCHASE` stock movement in a
  single transaction, guarded by the `variantId_storeId` unique constraint.
- **Idempotent** — verified by running it twice: run 1 opened 37 of 195
  existing rows; run 2 opened 0 of 232 (195 + 37). Re-runs never top up
  stock, never duplicate zones or movements.

`db:seed` (catalog seed) is a separate, heavier script; for a bare functional
database `db:migrate:deploy` + `db:bootstrap` is enough.

---

## 3. Payment boundary — verified findings

### 3.1 Production cannot use the mock/simulated payment flow (TRUE)

- `PaymentsService.simulateOutcome` (`payments.service.ts:168`) throws
  `NotFoundException` when `app.env === 'production'`.
- `app.env` maps directly from `NODE_ENV`
  (`config/configuration.ts:98`) — no override path.
- Belt and braces: the MOCK adapter itself is unregistered in production
  (`payments.module.ts` gate), so the webhook route returns 400 and any online
  payment-intent request returns 400 from `providerForMethod`
  (`payments.service.ts:488`: *"Online payments are not enabled yet: no
  provider configured for production"*).

### 3.2 No client path can mark an order paid (TRUE)

Only two write sites advance payment/order money state:

1. **Webhook** (`processWebhookEvent`, `payments.service.ts:309–344`):
   HMAC-SHA256 signature over the raw body (`x-mock-signature`,
   `timingSafeEqual`; empty secret or missing header ⇒ rejected —
   `mock.provider.spec.ts:15–38`). `ManualProvider.verify` always returns
   false (COD emits no webhooks — `manual.provider.spec.ts`). Unknown event →
   404, amount mismatch → 400, currency mismatch → 400, replay → idempotent
   no-op, illegal transition → 409; payment + order mirror written in one
   transaction.
2. **Demo simulate endpoint** (non-production only, see 3.1; must be owned,
   MOCK payment, order `PENDING_PAYMENT`).

`order.paymentStatus` is written **only** in `payments.service.ts` (lines 247,
299, 443) plus the hardcoded `PENDING` at order creation
(`orders.service.ts:215`). The no-op ternary at `orders.service.ts:408`
(`paymentStatus: order.paymentStatus === 'CAPTURED' ? order.paymentStatus :
order.paymentStatus`) is a harmless dead branch — both arms are identical, so
it cannot corrupt state; worth cleaning up but not a security hole.

Client DTOs (`packages/validation`): checkout accepts
`{idempotencyKey, shippingAddress, billingAddress, notes}`, intent
`{orderId, method, idempotencyKey}`, simulate `{outcome}`, cancel `{reason}`,
refund `{amount?, reason}` — **no money or status fields accepted from the
client, anywhere.** Admin/store `paymentStatus` values are list-query *filters*
only; status-update bodies use fulfilment enums validated by
`canTransitionOrder`.

### 3.3 Demo-payments client flag (TRUE — off by default, dev only)

`EXPO_PUBLIC_PAYMENTS_DEMO` is read in exactly one file
(`apps/customer/app/(shop)/checkout.tsx:59`, `=== 'true'`) and used only to
show the UPI/Card rows (:511) and mount `DemoPaymentSheet` (:814). No other
file, no `eas.json`, no `app.config`, and no entry in `apps/customer/.env` —
so the flag is **off even locally** unless explicitly set. The COD row is
always visible and is the real flow.

---

## 4. What is real, mocked, and unimplemented

### Real (works end-to-end today)

- **OTP phone auth** — JWT sessions; MSG91 SMS provider implemented and
  optional. **Demo mode is currently on** (`OTP_DEMO_MODE=true`,
  dev code `1234`) — must be off with real MSG91 creds for production.
- **COD checkout** — order + stock reservation + MANUAL payment record written
  atomically; zone-restricted delivery; idempotency keys.
- **Cart, wishlist, addresses, order history, order cancel, status history.**
- **Reviews**: submit (`prisma.review.create`, defaults `PENDING`),
  product listing (`PUBLISHED` only), eligibility gate (requires `DELIVERED`
  order) — all under `customer-journey`. See gaps below.
- **Returns**: customer file + eligibility + detail routes (`customer-journey`).
- **Push notifications** — real Expo push (`notifications.service.ts:235`).
- **Inventory ledger** with reservations and idempotent release.
- **Pending-order expiry sweep** — every 5 min
  (`order-expiry.service.ts`, `@Cron('*/5 * * * *')`), cancels
  `PENDING_PAYMENT` orders older than `PENDING_ORDER_EXPIRY_MINUTES`
  (default 120, range 15–1440) and releases reservations.
- **Admin/store order management** — list/detail/status patch behind
  roles + permission codes, transitions enforced by `canTransitionOrder`
  (`admin-orders.controller.ts:52`).

### Mocked / demo-only

- **MOCK payment adapter** — non-production only (§3.1). Verified boundary;
  no code change was needed.
- **OTP demo mode** — `OTP_DEMO_MODE=true` in the current `.env`.

### Genuinely unimplemented (scaffolds only)

- **Coupons API** — `coupons.module.ts` is `@Module({})` with a docblock of
  planned endpoints. Permission codes `coupons:read/write` exist in
  `packages/types/permissions.ts` but **no route uses them**. (DB currently
  holds 1 orphan coupon row.) Coupon *redemption accounting* exists on the
  order path, but there is no admin CRUD and no validate/apply endpoint.
- **Review moderation** — reviews are always created `PENDING` and only
  `PUBLISHED` are listed, but **no route ever publishes one** → DB has 0
  reviews; nothing can go live without manual DB edits.
- **Return decisions** — customers can file returns, but there is **no staff
  approve/reject route** → DB has 0 return requests processed.
- `orders.module.ts:3` docblock says admin endpoints are "planned but not
  implemented here" — stale comment; they live in `modules/admin` and do
  exist.
- No email sender; SMS only via optional MSG91.

---

## 5. Known defects found during audit (not yet fixed)

1. **COD orders are auto-cancelled after the payment window.**
   Evidence: a real COD order (`ORD-20260926-C7E1671E`, placed 20:37 UTC) was
   found `CANCELLED` at 22:40 UTC — reason *"Payment was not completed in
   time"* — while its payment correctly remained `PENDING` (COD collects cash
   on delivery and never captures online). Root cause: nothing advances a COD
   order out of `PENDING_PAYMENT` (only a `CAPTURED` webhook does, via
   `mirrorToOrder`, `payments.service.ts:449`), so the expiry sweep
   (`order-expiry.service.ts`) treats every COD order as an abandoned online
   payment. Fix directions: confirm COD orders at placement, exempt
   `CASH_ON_DELIVERY` from the expiry sweep, or have staff confirmation move
   them to `CONFIRMED` before the window closes.
2. **Dead ternary** at `orders.service.ts:408` (both branches identical) —
   cosmetic cleanup.
3. See §7 for test skip conditions (not defects, but easy to mistake for
   coverage).

---

## 6. Operational gaps

- **No CI/CD** — no workflow files; lint/typecheck/tests are manual.
- **No error tracking** — zero Sentry/Bugsnag/Datadog references in the repo.
- **No uptime monitoring** configured anywhere.
- **No release config for the app stores** — no `eas.json` / build profiles.
- **Backups** — the database is a managed Supabase Postgres; nothing in the
  repo documents or asserts a backup policy. Verify in the Supabase project
  settings before launch.
- **Secrets** — no `.env.example` files remain anywhere (removed by request).
  The authoritative key list is `apps/api/src/config/env.validation.ts`
  (validated at boot) for the API, and `EXPO_PUBLIC_API_URL` for the customer
  app. `apps/api/.env` / `apps/customer/.env` are git-ignored.

---

## 7. Sanity checks (Audit task 4) — all green

Run 2026-09-26:

| Check                        | apps/api                        | apps/customer          |
| ---------------------------- | ------------------------------- | ---------------------- |
| `typecheck`                  | 0 errors                        | 0 errors               |
| `lint`                       | 0 errors (19 pre-existing warnings) | 0 errors           |
| `test`                       | 233 passed / 37 skipped (26 files) | 63 passed (6 files) |

**Nothing fails.** Skip conditions to know about:

- API **e2e DB tests are gated**: they run only with `RUN_DB_E2E=1`
  (`describe.skipIf`), otherwise they are part of the 37 skipped.
- Delivery tests include 2 `it.skip` (known, intentional at audit time).
- Customer app: `pnpm --filter @sakya/customer test` (vitest).

Commands:

```bash
pnpm typecheck && pnpm lint && pnpm test        # root (turbo)
cd apps/api && RUN_DB_E2E=1 pnpm test           # include DB e2e
```

---

## 8. Configuration reference (current `.env` values)

**apps/api** — `NODE_ENV`, `DATABASE_URL`, `DATABASE_POOL_MAX`,
`JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`, `THROTTLE_LIMIT` / `THROTTLE_TTL`,
`OTP_DEMO_MODE=true` (+ optional `OTP_DEMO_CODE`), `MSG91_*` (optional),
`LOG_LEVEL`, `TRUST_PROXY`, `CORS_ORIGINS`, `PENDING_ORDER_EXPIRY_MINUTES`
(unset ⇒ 120), optional `COD_FEE_IN_PAISE`.

**apps/customer** — `EXPO_PUBLIC_API_URL` only.

For production launch: `NODE_ENV=production`, `OTP_DEMO_MODE=false` + real
`MSG91_*` credentials, real JWT secrets, `TRUST_PROXY`/`CORS_ORIGINS` set for
the deployed host — and resolve the COD expiry defect in §5.1 first.
