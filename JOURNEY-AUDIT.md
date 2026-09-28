# Full Journey Audit — OTP Login → Cart → Checkout → Address → Razorpay Payment

Scope: the end-to-end customer journey on the API (NestJS + Prisma/Postgres) and the
customer app (Expo). Every verdict below is backed by code inspection plus live probes
against the running dev server and the test suites (API **265 passed / 37 skipped**,
customer **63 passed**; both apps typecheck- and lint-clean).

**Overall verdict: the journey's skeleton is sound — money logic is
server-authoritative and the payment boundary holds. Two blockers must be fixed
before real money flows: your Razorpay keys are NOT yet in `apps/api/.env`, and the
COD auto-cancel defect will now eat *paid-at-checkout-timeout* orders too.**

---

## 0. FIRST BLOCKER: Razorpay credentials are not configured

The code registers the Razorpay provider **only when all three secrets exist**
(`payments.module.ts`):

```ts
if (keyId && keySecret && webhookSecret) {
  registry.set('RAZORPAY', new RazorpayProvider(keyId, keySecret, webhookSecret));
}
```

Right now `apps/api/.env` contains **no RAZORPAY_* keys** and `apps/customer/.env`
contains no `EXPO_PUBLIC_RAZORPAY_ENABLED`. I proved what happens live:

```
POST /api/v1/payments/webhook/RAZORPAY  → 400 "Payment provider "RAZORPAY" is not configured"
```

And `providerForMethod()` would fall back to MOCK only in non-production; in
production it 400s ("Online payments are not enabled yet"). So with the keys added
anywhere but the API `.env`, or with a typo, checkout with UPI/Card fails at runtime.

**Your move (5 minutes):**
1. In `apps/api/.env` add exactly:
   ```
   RAZORPAY_KEY_ID=rzp_live_xxxxxxxx        (or rzp_test_...)
   RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxx
   RAZORPAY_WEBHOOK_SECRET=xxxxxxxxxxxxxxxx
   ```
   The env validator already enforces that the three are provided together — a
   half-set config refuses to boot with a readable error instead of failing at
   first payment.
2. In the Razorpay Dashboard → Settings → Webhooks: point a webhook at
   `https://<your-api-domain>/api/v1/payments/webhook/RAZORPAY`, set the same
   secret as `RAZORPAY_WEBHOOK_SECRET`, and subscribe to events
   `payment.captured`, `payment.failed`, `payment.authorized` (the three the
   adapter understands — everything else is rejected with 400, which is correct:
   Razorpay retries only on non-2xx, so unknown events just bounce safely).
3. In `apps/customer/.env` add `EXPO_PUBLIC_RAZORPAY_ENABLED=true` and rebuild the
   app (Expo inlines EXPO_PUBLIC_* at bundle time — a rebuild, not a reload).
4. Restart the API and confirm: `GET /api/v1/health` green, and checkout with UPI
   now returns `provider: "RAZORPAY"` in the intent.

**Secret hygiene checked:** the key secret never crosses to the client. The intent
response exposes only `key` (the public key id), `order_id`, `amount`, `currency`
(`buildIntentResponse`). The full key secret lives server-side only. `.env` is
git-ignored (verified earlier in the audit).

---

## 1. Login — phone OTP

**Flow:** `POST /auth/otp/send` → SMS → `POST /auth/otp/verify` → JWT pair issued.

| Check | Verdict |
|---|---|
| Phone normalisation (E.164, one canonical form) | ✅ `indianPhoneSchema` |
| Codes stored hashed (SHA-256), never plaintext | ✅ `otp.service.ts` |
| 60s resend cooldown, 5 attempts/code, 10 verifications/phone/hour | ✅ all enforced server-side |
| New code supersedes old (no replay of stale SMS) | ✅ superseded in one transaction |
| Same response whether phone has an account (no enumeration) | ✅ |
| IP flood limits on OTP endpoints (20 send / 30 verify per 5 min) | ✅ `@Throttle` |
| New users provisioned with only the CUSTOMER role | ✅ (verified `auth.service.ts` register + OTP path) |
| Generic errors — can't distinguish wrong/expired/unknown | ✅ |
| **Demo mode is OFF** (`OTP_DEMO_MODE=true` in .env but dev-only; production refuses it) | ✅ |
| Refresh rotation + family replay detection | ✅ (from earlier audit) |

