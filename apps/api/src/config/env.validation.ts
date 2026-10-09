import { z } from 'zod';

/**
 * Environment contract.
 *
 * Parsed once at boot by ConfigModule. If a variable is missing or malformed the
 * process exits immediately with a readable report, rather than failing later
 * somewhere deep inside a request. Nothing else in the codebase should read
 * `process.env` directly.
 */

/** Comma-separated list -> trimmed, non-empty array. */
const csv = (defaultValue: string[] = []) =>
  z
    .string()
    .optional()
    .transform((value) =>
      value === undefined
        ? defaultValue
        : value
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0),
    );

/** `"true"`/`"false"`/`"1"`/`"0"` -> boolean. `z.coerce.boolean()` is unusable here (Boolean("false") === true). */
const booleanish = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value === '') return defaultValue;
      return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
    });

const nodeEnvSchema = z.enum(['development', 'test', 'production']).default('development');

export const environmentSchema = z
  .object({
    NODE_ENV: nodeEnvSchema,

    // --- HTTP ---------------------------------------------------------------
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    API_PREFIX: z.string().min(1).default('api'),
    API_VERSION: z.string().min(1).default('1'),
    CORS_ORIGINS: csv([
      'http://localhost:8081', // Expo dev server (web)
      'http://localhost:19006', // Expo web (legacy port)
      'http://localhost:3001', // future admin panel
    ]),
    TRUST_PROXY: booleanish(false),

    // --- Database -----------------------------------------------------------
    DATABASE_URL: z
      .string()
      .min(1, 'DATABASE_URL is required')
      .refine(
        (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
        'DATABASE_URL must be a postgresql:// connection string',
      ),
    /**
     * Only needed when the migration user cannot create databases, in which case
     * Prisma cannot create its own shadow database for `migrate dev`.
     */
    SHADOW_DATABASE_URL: z.string().optional(),
    /**
     * pg pool size for this process (Prisma 7 driver adapter owns pooling).
     *
     * Sizing against PostgreSQL: the live database this project targets runs
     * `max_connections = 60` with `superuser_reserved_connections = 3`, so only
     * ~57 slots are usable. Keep (API instances × this pool) + migrations,
     * monitoring and psql sessions under that number — a good rule is to leave
     * at least 30% of max_connections free. One instance with the default of 20
     * leaves ~2/3 of the server for everything else; if you run N instances
     * behind a process manager, scale the default down to ~57/N.
     *
     * WARNING — Supabase SESSION POOLER is stricter than the primary: it caps
     * at 15 session clients TOTAL (`XX000 EMAXCONNSESSION`), not 57. Any
     * environment whose DATABASE_URL points at a `*.pooler.supabase.com`
     * host must set DATABASE_POOL_MAX to ≤10 (verified: 10 leaves headroom
     * for migrations/psql). The default of 20 above is only correct for a
     * DIRECT connection (Render Postgres or `db.*.supabase.co` primary).
     */
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(20),

    // --- Auth ---------------------------------------------------------------
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL: z.string().min(1).default('15m'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    JWT_REFRESH_TTL: z.string().min(1).default('30d'),
    JWT_ISSUER: z.string().min(1).default('sakya-farms-api'),
    JWT_AUDIENCE: z.string().min(1).default('sakya-farms-clients'),

    // --- Password hashing (argon2id) ---------------------------------------
    ARGON2_MEMORY_KIB: z.coerce.number().int().min(8192).default(19_456),
    ARGON2_TIME_COST: z.coerce.number().int().min(2).max(10).default(2),
    ARGON2_PARALLELISM: z.coerce.number().int().min(1).max(8).default(1),

    // --- Rate limiting ------------------------------------------------------
    THROTTLE_TTL_SECONDS: z.coerce.number().int().min(1).default(60),
    THROTTLE_LIMIT: z.coerce.number().int().min(1).default(100),

    // --- Catalogue cache ----------------------------------------------------
    /**
     * Seconds a public catalogue read (products, categories) stays cached
     * in-process. Admin writes invalidate immediately; this TTL only bounds
     * staleness that cannot be signalled in-process — catalogue import scripts
     * writing behind the API's back, and other instances under a process
     * manager. 0 disables caching entirely.
     */
    CATALOG_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(3600).default(30),

    // --- Permission cache ---------------------------------------------------
    /**
     * Seconds a user's permission set stays cached in-process. Role/permission
     * mutations invalidate the affected user's cache immediately; this TTL only
     * bounds staleness that cannot be signalled in-process — other instances
     * under a process manager. 0 disables caching entirely.
     */
    PERMISSION_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(3600).default(60),

    // --- Commerce rules -----------------------------------------------------
    /** GST percent applied to the discounted subtotal. 0 keeps the old behaviour. */
    TAX_RATE_PERCENT: z.coerce.number().min(0).max(40).default(5),
    /** Flat shipping fee in paise when below the free-shipping threshold. */
    SHIPPING_FEE_IN_PAISE: z.coerce.number().int().min(0).default(4900),
    /** Subtotal (after discount) at/above which shipping is free; empty = never free. */
    FREE_SHIPPING_THRESHOLD_IN_PAISE: z.coerce.number().int().min(0).optional(),
    /** Extra fee for Cash on Delivery in paise; 0 disables. */
    COD_FEE_IN_PAISE: z.coerce.number().int().min(0).default(0),
    /** Max units of one variant per cart line. */
    MAX_QUANTITY_PER_LINE: z.coerce.number().int().min(1).max(20).default(10),
    /** Max distinct lines per cart. */
    MAX_CART_LINES: z.coerce.number().int().min(1).max(50).default(25),
    /** Days after delivery within which a return can be requested. */
    RETURN_WINDOW_DAYS: z.coerce.number().int().min(1).max(90).default(7),
    /** Minutes a PENDING_PAYMENT order may hold stock before expiry cleanup. */
    PENDING_ORDER_EXPIRY_MINUTES: z.coerce.number().int().min(15).max(1440).default(120),

    // --- Payments (provider adapters) ---------------------------------------
    /**
     * HMAC secret for the non-production MOCK webhook adapter. Optional: the
     * module falls back to a test-only default outside production. Never set a
     * real gateway secret here — gateway adapters own their own credentials.
     */
    PAYMENTS_MOCK_WEBHOOK_SECRET: z.string().min(16).optional(),
    RAZORPAY_KEY_ID: z.string().trim().min(1).optional(),
    RAZORPAY_KEY_SECRET: z.string().trim().min(1).optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().trim().min(1).optional(),

    // --- SMS (OTP delivery) -------------------------------------------------
    /**
     * Demo OTP mode for staging/demo builds: every phone gets the same fixed
     * code instead of a random one, so a demo can be driven without an SMS
     * inbox. Refuses to activate in production (validated below in the
     * service as well — env validation is not a security boundary).
     */
    OTP_DEMO_MODE: z.string().optional(),
    /** The fixed 4-digit code used when OTP_DEMO_MODE is on. */
    OTP_DEMO_CODE: z
      .string()
.regex(/^\d{6}$/, 'OTP_DEMO_CODE must be exactly 6 digits')
      .optional(),
    /**
     * MSG91 credentials for production OTP delivery. Optional as a pair: when
     * absent, dev environments log the code and production fails closed
     * (a customer must be told a send failed, not left waiting).
     */
    MSG91_AUTH_KEY: z.string().trim().min(1).optional(),
    /** DLT-approved OTP template ID; its copy must contain ##OTP##. */
    MSG91_OTP_TEMPLATE_ID: z.string().trim().min(1).optional(),
    /** Sender/header id shown in the SMS; India DLT binds it to the template. */
    MSG91_SMS_FROM: z.string().trim().min(3).max(11).default('SAKYAFRM'),

    // --- Observability ------------------------------------------------------
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    /** Human-readable logs for local development. Always JSON in production. */
    LOG_PRETTY: z.string().optional(),
    /**
     * Slow-request / slow-query warn threshold, in milliseconds. A request or
     * a single database query that takes at least this long is logged at warn
     * with its route/model and duration (never the SQL text or query params).
     * 0 disables the warnings. Default 1000 is a conservative operational
     * choice, NOT a measured production latency figure — tune it once real
     * traffic data exists.
     */
    SLOW_REQUEST_MS: z.coerce.number().int().min(0).default(1000),
    /**
     * Sentry DSN for error tracking. Optional by design: when absent (or an
     * empty string) the SDK is never initialised and the process behaves
     * exactly as it did before Sentry existed in this codebase. Validated only
     * as a trimmed string — a malformed DSN disables itself inside the SDK
     * instead of failing the boot, so env validation is not the last word.
     */
    SENTRY_DSN: z.string().trim().optional(),

    // --- Seeding (optional, only read by prisma/seed.ts) --------------------
    SEED_ADMIN_EMAIL: z.string().email().optional(),
    SEED_ADMIN_PASSWORD: z.string().min(12).optional(),
    SEED_ADMIN_FIRST_NAME: z.string().min(1).optional(),
    SEED_ADMIN_LAST_NAME: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    const razorpayValues = [env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET, env.RAZORPAY_WEBHOOK_SECRET];
    if (razorpayValues.some((value) => value !== undefined) && razorpayValues.some((value) => value === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['RAZORPAY_KEY_ID'],
        message: 'RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET must be provided together',
      });
    }

    if (env.NODE_ENV !== 'production') return;

    const placeholders: [keyof typeof env, string][] = [
      ['JWT_ACCESS_SECRET', 'replace-with'],
      ['JWT_REFRESH_SECRET', 'replace-with'],
    ];
    for (const [key, marker] of placeholders) {
      const value = env[key];
      if (typeof value === 'string' && value.includes(marker)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} still contains the example placeholder and cannot be used in production`,
        });
      }
    }

    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_REFRESH_SECRET'],
        message: 'JWT_REFRESH_SECRET must differ from JWT_ACCESS_SECRET',
      });
    }

    // MSG91 credentials are optional individually but useless half-set: an
    // auth key without a template (or the reverse) always fails at send time,
    // so reject the half-configuration at boot instead.
    const hasAuthKey = env.MSG91_AUTH_KEY !== undefined;
    const hasTemplate = env.MSG91_OTP_TEMPLATE_ID !== undefined;
    if (hasAuthKey !== hasTemplate) {
      ctx.addIssue({
        code: 'custom',
        path: [hasAuthKey ? 'MSG91_OTP_TEMPLATE_ID' : 'MSG91_AUTH_KEY'],
        message: 'MSG91_AUTH_KEY and MSG91_OTP_TEMPLATE_ID must be provided together',
      });
    }

  });

export type Environment = z.infer<typeof environmentSchema>;

/**
 * ConfigModule validator. Receives the merged process environment and returns the
 * parsed, typed result. Throws a single readable error listing every problem.
 */
export function validateEnvironment(raw: Record<string, unknown>): Environment {
  const parsed = environmentSchema.safeParse(raw);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration. Fix the following and restart:\n${details}\n\nSet the variables in apps/api/.env.`,
    );
  }

  return parsed.data;
}
