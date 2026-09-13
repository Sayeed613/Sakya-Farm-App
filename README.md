# Sakya Farms

Production commerce platform for Sakya Farms. This repository currently contains
the **backend foundation**: the monorepo, the REST API, the PostgreSQL schema and
the infrastructure around them.

The customer, store, delivery and admin apps are not built yet. The API is built
first so the clients are written against a real contract instead of fixtures.

```
Customer app ─┐
Store app ────┤
Delivery app ─┼──►  REST API (/api/v1)  ──►  NestJS  ──►  Prisma  ──►  PostgreSQL
Admin panel ──┘
```

PostgreSQL is the source of truth and only the API may talk to it. No mobile app
ever receives a database connection.

## Requirements

| Tool    | Version                           | Notes                                                        |
| ------- | --------------------------------- | ------------------------------------------------------------ |
| Node.js | 20.19+ (22 or 24 LTS recommended) | Prisma 7 requires at least 20.19                             |
| pnpm    | 11.x                              | `corepack enable && corepack prepare pnpm@11.9.0 --activate` |
| Docker  | any recent version                | Only to run the local PostgreSQL container                   |

If you prefer not to use Docker, any local PostgreSQL 14+ works — just point
`DATABASE_URL` at it instead of running `pnpm db:up`.

## Run the backend locally

```bash
# 1. Install dependencies for every workspace.
pnpm install

# 2. Create the API's environment file and edit it.
cp apps/api/.env.example apps/api/.env

# 3. Configure the local database container.
cp .env.example .env

# 4. Start PostgreSQL.
pnpm db:up            # docker compose up -d postgres

# 5. Apply the schema to a fresh database and generate the Prisma client.
pnpm --filter @sakya/api db:migrate

# 6. Seed roles and permissions (system data only — no catalog rows).
pnpm db:seed

# 7. Start the API in watch mode.
pnpm --filter @sakya/api dev
```

The API is then on `http://localhost:3000`, with routes under `/api/v1`:

```bash
curl -i http://localhost:3000/api/v1/health
```

```json
{
  "status": "ok",
  "service": "sakya-farms-api",
  "version": "1",
  "environment": "development",
  "uptimeSeconds": 3,
  "timestamp": "2026-01-01T00:00:00.000Z",
  "checks": { "database": { "status": "up", "latencyMs": 1.42 } }
}
```

A healthy process with an unreachable database returns **503** with
`status: "degraded"` — the endpoint checks the database, it does not assume it.

### Secrets

`JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` must each be at least 32 characters
and different from each other. Generate a pair:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Any environment variable that is missing or malformed stops the boot with a report
naming every problem. In production, leaving the `.env.example` placeholder text in
place is itself a startup failure.

## Common commands

Run from the repository root:

| Command                                        | Does                                                         |
| ---------------------------------------------- | ------------------------------------------------------------ |
| `pnpm build`                                   | Build every workspace package (packages first, then the API) |
| `pnpm dev`                                     | Run all watch tasks                                          |
| `pnpm typecheck`                               | Typecheck every workspace                                    |
| `pnpm lint`                                    | ESLint across the monorepo                                   |
| `pnpm test`                                    | Unit tests                                                   |
| `pnpm format`                                  | Prettier                                                     |
| `pnpm db:up` / `pnpm db:down` / `pnpm db:logs` | Local PostgreSQL container                                   |
| `pnpm db:migrate`                              | Create and apply a migration                                 |
| `pnpm db:seed`                                 | Seed roles and permissions                                   |
| `pnpm catalog:import`                          | Validate the scraped catalog export (dry run)                |
| `pnpm catalog:import` twice with `:apply`      | See `migration/README.md`                                    |

Prisma-specific, run in `apps/api`:

| Command                           | Does                                          |
| --------------------------------- | --------------------------------------------- |
| `pnpm exec prisma studio`         | Browse the database                           |
| `pnpm exec prisma migrate deploy` | Apply committed migrations (CI/production)    |
| `pnpm exec prisma migrate reset`  | Drop, re-migrate and reseed — **destructive** |

## Layout

```
apps/api/            NestJS API — the only deployable today
  prisma/schema.prisma   the domain, and the rules it enforces
  prisma/seed.ts         roles + permissions (system data only)
  prisma/import-catalog.ts  the controlled catalog importer
  src/config/            environment validation (Zod)
  src/common/            guards, filters, pipes, decorators, middleware
  src/database/          the single Prisma client
  src/modules/           one module per domain, mostly scaffolds
packages/types/       shared roles, statuses, error codes, money type
packages/validation/  Zod schemas, including the catalog contract
packages/utils/       pure helpers (paise arithmetic, slugs, pagination)
migration/            scraped data pipeline — see migration/README.md
docs/                 architecture, database and API conventions
infrastructure/       deployment assets (not built yet)
```

## Importing the scraped catalog

The 84 scraped products are **not** in the database and are **not** hard-coded in
`schema.prisma`. They enter through one controlled, validated path:

```bash
pnpm --filter @sakya/api catalog:import         # dry run, writes nothing
pnpm --filter @sakya/api catalog:import:apply   # one transaction, or nothing
```

The export (`migration/normalized/catalog.json`) does not exist yet. Until it does,
the importer exits with an explanation rather than importing anything. See
[`migration/README.md`](migration/README.md) for the contract.

## What exists today

**Implemented:** pnpm workspace + Turborepo; NestJS 12 on TypeScript 6; the full
PostgreSQL schema (22 tables) and its first migration; Zod-validated environment
configuration; structured JSON logging with request correlation ids; a `/api/v1`
versioned surface; global rate limiting, CORS allow-list, Helmet headers; one
consistent error envelope; JWT authentication wiring (strategy, guards, decorators)
and Argon2id password hashing; a health endpoint that probes the database; the
migration pipeline; unit tests for all of the above.

**Not implemented, on purpose:** payment integration, delivery tracking,
notification sending, background workers, deployment assets, and every business
endpoint. Each domain module documents the endpoints it will expose in its module
file (for example `apps/api/src/modules/orders/orders.module.ts`).

## Notes

- **Node 25** is newer than the versions Prisma's installer lists as supported
  (20.19+, 22.12+, 24.0+). CI and production should run an LTS release even though
  the current setup works locally.
- Migrations are a deliberate step (`migrate deploy`), never something a
  container does on boot — two replicas starting at once must not race.
- `pnpm-workspace.yaml` is the source of install policy for pnpm 11: `saveExact`,
  workspace linking and the allow-list of dependencies permitted to run build
  scripts. pnpm 11 ignores these settings in `.npmrc`.
