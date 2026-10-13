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
    razorpayKeyId: string | null;
    razorpayKeySecret: string | null;
    razorpayWebhookSecret: string | null;
  };
  /** Temporary exact-test-number OTP path; development/staging only. */
  testOtp: {
    enabled: boolean;
    testPhone: string | null;
    code: string | null;
    enabledDeadline: string | null;
    rawFlag: string | null;
    rawPhone: string | null;
    rawCode: string | null;
    rawDeadline: string | null;
  };
  sms: {
    /**
     * MSG91 credentials; authKey + template together mean SMS delivery is
     * configured. Either one missing falls back to dev-log delivery.
     */
    authKey: string | null;
    otpTemplateId: string | null;
    from: string;
    /**
     * Demo OTP mode: every phone verifies with the same fixed 6-digit code
     * (the same length production codes have). For demo/staging builds only;
     * never active in production.
     */
    demoMode: boolean;
    /** The fixed 6-digit code used when demoMode is on (default 123456). */
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
  catalog: {
    /** Seconds a public catalogue read stays cached in-process; 0 disables. */
    cacheTtlSeconds: number;
  };
  permissionCache: {
    /** Seconds a user's permission set stays cached in-process; 0 disables. */
    ttlSeconds: number;
  };
  /** Commerce rules that need ops tuning, not code changes. */
  commerce: {
    /** GST rate applied to the discounted subtotal, e.g. 5 means 5%. */
    taxRatePercent: number;
    /** Flat shipping fee in paise when below the free threshold. */
    shippingFeeInPaise: number;
    /** Subtotal (after discount) at or above which shipping is free; null = never free. */
    freeShippingThresholdInPaise: number | null;
    /** Extra fee for Cash on Delivery, in paise. 0 disables it. */
    codFeeInPaise: number;
    /** Max units of one variant in a cart — a stock-abuse and UX guard. */
    maxQuantityPerLine: number;
    /** Max distinct lines per cart. */
    maxCartLines: number;
    /** Days after delivery within which a return may be requested. */
    returnWindowDays: number;
    /** Minutes a PENDING_PAYMENT order may hold its reservation before expiry. */
    pendingOrderExpiryMinutes: number;
  };
  logging: {
    level: string;
    pretty: boolean;
    /** Requests/queries at or above this many ms are warned about; 0 disables. */
    slowRequestMs: number;
  };
  observability: {
    /** Sentry DSN; null disables error tracking entirely. */
    sentryDsn: string | null;
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
      razorpayKeyId: env.RAZORPAY_KEY_ID ?? null,
      razorpayKeySecret: env.RAZORPAY_KEY_SECRET ?? null,
      razorpayWebhookSecret: env.RAZORPAY_WEBHOOK_SECRET ?? null,
    },
    testOtp: {
      enabled: env.FEATURE_FLAG_TEST_OTP === 'true',
      testPhone: env.TEST_OTP_TEST_PHONE ?? null,
      code: env.TEST_OTP_CODE ?? null,
      enabledDeadline: env.TEST_OTP_ENABLED_DEADLINE ?? null,
      rawFlag: env.FEATURE_FLAG_TEST_OTP ?? null,
      rawPhone: env.TEST_OTP_TEST_PHONE ?? null,
      rawCode: env.TEST_OTP_CODE ?? null,
      rawDeadline: env.TEST_OTP_ENABLED_DEADLINE ?? null,
    },
    sms: {
      authKey: env.MSG91_AUTH_KEY ?? null,
      otpTemplateId: env.MSG91_OTP_TEMPLATE_ID ?? null,
      from: env.MSG91_SMS_FROM,
      // Demo mode is opt-in via env and can never activate in production:
      // this guard is duplicated inside OtpService so relying on it is safe.
      demoMode: env.OTP_DEMO_MODE === 'true',
      // Must stay 6 digits, matching OTP_DEMO_CODE validation and the verify
      // schema — production codes are always 6 digits too.
      demoCode: env.OTP_DEMO_CODE ?? '123456',
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
    catalog: {
      cacheTtlSeconds: env.CATALOG_CACHE_TTL_SECONDS,
    },
    permissionCache: {
      ttlSeconds: env.PERMISSION_CACHE_TTL_SECONDS,
    },
    commerce: {
      taxRatePercent: env.TAX_RATE_PERCENT,
      shippingFeeInPaise: env.SHIPPING_FEE_IN_PAISE,
      freeShippingThresholdInPaise: env.FREE_SHIPPING_THRESHOLD_IN_PAISE ?? null,
      codFeeInPaise: env.COD_FEE_IN_PAISE,
      maxQuantityPerLine: env.MAX_QUANTITY_PER_LINE,
      maxCartLines: env.MAX_CART_LINES,
      returnWindowDays: env.RETURN_WINDOW_DAYS,
      pendingOrderExpiryMinutes: env.PENDING_ORDER_EXPIRY_MINUTES,
    },
    logging: {
      level: env.LOG_LEVEL,
      // Pretty output is a development convenience; production emits JSON.
      pretty: env.LOG_PRETTY === undefined ? !isProduction : env.LOG_PRETTY === 'true',
      slowRequestMs: env.SLOW_REQUEST_MS,
    },
    observability: {
      // A blank line in `.env` means "unset", not "track errors into a
      // broken DSN" — normalise it to null here.
      sentryDsn: env.SENTRY_DSN !== undefined && env.SENTRY_DSN.length > 0 ? env.SENTRY_DSN : null,
    },
  };
}
