import request from 'supertest';
import {
  UserStatus,
  syncOwnerRolePermissions,
  syncPermissions,
} from '@hector/database';
import type { INestApplication } from '@nestjs/common';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';

describe('Sales Dashboard (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;
  let pishtehId: string;
  let demoBId: string;
  let ownerPasswordHash: string;
  let wholesaleChannelId: string;

  beforeAll(async () => {
    app = await createE2eApp();
    database = app.get(DatabaseService);
    await syncPermissions(database.client);
    await syncOwnerRolePermissions(database.client);

    pishtehId = (
      await database.client.company.findUniqueOrThrow({ where: { slug: 'pishteh' } })
    ).id;
    demoBId = (
      await database.client.company.findUniqueOrThrow({ where: { slug: 'hector-demo-b' } })
    ).id;
    wholesaleChannelId = (
      await database.client.salesChannel.findUniqueOrThrow({
        where: { companyId_code: { companyId: pishtehId, code: 'WHOLESALE' } },
      })
    ).id;

    const owner = await database.client.user.update({
      where: { email: ownerEmail },
      data: { status: UserStatus.ACTIVE, deletedAt: null },
    });
    ownerPasswordHash = owner.passwordHash;
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(email: string): Promise<string> {
    await database.client.user.update({
      where: { email: ownerEmail },
      data: {
        status: UserStatus.ACTIVE,
        deletedAt: null,
        passwordHash: ownerPasswordHash,
      },
    });
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return res.body.data.accessToken as string;
  }

  function auth(token: string, companyId = pishtehId) {
    return {
      Authorization: `Bearer ${token}`,
      'X-Company-Id': companyId,
    };
  }

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get('/api/v1/sales/dashboard').expect(401);
  });

  it('returns company-scoped dashboard aggregates', async () => {
    const token = await login(ownerEmail);
    const res = await request(app.getHttpServer())
      .get('/api/v1/sales/dashboard')
      .query({ range: '30d' })
      .set(auth(token))
      .expect(200);

    expect(res.body.data.meta.range.preset).toBe('30d');
    expect(res.body.data.snapshot).toEqual(
      expect.objectContaining({
        openOrders: expect.any(Number),
        confirmedOrders: expect.any(Number),
        processingOrders: expect.any(Number),
        partiallyFulfilledOrders: expect.any(Number),
        pendingFulfillmentUnits: expect.any(Number),
        openReturns: expect.any(Number),
        pendingReturns: expect.any(Number),
      }),
    );
    expect(res.body.data.period).toEqual(
      expect.objectContaining({
        ordersCount: expect.any(Number),
        salesByCurrency: expect.any(Array),
      }),
    );
    expect(Array.isArray(res.body.data.salesByChannel)).toBe(true);
    expect(Array.isArray(res.body.data.recentOrders)).toBe(true);
    expect(res.body.data.outstandingReceivables.source).toBe('CustomerReceivable');
    expect(res.body.data.outstandingReceivables.label).toMatch(/Phase 6/i);
  });

  it('filters by channelId and rejects foreign channel', async () => {
    const token = await login(ownerEmail);
    await request(app.getHttpServer())
      .get('/api/v1/sales/dashboard')
      .query({ range: '7d', channelId: wholesaleChannelId })
      .set(auth(token))
      .expect(200);

    const foreignChannel = await database.client.salesChannel.findFirstOrThrow({
      where: { companyId: demoBId },
    });
    await request(app.getHttpServer())
      .get('/api/v1/sales/dashboard')
      .query({ channelId: foreignChannel.id })
      .set(auth(token, pishtehId))
      .expect(404);
  });

  it('rejects invalid custom range without from/to', async () => {
    const token = await login(ownerEmail);
    await request(app.getHttpServer())
      .get('/api/v1/sales/dashboard')
      .query({ range: 'custom' })
      .set(auth(token))
      .expect(400);
  });
});
