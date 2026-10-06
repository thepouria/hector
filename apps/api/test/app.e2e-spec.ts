import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createE2eApp } from './helpers/e2e-app';

/**
 * E2E tests expect PostgreSQL to be available (docker compose up -d).
 */
describe('Hector API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns ok when database is available', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200);

    expect(response.body).toMatchObject({
      status: 'ok',
      service: 'hector-api',
      checks: {
        database: 'ok',
      },
    });
    expect(response.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('reuses a valid incoming X-Request-Id', async () => {
    const requestId = '11111111-2222-4333-8444-555555555555';

    const response = await request(app.getHttpServer())
      .get('/health')
      .set('X-Request-Id', requestId)
      .expect(200);

    expect(response.headers['x-request-id']).toBe(requestId);
  });

  it('rejects unauthenticated access to protected routes', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);

    expect(response.body).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'UNAUTHENTICATED',
          message: expect.any(String),
        }),
        requestId: expect.any(String),
      }),
    );
  });
});
