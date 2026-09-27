import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { captureFatal, initSentry } from './observability/sentry';

/**
 * Process-level last resort for errors that escaped every request.
 *
 * `AllExceptionsFilter` handles anything thrown while serving a request. The
 * two cases below are different: they are asynchronous failures with no
 * request to answer, so nothing in Nest can turn them into a 500. Left
 * unhandled, Node prints a stack trace to stderr and the process keeps
 * running in an unknown state — worst when it happens inside the inventory or
 * payment transaction path.
 *
 * The policy is "log hard, then die": writing a fatal line and exiting
 * non-zero hands the decision to the process manager (PM2), which restarts
 * the service with backoff. A crashed-then-restarted API loses seconds; a
 * zombie API silently corrupting order state loses trust. When Sentry is
 * configured, the event is also shipped first — with a bounded flush, so
 * observability can never delay (let alone prevent) the restart.
 *
 * Registered before bootstrapping so a rejection during module init is
 * covered too.
 */
function installProcessLevelGuards(): void {
  const bail = (kind: string, detail: string, cause: unknown): void => {
    // The pino logger may not exist yet (or may be mid-flush during exit),
    // so write directly: stderr is synchronous for files and PTYs, which is
    // exactly where PM2 captures output.
    process.stderr.write(`FATAL ${kind}: ${detail}\n`);
    // Best effort: capture to Sentry if initialised (bounded at ~2s, never
    // throws), then keep the original contract — 1 = crashed, so PM2 counts
    // consecutive fast exits and backs off.
    void captureFatal(kind, cause).finally(() => process.exit(1));
  };

  process.on('uncaughtException', (error: Error) => {
    bail('uncaughtException', error.stack ?? error.message, error);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    const detail = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
    const cause = reason instanceof Error ? reason : new Error(`Unhandled rejection: ${detail}`);
    bail('unhandledRejection', detail, cause);
  });
}

installProcessLevelGuards();

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Hold logs until the pino logger is attached, so nothing is emitted in a
    // different format during startup.
    bufferLogs: true,
  });

  const logger = app.get(Logger);
  app.useLogger(logger);

  // Error tracking, if a DSN is configured. Kept behind ConfigService so the
  // env is validated exactly once, and a no-op (SDK never initialised) when
  // SENTRY_DSN is absent.
  const configService = app.get(ConfigService);
  initSentry({
    dsn: configService.get<string>('observability.sentryDsn') ?? null,
    environment: configService.getOrThrow<string>('app.env'),
  });

  // Prefix, versioning, CORS, security headers and request ids. Shared with the
  // integration tests so both configure the app identically.
  configureApp(app);
  const port = configService.getOrThrow<number>('app.port');
  const prefix = configService.getOrThrow<string>('app.apiPrefix');
  const version = configService.getOrThrow<string>('app.apiVersion');

  // Lets PrismaService close its pool when the platform sends SIGTERM/SIGINT.
  app.enableShutdownHooks();

  await app.listen(port, '0.0.0.0');

  logger.log(
    `Sakya Farms API listening on http://localhost:${port}/${prefix}/v${version}`,
    'Bootstrap',
  );
}

void bootstrap().catch((error: unknown) => {
  // The Nest logger may not exist if bootstrapping itself failed, so this is the
  // one place that writes directly to stderr. Sentry may be up if the failure
  // happened after module init — capture it (bounded) before exiting.
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`Failed to start the API:\n${detail}\n`);
  void captureFatal('bootstrap', error).finally(() => process.exit(1));
});
