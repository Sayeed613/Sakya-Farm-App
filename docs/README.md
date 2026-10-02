# Documentation

| Document                                           | Contents                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------- |
| [`system-flow.md`](./system-flow.md)               | **Fully updated backend + customer app flow diagrams** (auth, cart, serviceability, checkout, payment capture, expiry sweep, order lifecycle) |
| [`architecture.md`](./architecture.md)             | Monorepo layout, the request path, and what is deliberately not built yet |
| [`database.md`](./database.md)                     | Domain model and the invariants the schema enforces                       |
| [`api-conventions.md`](./api-conventions.md)       | Versioning, response shapes, errors, authentication and authorisation     |
| [`payments-setup.md`](./payments-setup.md)         | Razorpay credentials, webhook configuration and test-mode payment setup   |
| [`handoff.md`](./handoff.md)                       | Project state, module-by-module notes and known gaps                      |
| [`journey-audit.md`](./journey-audit.md)           | Customer-journey audit: checklist of server-side guarantees and results   |
| [`customer-ui-qa-audit.md`](./customer-ui-qa-audit.md) | Customer-app UI QA audit and findings                                 |
| [`scaling-summary.md`](./scaling-summary.md)       | Scaling notes and the path from one node to many                          |
| [`../migration/README.md`](../migration/README.md) | The scraped-catalog pipeline and its JSON contract                        |
| [`../README.md`](../README.md)                     | Running the backend locally                                               |

## Where the truth lives

- **Data** — PostgreSQL. It is the single source of truth; nothing else holds
  state that cannot be rebuilt from it.
- **The domain rules** — `apps/api/prisma/schema.prisma` plus the service layer.
- **Shared vocabularies** (roles, statuses, error codes) — `packages/types`, kept
  in step with the schema by a test rather than by discipline.
- **The migration contract** — `packages/validation/src/catalog.ts`.
