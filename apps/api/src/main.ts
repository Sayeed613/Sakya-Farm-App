import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Hold logs until the pino logger is attached, so nothing is emitted in a
    // different format during startup.
    bufferLogs: true,
  });

  const logger = app.get(Logger);
  app.useLogger(logger);

  // Prefix, versioning, CORS, security headers and request ids. Shared with the
  // integration tests so both configure the app identically.
  configureApp(app);

  const configService = app.get(ConfigService);
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
  // one place that writes directly to stderr.
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`Failed to start the API:\n${detail}\n`);
  process.exit(1);
});
