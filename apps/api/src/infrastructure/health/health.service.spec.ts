import { HealthService } from './health.service';
import type { DatabaseService } from '../database/database.service';

describe('HealthService', () => {
  it('returns ok when database ping succeeds', async () => {
    const database = {
      ping: jest.fn().mockResolvedValue(undefined),
    } as unknown as DatabaseService;

    const service = new HealthService(database);
    await expect(service.check()).resolves.toEqual({
      status: 'ok',
      service: 'hector-api',
      checks: { database: 'ok' },
    });
  });

  it('returns error when database ping fails', async () => {
    const database = {
      ping: jest.fn().mockRejectedValue(new Error('connection refused')),
    } as unknown as DatabaseService;

    const service = new HealthService(database);
    await expect(service.check()).resolves.toEqual({
      status: 'error',
      service: 'hector-api',
      checks: { database: 'error' },
    });
  });
});
