# Documentation

| Document                                           | Contents                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------- |
| [`architecture.md`](./architecture.md)             | Monorepo layout, the request path, and what is deliberately not built yet |
| [`database.md`](./database.md)                     | Domain model and the invariants the schema enforces                       |
| [`api-conventions.md`](./api-conventions.md)       | Versioning, response shapes, errors, authentication and authorisation     |
| [`../migration/README.md`](../migration/README.md) | The scraped-catalog pipeline and its JSON contract                        |
| [`../README.md`](../README.md)                     | Running the backend locally                                               |

## Where the truth lives

- **Data** — PostgreSQL. It is the single source of truth; nothing else holds
  state that cannot be rebuilt from it.
- **The domain rules** — `apps/api/prisma/schema.prisma` plus the service layer.
- **Shared vocabularies** (roles, statuses, error codes) — `packages/types`, kept
  in step with the schema by a test rather than by discipline.
- **The migration contract** — `packages/validation/src/catalog.ts`.
