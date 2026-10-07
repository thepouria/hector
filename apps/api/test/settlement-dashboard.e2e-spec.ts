import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { syncOwnerRolePermissions, syncPermissions, UserStatus } from '@hector/database';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';

describe('Settlement Dashboard (e2e) Phase 6.5', () => {
  let app: INestApplication;
  let database: DatabaseService;
  const ownerEmail = 'pouria@hector.local';
  let pishtehId: string;

  beforeAll(async () => {
    app = await createE2eApp();
    database = app.get(DatabaseService);
    await syncPermissions(database.client);
    await syncOwnerRolePermissions(database.client);
    pishtehId = (
      await database.client.company.findUniqueOrThrow({ where: { slug: 'pishteh' } })
    ).id;
    await database.client.user.update({
      where: { email: ownerEmail },
      data: { status: UserStatus.ACTIVE, deletedAt: null },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  async function login() {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password: E2E_PASSWORD })
      .expect(200);
    return res.body.data.accessToken as string;
  }

  it('STL65-001: dashboard returns currency-aware KPIs without combining currencies', async () => {
    const token = await login();
    const res = await request(app.getHttpServer())
      .get('/api/v1/settlements/dashboard')
      .set({ Authorization: `Bearer ${token}`, 'X-Company-Id': pishtehId })
      .expect(200);

    expect(res.body.data).toMatchObject({
      semantics: {
        currenciesNeverCombined: true,
        outstandingIsNotDiscrepancy: true,
        financeRemainsMoneyTruth: true,
      },
    });
    expect(res.body.data.kpis).toEqual(
      expect.objectContaining({
        openPayableCount: expect.any(Number),
        overduePayableCount: expect.any(Number),
        openLoanCount: expect.any(Number),
        openChannelSettlementCount: expect.any(Number),
        needsMatchingCount: expect.any(Number),
        openDiscrepancyCount: expect.any(Number),
        underReviewCount: expect.any(Number),
      }),
    );
    expect(Array.isArray(res.body.data.outstandingPayablesByCurrency)).toBe(true);
    expect(Array.isArray(res.body.data.outstandingLoansByCurrency)).toBe(true);
    expect(Array.isArray(res.body.data.attentionQueue)).toBe(true);
    expect(Array.isArray(res.body.data.recent.channelSettlements)).toBe(true);
    expect(Array.isArray(res.body.data.recent.reconciliations)).toBe(true);

    for (const row of res.body.data.outstandingPayablesByCurrency) {
      expect(row).toEqual(
        expect.objectContaining({
          currency: expect.any(String),
          amount: expect.any(String),
          count: expect.any(Number),
        }),
      );
    }
  });

  it('STL65-002: dashboard requires company context and auth', async () => {
    await request(app.getHttpServer()).get('/api/v1/settlements/dashboard').expect(401);

    const token = await login();
    await request(app.getHttpServer())
      .get('/api/v1/settlements/dashboard')
      .set({ Authorization: `Bearer ${token}` })
      .expect(400);
  });
});
