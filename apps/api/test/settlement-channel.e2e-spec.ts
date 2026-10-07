import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  ChannelSettlementComponentEffect,
  ChannelSettlementComponentType,
  CurrencyCode,
  ReceiptSourceType,
  syncOwnerRolePermissions,
  syncPermissions,
  UserStatus,
} from '@hector/database';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';

/**
 * Phase 6.3 — Channel Settlement e2e (manual-first, Receipt allocation).
 */
describe('Channel Settlement (e2e) Phase 6.3', () => {
  let app: INestApplication;
  let database: DatabaseService;
  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;
  let pishtehId: string;
  let demoBId: string;

  const createdChannelSettlementIds: string[] = [];

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
  });

  afterAll(async () => {
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
        await database.client.settlementItem.deleteMany({
          where: { id: item.id },
        });
        await database.client.settlement.deleteMany({
          where: { id: item.settlementId },
        });
      }
      await database.client.channelSettlementComponent.deleteMany({
        where: { channelSettlementId: id },
      });
      await database.client.channelSettlement.deleteMany({ where: { id } });
    }
    await app.close();
  });

  function auth(token: string, companyId = pishtehId) {
    return { Authorization: `Bearer ${token}`, 'X-Company-Id': companyId };
  }

  async function login() {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password })
      .expect(200);
    return res.body.data.accessToken as string;
  }

  async function channelId(code: string, companyId = pishtehId) {
    const ch = await database.client.salesChannel.findFirstOrThrow({
      where: { companyId, code },
    });
    return ch.id;
  }

  async function fundedBank(token: string, companyId: string, opening = '5000000000') {
    const created = await request(app.getHttpServer())
      .post('/api/v1/finance/accounts')
      .set(auth(token, companyId))
      .send({
        code: `BANK-CHS-${randomUUID().slice(0, 8)}`,
        name: 'Channel Settlement Bank',
        type: 'BANK',
        currency: CurrencyCode.IRR,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/finance/accounts/${created.body.data.id}/opening-balance`)
      .set(auth(token, companyId))
      .send({
        amount: opening,
        effectiveAt: '2026-09-01T00:00:00.000Z',
        requestId: randomUUID(),
      })
      .expect(200);
    return created.body.data.id as string;
  }

  async function postedReceipt(
    token: string,
    companyId: string,
    accountId: string,
    amount: string,
  ) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/finance/receipts')
      .set(auth(token, companyId))
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

  const khanoumiComponents = [
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
      description: 'Shipping / other fees',
    },
    {
      type: ChannelSettlementComponentType.ADJUSTMENT,
      effect: ChannelSettlementComponentEffect.INCREASE,
      amount: '5000000',
      description: 'Positive marketplace correction',
    },
  ];

  it('STL63-001: Khanoumi expected net + partial/multi receipt → RECEIVED', async () => {
    const token = await login();
    const bankId = await fundedBank(token, pishtehId);
    const chId = await channelId('KHANOUMI');

    const created = await request(app.getHttpServer())
      .post('/api/v1/settlements/channels')
      .set(auth(token))
      .send({
        channelId: chId,
        periodStart: '2026-09-01T00:00:00.000Z',
        periodEnd: '2026-09-15T23:59:59.999Z',
        currency: CurrencyCode.IRR,
        externalReference: `KH-SEP-${randomUUID().slice(0, 8)}`,
        components: khanoumiComponents,
        requestId: randomUUID(),
      })
      .expect(201);
    createdChannelSettlementIds.push(created.body.data.id);
    expect(created.body.data.expectedNet).toBe('1475000000');
    expect(created.body.data.status).toBe('DRAFT');

    await request(app.getHttpServer())
      .post(`/api/v1/settlements/channels/${created.body.data.id}/finalize`)
      .set(auth(token))
      .expect(200)
      .expect((res) => {
        expect(res.body.data.status).toBe('OPEN');
        expect(res.body.data.expectedNet).toBe('1475000000');
      });

    const r1 = await postedReceipt(token, pishtehId, bankId, '1000000000');
    await request(app.getHttpServer())
      .post(`/api/v1/settlements/channels/${created.body.data.id}/allocate-receipt`)
      .set(auth(token))
      .send({ receiptId: r1, amount: '1000000000', requestId: randomUUID() })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.actualReceived).toBe('1000000000');
        expect(res.body.data.outstandingAmount).toBe('475000000');
        expect(res.body.data.status).toBe('PARTIALLY_RECEIVED');
      });

    const r2 = await postedReceipt(token, pishtehId, bankId, '475000000');
    await request(app.getHttpServer())
      .post(`/api/v1/settlements/channels/${created.body.data.id}/allocate-receipt`)
      .set(auth(token))
      .send({ receiptId: r2, amount: '475000000', requestId: randomUUID() })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.actualReceived).toBe('1475000000');
        expect(res.body.data.outstandingAmount).toBe('0');
        expect(res.body.data.status).toBe('RECEIVED');
      });
  });

  it('STL63-002: Digikala + Snapp use same engine; one receipt → two settlements', async () => {
    const token = await login();
    const bankId = await fundedBank(token, pishtehId);
    const digi = await channelId('DIGIKALA');
    const snapp = await channelId('SNAPP_SHOP');

    async function make(channelId: string, gross: string, commission: string) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/settlements/channels')
        .set(auth(token))
        .send({
          channelId,
          periodStart: '2026-09-16T00:00:00.000Z',
          periodEnd: '2026-09-30T23:59:59.999Z',
          currency: CurrencyCode.IRR,
          components: [
            {
              type: ChannelSettlementComponentType.GROSS_SALES,
              effect: ChannelSettlementComponentEffect.INCREASE,
              amount: gross,
            },
            {
              type: ChannelSettlementComponentType.COMMISSION,
              effect: ChannelSettlementComponentEffect.DECREASE,
              amount: commission,
            },
          ],
          requestId: randomUUID(),
        })
        .expect(201);
      createdChannelSettlementIds.push(res.body.data.id);
      await request(app.getHttpServer())
        .post(`/api/v1/settlements/channels/${res.body.data.id}/finalize`)
        .set(auth(token))
        .expect(200);
      return res.body.data;
    }

    const a = await make(digi, '1000000000', '400000000');
    const b = await make(snapp, '800000000', '400000000');
    expect(a.expectedNet).toBe('600000000');
    expect(b.expectedNet).toBe('400000000');

    const receipt = await postedReceipt(token, pishtehId, bankId, '1000000000');
    await request(app.getHttpServer())
      .post(`/api/v1/settlements/channels/${a.id}/allocate-receipt`)
      .set(auth(token))
      .send({ receiptId: receipt, amount: '600000000', requestId: randomUUID() })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/settlements/channels/${b.id}/allocate-receipt`)
      .set(auth(token))
      .send({ receiptId: receipt, amount: '400000000', requestId: randomUUID() })
      .expect(200);

    const aGet = await request(app.getHttpServer())
      .get(`/api/v1/settlements/channels/${a.id}`)
      .set(auth(token))
      .expect(200);
    const bGet = await request(app.getHttpServer())
      .get(`/api/v1/settlements/channels/${b.id}`)
      .set(auth(token))
      .expect(200);
    expect(aGet.body.data.status).toBe('RECEIVED');
    expect(bGet.body.data.status).toBe('RECEIVED');

    await request(app.getHttpServer())
      .post(`/api/v1/settlements/channels/${a.id}/allocate-receipt`)
      .set(auth(token))
      .send({ receiptId: receipt, amount: '1', requestId: randomUUID() })
      .expect(409);
  });

  it('STL63-003: excess receipt cannot over-allocate; edit blocked after allocation', async () => {
    const token = await login();
    const bankId = await fundedBank(token, pishtehId);
    const chId = await channelId('WEBSITE');

    const created = await request(app.getHttpServer())
      .post('/api/v1/settlements/channels')
      .set(auth(token))
      .send({
        channelId: chId,
        periodStart: '2026-08-01T00:00:00.000Z',
        periodEnd: '2026-08-15T23:59:59.999Z',
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
    createdChannelSettlementIds.push(created.body.data.id);
    await request(app.getHttpServer())
      .post(`/api/v1/settlements/channels/${created.body.data.id}/finalize`)
      .set(auth(token))
      .expect(200);

    const receipt = await postedReceipt(token, pishtehId, bankId, '1000000000');
    await request(app.getHttpServer())
      .post(`/api/v1/settlements/channels/${created.body.data.id}/allocate-receipt`)
      .set(auth(token))
      .send({ receiptId: receipt, amount: '1000000000', requestId: randomUUID() })
      .expect(409);

    await request(app.getHttpServer())
      .post(`/api/v1/settlements/channels/${created.body.data.id}/allocate-receipt`)
      .set(auth(token))
      .send({ receiptId: receipt, amount: '900000000', requestId: randomUUID() })
      .expect(200);

    await request(app.getHttpServer())
      .put(`/api/v1/settlements/channels/${created.body.data.id}/components`)
      .set(auth(token))
      .send({
        components: [
          {
            type: ChannelSettlementComponentType.GROSS_SALES,
            effect: ChannelSettlementComponentEffect.INCREASE,
            amount: '800000000',
          },
        ],
      })
      .expect(409);
  });

  it('STL63-004: tenant isolation + idempotent allocate', async () => {
    const token = await login();
    const bankId = await fundedBank(token, pishtehId);
    const chId = await channelId('MANUAL');

    const created = await request(app.getHttpServer())
      .post('/api/v1/settlements/channels')
      .set(auth(token))
      .send({
        channelId: chId,
        periodStart: '2026-07-01T00:00:00.000Z',
        periodEnd: '2026-07-31T23:59:59.999Z',
        currency: CurrencyCode.IRR,
        components: [
          {
            type: ChannelSettlementComponentType.GROSS_SALES,
            effect: ChannelSettlementComponentEffect.INCREASE,
            amount: '100000000',
          },
        ],
        requestId: randomUUID(),
      })
      .expect(201);
    createdChannelSettlementIds.push(created.body.data.id);
    await request(app.getHttpServer())
      .post(`/api/v1/settlements/channels/${created.body.data.id}/finalize`)
      .set(auth(token))
      .expect(200);

    const demoChannel = await database.client.salesChannel.findFirst({
      where: { companyId: demoBId },
    });
    if (demoChannel) {
      await request(app.getHttpServer())
        .post('/api/v1/settlements/channels')
        .set(auth(token, pishtehId))
        .send({
          channelId: demoChannel.id,
          periodStart: '2026-07-01T00:00:00.000Z',
          periodEnd: '2026-07-31T23:59:59.999Z',
          currency: CurrencyCode.IRR,
          components: [
            {
              type: ChannelSettlementComponentType.GROSS_SALES,
              effect: ChannelSettlementComponentEffect.INCREASE,
              amount: '1000',
            },
          ],
          requestId: randomUUID(),
        })
        .expect(404);
    }

    const receipt = await postedReceipt(token, pishtehId, bankId, '100000000');
    const key = randomUUID();
    await request(app.getHttpServer())
      .post(`/api/v1/settlements/channels/${created.body.data.id}/allocate-receipt`)
      .set(auth(token))
      .send({ receiptId: receipt, amount: '100000000', requestId: key })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/settlements/channels/${created.body.data.id}/allocate-receipt`)
      .set(auth(token))
      .send({ receiptId: receipt, amount: '100000000', requestId: key })
      .expect(200);

    const get = await request(app.getHttpServer())
      .get(`/api/v1/settlements/channels/${created.body.data.id}`)
      .set(auth(token))
      .expect(200);
    expect(get.body.data.actualReceived).toBe('100000000');
    expect(get.body.data.status).toBe('RECEIVED');
  });

  it('STL63-005: race cannot over-receive channel settlement', async () => {
    const token = await login();
    const bankId = await fundedBank(token, pishtehId);
    const chId = await channelId('KHANOUMI');

    const created = await request(app.getHttpServer())
      .post('/api/v1/settlements/channels')
      .set(auth(token))
      .send({
        channelId: chId,
        periodStart: '2026-06-01T00:00:00.000Z',
        periodEnd: '2026-06-15T23:59:59.999Z',
        currency: CurrencyCode.IRR,
        components: [
          {
            type: ChannelSettlementComponentType.GROSS_SALES,
            effect: ChannelSettlementComponentEffect.INCREASE,
            amount: '100000000',
          },
        ],
        requestId: randomUUID(),
      })
      .expect(201);
    createdChannelSettlementIds.push(created.body.data.id);
    await request(app.getHttpServer())
      .post(`/api/v1/settlements/channels/${created.body.data.id}/finalize`)
      .set(auth(token))
      .expect(200);

    const rA = await postedReceipt(token, pishtehId, bankId, '80000000');
    const rB = await postedReceipt(token, pishtehId, bankId, '80000000');

    const [a, b] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/settlements/channels/${created.body.data.id}/allocate-receipt`)
        .set(auth(token))
        .send({ receiptId: rA, amount: '80000000', requestId: randomUUID() }),
      request(app.getHttpServer())
        .post(`/api/v1/settlements/channels/${created.body.data.id}/allocate-receipt`)
        .set(auth(token))
        .send({ receiptId: rB, amount: '80000000', requestId: randomUUID() }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const get = await request(app.getHttpServer())
      .get(`/api/v1/settlements/channels/${created.body.data.id}`)
      .set(auth(token))
      .expect(200);
    expect(Number(get.body.data.actualReceived)).toBeLessThanOrEqual(100000000);
  });
});
