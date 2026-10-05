/**
 * Test environment for specs that boot the real application.
 *
 * Imported BEFORE `src/app.module` (see health.spec.ts): ConfigModule reads
 * `.env` while `app.module` is being evaluated, and dotenv never overwrites a
 * key that already exists — so a spec that must control the config has to set
 * it in a module that evaluates first. Static imports hoist above a spec
 * file's own statements, which is why this lives in a separate module rather
 * than at the top of the spec itself.
 *
 * All values are process-scoped to this test worker; no `.env` file is read
 * or written here. Defaults mirror catalog.e2e.spec.ts's beforeAll — but they
 * are set BEFORE `.env` loads here (catalog sets them after), so each must be
 * valid on its own: env validation demands JWT secrets of at least 32
 * characters.
 */
process.env.LOG_PRETTY ??= 'false';
process.env.LOG_LEVEL ??= 'error';
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-value-0123456789abcdef';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-value-0123456789abcdef';
// Unconditional: a developer machine's `.env` may already have been loaded
// with a 4-digit demo code, which env validation rejects ("must be exactly
// 6 digits") and which `??=` would therefore preserve.
process.env.OTP_DEMO_CODE = '123456';

export {};
