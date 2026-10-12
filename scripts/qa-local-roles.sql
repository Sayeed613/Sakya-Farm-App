-- Throwaway bootstrap for the LOCAL DISPOSABLE QA database only
-- (sakya_farms_qa inside the local Docker Postgres container).
--
-- The repo's RLS migration (20261011120000_enable_rls_deny_by_default)
-- REVOKEs against the Supabase-managed roles (anon, authenticated,
-- service_role). Those roles do not exist in vanilla Postgres, so
-- `prisma migrate deploy` fails with `role "anon" does not exist`.
-- Creating no-login stubs here keeps QA migrations byte-identical to
-- what production already applied. Never run this against production:
-- the roles already exist there.
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END
$roles$;

SELECT rolname FROM pg_catalog.pg_roles
WHERE rolname IN ('anon', 'authenticated', 'service_role');
