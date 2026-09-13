# infrastructure/

Deployment assets.

**Intentionally empty for now.** Local PostgreSQL runs from the repository-root
`docker-compose.yml`; nothing here is needed until the API is actually deployed.

Reserved for, in rough order:

| Subdirectory  | Will contain                                                                                         |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| `docker/`     | The API's production `Dockerfile` (multi-stage, non-root, `prisma migrate deploy` as a release step) |
| `terraform/`  | Managed PostgreSQL, the container runtime, secrets, DNS                                              |
| `ci/`         | Pipeline definitions for typecheck, lint, test, migrate and deploy                                   |
| `monitoring/` | Log shipping, uptime checks, alerting on `/api/v1/health`                                            |

Two decisions worth recording before anything is written here:

- **Migrations run as an explicit release step**, not on container start. Two
  replicas booting simultaneously must not race to migrate the same database.
- **`DATABASE_URL` comes from the platform's secret store**, never from an image
  layer or a committed file. PostgreSQL is not reachable from the public internet.
