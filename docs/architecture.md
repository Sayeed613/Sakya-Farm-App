# Architecture

## Shape

```
Customer app ─┐
Store app ────┤
Delivery app ─┼──►  REST API (/api/v1)  ──►  NestJS  ──►  Prisma  ──►  PostgreSQL
Admin panel ──┘
```

Clients talk to the REST API and nothing else. There is no client-side database
access, no ORM in a mobile app, and no shared database credentials outside the
backend. The `store/`, `delivery/`, `customer/` and `admin/` apps do not exist
yet; the API is being built first so that they are written against a real
contract rather than invented fixtures.

## Monorepo

```
sakya-farms/
├── apps/
│   └── api/                NestJS + Prisma — the only deployable right now
├── packages/
│   ├── types/              Roles, statuses, error codes, money type
│   ├── validation/         Zod schemas (requests + the catalog contract)
│   └── utils/              Pure helpers (paise arithmetic, slugs, pagination)
├── migration/              Scraped data pipeline (see migration/README.md)
├── infrastructure/         Deployment assets — not built yet
└── docs/
```

`packages/*` are built to `dist/` and consumed as real workspace dependencies, so
the API cannot import a package it has not declared. Turborepo orders the builds;
`turbo run build` builds the packages before the API.

## The request path

```
Express
 └── helmet + CORS + request id        (main.ts)
      └── pino-http structured logging (AppModule)
           └── ThrottlerGuard          rate limit before any real work
                └── JwtAuthGuard       authenticate unless @Public()
                     └── RolesGuard    @Roles(...)
                          └── PermissionsGuard  @Permissions(...)
                               └── controller → service → PrismaService
                                    └── AllExceptionsFilter   one error shape
```

Three consequences worth knowing:

- **New endpoints are protected by default.** They opt out of authentication with
  `@Public()`, which is a deliberate, visible act.
- **Authorisation is never decided in a client.** A hidden button is not a control.
- **Every failure has one shape.** There is a single exception filter, so there is
  no ambiguity about which filter wins.

## Configuration

Environment variables are validated once at boot (`src/config/env.validation.ts`)
and the process exits with a readable report if anything is missing. Exactly one
module reads `process.env`; everything else asks `ConfigService`. In production the
presence of the example secrets is itself a startup error.

## What is intentionally not here

Each of these is a real decision, not an oversight:

| Not built            | Why                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| GraphQL              | REST was chosen; the clients need simple, cacheable reads.                                       |
| Microservices        | One deployable and one database until scale demands otherwise.                                   |
| Firebase             | PostgreSQL is the source of truth, including for documents and images.                           |
| Business endpoints   | The schema and infrastructure come first; endpoints follow per module.                           |
| Payment gateway      | No provider is chosen yet. The `payments` table exists so integration is additive.               |
| Background workers   | Notifications are stored as `QUEUED` first; sending is a worker's job, added later.              |
| Redis                | Needed for multi-instance rate limiting and caching. Single-instance limits are in-memory today. |
| `api-client` package | Written when the first client app is, against endpoints that actually exist.                     |

## Known trade-offs

- **Roles are resolved per request.** `JwtStrategy` reads roles and permissions from
  the database on every authenticated request instead of trusting token claims, so
  revoking access takes effect immediately. That costs one indexed query per
  request; caching it is the intended next optimisation.
- **Rate limiting is per process.** The default in-memory storage means limits are
  per instance. A shared store is required before running more than one.
- **Prisma's event stream is not subscribed to.** The generated `PrismaClient` is a
  const with a generic type rather than an extendable class, so log event names
  cannot be inferred through `extends`. Database failures still reach the logs via
  the exception filter, with the request's correlation id.
