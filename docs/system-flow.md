# System flow — backend + customer app

The complete, current flow of the Sakya Farms platform: what the customer app
does, what the API does, and how money and stock move safely between them.
Every diagram reflects the code as it runs today (Razorpay **test mode**,
Bengaluru-only fresh produce, pull-based payment reconciliation).

**Runtime pieces**

| Piece                                              | Runs as                                        |
| -------------------------------------------------- | ---------------------------------------------- |
| API — `apps/api`                                   | `node dist/main.js` on `:3000`, routes `/api/v1` (build first: `pnpm --filter @sakya/api build`) |
| Customer app — `apps/customer`                     | Expo (dev build / Expo Go / web), `EXPO_PUBLIC_API_URL` points at the API |
| Razorpay                                           | Test keys (`rzp_test_…`), webhook secret on the API, **auto-capture off → the API captures explicitly** |
| PostgreSQL                                         | Single source of truth; only the API talks to it |

---

## 1. Sign-in — phone OTP

```mermaid
sequenceDiagram
    autonumber
    actor C as Customer app
    participant API as Sakya API
    participant MSG as MSG91 (dev: echo code)

    C->>API: POST /auth/otp/send {phone}
    API->>MSG: send 6-digit code (5 min TTL)
    MSG-->>C: SMS code (dev builds echo devCode 1234)
    C->>API: POST /auth/otp/verify {phone, otp}
    API-->>C: {session: access + refresh JWT}
    Note over C: Signed-in state gates cart, addresses, orders.<br/>Each phone number = one account (saved addresses are per-account).
```

---

## 2. Catalog, cart and coupon

```mermaid
sequenceDiagram
    autonumber
    actor C as Customer app
    participant API as Sakya API
    participant DB as PostgreSQL

    C->>API: GET /products, GET /categories
    API-->>C: catalog (server-priced, never client-priced)
    C->>API: GET /cart
    API->>DB: resolve active cart + items + categories
    API-->>C: CartResponse (subtotal, shipping, discount, total — server math)
    C->>API: POST/PATCH/DELETE /cart/items…
    API-->>C: updated CartResponse (written into the ["cart"] query cache)
    Note over C: The cart screen shows a Discount row only.<br/>The coupon field lives on CHECKOUT (Apply → server confirms).
    C->>API: POST /cart/coupon {code}   (from checkout)
    API-->>C: CartResponse with coupon + recomputed totals (or a verbatim API error)
```

---

## 3. Address + serviceability (the "not serviceable" gate)

```mermaid
flowchart TD
    A[Checkout loads] --> B{Signed in?}
    B -- no --> Z[Verify phone screen]
    B -- yes --> C[GET /users/me/addresses<br/>saved book — per phone account]
    C --> D[Cart address pre-selected?<br/>exact normalised match against a saved row]
    D --> E[Delivery card: Add / Change address]
    E --> F[GET /serviceability?pincode&amp;containsFreshProduce]
    F --> G{Basket contains fresh produce?<br/>containsFreshProduce helper over<br/>every item's categorySlugs}
    G -- no --> H["serviceable ✓<br/>Delivery available across India"]
    G -- yes --> I{Pincode 560xxx?<br/>isBengaluruPincode}
    I -- yes --> J["serviceable ✓<br/>About 30 minutes in Bengaluru"]
    I -- no --> K["not serviceable ✗<br/>'try another address' + retry"]
    H --> L[Proceed to payment]
    J --> L
```

The **same rule** is enforced twice so the UI and the order gate can never
disagree:

- UI: `GET /serviceability` (and `POST /serviceability/check`) → `serviceable = !containsFreshProduce || isBengaluruPincode`
- Server: `orders.service` throws *"Fresh fruits and vegetables are currently delivered within Bengaluru only."* before any order row exists.

Fresh-slug detection lives in **one** place: `packages/utils/src/delivery.ts`
(`FRESH_PRODUCE_CATEGORY_SLUGS` + `containsFreshProduce`) — every catalog slug
(`all-fresh`, `sakya-fresh`, `roots-others-copy`, …) is covered and pinned by
regression tests.

---

## 4. Checkout → order placement

```mermaid
sequenceDiagram
    autonumber
    actor C as Customer app (checkout.tsx)
    participant API as Sakya API
    participant DB as PostgreSQL

    C->>API: POST /orders {idempotencyKey, shippingAddress{postalCode…}, notes}
    API->>API: validate: cart non-empty, store open,<br/>serviceability (fresh → 560xxx), totals from server cart
    API->>DB: ONE transaction: order PENDING_PAYMENT<br/>+ stock reservation + cart → CONVERTED
    API-->>C: OrderResponse (201, idempotent: same key → same order)
    Note over C: Pay-Now retries reuse createdOrderRef —<br/>a retry can never double-place an order.
```

