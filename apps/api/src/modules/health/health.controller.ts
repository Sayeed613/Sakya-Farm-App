import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { HealthCheckResult } from '@sakya/types';
import type { Response } from 'express';

import { Public } from '../../common/decorators/public.decorator';
import { HealthService } from './health.service';

/**
 * `GET /api/v1/health`
 *
 * Public by design: orchestrators, uptime monitors and the deploy pipeline probe
 * it before any user exists. It reports liveness *and* database reachability, so
 * a database outage surfaces as a 503 rather than a 200 that lies.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get()
  async check(@Res({ passthrough: true }) response: Response): Promise<HealthCheckResult> {
    const result = await this.healthService.check();

    response.status(result.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);

    return result;
  }
}
