# Performance Audit — Sakya Farm App

**Date:** 2026-10-03 · **Scope:** DB connections, API hot paths, client refresh UX, bundle/assets

## 1. Database / connection layer (Phase 20)

- All Prisma usage flows through the single `PrismaService` using `@prisma/adapter-pg` with an explicit pool (`DATABASE_POOL_MAX`).
- **Fixed (IR-007):** `PrismaPg` now sets `keepAlive: true`, `keepAliveInitialDelayMillis: 30_000`, `connectionTimeoutMillis: 10_000`, `idleTimeoutMillis: 30_000` — defends against the historical Postgres **P1017** ("server has closed the connection") when idle sockets are reaped by firewall/NAT.
- No raw `pg.Client` anywhere; interactive transactions are sequential (no `Promise.all` on a tx client), so pool slots are never nested.
- Verified after change: full API suite green including 35 DB-backed e2e tests against the remote DB.

## 2. Concurrency cost of checkout hardening (IR-002/003)

The added `FOR UPDATE` cart lock, under-lock replay re-check, and atomic coupon claim each run **inside the existing single transaction** — they add 3–4 round trips to a flow that already performs order/items/payment/reservation writes. Contention is scoped to one cart row (per-user), so the lock serializes only duplicate attempts of the *same* checkout, which is the intent. e2e timings observed: checkout ≈ 3–7 s against the **remote** Supabase pooler (network-dominated, not lock-dominated); expect far lower against a co-located production DB.

## 3. API responses observed in e2e runs (remote DB, p50-ish from logs)

| Route | Response time |
|---|---|
| `GET /products?page&limit` (cold) | ~6.0 s (first hit, remote, no cache warm) |
| `GET /products` (warm) | ~0.3–0.6 s |
| `POST /cart/items`, `GET /cart` | ~0.3–4.6 s |
| Auth OTP send/verify | ~0.3–1.9 s |

The cold `GET /products` at ~6 s is a **remote-DB + cold-cache artifact of this session**; a catalog cache layer exists (`catalog-cache.service`). Worth re-measuring co-located before launch — flagged as a manual verification item.

## 4. Client (Phase 24)

- **Fixed (IR-010):** home pull-to-refresh now awaits both refetches (`Promise.all`) inside try/finally — no premature spinner dismissal / race between the two queries.
- Categories tab already awaited correctly (verified, no change needed).

## 5. Bundle & assets (IR-016 — open)

Measured from `expo export` output:

- Web JS entry: **5.2 MB** (single bundle, dev-flag-stripped production export)
- Android Hermes bundle: **7.8 MB** bytecode
- Largest images (PNG, in-repo): `header-bg.png` 2.2 MB, `checkout-header.png` 1.9 MB, `cart-header.png` 1.8 MB, `profile-header.png` 1.6 MB, `gourds-local-veg.png` 1.2 MB — several more in the 400–750 KB range.

**Assessment:** the 1–2 MB header PNGs are the biggest low-hanging fruit (convert to WebP/AVIF at display size, ideally via `expo-image` + CDN). Not changed in this pass: asset replacement alters product visuals and needs design sign-off; recorded as P3 in ISSUE_REGISTER with the measurement as evidence.

## 6. Background jobs

- Pending-order expiry sweep (120-minute cadence, confirmed at boot: `Pending-order expiry active: 120 minutes`) is a single scheduled query — reviewed, no change needed.
- Inventory release/deduct paths sorted by `variantId` to avoid deadlock stalls under load (IR-004).

## 7. Summary

| Item | Status |
|---|---|
| P1017 keepalive | ✅ Fixed (IR-007) |
| Checkout lock overhead | ✅ Bounded, inside existing tx, e2e-timed |
| Pull-to-refresh race | ✅ Fixed (IR-010) |
| Cold catalog query / remote latency | ⚠️ Re-measure co-located (manual) |
| Oversized PNG assets / bundle size | ⚠️ Open P3 (IR-016) |
