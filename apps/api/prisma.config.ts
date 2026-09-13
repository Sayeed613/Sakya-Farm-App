import 'dotenv/config';

import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration (Prisma 7+).
 *
 * The CLI no longer reads `url` from the datasource block in schema.prisma, and
 * it no longer loads `.env` on its own — hence the `dotenv/config` import above.
 * The runtime Prisma Client does not use this file at all: it receives its
 * connection string from the `@prisma/adapter-pg` adapter in src/database.
 *
 * `datasource` is only added when DATABASE_URL is present. Commands that never
 * touch a database (`generate`, `format`, `validate`) therefore work on a fresh
 * checkout, while `migrate`, `db push` and `studio` fail with a clear missing-URL
 * error if `.env` has not been created yet.
 */
const databaseUrl = process.env.DATABASE_URL;
const shadowDatabaseUrl = process.env.SHADOW_DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',

  migrations: {
    path: 'prisma/migrations',
    // Prisma 7 no longer seeds automatically after `migrate dev`/`migrate reset`;
    // this makes an explicit `prisma db seed` work.
    seed: 'tsx prisma/seed.ts',
  },

  ...(databaseUrl !== undefined && databaseUrl !== ''
    ? {
        datasource: {
          url: databaseUrl,
          ...(shadowDatabaseUrl !== undefined && shadowDatabaseUrl !== ''
            ? { shadowDatabaseUrl }
            : {}),
        },
      }
    : {}),
});
