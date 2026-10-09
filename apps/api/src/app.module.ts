import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { UserAwareThrottlerGuard } from './common/guards/user-aware-throttler.guard';
import { resolveRequestId } from './common/middleware/request-id.middleware';
import type { RequestMetrics } from './observability/request-metrics';
import {
  REDACT_PATHS,
  requestSerializer,
  responseSerializer,
} from './observability/pino-config';
import { CatalogCacheModule } from './cache/catalog-cache.module';
import { PermissionCacheModule } from './cache/permission-cache.module';
import configuration from './config/configuration';
import { PrismaModule } from './database/prisma.module';
import {
  AdminModule,
  AuthModule,
  CartModule,
  CategoriesModule,
  CouponsModule,
  CustomerJourneyModule,
  DeliveryModule,
  HealthModule,
  InventoryModule,
  NotificationsModule,
  OrdersModule,
  PaymentsModule,
  ProductsModule,
  ReviewsModule,
  StoresModule,
  UsersModule,
} from './modules';

/**
 * The request shape the completion log reads instrumentation from.
 *
 * `metrics` is attached by `requestMetricsMiddleware`; `route` is Express'
 * matched layer (`/api/v1/cart/items/:itemId`), which only exists once routing
 * has happened — that is why it is read here, when the response finishes,
 * instead of in the `req` serializer, whose bindings are frozen at request
 * start.
 */
type InstrumentedRequest = IncomingMessage & {
  metrics?: RequestMetrics;
  route?: { path?: string | string[] };
};

/** Route template for grouping, or null when nothing matched (404). */
function routeTemplate(request: InstrumentedRequest): string | null {
  const path = request.route?.path;
  if (path === undefined) return null;
  if (Array.isArray(path)) return path[0] ?? null;
  return path;
}

/** Round each external-service total for a compact log binding. */
function roundDurations(durations: Record<string, number>): Record<string, number> {
  const rounded: Record<string, number> = {};
  for (const [label, milliseconds] of Object.entries(durations)) {
    rounded[label] = Math.round(milliseconds);
  }
  return rounded;
}

/**
 * Resolve `.env` from the API directory itself. `__dirname` here is the source
 * folder, so moving up one level reaches `apps/api` where `.env` lives.
 */
const appRoot = join(__dirname, '..');

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // `.env.local` wins over `.env` for values a developer wants to override.
      envFilePath: [join(appRoot, '.env.local'), join(appRoot, '.env')],
      load: [configuration],
    }),

    /**
     * Structured request logging. Every line is JSON with a correlation id, so
     * logs can be shipped to any collector without a parsing step. Pretty output
     * is used in development only.
     */
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const level = configService.getOrThrow<string>('logging.level');
        const pretty = configService.getOrThrow<boolean>('logging.pretty');
        const environment = configService.getOrThrow<string>('app.env');

        return {
          pinoHttp: {
            level,
            ...(pretty
              ? {
                  transport: {
                    target: 'pino-pretty',
                    options: {
                      singleLine: true,
                      colorize: true,
                      translateTime: 'SYS:HH:MM:ss.l',
                      ignore: 'pid,hostname,context',
                    },
                  },
                }
              : {}),
            // Reuse a caller-provided correlation id when it is safe to.
            genReqId: (request) => resolveRequestId(request.headers['x-request-id']),
            // Credentials, OTP codes and webhook signatures must never reach
            // a log sink — policy lives in observability/pino-config.ts so it
            // is unit-testable; serializers keep bodies/headers out entirely.
            redact: {
              paths: REDACT_PATHS,
              censor: '[redacted]',
            },
            serializers: {
              req: requestSerializer,
              res: responseSerializer,
            },
            // Evaluated once for the per-request child at request start and
            // AGAIN when the completion line is written — so the buckets
            // filled during the request land on that line, alongside pino's
            // own `responseTime` and the `res.statusCode`/`req` serializers
            // (method, url, correlation id).
            customProps: (request) => {
              const instrumented = request as InstrumentedRequest;
              const metrics = instrumented.metrics;
              const route = routeTemplate(instrumented);
              const external =
                metrics === undefined ? {} : roundDurations(metrics.externalMs);
              return {
                service: 'sakya-farms-api',
                env: environment,
                ...(route === null ? {} : { route }),
                ...(metrics === undefined
                  ? {}
                  : {
                      db: { ms: Math.round(metrics.dbMs), queries: metrics.dbQueries },
                      ...(Object.keys(external).length === 0 ? {} : { ext: external }),
                    }),
              };
            },
            // Health probes fire every few seconds; logging them buries real traffic.
            autoLogging: {
              ignore: (request) => (request.url ?? '').includes('/health'),
            },
          },
        };
      },
    }),

    /**
     * Rate limiting is enabled globally; individual routes can tighten it with
     * `@Throttle()`. Storage is in-memory, so limits are per process — a shared
     * store (Redis) is required once more than one instance runs. Buckets are
     * keyed per user id when the caller presents a valid access token, per IP
     * otherwise; see UserAwareThrottlerGuard registered below.
     */
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: configService.getOrThrow<number>('throttle.ttlSeconds') * 1000,
            limit: configService.getOrThrow<number>('throttle.limit'),
          },
        ],
        errorMessage: 'Too many requests. Please slow down and try again shortly.',
      }),
    }),

    PrismaModule,
    CatalogCacheModule,
    PermissionCacheModule,
    AuthModule,
    HealthModule,

    // Domain modules. Scaffolded so the structure and dependency direction are
    // fixed; controllers and services are added per feature.
    UsersModule,
    ProductsModule,
    CategoriesModule,
    InventoryModule,
    StoresModule,
    CartModule,
    OrdersModule,
    PaymentsModule,
    DeliveryModule,
    CouponsModule,
    ReviewsModule,
    NotificationsModule,
    CustomerJourneyModule,
    AdminModule,
  ],
  providers: [
    // Order matters: reject floods before doing any token or database work.
    // UserAwareThrottlerGuard keeps that promise — it verifies the bearer
    // token inline (one HMAC check, no I/O) purely to pick the bucket key:
    // per-user for valid access tokens (carrier-grade NAT shares one IP across
    // many real customers), per-IP for everything else.
    { provide: APP_GUARD, useClass: UserAwareThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
