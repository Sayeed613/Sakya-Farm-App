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
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

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

    // --- Payments (provider adapters) ---------------------------------------
    /**
     * HMAC secret for the non-production MOCK webhook adapter. Optional: the
     * module falls back to a test-only default outside production. Never set a
     * real gateway secret here — gateway adapters own their own credentials.
     */
    PAYMENTS_MOCK_WEBHOOK_SECRET: z.string().min(16).optional(),

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
      .regex(/^\d{4}$/, 'OTP_DEMO_CODE must be exactly 4 digits')
      .optional(),
    /**
     * Vonage credentials for production OTP delivery. Optional as a pair: when
     * absent, dev environments log the code and production fails closed
     * (a customer must be told a send failed, not left waiting).
     */
    VONAGE_API_KEY: z.string().trim().min(1).optional(),
    VONAGE_API_SECRET: z.string().trim().min(1).optional(),
    /** Alphanumeric sender id shown in the SMS; regional restrictions apply. */
    VONAGE_SMS_FROM: z.string().trim().min(3).max(11).default('SAKYAFRM'),

    // --- Observability ------------------------------------------------------
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    /** Human-readable logs for local development. Always JSON in production. */
    LOG_PRETTY: z.string().optional(),

    // --- Seeding (optional, only read by prisma/seed.ts) --------------------
    SEED_ADMIN_EMAIL: z.string().email().optional(),
    SEED_ADMIN_PASSWORD: z.string().min(12).optional(),
    SEED_ADMIN_FIRST_NAME: z.string().min(1).optional(),
    SEED_ADMIN_LAST_NAME: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
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

    // Vonage credentials are optional individually but useless half-set: a
    // key without a secret (or the reverse) always fails at send time, so
    // reject the half-configuration at boot instead.
    const hasKey = env.VONAGE_API_KEY !== undefined;
    const hasSecret = env.VONAGE_API_SECRET !== undefined;
    if (hasKey !== hasSecret) {
      ctx.addIssue({
        code: 'custom',
        path: [hasKey ? 'VONAGE_API_SECRET' : 'VONAGE_API_KEY'],
        message: 'VONAGE_API_KEY and VONAGE_API_SECRET must be provided together',
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
      `Invalid environment configuration. Fix the following and restart:\n${details}\n\nSee apps/api/.env.example for the expected variables.`,
    );
  }

  return parsed.data;
}
