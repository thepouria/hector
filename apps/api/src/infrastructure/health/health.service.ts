import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export type HealthCheckStatus = 'ok' | 'error';

export type HealthResponse = {
  status: HealthCheckStatus;
  service: 'hector-api';
  checks: {
    database: HealthCheckStatus;
  };
};

@Injectable()
export class HealthService {
  constructor(private readonly database: DatabaseService) {}

  async check(): Promise<HealthResponse> {
    let database: HealthCheckStatus = 'ok';

    try {
      await this.database.ping();
    } catch {
      database = 'error';
    }

    return {
      status: database === 'ok' ? 'ok' : 'error',
      service: 'hector-api',
      checks: {
        database,
      },
    };
  }
}
