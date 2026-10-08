import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  ChannelSettlementComponentEffect,
  ChannelSettlementComponentType,
  CurrencyCode,
  ReconciliationDiscrepancyReason,
  ReconciliationResolutionType,
  ReconciliationSourceType,
  ReconciliationStatus,
  ReceiptSourceType,
  syncOwnerRolePermissions,
  syncPermissions,
  UserStatus,
} from '@hector/database';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';

describe('Reconciliation Engine (e2e) Phase 6.4', () => {
  let app: INestApplication;
  let database: DatabaseService;
  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;
  let pishtehId: string;
  const createdReconciliationIds: string[] = [];
  const createdChannelSettlementIds: string[] = [];

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
    for (const id of createdReconciliationIds) {
      await database.client.reconciliationDiscrepancy.deleteMany({
        where: { reconciliationId: id },
      });
      await database.client.reconciliation.deleteMany({ where: { id } });
    }
    for (const id of createdChannelSettlementIds) {
      const items = await database.client.settlementItem.findMany({
        where: { sourceType: 'CHANNEL', sourceId: id },
        select: { id: true, settlementId: true, companyId: true },
      });
      for (const item of items) {
        await database.client.settlementAllocationFxDetail.deleteMany({
          where: {
            allocation: { settlementItemId: item.id, companyId: item.companyId },
          },
        });
        await database.client.settlementAllocation.deleteMany({
          where: { settlementItemId: item.id, companyId: item.companyId },
        });
        await database.client.settlementItem.deleteMany({ where: { id: item.id } });
        await database.client.settlement.deleteMany({ where: { id: item.settlementId } });
      }
      await database.client.channelSettlementComponent.deleteMany({
        where: { channelSettlementId: id },
      });
      await database.client.channelSettlement.deleteMany({ where: { id } });
    }
    await app.close();
  });

  function auth(token: string) {
    return { Authorization: `Bearer ${token}`, 'X-Company-Id': pishtehId };
  }

  async function login() {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password })
      .expect(200);
    return res.body.data.accessToken as string;
  }

  async function fundedBank(token: string, opening = '5000000000') {
    const created = await request(app.getHttpServer())
      .post('/api/v1/finance/accounts')
      .set(auth(token))
      .send({
        code: `BANK-REC-${randomUUID().slice(0, 8)}`,
        name: 'Reconciliation Bank',
        type: 'BANK',
        currency: CurrencyCode.IRR,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/finance/accounts/${created.body.data.id}/opening-balance`)
      .set(auth(token))
      .send({ amount: opening, requestId: randomUUID() })
      .expect(200);
    return created.body.data.id as string;
  }

  async function postedReceipt(token: string, accountId: string, amount: string) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/finance/receipts')
      .set(auth(token))
      .send({
        accountId,
        amount,
        sourceType: ReceiptSourceType.OTHER,
        requestId: randomUUID(),
        postImmediately: true,
      })
      .expect(201);
    return res.body.data.id as string;
  }

  it('REC64-001: Khanoumi channel reconciliation with accepted variance', async () => {
    const token = await login();
    const bankId = await fundedBank(token);
    const chId = (
      await database.client.salesChannel.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'KHANOUMI' },
      })
    ).id;

    const chs = await request(app.getHttpServer())
      .post('/api/v1/settlements/channels')
      .set(auth(token))
      .send({
        channelId: chId,
        periodStart: '2026-09-01T00:00:00.000Z',
        periodEnd: '2026-09-15T23:59:59.999Z',
        currency: CurrencyCode.IRR,
        components: [
          {
            type: ChannelSettlementComponentType.GROSS_SALES,
            effect: ChannelSettlementComponentEffect.INCREASE,
            amount: '2000000000',
          },
          {
            type: ChannelSettlementComponentType.COMMISSION,
            effect: ChannelSettlementComponentEffect.DECREASE,
            amount: '500000000',
          },
          {
            type: ChannelSettlementComponentType.RETURN,
            effect: ChannelSettlementComponentEffect.DECREASE,
            amount: '20000000',
          },
          {
            type: ChannelSettlementComponentType.FEE,
            effect: ChannelSettlementComponentEffect.DECREASE,
            amount: '10000000',
            description: 'Fees',
          },
          {
            type: ChannelSettlementComponentType.ADJUSTMENT,
            effect: ChannelSettlementComponentEffect.INCREASE,
            amount: '5000000',
            description: 'Adj',
          },
        ],
        requestId: randomUUID(),
      })
      .expect(201);
    createdChannelSettlementIds.push(chs.body.data.id);
    await request(app.getHttpServer())
      .post(`/api/v1/settlements/channels/${chs.body.data.id}/finalize`)
      .set(auth(token))
      .expect(200);

    const rec = await request(app.getHttpServer())
      .post('/api/v1/reconciliations')
      .set(auth(token))
      .send({
        sourceType: ReconciliationSourceType.CHANNEL,
        sourceId: chs.body.data.id,
        requestId: randomUUID(),
      })
      .expect(201);
    createdReconciliationIds.push(rec.body.data.id);
    expect(rec.body.data.expectedAmount).toBe('1475000000');

    const r1 = await postedReceipt(token, bankId, '1000000000');
    const r2 = await postedReceipt(token, bankId, '470000000');

    await request(app.getHttpServer())
      .post(`/api/v1/reconciliations/${rec.body.data.id}/match`)
      .set(auth(token))
      .send({
        financeTxnType: 'RECEIPT',
        financeTxnId: r1,
        amount: '1000000000',
        requestId: randomUUID(),
      })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.matchedAmount).toBe('1000000000');
        expect(res.body.data.remainingExpected).toBe('475000000');
        expect(res.body.data.status).toBe(ReconciliationStatus.PARTIALLY_MATCHED);
      });

    await request(app.getHttpServer())
      .post(`/api/v1/reconciliations/${rec.body.data.id}/match`)
      .set(auth(token))
      .send({
        financeTxnType: 'RECEIPT',
        financeTxnId: r2,
        amount: '470000000',
        requestId: randomUUID(),
      })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.matchedAmount).toBe('1470000000');
        expect(res.body.data.remainingExpected).toBe('5000000');
      });

    await request(app.getHttpServer())
      .post(`/api/v1/reconciliations/${rec.body.data.id}/close-matching`)
      .set(auth(token))
      .expect(200)
      .expect((res) => {
        expect(res.body.data.status).toBe(ReconciliationStatus.DISCREPANCY);
        expect(res.body.data.differenceAmount).toBe('-5000000');
        expect(res.body.data.expectedAmount).toBe('1475000000');
        expect(res.body.data.matchedAmount).toBe('1470000000');
      });

    await request(app.getHttpServer())
      .post(`/api/v1/reconciliations/${rec.body.data.id}/discrepancies`)
      .set(auth(token))
      .send({
        amount: '-5000000',
        reasonCode: ReconciliationDiscrepancyReason.BANK_FEE,
        description: 'Bank fee on settlement transfer',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/reconciliations/${rec.body.data.id}/resolve`)
      .set(auth(token))
      .send({
        resolutionType: ReconciliationResolutionType.ACCEPTED_VARIANCE,
        resolutionNotes: 'Accepted bank fee variance',
        requestId: randomUUID(),
      })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.status).toBe(ReconciliationStatus.RESOLVED);
        expect(res.body.data.differenceAmount).toBe('-5000000');
        expect(res.body.data.expectedAmount).toBe('1475000000');
        expect(res.body.data.matchedAmount).toBe('1470000000');
      });

    const chsAfter = await request(app.getHttpServer())
      .get(`/api/v1/settlements/channels/${chs.body.data.id}`)
      .set(auth(token))
      .expect(200);
    expect(chsAfter.body.data.expectedNet).toBe('1475000000');
  });

  it('REC64-002: over-allocate via match is rejected', async () => {
    const token = await login();
    const bankId = await fundedBank(token);
    const chId = (
      await database.client.salesChannel.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'DIGIKALA' },
      })
    ).id;

    const chs = await request(app.getHttpServer())
      .post('/api/v1/settlements/channels')
      .set(auth(token))
      .send({
        channelId: chId,
        periodStart: '2026-10-01T00:00:00.000Z',
        periodEnd: '2026-10-15T23:59:59.999Z',
        currency: CurrencyCode.IRR,
        components: [
          {
            type: ChannelSettlementComponentType.GROSS_SALES,
            effect: ChannelSettlementComponentEffect.INCREASE,
            amount: '900000000',
          },
        ],
        requestId: randomUUID(),
      })
      .expect(201);
    createdChannelSettlementIds.push(chs.body.data.id);
    await request(app.getHttpServer())
      .post(`/api/v1/settlements/channels/${chs.body.data.id}/finalize`)
      .set(auth(token))
      .expect(200);

    const rec = await request(app.getHttpServer())
      .post('/api/v1/reconciliations')
      .set(auth(token))
      .send({
        sourceType: ReconciliationSourceType.CHANNEL,
        sourceId: chs.body.data.id,
        requestId: randomUUID(),
      })
      .expect(201);
    createdReconciliationIds.push(rec.body.data.id);

    const receipt = await postedReceipt(token, bankId, '1000000000');
    await request(app.getHttpServer())
      .post(`/api/v1/reconciliations/${rec.body.data.id}/match`)
      .set(auth(token))
      .send({
        financeTxnType: 'RECEIPT',
        financeTxnId: receipt,
        amount: '1000000000',
        requestId: randomUUID(),
      })
      .expect(409);
  });
});
