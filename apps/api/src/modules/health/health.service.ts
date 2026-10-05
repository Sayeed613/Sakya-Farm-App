import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { HealthCheckResult } from '@sakya/types';

import { PrismaService } from '../../database/prisma.service';

/**
 * The liveness answer. Deliberately much smaller than `HealthCheckResult`:
 * liveness reports the process, not the instance's ability to serve traffic.
 */
export interface LivenessResult {
  status: 'ok';
  uptimeSeconds: number;
  timestamp: string;
}

/**
 * Reports whether this process can actually serve traffic.
 *
 * The database probe is a real round trip (`SELECT 1`) rather than a check that
 * the client object exists: a pool that has lost its connection is exactly the
 * failure this endpoint must catch. A failed probe returns 503 so load balancers
 * and orchestrators stop routing to the instance.
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async check(): Promise<HealthCheckResult> {
    const environment = this.configService.getOrThrow<string>('app.env');
    const version = this.configService.getOrThrow<string>('app.apiVersion');

    const database = await this.checkDatabase();

    return {
      status: database.status === 'up' ? 'ok' : 'degraded',
      service: 'sakya-farms-api',
      version,
      environment,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
      checks: { database },
    };
  }

  /**
   * Liveness answer: the Node/Nest process is up — and that is ALL it proves.
   *
   * Deliberately performs no I/O, not even a database ping. The two health
   * endpoints answer different questions: `/health` asks "should this instance
   * receive traffic?" (database down => 503), while `/health/live` asks "is the
   * process alive?" — the thing an orchestrator restarts on. Folding the
   * database probe into liveness would turn a database outage into a restart
   * loop across every instance: a restarted process still cannot reach the
   * database.
   */
  liveness(): LivenessResult {
    return {
      status: 'ok',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  private async checkDatabase(): Promise<HealthCheckResult['checks']['database']> {
    try {
      const latencyMs = await this.prisma.ping();
      return { status: 'up', latencyMs: Math.round(latencyMs * 100) / 100 };
    } catch (error) {
      this.logger.error(
        'Database health probe failed',
        error instanceof Error ? error.stack : String(error),
      );
      return {
        status: 'down',
        latencyMs: null,
        error: 'Database connection failed',
      };
    }
  }
}