- Stock is **reserved** with the order and held for `PENDING_ORDER_EXPIRY_MINUTES` (120 min).
- `shippingAddress.postalCode` is the field name (not `pincode`), endpoint is `POST /orders`.
- COD stops here (section 5a). Online methods continue to the payment intent.

---

## 5. Payment — the money flow

### 5a. Cod — anchored, settled on delivery

```mermaid
flowchart LR
    O[Order PENDING_PAYMENT] --> M["Payment MANUAL / PENDING<br/>(pay-on-delivery anchor)"]
    M --> D[Order delivered] --> P[Payment collected &amp; recorded]
    Note1["Expiry sweep NEVER touches COD:<br/>it matches on method CASH_ON_DELIVERY + PENDING"]
```

### 5b. Online (UPI / Card) — intent, gateway, capture

```mermaid
sequenceDiagram
    autonumber
    actor C as Customer app
    participant API as Sakya API
    participant RZ as Razorpay (test mode)
    participant DB as PostgreSQL

    C->>API: POST /payments/intent {orderId, method, idempotencyKey}
    API->>DB: Payment row PENDING (amount from the ORDER, never the client)
    API->>RZ: POST /v1/orders (amount, receipt = payment id)
    RZ-->>API: order_xxx
    API->>DB: providerOrderId = order_xxx
    API-->>C: {payment, intent{key, order_id, amount}}

    note over C: Surface picked by platform — same gateway order, three doors:<br/>• native SDK (dev build: react-native-razorpay)<br/>• in-app WebView sheet (Expo Go: RazorpaySheetHost)<br/>• browser popup (web)
    C->>RZ: checkout.js opens with order_xxx
    C->>RZ: Customer pays (test UPI / test card)
    RZ-->>C: sheet closes (hint only — never proof)
    C->>API: GET /payments/orders/:id  ← polls while PENDING or AUTHORIZED
```

### 5c. Confirmation — three paths to CAPTURED

```mermaid
flowchart TD
    S[Gateway payment exists for order_xxx] --> W[PATH 1 — Webhook<br/>POST /payments/webhook/razorpay<br/>HMAC signature verified]
    S --> P[PATH 2 — Pull reconcile<br/>order screen polls GET /payments/orders/:id<br/>every 1.5s × 20 while unresolved]
    S --> X[PATH 3 — Expiry sweep<br/>every 5 min, before cancelling anything]

    W --> M[processWebhookEvent — the ONE state machine]
    P --> R[reconcilePayment: ask Razorpay<br/>orders/:id/payments]
    X --> R

    R --> Q{Gateway says}
    Q -- captured --> M
    Q -- authorized --> CP["capturePayment() → POST /payments/:id/capture<br/>(auto-capture is OFF; authorization would otherwise expire)"]
    CP --> R2[re-read status] --> M
    Q -- nothing decisive / unreachable --> N[return null — read still succeeds,<br/>next tick retries; AUTHORIZED money is NEVER cancelled]

    M --> T{Payment transition}
    T -- PENDING/AUTHORIZED → CAPTURED --> U[Payment CAPTURED + order CONFIRMED<br/>OrderStatusHistory + customer push]
    T -- → FAILED --> V[Order FAILED (retryable attempt kept on same gateway order)]

    U --> Z[Client sees captured row → navigates / banner "Order confirmed"]
```

Rules that make this safe:

- **One state machine.** Webhook, pull-reconcile and sweep all funnel through
  `processWebhookEvent` — amount/currency cross-check, replay handling,
  transition guard, order mirroring, notifications, identical in every path.
- **Nothing is invented locally.** The gateway's own answer (`fetchPaymentStatus`)
  is the only authority; a sheet closing is only a hint.
- **Authorized ≠ done.** `reconcilePayment` captures an authorization
  immediately (Razorpay auto-capture is off by default) and re-reads; a failed
  capture keeps the authorization and retries next poll/sweep.
- **No webhook needed in dev.** Razorpay cannot reach `localhost`, so path 2
  is what confirms test payments on a dev machine — the client polls, the
  server reconciles and captures.
- **Client polling stops only when resolved:** `paymentStatus` ∈ {PENDING,
  AUTHORIZED} → poll; CAPTURED/FAILED → stop. The UI never self-declares success.

