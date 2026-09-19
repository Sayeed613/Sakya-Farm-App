import { validateEnvironment } from './env.validation';

/**
 * Structured application configuration.
 *
 * This factory is the ONLY place `process.env` is read. It is registered with
 * `ConfigModule.forRoot({ load: [configuration] })`, so the environment is parsed
 * and validated once during bootstrap and the process exits immediately if
 * anything is missing or malformed.
 *
 * Validation lives here rather than in ConfigModule's `validate` hook on purpose:
 * that hook writes its parsed output back into `process.env`, which would mean
 * coercing values twice with inconsistent results (an array would be re-parsed as
 * a string, for instance).
 */
export interface AppConfig {
  app: {
    env: 'development' | 'test' | 'production';
    isProduction: boolean;
    port: number;
    apiPrefix: string;
    apiVersion: string;
    corsOrigins: string[];
    trustProxy: boolean;
  };
  database: {
    url: string;
    poolMax: number;
  };
  payments: {
    /** HMAC secret for the non-production MOCK webhook adapter. */
    mockWebhookSecret: string | undefined;
  };
  sms: {
    /** Vonage credentials; both null means SMS delivery is not configured. */
    apiKey: string | null;
    apiSecret: string | null;
    from: string;
    /**
     * Demo OTP mode: every phone verifies with the same fixed 4-digit code.
     * For demo/staging builds only; never active in production.
     */
    demoMode: boolean;
    /** The fixed 4-digit code used when demoMode is on (default 1234). */
    demoCode: string;
  };
  auth: {
    accessSecret: string;
    accessTtl: string;
    refreshSecret: string;
    refreshTtl: string;
    issuer: string;
    audience: string;
    argon2: {
      memoryKib: number;
      timeCost: number;
      parallelism: number;
    };
  };
  throttle: {
    ttlSeconds: number;
    limit: number;
  };
  logging: {
    level: string;
    pretty: boolean;
  };
}

export default function configuration(): AppConfig {
  const env = validateEnvironment(process.env);
  const isProduction = env.NODE_ENV === 'production';

  return {
    app: {
      env: env.NODE_ENV,
      isProduction,
      port: env.PORT,
      apiPrefix: env.API_PREFIX,
      apiVersion: env.API_VERSION,
      corsOrigins: env.CORS_ORIGINS,
      trustProxy: env.TRUST_PROXY,
    },
    database: {
      url: env.DATABASE_URL,
      poolMax: env.DATABASE_POOL_MAX,
    },
    payments: {
      mockWebhookSecret: env.PAYMENTS_MOCK_WEBHOOK_SECRET,
    },
    sms: {
      apiKey: env.VONAGE_API_KEY ?? null,
      apiSecret: env.VONAGE_API_SECRET ?? null,
      from: env.VONAGE_SMS_FROM,
      // Demo mode is opt-in via env and can never activate in production:
      // this guard is duplicated inside OtpService so relying on it is safe.
      demoMode: !isProduction && env.OTP_DEMO_MODE === 'true',
      demoCode: env.OTP_DEMO_CODE ?? '1234',
    },
    auth: {
      accessSecret: env.JWT_ACCESS_SECRET,
      accessTtl: env.JWT_ACCESS_TTL,
      refreshSecret: env.JWT_REFRESH_SECRET,
      refreshTtl: env.JWT_REFRESH_TTL,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      argon2: {
        memoryKib: env.ARGON2_MEMORY_KIB,
        timeCost: env.ARGON2_TIME_COST,
        parallelism: env.ARGON2_PARALLELISM,
      },
    },
    throttle: {
      ttlSeconds: env.THROTTLE_TTL_SECONDS,
      limit: env.THROTTLE_LIMIT,
    },
    logging: {
      level: env.LOG_LEVEL,
      // Pretty output is a development convenience; production emits JSON.
      pretty: env.LOG_PRETTY === undefined ? !isProduction : env.LOG_PRETTY === 'true',
    },
  };
}
