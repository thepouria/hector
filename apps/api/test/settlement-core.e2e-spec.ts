import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  CurrencyCode,
  PaymentPurposeType,
  PaymentStatus,
  SettlementAllocationStatus,
  SettlementFinanceTxnType,
  SettlementSourceType,
  SettlementStatus,
  syncOwnerRolePermissions,
  syncPermissions,
  UserStatus,
} from '@hector/database';
import type { INestApplication } from '@nestjs/common';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';

describe('Settlement Allocation Core (e2e) Phase 6.1', () => {
  let app: INestApplication;
  let database: DatabaseService;
  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;
  let pishtehId: string;
  let demoBId: string;
  let bankIrrId: string;
  let cashUsdId: string;
  const createdPaymentIds: string[] = [];
  const createdSettlementIds: string[] = [];
  const createdObligationIds: string[] = [];

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
    bankIrrId = (
      await database.client.financialAccount.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'BANK-MELLAT-IRR' },
      })
    ).id;
    cashUsdId = (
      await database.client.financialAccount.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'CASH-USD' },
      })
    ).id;
  });

  afterAll(async () => {
    if (createdSettlementIds.length > 0) {
      await database.client.settlementAllocation.deleteMany({
        where: { settlementId: { in: createdSettlementIds } },
      });
      await database.client.settlementItem.deleteMany({
        where: { settlementId: { in: createdSettlementIds } },
      });
      await database.client.settlement.deleteMany({
        where: { id: { in: createdSettlementIds } },
      });
    }
    if (createdObligationIds.length > 0) {
      await database.client.settlementManualObligation.deleteMany({
        where: { id: { in: createdObligationIds } },
      });
    }
    if (createdPaymentIds.length > 0) {
      const reversalPayments = await database.client.payment.findMany({
        where: { reversalOfId: { in: createdPaymentIds } },
        select: { id: true },
      });
      const reversalPaymentIds = reversalPayments.map((p) => p.id);
      const allPaymentIds = [...createdPaymentIds, ...reversalPaymentIds];
      const payJournals = await database.client.journalEntry.findMany({
        where: { sourceType: 'PAYMENT', sourceId: { in: allPaymentIds } },
        select: { id: true },
      });
      const payIds = payJournals.map((j) => j.id);
      const payReversals = await database.client.journalEntry.findMany({
        where: { reversalOfId: { in: payIds } },
        select: { id: true },
      });
      const allPayJournalIds = [...payIds, ...payReversals.map((j) => j.id)];
      if (allPayJournalIds.length > 0) {
        await database.client.journalLine.deleteMany({
          where: { journalEntryId: { in: allPayJournalIds } },
        });
        await database.client.journalEntry.updateMany({
          where: { id: { in: allPayJournalIds } },
          data: { reversalOfId: null },
        });
        await database.client.journalEntry.deleteMany({
          where: { id: { in: allPayJournalIds } },
        });
      }
      await database.client.financialAccountMovement.deleteMany({
        where: { sourceType: 'PAYMENT', sourceId: { in: allPaymentIds } },
      });
      await database.client.payment.updateMany({
        where: { id: { in: createdPaymentIds } },
        data: { reversalOfId: null },
      });
      if (reversalPaymentIds.length > 0) {
        await database.client.payment.deleteMany({ where: { id: { in: reversalPaymentIds } } });
      }
      await database.client.payment.deleteMany({ where: { id: { in: createdPaymentIds } } });
    }
    await app.close();
  });

  async function login(email: string): Promise<string> {
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

  async function createPostedPayment(
    token: string,
    amount: string,
    opts: { accountId?: string; companyId?: string; currency?: CurrencyCode } = {},
  ): Promise<string> {
    const companyId = opts.companyId ?? pishtehId;
    const res = await request(app.getHttpServer())
      .post('/api/v1/finance/payments')
      .set(auth(token, companyId))
      .send({
        accountId: opts.accountId ?? bankIrrId,
        amount,
        purposeType: PaymentPurposeType.OTHER,
        requestId: randomUUID(),
        postImmediately: true,
      })
      .expect(201);
    const id = res.body.data.id as string;
    createdPaymentIds.push(id);
    expect(res.body.data.status).toBe(PaymentStatus.POSTED);
    return id;
  }

  async function createObligation(
    token: string,
    amount: string,
    currency: CurrencyCode = CurrencyCode.IRR,
    companyId = pishtehId,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/settlements/manual-obligations')
      .set(auth(token, companyId))
      .send({ currency, originalAmount: amount })
      .expect(201);
    const id = res.body.data.id as string;
    createdObligationIds.push(id);
    return id;
  }

  async function createOpenSettlement(
    token: string,
    obligationId: string,
    currency: CurrencyCode = CurrencyCode.IRR,
  ) {
    const create = await request(app.getHttpServer())
      .post('/api/v1/settlements')
      .set(auth(token))
      .send({ currency, requestId: randomUUID() })
      .expect(201);
    const settlementId = create.body.data.id as string;
    createdSettlementIds.push(settlementId);
    expect(create.body.data.number).toMatch(/^STL-\d{6,}$/);
    expect(create.body.data.status).toBe(SettlementStatus.DRAFT);

    await request(app.getHttpServer())
      .post(`/api/v1/settlements/${settlementId}/items`)
      .set(auth(token))
      .send({
        sourceType: SettlementSourceType.MANUAL_OBLIGATION,
        sourceId: obligationId,
      })
      .expect(201);

    const opened = await request(app.getHttpServer())
      .post(`/api/v1/settlements/${settlementId}/open`)
      .set(auth(token))
      .expect(200);
    expect(opened.body.data.status).toBe(SettlementStatus.OPEN);
    return {
      settlementId,
      itemId: opened.body.data.items[0].id as string,
    };
  }

  it('STL-CORE-001: partial allocation → PARTIALLY_SETTLED', async () => {
    const token = await login(ownerEmail);
    const obligationId = await createObligation(token, '500000000');
    const paymentId = await createPostedPayment(token, '200000000');
    const { settlementId, itemId } = await createOpenSettlement(token, obligationId);

    const alloc = await request(app.getHttpServer())
      .post(`/api/v1/settlements/${settlementId}/allocations`)
      .set(auth(token))
      .send({
        settlementItemId: itemId,
        financeTxnType: SettlementFinanceTxnType.PAYMENT,
        financeTxnId: paymentId,
        amount: '200000000',
        requestId: randomUUID(),
      })
      .expect(201);

    expect(alloc.body.data.status).toBe(SettlementStatus.PARTIALLY_SETTLED);
    expect(alloc.body.data.totals.allocatedAmount).toBe('200000000');
    expect(alloc.body.data.totals.remainingAmount).toBe('300000000');
    expect(alloc.body.data.items[0].derivedStatus).toBe('PARTIALLY_SETTLED');
  });

  it('STL-CORE-002: multiple payments → one obligation SETTLED', async () => {
    const token = await login(ownerEmail);
    const obligationId = await createObligation(token, '500000000');
    const p1 = await createPostedPayment(token, '200000000');
    const p2 = await createPostedPayment(token, '250000000');
    const p3 = await createPostedPayment(token, '50000000');
    const { settlementId, itemId } = await createOpenSettlement(token, obligationId);

    for (const [paymentId, amount] of [
      [p1, '200000000'],
      [p2, '250000000'],
      [p3, '50000000'],
    ] as const) {
      await request(app.getHttpServer())
        .post(`/api/v1/settlements/${settlementId}/allocations`)
        .set(auth(token))
        .send({
          settlementItemId: itemId,
          financeTxnType: SettlementFinanceTxnType.PAYMENT,
          financeTxnId: paymentId,
          amount,
          requestId: randomUUID(),
        })
        .expect(201);
    }

    const got = await request(app.getHttpServer())
      .get(`/api/v1/settlements/${settlementId}`)
      .set(auth(token))
      .expect(200);
    expect(got.body.data.status).toBe(SettlementStatus.SETTLED);
    expect(got.body.data.totals.remainingAmount).toBe('0');
    expect(
      got.body.data.allocations.filter(
        (a: { status: string }) => a.status === SettlementAllocationStatus.ACTIVE,
      ),
    ).toHaveLength(3);
  });

  it('STL-CORE-003: one payment → multiple obligations', async () => {
    const token = await login(ownerEmail);
    const o1 = await createObligation(token, '300000000');
    const o2 = await createObligation(token, '200000000');
    const paymentId = await createPostedPayment(token, '500000000');

    const s1 = await createOpenSettlement(token, o1);
    const s2 = await createOpenSettlement(token, o2);

    await request(app.getHttpServer())
      .post(`/api/v1/settlements/${s1.settlementId}/allocations`)
      .set(auth(token))
      .send({
        settlementItemId: s1.itemId,
        financeTxnType: SettlementFinanceTxnType.PAYMENT,
        financeTxnId: paymentId,
        amount: '300000000',
        requestId: randomUUID(),
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/settlements/${s2.settlementId}/allocations`)
      .set(auth(token))
      .send({
        settlementItemId: s2.itemId,
        financeTxnType: SettlementFinanceTxnType.PAYMENT,
        financeTxnId: paymentId,
        amount: '200000000',
        requestId: randomUUID(),
      })
      .expect(201);

    const o3 = await createObligation(token, '100000000');
    const s3 = await createOpenSettlement(token, o3);
    const over = await request(app.getHttpServer())
      .post(`/api/v1/settlements/${s3.settlementId}/allocations`)
      .set(auth(token))
      .send({
        settlementItemId: s3.itemId,
        financeTxnType: SettlementFinanceTxnType.PAYMENT,
        financeTxnId: paymentId,
        amount: '1',
        requestId: randomUUID(),
      })
      .expect(409);
    expect(over.body.error.code).toBe('SETTLEMENT_OVER_ALLOCATE_PAYMENT');
  });

  it('STL-CORE-004: rejects zero/negative and over-settle', async () => {
    const token = await login(ownerEmail);
    const obligationId = await createObligation(token, '100000000');
    const paymentId = await createPostedPayment(token, '100000000');
    const { settlementId, itemId } = await createOpenSettlement(token, obligationId);

    await request(app.getHttpServer())
      .post(`/api/v1/settlements/${settlementId}/allocations`)
      .set(auth(token))
      .send({
        settlementItemId: itemId,
        financeTxnType: SettlementFinanceTxnType.PAYMENT,
        financeTxnId: paymentId,
        amount: '0',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/api/v1/settlements/${settlementId}/allocations`)
      .set(auth(token))
      .send({
        settlementItemId: itemId,
        financeTxnType: SettlementFinanceTxnType.PAYMENT,
        financeTxnId: paymentId,
        amount: '-10',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/api/v1/settlements/${settlementId}/allocations`)
      .set(auth(token))
      .send({
        settlementItemId: itemId,
        financeTxnType: SettlementFinanceTxnType.PAYMENT,
        financeTxnId: paymentId,
        amount: '100000001',
        requestId: randomUUID(),
      })
      .expect(409);
  });

  it('STL-CORE-005: reverse restores PARTIALLY_SETTLED / OPEN; payment untouched', async () => {
    const token = await login(ownerEmail);
    const obligationId = await createObligation(token, '500000000');
    const paymentId = await createPostedPayment(token, '500000000');
    const { settlementId, itemId } = await createOpenSettlement(token, obligationId);

    const settled = await request(app.getHttpServer())
      .post(`/api/v1/settlements/${settlementId}/allocations`)
      .set(auth(token))
      .send({
        settlementItemId: itemId,
        financeTxnType: SettlementFinanceTxnType.PAYMENT,
        financeTxnId: paymentId,
        amount: '500000000',
        requestId: randomUUID(),
      })
      .expect(201);
    expect(settled.body.data.status).toBe(SettlementStatus.SETTLED);
    const allocationId = settled.body.data.allocations[0].id as string;

    const paymentBefore = await request(app.getHttpServer())
      .get(`/api/v1/finance/payments/${paymentId}`)
      .set(auth(token))
      .expect(200);
    expect(paymentBefore.body.data.amount).toBe('500000000');
    expect(paymentBefore.body.data.status).toBe(PaymentStatus.POSTED);

    const reversed = await request(app.getHttpServer())
      .post(`/api/v1/settlements/${settlementId}/allocations/${allocationId}/reverse`)
      .set(auth(token))
      .send({ reason: 'wrong payable match' })
      .expect(200);
    expect(reversed.body.data.status).toBe(SettlementStatus.OPEN);
    expect(reversed.body.data.totals.allocatedAmount).toBe('0');
    expect(reversed.body.data.allocations[0].status).toBe(SettlementAllocationStatus.REVERSED);
    expect(reversed.body.data.allocations[0].reverseReason).toBe('wrong payable match');

    const paymentAfter = await request(app.getHttpServer())
      .get(`/api/v1/finance/payments/${paymentId}`)
      .set(auth(token))
      .expect(200);
    expect(paymentAfter.body.data.amount).toBe('500000000');
    expect(paymentAfter.body.data.status).toBe(PaymentStatus.POSTED);

    // partial reverse path: re-allocate then reverse portion via full reverse of one of two
    await request(app.getHttpServer())
      .post(`/api/v1/settlements/${settlementId}/allocations`)
      .set(auth(token))
      .send({
        settlementItemId: itemId,
        financeTxnType: SettlementFinanceTxnType.PAYMENT,
        financeTxnId: paymentId,
        amount: '400000000',
        requestId: randomUUID(),
      })
      .expect(201);
    const a2 = await request(app.getHttpServer())
      .post(`/api/v1/settlements/${settlementId}/allocations`)
      .set(auth(token))
      .send({
        settlementItemId: itemId,
        financeTxnType: SettlementFinanceTxnType.PAYMENT,
        financeTxnId: paymentId,
        amount: '100000000',
        requestId: randomUUID(),
      })
      .expect(201);
    expect(a2.body.data.status).toBe(SettlementStatus.SETTLED);
    const lastActive = a2.body.data.allocations.find(
      (a: { status: string; amount: string }) =>
        a.status === SettlementAllocationStatus.ACTIVE && a.amount === '100000000',
    );
    const afterPartial = await request(app.getHttpServer())
      .post(`/api/v1/settlements/${settlementId}/allocations/${lastActive.id}/reverse`)
      .set(auth(token))
      .send({ reason: 'correct down' })
      .expect(200);
    expect(afterPartial.body.data.status).toBe(SettlementStatus.PARTIALLY_SETTLED);
    expect(afterPartial.body.data.totals.allocatedAmount).toBe('400000000');
    expect(afterPartial.body.data.totals.remainingAmount).toBe('100000000');
  });

  it('STL-CORE-006: cancel blocked with ACTIVE allocations; allowed after reverse', async () => {
    const token = await login(ownerEmail);
    const obligationId = await createObligation(token, '100000000');
    const paymentId = await createPostedPayment(token, '100000000');
    const { settlementId, itemId } = await createOpenSettlement(token, obligationId);
    const alloc = await request(app.getHttpServer())
      .post(`/api/v1/settlements/${settlementId}/allocations`)
      .set(auth(token))
      .send({
        settlementItemId: itemId,
        financeTxnType: SettlementFinanceTxnType.PAYMENT,
        financeTxnId: paymentId,
        amount: '100000000',
        requestId: randomUUID(),
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/settlements/${settlementId}/cancel`)
      .set(auth(token))
      .expect(409);

    await request(app.getHttpServer())
      .post(
        `/api/v1/settlements/${settlementId}/allocations/${alloc.body.data.allocations[0].id}/reverse`,
      )
      .set(auth(token))
      .send({})
      .expect(200);

    const cancelled = await request(app.getHttpServer())
      .post(`/api/v1/settlements/${settlementId}/cancel`)
      .set(auth(token))
      .expect(200);
    expect(cancelled.body.data.status).toBe(SettlementStatus.CANCELLED);
  });

  it('STL-CORE-007: tenant isolation on payment / obligation / settlement', async () => {
    const token = await login(ownerEmail);
    const obligationId = await createObligation(token, '100000000');
    const paymentId = await createPostedPayment(token, '100000000');
    const { settlementId, itemId } = await createOpenSettlement(token, obligationId);

    await request(app.getHttpServer())
      .get(`/api/v1/settlements/${settlementId}`)
      .set(auth(token, demoBId))
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/v1/settlements/${settlementId}/allocations`)
      .set(auth(token, demoBId))
      .send({
        settlementItemId: itemId,
        financeTxnType: SettlementFinanceTxnType.PAYMENT,
        financeTxnId: paymentId,
        amount: '100000000',
        requestId: randomUUID(),
      })
      .expect(404);

    // Cross-company finance txn id under company A header
    const foreignPayment = await database.client.payment.findFirst({
      where: { companyId: demoBId, status: PaymentStatus.POSTED },
      select: { id: true },
    });
    if (foreignPayment) {
      await request(app.getHttpServer())
        .post(`/api/v1/settlements/${settlementId}/allocations`)
        .set(auth(token))
        .send({
          settlementItemId: itemId,
          financeTxnType: SettlementFinanceTxnType.PAYMENT,
          financeTxnId: foreignPayment.id,
          amount: '1',
          requestId: randomUUID(),
        })
        .expect(404);
    }
  });

  it('STL-CORE-008: cross-currency allocation rejected in 6.1', async () => {
    const token = await login(ownerEmail);
    const obligationId = await createObligation(token, '100.00', CurrencyCode.USD);
    const paymentId = await createPostedPayment(token, '100000000'); // IRR
    const create = await request(app.getHttpServer())
      .post('/api/v1/settlements')
      .set(auth(token))
      .send({ currency: CurrencyCode.USD, requestId: randomUUID() })
      .expect(201);
    createdSettlementIds.push(create.body.data.id);

    await request(app.getHttpServer())
      .post(`/api/v1/settlements/${create.body.data.id}/items`)
      .set(auth(token))
      .send({
        sourceType: SettlementSourceType.MANUAL_OBLIGATION,
        sourceId: obligationId,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/settlements/${create.body.data.id}/open`)
      .set(auth(token))
      .expect(200);

    const itemId = (
      await request(app.getHttpServer())
        .get(`/api/v1/settlements/${create.body.data.id}`)
        .set(auth(token))
        .expect(200)
    ).body.data.items[0].id as string;

    const res = await request(app.getHttpServer())
      .post(`/api/v1/settlements/${create.body.data.id}/allocations`)
      .set(auth(token))
      .send({
        settlementItemId: itemId,
        financeTxnType: SettlementFinanceTxnType.PAYMENT,
        financeTxnId: paymentId,
        amount: '100.00',
        requestId: randomUUID(),
      })
      .expect(409);
    expect(res.body.error.code).toBe('SETTLEMENT_FX_RATE_REQUIRED');

    // Same-currency USD foundation works
    const usdPay = await createPostedPayment(token, '100.00', {
      accountId: cashUsdId,
    });
    const ok = await request(app.getHttpServer())
      .post(`/api/v1/settlements/${create.body.data.id}/allocations`)
      .set(auth(token))
      .send({
        settlementItemId: itemId,
        financeTxnType: SettlementFinanceTxnType.PAYMENT,
        financeTxnId: usdPay,
        amount: '100.00',
        requestId: randomUUID(),
      })
      .expect(201);
    expect(ok.body.data.status).toBe(SettlementStatus.SETTLED);
  });

  it('STL-CORE-009: idempotency same key + conflict on payload change', async () => {
    const token = await login(ownerEmail);
    const obligationId = await createObligation(token, '200000000');
    const paymentId = await createPostedPayment(token, '200000000');
    const { settlementId, itemId } = await createOpenSettlement(token, obligationId);
    const requestId = randomUUID();

    const first = await request(app.getHttpServer())
      .post(`/api/v1/settlements/${settlementId}/allocations`)
      .set(auth(token))
      .send({
        settlementItemId: itemId,
        financeTxnType: SettlementFinanceTxnType.PAYMENT,
        financeTxnId: paymentId,
        amount: '100000000',
        requestId,
      })
      .expect(201);

    const retry = await request(app.getHttpServer())
      .post(`/api/v1/settlements/${settlementId}/allocations`)
      .set(auth(token))
      .send({
        settlementItemId: itemId,
        financeTxnType: SettlementFinanceTxnType.PAYMENT,
        financeTxnId: paymentId,
        amount: '100000000',
        requestId,
      })
      .expect(201);
    expect(
      retry.body.data.allocations.filter(
        (a: { status: string }) => a.status === SettlementAllocationStatus.ACTIVE,
      ),
    ).toHaveLength(1);
    expect(retry.body.data.allocations[0].id).toBe(first.body.data.allocations[0].id);

    await request(app.getHttpServer())
      .post(`/api/v1/settlements/${settlementId}/allocations`)
      .set(auth(token))
      .send({
        settlementItemId: itemId,
        financeTxnType: SettlementFinanceTxnType.PAYMENT,
        financeTxnId: paymentId,
        amount: '50000000',
        requestId,
      })
      .expect(409);
  });

  it('STL-CORE-010: payment race cannot over-allocate', async () => {
    const token = await login(ownerEmail);
    const o1 = await createObligation(token, '100000000');
    const o2 = await createObligation(token, '100000000');
    const paymentId = await createPostedPayment(token, '100000000');
    const s1 = await createOpenSettlement(token, o1);
    const s2 = await createOpenSettlement(token, o2);

    const results = await Promise.allSettled([
      request(app.getHttpServer())
        .post(`/api/v1/settlements/${s1.settlementId}/allocations`)
        .set(auth(token))
        .send({
          settlementItemId: s1.itemId,
          financeTxnType: SettlementFinanceTxnType.PAYMENT,
          financeTxnId: paymentId,
          amount: '80000000',
          requestId: randomUUID(),
        }),
      request(app.getHttpServer())
        .post(`/api/v1/settlements/${s2.settlementId}/allocations`)
        .set(auth(token))
        .send({
          settlementItemId: s2.itemId,
          financeTxnType: SettlementFinanceTxnType.PAYMENT,
          financeTxnId: paymentId,
          amount: '80000000',
          requestId: randomUUID(),
        }),
    ]);

    const statuses = results.map((r) =>
      r.status === 'fulfilled' ? r.value.status : 0,
    );
    const ok = statuses.filter((s) => s === 201).length;
    const conflict = statuses.filter((s) => s === 409).length;
    expect(ok).toBe(1);
    expect(conflict).toBe(1);

    const active = await database.client.settlementAllocation.aggregate({
      where: {
        companyId: pishtehId,
        paymentId,
        status: SettlementAllocationStatus.ACTIVE,
      },
      _sum: { amount: true },
    });
    expect(Number(active._sum.amount?.toString() ?? '0')).toBeLessThanOrEqual(100000000);
  });

  it('STL-CORE-011: obligation race cannot over-settle', async () => {
    const token = await login(ownerEmail);
    const obligationId = await createObligation(token, '100000000');
    const p1 = await createPostedPayment(token, '100000000');
    const p2 = await createPostedPayment(token, '100000000');
    const { settlementId, itemId } = await createOpenSettlement(token, obligationId);

    const results = await Promise.allSettled([
      request(app.getHttpServer())
        .post(`/api/v1/settlements/${settlementId}/allocations`)
        .set(auth(token))
        .send({
          settlementItemId: itemId,
          financeTxnType: SettlementFinanceTxnType.PAYMENT,
          financeTxnId: p1,
          amount: '80000000',
          requestId: randomUUID(),
        }),
      request(app.getHttpServer())
        .post(`/api/v1/settlements/${settlementId}/allocations`)
        .set(auth(token))
        .send({
          settlementItemId: itemId,
          financeTxnType: SettlementFinanceTxnType.PAYMENT,
          financeTxnId: p2,
          amount: '80000000',
          requestId: randomUUID(),
        }),
    ]);

    const statuses = results.map((r) =>
      r.status === 'fulfilled' ? r.value.status : 0,
    );
    expect(statuses.filter((s) => s === 201).length).toBe(1);
    expect(statuses.filter((s) => s === 409).length).toBe(1);

    const active = await database.client.settlementAllocation.aggregate({
      where: {
        companyId: pishtehId,
        settlementItemId: itemId,
        status: SettlementAllocationStatus.ACTIVE,
      },
      _sum: { amount: true },
    });
    expect(Number(active._sum.amount?.toString() ?? '0')).toBeLessThanOrEqual(100000000);
  });

  it('STL-CORE-012: unsupported fx liability source rejected', async () => {
    const token = await login(ownerEmail);
    const create = await request(app.getHttpServer())
      .post('/api/v1/settlements')
      .set(auth(token))
      .send({ currency: CurrencyCode.IRR, requestId: randomUUID() })
      .expect(201);
    createdSettlementIds.push(create.body.data.id);

    await request(app.getHttpServer())
      .post(`/api/v1/settlements/${create.body.data.id}/items`)
      .set(auth(token))
      .send({
        sourceType: SettlementSourceType.FX_LIABILITY,
        sourceId: randomUUID(),
      })
      .expect(409);
  });
});
