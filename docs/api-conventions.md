# API conventions

## Versioning

Every route is served under `/{API_PREFIX}/v{API_VERSION}`, so today everything is
`/api/v1/...`. Versioning is in the path so a future `/api/v2` can run alongside v1
instead of breaking clients that cannot be updated in lockstep.

| Route                                                                                                                                                | Purpose                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `/api/v1/health`                                                                                                                                     | Liveness **and** database reachability           |
| `/api/v1/auth`                                                                                                                                       | Sign-in, refresh, sign-out (not implemented yet) |
| `/api/v1/users`, `/products`, `/categories`, `/cart`, `/orders`, `/inventory`, `/stores`, `/delivery`, `/payments`, `/coupons`, `/reviews` | Feature surfaces, added module by module         |
| `/api/v1/admin/products`                                                                                                                               | Admin product management (products:read, products:write)        |
| `/api/v1/admin/categories`                                                                                                                              | Admin category management (categories:read, categories:write)   |
| `/api/v1/admin/orders`                                                                                                                               | Admin order management (orders:read, orders:update:status)      |
| `/api/v1/admin/customers`                                                                                                                              | Admin customer management (customers:read)                      |
| `/api/v1/admin/users`                                                                                                                               | Admin user management (users:read, users:manage)                |
| `/api/v1/admin/inventory`                                                                                                                              | Admin inventory management (inventory:read, inventory:adjust)   |
| `/api/v1/admin/shipments`                                                                                                                              | Admin shipment management (delivery:read)                      |
| `/api/v1/admin/assignments`                                                                                                                            | Admin delivery assignment management (delivery:read, delivery:assign, delivery:update:status) |
| `/api/v1/admin/stores`                                                                                                                                | Admin store management (stores:read, stores:write)                    |
| `/api/v1/admin/stores/:storeId/staff`                                                                                                                 | Admin store staff management (stores:read, stores:staff:manage)      |
| `/api/v1/stores/:storeId/orders`                                                                                                                       | Store-facing order management (orders:read:store, orders:update:store) |
| `/api/v1/stores/:storeId/inventory`                                                                                                                   | Store-facing inventory management (inventory:read, inventory:adjust)  |

## Responses

Successful requests return the resource directly, or a paginated envelope:

```json
{
  "items": [],
  "meta": { "page": 1, "perPage": 20, "total": 0, "totalPages": 1, "hasNextPage": false, "hasPreviousPage": false }
}
```

Failures always use one shape, produced by the global exception filter:

```json
{
  "success": false,
  "statusCode": 400,
  "code": "VALIDATION_FAILED",
  "message": "Request validation failed (2 issues)",
  "issues": [
    { "path": "quantity", "message": "Quantity must be a whole number" },
    { "path": "items.0.variantId", "message": "Must be a valid UUID" }
  ],
  "requestId": "0f2f1c1e-...",
  "path": "/api/v1/cart/items",
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

`code` is a stable machine-readable value (`@sakya/types` → `API_ERROR_CODES`) so
clients branch on it rather than on the message text. Invalid input is a 400 with
every failing field listed; a 500 never describes the internal failure.

## Correlating a problem

Every response carries an `x-request-id` header, echoed as `requestId` in error
bodies and included in every log line. A caller-supplied `x-request-id` is honoured
when it looks like a safe token, so a client can propagate its own trace id.

## Authentication

Bearer tokens in the `Authorization` header (`session: false` — sessions are not
cookie-based, because the primary clients are mobile apps).

```
Authorization: Bearer <access token>
```

- **Access tokens** are short-lived (`JWT_ACCESS_TTL`, default 15m) and signed with
  `JWT_ACCESS_SECRET`. They carry only `sub` (user id), `typ: "access"` and the
  session id; nothing about roles.
- **Refresh tokens** are long-lived (`JWT_REFRESH_TTL`) and signed with a separate
  secret. Only a hash of each token is stored, grouped by family so that replaying a
  superseded token can revoke the whole chain.
- **Roles and permissions are read from the database per request**, so revoking
  access takes effect immediately rather than when the token expires.

## Authorisation

Authentication is global; endpoints opt out with `@Public()`. Authorisation is
applied per route:

```ts
@Permissions('products:write')          // every listed permission is required
@Roles('ADMIN', 'SUPER_ADMIN')          // at least one listed role

@Get('mine')
listMine(@CurrentUser('id') userId: string) {}
```

Prefer `@Permissions` for business endpoints: checking the capability stays correct
when a role's bundle is edited. `SUPER_ADMIN` bypasses permission checks. A denied
request is a 403 that does not disclose which permission was missing.

## Validation

Request bodies, queries and params are validated with Zod schemas from
`@sakya/validation`, so the API and the client apps enforce the same rules:

```ts
@Get()
list(@Query(new ZodValidationPipe(paginationQuerySchema)) query: PaginationQuery) {}
```

A handler only ever sees parsed output — defaults applied, coercions done, unknown
keys stripped. That last property is a control, not a convenience: a client cannot
smuggle an unexpected `priceInPaise` field past validation into a handler.

## Rate limiting

Applied globally (`THROTTLE_LIMIT` per `THROTTLE_TTL_SECONDS`, per client IP).
Storage is in-memory, so limits apply per process; a shared store is required
before running multiple instances. Exceeding a limit returns `429` with
`code: "RATE_LIMITED"`.

## Health

`GET /api/v1/health` returns `200` only when the process is up **and** a `SELECT 1`
round trip to PostgreSQL succeeds. When the database is unreachable it returns
`503` with `status: "degraded"`, so a load balancer stops routing traffic instead of
serving errors.
