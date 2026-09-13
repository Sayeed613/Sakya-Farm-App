import { Global, Module } from '@nestjs/common';

import { PrismaService } from './prisma.service';

/**
 * Global so feature modules can inject PrismaService directly.
 *
 * There is exactly one client and one connection pool per process; making the
 * module global keeps that guarantee instead of letting each module build its own.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