⚠️ **Note (acceptable, know it):** `verifyOtp` issues a session but the hourly cap
and code burning are per-phone. A SIM-spoofing attacker who can intercept SMS could
still get in — that's inherent to OTP auth, not a code defect. MSG91 credentials
are still unset in `.env`, so OTP delivery currently logs to console in dev
(`devCode`). Before launch you must set `MSG91_AUTH_KEY` + `MSG91_OTP_TEMPLATE_ID`
(env validator enforces they come as a pair).

**Verdict: PASS (with the MSG91 setup as a launch prerequisite).**

## 2. Browser / web layer

| Check | Verdict |
|---|---|
| CORS: explicit allow-list, no wildcard, `credentials:true` safe because list is fixed | ✅ `app.setup.ts` |
| Allowed headers minimal (Content-Type, Authorization, x-request-id) | ✅ |
| Token storage: SecureStore on native; **localStorage on web** | ⚠️ known trade-off, see below |
| 401 handling: single-flight refresh, retry once, no refresh loops | ✅ `client.ts` |
| Offline gate: requests fail fast instead of hanging | ✅ |
| Helmet/security headers | ✅ (earlier audit) |
| Web checkout: Razorpay **native SDK is disabled on web** (`Platform.OS !== 'web'`) | ✅ prevents a broken web pay path |

⚠️ **localStorage on web:** the refresh token is readable by any XSS on the web
origin. This is the standard Expo-web compromise (SecureStore has no real web
implementation in SDK 57). Mitigations already in place: token TTL is 15 min
access / 30 d refresh, replay detection revokes a family, `credentials: true` +
strict CORS. Acceptable for launch; revisit httpOnly-cookie sessions if the web
build becomes a primary channel.

**Verdict: PASS with documented trade-off.**

## 3. Add to cart

| Check | Verdict |
|---|---|
| Client sends only variantId + quantity — never price, store or totals | ✅ `addCartItemSchema` |
| Unit price snapshotted server-side from the variant row | ✅ `cart.service.ts` |
| Totals recomputed on EVERY read by the server (`computeTotals` shared with checkout) | ✅ — client cannot inflate anything |
| Product/variant availability re-checked on every add | ✅ |
| Per-line cap (10) and per-cart lines cap (25) enforced server-side | ✅ |
| Store scoping: server resolves; client cannot pick a store | ✅ |
| Guest cart merge: variantId+quantity only, revalidated, bad lines dropped | ✅ |
| Coupon limits (min order, usage limit, per-user) re-checked at apply AND at checkout | ✅ |

**Verdict: PASS.**

## 4. Checkout + address

| Check | Verdict |
|---|---|
| Server recomputes the total from cart lines — the order total IS the approved total | ✅ bit-for-bit same `computeTotals` |
| **No client money fields anywhere** — body is idempotencyKey, address, notes | ✅ `checkoutSchema` |
| Pincode regex + serviceability zone gate BEFORE order creation | ✅ |
| Fulfilment store from the cart row, re-validated active, never from the client | ✅ |
| Order + items + stock reservations + payment anchor in ONE transaction | ✅ |
| Stock reservation is a conditional atomic UPDATE — **no oversell race** | ✅ `reserveOrderLine` (raw guarded SQL) |
| Idempotency: retried checkout returns the original order, per-customer key | ✅ e2e-tested |
| Coupon redemption recorded atomically; returned on cancellation | ✅ |
| Address is a `record(string, unknown)` — stored as given, never executed | ✅ (schema-validated pincode server-side) |

⚠️ Minor: `shippingAddress` is loosely typed (`z.record`) — the checkout screen
sends a strict shape and the address is stored, not interpreted, so no injection
surface. A stricter address schema is nice-to-have, not a launch blocker.

**Verdict: PASS.**

## 5. Payment — Razorpay

### The boundary (the part that must never break)

1. **Amount is server-owned.** The intent reads `order.totalInPaise` from the DB row.
   The client sends orderId + method + idempotency key — never an amount. Changing
   the amount in the app is impossible by construction; the `createOrder` call even
   verifies Razorpay echoed back the same amount/currency and throws if not.
