import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';

/**
 * Analytics ingest — fire-and-forget by contract.
 *
 * `track` never awaits a write and never throws: an analytics failure must
 * not fail the user action it observes. Events land in `analytics_events`
 * where queries/funnels can be built later; swapping in a hosted provider
 * later means adding a forwarder here, not touching any screen.
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  track(
    userId: string | null,
    name: string,
    props?: Record<string, unknown>,
    sessionId?: string,
  ): void {
    void this.prisma.analyticsEvent
      .create({
        data: {
          userId: userId ?? null,
          name,
          props: (props ?? undefined) as never,
          sessionId: sessionId ?? null,
        },
      })
      .catch((error: unknown) => {
        // Logged at debug: analytics noise must not drown real errors.
        this.logger.debug({ event: name, error }, 'analytics ingest failed');
      });
  }
}
