import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  CurrencyCode,
  JournalEntryStatus,
  JournalLineDirection,
  UserStatus,
  syncOwnerRolePermissions,
  syncPermissions,
} from '@hector/database';
import type { INestApplication } from '@nestjs/common';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';

/**
 * Phase 4.10 smoke: general-ledger, trial-balance, company-scoped lists.
 * Does not invent Sales/Profit.
 */
describe('Finance API + UI smoke (e2e) Phase 4.10', () => {
  let app: INestApplication;
  let database: DatabaseService;
  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;
  let pishtehId: string;
  let demoBId: string;

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

    await database.client.user.update({
      where: { email: ownerEmail },
      data: { status: UserStatus.ACTIVE, deletedAt: null },
    });

    const token = await login(ownerEmail);
    await request(app.getHttpServer())
      .get('/api/v1/finance/ledger-accounts')
      .set(auth(token, pishtehId))
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return res.body.data.accessToken as string;
  }

  function auth(token: string, companyId: string) {
    return {
      Authorization: `Bearer ${token}`,
      'x-company-id': companyId,
    };
  }

  it('requires ledgerAccountId for general-ledger', async () => {
    const token = await login(ownerEmail);
    await request(app.getHttpServer())
      .get('/api/v1/finance/general-ledger')
      .set(auth(token, pishtehId))
      .expect(400);
  });

  it('returns general-ledger with running balance for a ledger account', async () => {
    const token = await login(ownerEmail);
    const equity = await database.client.ledgerAccount.findFirstOrThrow({
      where: { companyId: pishtehId, systemKey: 'CAPITAL_EQUITY' },
    });
    const bankCoa = await database.client.ledgerAccount.findFirstOrThrow({
      where: {
        companyId: pishtehId,
        OR: [{ systemKey: 'CASH_AND_BANK' }, { code: { startsWith: '1' } }],
      },
      orderBy: { code: 'asc' },
    });

    // Ensure at least one posted line exists via manual journal
    const requestId = randomUUID();
    const created = await request(app.getHttpServer())
      .post('/api/v1/finance/journals/manual')
      .set(auth(token, pishtehId))
      .send({
        description: '4.10 GL smoke',
        requestId,
        postImmediately: true,
        lines: [
          {
            ledgerAccountId: bankCoa.id,
            direction: JournalLineDirection.DEBIT,
            originalAmount: '1000',
            originalCurrency: CurrencyCode.IRR,
            baseAmount: '1000',
          },
          {
            ledgerAccountId: equity.id,
            direction: JournalLineDirection.CREDIT,
            originalAmount: '1000',
            originalCurrency: CurrencyCode.IRR,
            baseAmount: '1000',
          },
        ],
      })
      .expect(201);

    expect(created.body.data.status).toBe(JournalEntryStatus.POSTED);

    const gl = await request(app.getHttpServer())
      .get('/api/v1/finance/general-ledger')
      .query({ ledgerAccountId: equity.id, pageSize: 50 })
      .set(auth(token, pishtehId))
      .expect(200);

    expect(gl.body.ledgerAccount.id).toBe(equity.id);
    expect(gl.body.baseCurrency).toBeTruthy();
    expect(Array.isArray(gl.body.data)).toBe(true);
    expect(gl.body.data.length).toBeGreaterThan(0);
    const last = gl.body.data[gl.body.data.length - 1];
    expect(last.runningBalanceBase).toBeDefined();
    expect(gl.body.openingBalanceBase).toBeDefined();
    expect(gl.body.closingBalanceBase).toBeDefined();
  });

  it('trial-balance is company-scoped', async () => {
    const token = await login(ownerEmail);
    const a = await request(app.getHttpServer())
      .get('/api/v1/finance/trial-balance')
      .set(auth(token, pishtehId))
      .expect(200);
    const b = await request(app.getHttpServer())
      .get('/api/v1/finance/trial-balance')
      .set(auth(token, demoBId))
      .expect(200);

    expect(a.body.baseCurrency).toBeTruthy();
    expect(Array.isArray(a.body.data)).toBe(true);
    expect(Array.isArray(b.body.data)).toBe(true);
    // Different companies must not share identical account id sets blindly
    const idsA = new Set((a.body.data as Array<{ ledgerAccountId: string }>).map((r) => r.ledgerAccountId));
    for (const row of b.body.data as Array<{ ledgerAccountId: string }>) {
      expect(idsA.has(row.ledgerAccountId)).toBe(false);
    }
  });

  it('company-scoped list rejects cross-company journal detail', async () => {
    const token = await login(ownerEmail);
    const list = await request(app.getHttpServer())
      .get('/api/v1/finance/journals')
      .query({ pageSize: 1 })
      .set(auth(token, pishtehId))
      .expect(200);

    const journalId = list.body.data?.[0]?.id as string | undefined;
    if (!journalId) return;

    await request(app.getHttpServer())
      .get(`/api/v1/finance/journals/${journalId}`)
      .set(auth(token, demoBId))
      .expect(404);
  });
});
