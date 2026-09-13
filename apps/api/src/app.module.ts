import { join } from 'node:path';

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { resolveRequestId } from './common/middleware/request-id.middleware';
import configuration from './config/configuration';
import { PrismaModule } from './database/prisma.module';
import {
  AdminModule,
  AuthModule,
  CartModule,
  CategoriesModule,
  CouponsModule,
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
            // Credentials and secrets must never reach a log sink.
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'res.headers["set-cookie"]',
                'req.body.password',
                'req.body.currentPassword',
                'req.body.newPassword',
                'req.body.refreshToken',
              ],
              censor: '[redacted]',
            },
            serializers: {
              req: (request: { id?: string; method?: string; url?: string }) => ({
                id: request.id,
                method: request.method,
                url: request.url,
              }),
              res: (response: { statusCode?: number }) => ({ statusCode: response.statusCode }),
            },
            customProps: () => ({ service: 'sakya-farms-api', env: environment }),
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
     * store (Redis) is required once more than one instance runs.
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
    AdminModule,
  ],
  providers: [
    // Order matters: reject floods before doing any token or database work.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
