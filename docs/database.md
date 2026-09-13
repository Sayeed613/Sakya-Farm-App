# Database and domain model

PostgreSQL, accessed only through Prisma, only from the API. `apps/api/prisma/schema.prisma`
is the definition; this document explains the rules behind it.

## The rules

1. **Money is integer paise.** Every amount is `*InPaise Int`. Never `Float`, never
   `Decimal` for currency, never rupees. `0.1 + 0.2 !== 0.3` is not an acceptable
   property for a total. Display formatting happens at the edge, via
   `formatPaise` from `@sakya/utils`.
2. **Internal keys are UUIDs.** Source identifiers (Shopify product/variant/image
   ids, handles) are stored as metadata columns and are never primary keys. That
   keeps our identity stable if the source store is ever rebuilt.
3. **Product and variant are separate.** A product groups; a variant is what a
   customer buys. Price, SKU, barcode and weight live on the variant.
4. **Inventory is per (variant, store).** `inventory` holds the current balance;
   `inventory_movements` is an append-only ledger with a signed `quantity_delta`
   and the resulting `quantity_after`. Corrections are new rows — movements are
   never updated or deleted, so the history is always reconstructable.
5. **Availability is not stock.** `is_available` (products, variants) says whether
   the item is offered; `inventory` says how many exist. A product can be available
   with zero stock (backorder) or stocked but not for sale. Nothing derives one
   from the other.
6. **Timestamps everywhere, except where mutation is forbidden.** Ledger entries,
   audit logs, status history and order items have `createdAt` only; adding
   `updatedAt` would imply they can change.
7. **Foreign keys are deliberate.** Cascades are used where a child cannot exist
   without its parent (order items, cart items, product images). `Restrict` protects
   records that carry financial meaning (an order keeps its payments and its
   movements). A category's parent uses `SetNull` so deleting a branch cannot
   delete its children.
8. **Unique constraints encode business facts**, not just tidiness:
   `(source_platform, source_product_id)` and `(source_platform, source_handle)`
   make duplicate products from one source impossible; `(variant_id, store_id)`
   makes stock unambiguous; `(user_id, product_id)` limits reviews; `order_id` on a
   coupon redemption makes a retried order safe.
9. **Server-computed money.** Order and cart totals are columns the server writes.
   No endpoint accepts a price, discount, tax, shipping or total from a client.
10. **Order status is a state machine.** Transitions are declared in
    `ORDER_STATUS_TRANSITIONS` (`@sakya/types`) and enforced in the service layer;
    every change writes an `order_status_history` row naming the actor and reason.
11. **Order items are snapshots.** They carry copies of the product title, variant
    title and SKU at purchase time, so editing the catalog never rewrites history.
12. **Secrets are hashed.** `refresh_tokens.token_hash` stores a hash, never the
    token: a database leak must not hand over live sessions. `users.password_hash`
    is Argon2id.

## Tables

| Group          | Tables                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------ |
| Identity       | `users`, `roles`, `permissions`, `user_roles`, `role_permissions`, `refresh_tokens`, `addresses` |
| Catalog        | `categories`, `products`, `product_variants`, `product_images`, `product_categories`             |
| Stores & stock | `stores`, `store_staff`, `inventory`, `inventory_movements`                                      |
| Cart           | `carts`, `cart_items`                                                                            |
| Orders         | `orders`, `order_items`, `order_status_history`, `payments`, `shipments`, `delivery_assignments` |
| Engagement     | `coupons`, `coupon_redemptions`, `reviews`, `notifications`                                      |
| Oversight      | `audit_logs`                                                                                     |

## Roles and permissions

Roles are rows, not a hard-coded enum in application logic. Each role is a named
bundle of permissions (`resource:action`), seeded by `prisma/seed.ts` from the
single vocabulary in `packages/types/src/permissions.ts`.

The API checks **permissions**, not roles, for business endpoints. Editing a role's
bundle therefore changes what operators can do without a code change, and the
change is data that can be audited.

| Role               | Roughly                                                |
| ------------------ | ------------------------------------------------------ |
| `CUSTOMER`         | Own cart, own orders, published reviews                |
| `STORE_STAFF`      | Read a store's catalog, adjust stock, process orders   |
| `STORE_MANAGER`    | The above plus transfers, dispatch assignment, coupons |
| `DELIVERY_PARTNER` | Own assignments                                        |
| `SUPPORT_AGENT`    | Read orders and users, cancel orders, moderate reviews |
| `ADMIN`            | Everything except editing the permission catalogue     |
| `SUPER_ADMIN`      | Everything, and bypasses individual permission checks  |

## Migrations

```bash
pnpm --filter @sakya/api db:migrate        # prisma migrate dev (creates + applies)
pnpm --filter @sakya/api db:migrate:deploy # apply committed migrations (CI/production)
pnpm --filter @sakya/api db:seed           # roles and permissions only
```

`prisma migrate dev` and `migrate reset` no longer run `prisma generate` or the
seed automatically in Prisma 7, so the scripts in `apps/api/package.json` are
explicit about each step.