---

## 6. Pending-order expiry sweep (money-safety critical)

```mermaid
flowchart TD
    CRON["Cron every 5 min<br/>orders PENDING_PAYMENT older than 120 min"] --> Q{COD anchor present?<br/>method=CASH_ON_DELIVERY + PENDING}
    Q -- yes --> SKIP1[Skip — COD is pending by design]
    Q -- no --> A{Any CAPTURED payment row?}
    A -- yes --> HEAL[Auto-heal: replay captured event<br/>→ order CONFIRMED, never cancelled]
    A -- no --> G{Gateway order exists?}
    G -- yes --> REC[reconcilePayment — ask Razorpay<br/>and CAPTURE if only authorized]
    REC -- money found --> KEEP1[Leave order alone]
    REC -- no answer --> AU{AUTHORIZED row in DB?}
    G -- no --> AU
    AU -- yes --> KEEP2[Re-apply authorized event (no-op)<br/>order survives; next tick retries]
    AU -- no --> CANCEL[Cancel order + write status history<br/>+ release stock reservation]
```

Never-cancel invariants: COD is skipped, captured money auto-heals, an
unreachable gateway skips the run, and AUTHORIZED money survives every run —
a wrong cancellation cannot be undone by waiting.

---

## 7. Order lifecycle (server-authoritative)

```mermaid
stateDiagram-v2
    [*] --> PENDING_PAYMENT: POST /orders (+ stock reservation)
    PENDING_PAYMENT --> CONFIRMED: payment captured (any of the 3 paths)
    PENDING_PAYMENT --> CANCELLED: customer cancel / expiry sweep / payment failed
    PENDING_PAYMENT --> FAILED: payment failed
    CONFIRMED --> PROCESSING
    PROCESSING --> PACKED
    PACKED --> READY_FOR_PICKUP
    PACKED --> OUT_FOR_DELIVERY
    READY_FOR_PICKUP --> DELIVERED
    OUT_FOR_DELIVERY --> DELIVERED
    OUT_FOR_DELIVERY --> FAILED
    FAILED --> CANCELLED
    DELIVERED --> REFUNDED: return accepted
    CONFIRMED --> CANCELLED: store/admin cancel
    PROCESSING --> CANCELLED
    PACKED --> CANCELLED
    READY_FOR_PICKUP --> CANCELLED
```

- Transitions are validated against `ORDER_STATUS_TRANSITIONS`
  (`packages/types/src/statuses.ts`) — a request body can never set a status
  directly; every write appends `OrderStatusHistory`.
- The order detail screen polls while the order is active (15 s) and
  additionally polls **payment rows** for a freshly placed online payment.

---

## 8. Where each flow lives in code

| Flow                          | Backend                                                        | Customer app                                                        |
| ----------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------- |
| OTP auth                      | `apps/api/src/modules/auth`                                     | `app/(auth)/*`, `src/stores/auth-store.ts`                          |
| Catalog / cart / coupon       | `modules/cart`, `modules/catalog`                              | `app/(shop)/components/AuthenticatedCartScreen.tsx`, checkout coupon card |
| Addresses                     | `modules/users` (`/users/me/addresses`)                        | `src/components/checkout/AddressPickerSheet.tsx`, `AddressSheet.tsx` |
| Serviceability (fresh rule)   | `modules/customer-journey`, gate in `modules/orders`           | `checkout.tsx` delivery card, `packages/utils/src/delivery.ts`       |
| Order placement               | `modules/orders/orders.service.ts`                             | `app/(shop)/checkout.tsx` (`handlePlaceOrder`, idempotent)          |
| Payment intent + webhooks     | `modules/payments` (service, webhook controller, providers)    | `src/lib/razorpay-checkout.ts`, `RazorpaySheetHost.tsx`             |
| Pull reconcile + capture      | `payments.service.listForOrder` / `reconcilePayment`           | `orders/[id].tsx` `useFreshOrderPolling`                            |
| Expiry sweep                  | `modules/orders/order-expiry.service.ts`                       | — (server-driven)                                                   |
| Order tracking                | `modules/orders` (status history)                              | `orders/[id].tsx`, `src/lib/order-tracking.ts`                      |

Related docs: [`payments-setup.md`](./payments-setup.md) (gateway credentials
and webhook setup), [`api-conventions.md`](./api-conventions.md) (envelopes and
errors), [`handoff.md`](./handoff.md) (project state and known gaps).
