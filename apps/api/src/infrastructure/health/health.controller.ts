import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../../modules/auth/decorators/public.decorator';
import { HealthService, type HealthResponse } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get()
  @SkipThrottle()
  @ApiOperation({ summary: 'Application and dependency health' })
  async getHealth(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    const health = await this.healthService.check();

    if (health.status !== 'ok') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return health;
  }
}
