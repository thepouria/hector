import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { UserStatus } from '@hector/database';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import {
  createE2eApp,
  E2E_PASSWORD,
  e2eTrustedOrigin,
  extractRefreshCookie,
} from './helpers/e2e-app';

/**
 * Auth E2E tests require PostgreSQL and seeded users (`pnpm db:seed`).
 */
describe('Auth (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  const password = E2E_PASSWORD;
  const email = 'pouria@hector.local';

  beforeAll(async () => {
    app = await createE2eApp();
    database = app.get(DatabaseService);

    await database.client.user.update({
      where: { email },
      data: { status: UserStatus.ACTIVE, deletedAt: null },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('logs in, reads me, refreshes with rotation, and logs out', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);

    expect(login.body.data.accessToken).toBeDefined();
    expect(login.body.data.user.email).toBe(email);
    expect(login.body.data.user.passwordHash).toBeUndefined();

    const refreshCookie = extractRefreshCookie(login.headers['set-cookie']);
    expect(refreshCookie).toBeDefined();
    expect(login.headers['set-cookie']?.join(';')).toContain('HttpOnly');

    const accessToken = login.body.data.accessToken as string;

    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(me.body.data.email).toBe(email);

    const refresh = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie!)
      .set('Origin', e2eTrustedOrigin())
      .expect(200);

    const nextCookie = extractRefreshCookie(refresh.headers['set-cookie']);
    expect(nextCookie).toBeDefined();
    expect(nextCookie).not.toBe(refreshCookie);
    expect(refresh.body.data.accessToken).toBeDefined();

    const sessions = await request(app.getHttpServer())
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${refresh.body.data.accessToken}`)
      .expect(200);

    expect(Array.isArray(sessions.body.data)).toBe(true);
    expect(sessions.body.data.some((session: { current: boolean }) => session.current)).toBe(true);

    // Reuse of a rotated refresh token revokes the session (reuse detection).
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie!)
      .set('Origin', e2eTrustedOrigin())
      .expect(401);

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${refresh.body.data.accessToken}`)
      .expect(401);

    // Fresh login for logout coverage after revoke-on-reuse.
    const relogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${relogin.body.data.accessToken}`)
      .set('Origin', e2eTrustedOrigin())
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${relogin.body.data.accessToken}`)
      .expect(401);
  });

  it('rejects unknown email and wrong password with the same code', async () => {
    const unknown = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'missing@hector.local', password })
      .expect(401);

    const wrong = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'definitely-wrong-password' })
      .expect(401);

    expect(unknown.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('supports multiple sessions and logout-all', async () => {
    const first = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);

    const second = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);

    const sessions = await request(app.getHttpServer())
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${second.body.data.accessToken}`)
      .expect(200);

    const activeCount = sessions.body.data.filter(
      (session: { revoked: boolean }) => !session.revoked,
    ).length;
    expect(activeCount).toBeGreaterThanOrEqual(2);

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${second.body.data.accessToken}`)
      .set('Origin', e2eTrustedOrigin())
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${first.body.data.accessToken}`)
      .expect(401);

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${second.body.data.accessToken}`)
      .expect(401);
  });

  it('prevents revoking another user session and handles concurrent refresh', async () => {
    const pouria = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);

    const ahmad = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'ahmad@hector.local', password })
      .expect(200);

    const ahmadSessions = await request(app.getHttpServer())
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${ahmad.body.data.accessToken}`)
      .expect(200);

    const foreignSessionId = ahmadSessions.body.data[0].id as string;

    await request(app.getHttpServer())
      .delete(`/api/v1/auth/sessions/${foreignSessionId}`)
      .set('Authorization', `Bearer ${pouria.body.data.accessToken}`)
      .set('Origin', e2eTrustedOrigin())
      .expect(404);

    const refreshCookie = extractRefreshCookie(pouria.headers['set-cookie']);
    expect(refreshCookie).toBeDefined();

    const origin = e2eTrustedOrigin();
    const [firstRefresh, secondRefresh] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', refreshCookie!)
        .set('Origin', origin),
      request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', refreshCookie!)
        .set('Origin', origin),
    ]);

    const statuses = [firstRefresh.status, secondRefresh.status].sort();
    expect(statuses).toEqual([200, 401]);
  });

  it('denies suspended users', async () => {
    await database.client.user.update({
      where: { email },
      data: { status: UserStatus.SUSPENDED },
    });

    try {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(401);
    } finally {
      await database.client.user.update({
        where: { email },
        data: { status: UserStatus.ACTIVE },
      });
    }
  });
});