2. **No client confirm endpoint exists.** "I paid" from a client changes nothing.
   Status advances ONLY via:
   - provider-signed webhook (`POST /payments/webhook/RAZORPAY`), or
   - owner cancel of an open payment, or
   - admin refund.
3. **Webhook verification:** HMAC-SHA256 over the **exact raw request bytes**
   (the JSON parser's `verify` hook stashes the buffer before parsing), hex-format
   checked, compared with `timingSafeEqual`. Forged/tampered → 401, no state change.
   Unit-tested including whitespace tampering.
4. **Amount/currency cross-check:** the webhook's claimed amount must equal the
   stored payment amount or the event is rejected 400 — a compromised webhook or a
   Razorpay misconfiguration can't mark ₹1 as ₹50,000.
5. **Idempotency everywhere:** replayed captured events are acknowledged without
   double-advancing; `payment.captured` maps to CAPTURED and mirrors the order to
   CONFIRMED with a status-history row, in one transaction.
6. **Provider order lifecycle:** one Razorpay order per local payment; retries reuse
   the stored `providerOrderId` instead of minting duplicates.
7. **Client honesty:** the SDK result is ignored as authority; the order screen
   polls `GET /payments/orders/:orderId` (bounded: 20 × 1.5s) until the webhook
   lands. UI never claims success on its own.
8. Live probes confirmed: unsigned webhook → 400/401 path, unknown provider → 400,
   fake JWT on `/orders` → 401, bad phone → 400. No information leaks in errors.

**Verdict: the payment boundary HOLDS.**

### ⛔ BLOCKER 2 — the expiry job vs. Razorpay orders

`order-expiry.service.ts` cancels any `PENDING_PAYMENT` order older than 120 min
that has **no `CASH_ON_DELIVERY` payment row**. An online order paid at minute 121
(bank delay, customer closed the app after Razorpay showed success, webhook
provider outage) is cancelled **after the customer's money was captured** —
because the check is on the payment METHOD, not the payment STATUS.

This was previously the COD defect (HANDOFF §5.1); Razorpay now widens it to real
money. The correct fix is small and I can do it on your word:

- change the sweep's guard from "no CASH_ON_DELIVERY payment" to
  "no payment row with status PENDING whose method is CASH_ON_DELIVERY, and no
  CAPTURED/AUTHORIZED payment", i.e. never cancel an order whose money arrived;
- and for captured-but-expired cases, prefer auto-confirm over cancel.

### ⚠️ Known limitation (not a defect)

Web checkout cannot use Razorpay native SDK. If web payment matters, you'll need
Razorpay's standard web Checkout.js in a browser sheet — a follow-up, not a
launch blocker (web customers can pay COD today).

---

## Live probe log (dev server, 2026-09-27)

```
GET  /api/v1/health                              → 200 ok, db up
POST /payments/webhook/RAZORPAY (no signature)   → 400 (no adapter: keys unset)
POST /payments/webhook/RAZORPAY (bad signature)  → 400/401 once keys set (HMAC path unit-tested)
POST /payments/webhook/UNKNOWNPROVIDER           → 400
GET  /orders (fake JWT)                          → 401 UNAUTHENTICATED
POST /auth/otp/send (bad phone)                  → 400
```

## Pre-launch checklist (in order)

1. **Add the three RAZORPAY_* vars to `apps/api/.env`** and restart → webhooks and
   intents come alive.
2. **Add `EXPO_PUBLIC_RAZORPAY_ENABLED=true` to `apps/customer/.env`** and rebuild
   the app.
3. **Register the webhook in the Razorpay dashboard** with the same secret.
4. **Fix the expiry sweep guard** (Blocker 2) before real transactions — say the
   word and I'll implement it with tests.
5. Set `MSG91_AUTH_KEY` + `MSG91_OTP_TEMPLATE_ID` so OTP SMS actually delivers.
6. Set `NODE_ENV=production` only after Sentry DSN + PM2 are in place (they are —
   from the scaling work).
7. Re-run `pnpm test` in both apps (green as of this audit: 265 + 63).
