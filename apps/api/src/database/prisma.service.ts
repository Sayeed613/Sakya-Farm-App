import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client';

/**
 * The single Prisma client for the process.
 *
 * Prisma 7 requires a driver adapter, so connections are owned and pooled by `pg`
 * rather than by a Rust engine. Pool size comes from configuration so it can be
 * tuned against PostgreSQL's `max_connections` per environment.
 *
 * Only the API talks to PostgreSQL. Mobile apps, the admin panel and any other
 * client go through REST; a database connection is never shipped to a client.
 *
 * Database failures surface as exceptions and are logged with the request's
 * correlation id by the global exception filter. Prisma's own query/warn event
 * stream is deliberately not subscribed to here: the generated `PrismaClient` is
 * a const with a generic *type* rather than an extendable class, so event names
 * cannot be inferred through `extends`. If query logging is needed later, add it
 * where the client is constructed with inference intact.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(configService: ConfigService) {
    const connectionString = configService.getOrThrow<string>('database.url');
    const poolMax = configService.getOrThrow<number>('database.poolMax');

    // TCP keepalive on every pooled connection.
    //
    // Without it, a connection that goes idle (quiet period between requests,
    // or a long-lived process behind a firewall/NAT that silently drops the
    // socket) is closed by the peer without either side noticing. The next
    // query on that dead socket then fails with P1017 ("Server has closed the
    // connection") — reported historically against this service. With
    // keepalive the kernel probes the socket, so a dead connection is detected
    // and torn down *before* Prisma hands it to a query, and pg's pool
    // replaces it transparently instead of surfacing an error to a request.
    //
    // 30s idle delay probes well inside the common 5-minute idle-connection
    // cut of cloud load balancers and PostgreSQL's own idle limits.
    super({
      adapter: new PrismaPg({
        connectionString,
        max: poolMax,
        keepAlive: true,
        keepAliveInitialDelayMillis: 30_000,
        // Fail fast when the server is unreachable rather than queueing a
        // request for the driver's default (long) connect timeout.
        connectionTimeoutMillis: 10_000,
        // Bound how long a query waits for a free pool slot before erroring
        // with a retryable SERVICE_UNAVAILABLE instead of hanging a request.
        idleTimeoutMillis: 30_000,
      }),
    });
  }

  /**
   * Round-trip check used by the health endpoint.
   *
   * `SELECT 1` proves the pool can actually reach PostgreSQL, which a check for
   * "the client object exists" would not. Returns the observed latency so a
   * degrading database is visible before it fails.
   */
  async ping(): Promise<number> {
    const startedAt = process.hrtime.bigint();
    await this.$queryRaw`SELECT 1`;
    return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Closing the database connection pool');
    await this.$disconnect();
  }
}
