import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  CurrencyCode,
  FxRateSourceType,
  PaymentPurposeType,
  PaymentStatus,
  Prisma,
  SettlementAllocationStatus,
  SettlementStatus,
  syncOwnerRolePermissions,
  syncPermissions,
  UserStatus,
} from '@hector/database';
import type { INestApplication } from '@nestjs/common';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';
import { createPartyLinkedSupplier } from './helpers/party-linked-supplier';

describe('Settlement Payables + Loans + FX (e2e) Phase 6.2', () => {
  let app: INestApplication;
  let database: DatabaseService;
  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;
  let pishtehId: string;
  let demoBId: string;
  let bankIrrId: string;
  let cashUsdId: string;
  const createdPaymentIds: string[] = [];
  const createdPayableIds: string[] = [];
  const createdLoanIds: string[] = [];
  const createdSettlementIds: string[] = [];

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
    const settlements = await database.client.settlement.findMany({
      where: {
        OR: [
          { id: { in: createdSettlementIds } },
          { companyId: pishtehId, type: { in: ['SUPPLIER_PAYABLE', 'LOAN'] } },
        ],
      },
      select: { id: true },
    });
    const settlementIds = [
      ...new Set([...createdSettlementIds, ...settlements.map((s) => s.id)]),
    ];
    if (settlementIds.length > 0) {
      const allocIds = (
        await database.client.settlementAllocation.findMany({
          where: { settlementId: { in: settlementIds } },
          select: { id: true },
        })
      ).map((a) => a.id);
      if (allocIds.length > 0) {
        await database.client.settlementAllocationFxDetail.deleteMany({
          where: { allocationId: { in: allocIds } },
        });
        await database.client.supplierLiabilityMovement.deleteMany({
          where: {
            sourceType: 'SETTLEMENT_ALLOCATION',
            sourceId: { in: allocIds },
          },
        });
      }
      await database.client.settlementAllocation.deleteMany({
        where: { settlementId: { in: settlementIds } },
      });
      await database.client.settlementItem.deleteMany({
        where: { settlementId: { in: settlementIds } },
      });
      await database.client.settlement.deleteMany({ where: { id: { in: settlementIds } } });
    }
    if (createdPayableIds.length > 0) {
      await database.client.supplierLiabilityMovement.deleteMany({
        where: { payableId: { in: createdPayableIds } },
      });
      await database.client.supplierPayable.deleteMany({
        where: { id: { in: createdPayableIds } },
      });
    }
    if (createdLoanIds.length > 0) {
      await database.client.loanRepayment.deleteMany({
        where: { loanId: { in: createdLoanIds } },
      });
      await database.client.loanDisbursement.deleteMany({
        where: { loanId: { in: createdLoanIds } },
      });
      await database.client.loan.deleteMany({ where: { id: { in: createdLoanIds } } });
    }
    if (createdPaymentIds.length > 0) {
      const payJournals = await database.client.journalEntry.findMany({
        where: { sourceType: 'PAYMENT', sourceId: { in: createdPaymentIds } },
        select: { id: true },
      });
      const payIds = payJournals.map((j) => j.id);
      if (payIds.length > 0) {
        await database.client.journalLine.deleteMany({
          where: { journalEntryId: { in: payIds } },
        });
        await database.client.journalEntry.deleteMany({ where: { id: { in: payIds } } });
      }
      await database.client.financialAccountMovement.deleteMany({
        where: { sourceType: 'PAYMENT', sourceId: { in: createdPaymentIds } },
      });
      await database.client.payment.deleteMany({ where: { id: { in: createdPaymentIds } } });
    }
    await app.close();
  });

  async function login(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password })
      .expect(200);
    return res.body.data.accessToken as string;
  }

  function auth(token: string, companyId = pishtehId) {
    return { Authorization: `Bearer ${token}`, 'X-Company-Id': companyId };
  }

  async function createPostedPayment(
    token: string,
    amount: string,
    accountId = bankIrrId,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/finance/payments')
      .set(auth(token))
      .send({
        accountId,
        amount,
        purposeType: PaymentPurposeType.OTHER,
        requestId: randomUUID(),
        postImmediately: true,
      })
      .expect(201);
    createdPaymentIds.push(res.body.data.id);
    expect(res.body.data.status).toBe(PaymentStatus.POSTED);
    return res.body.data.id as string;
  }

  async function createOpeningPayable(
    token: string,
    amount: string,
    currency: CurrencyCode = CurrencyCode.IRR,
  ): Promise<string> {
    let supplier = await database.client.supplier.findFirst({
      where: { companyId: pishtehId, status: 'ACTIVE' },
    });
    if (!supplier) {
      supplier = await createPartyLinkedSupplier(database.client, {
        companyId: pishtehId,
        code: `STL62-${Date.now().toString(36).toUpperCase()}`,
        name: 'Settlement 6.2 Supplier',
      });
    }
    const res = await request(app.getHttpServer())
      .post('/api/v1/finance/payables/opening')
      .set(auth(token))
      .send({
        supplierId: supplier.id,
        currency,
        amount,
        notes: '6.2 e2e',
        requestId: randomUUID(),
      })
      .expect(201);
    createdPayableIds.push(res.body.data.id);
    return res.body.data.id as string;
  }

  async function createUsdOpeningPayable(token: string, amount: string): Promise<string> {
    const supplier = await database.client.supplier.findFirstOrThrow({
      where: { companyId: pishtehId, status: 'ACTIVE' },
    });
    const owner = await database.client.user.findUniqueOrThrow({
      where: { email: ownerEmail },
    });
    const number = `SP-E2E-${Date.now().toString(36).toUpperCase()}`;
    const payable = await database.client.supplierPayable.create({
      data: {
        companyId: pishtehId,
        number,
        supplierId: supplier.id,
        purchaseType: 'OPENING',
        currency: CurrencyCode.USD,
        referenceFxRate: new Prisma.Decimal('250000'),
        referenceFxBaseCurrency: CurrencyCode.USD,
        referenceFxQuoteCurrency: CurrencyCode.IRR,
        status: 'OPEN',
        recognizedAt: new Date(),
        requestId: randomUUID(),
        movements: {
          create: {
            supplierId: supplier.id,
            direction: 'INCREASE',
            type: 'OPENING_BALANCE',
            amount,
            currency: CurrencyCode.USD,
            sourceType: 'OPENING_BALANCE',
            sourceId: randomUUID(),
            effectiveAt: new Date(),
            createdById: owner.id,
          },
        },
      },
    });
    createdPayableIds.push(payable.id);
    void token;
    return payable.id;
  }

  async function createLoan(
    token: string,
    opts: {
      currency: CurrencyCode;
      principal: string;
      accountId: string;
      referenceFxRate?: string;
    },
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/finance/loans')
      .set(auth(token))
      .send({
        lenderType: 'PARTNER',
        lenderName: 'Ahmad',
        currency: opts.currency,
        contractedPrincipal: opts.principal,
        ...(opts.referenceFxRate
          ? {
              referenceFxRate: opts.referenceFxRate,
              referenceFxBaseCurrency: CurrencyCode.USD,
              referenceFxQuoteCurrency: CurrencyCode.IRR,
            }
          : {}),
        receivingAccountId: opts.accountId,
        firstDisbursement: {
          accountId: opts.accountId,
          amount: opts.principal,
        },
        postImmediately: true,
        requestId: randomUUID(),
      })
      .expect(201);
    createdLoanIds.push(res.body.data.id);
    return res.body.data.id as string;
  }

  function trackSettlement(body: { id?: string; data?: { id: string } }) {
    const id = body.id ?? body.data?.id;
    if (id) createdSettlementIds.push(id);
  }

  it('STL62-001: partial + multi IRR payable settlement', async () => {
    const token = await login();
    const payableId = await createOpeningPayable(token, '500000000');
    const p1 = await createPostedPayment(token, '200000000');
    const p2 = await createPostedPayment(token, '300000000');

    const partial = await request(app.getHttpServer())
      .post(`/api/v1/settlements/payables/${payableId}/settle`)
      .set(auth(token))
      .send({ paymentId: p1, amount: '200000000', requestId: randomUUID() })
      .expect(201);
    trackSettlement(partial.body.data);
    expect(partial.body.data.status).toBe(SettlementStatus.PARTIALLY_SETTLED);
    expect(partial.body.data.totals.remainingAmount).toBe('300000000');

    const done = await request(app.getHttpServer())
      .post(`/api/v1/settlements/payables/${payableId}/settle`)
      .set(auth(token))
      .send({ paymentId: p2, amount: '300000000', requestId: randomUUID() })
      .expect(201);
    trackSettlement(done.body.data);
    expect(done.body.data.status).toBe(SettlementStatus.SETTLED);

    const summary = await request(app.getHttpServer())
      .get(`/api/v1/settlements/payables/${payableId}`)
      .set(auth(token))
      .expect(200);
    expect(summary.body.data.outstandingAmount).toBe('0');
    expect(summary.body.data.status).toBe('PAID');
  });

  it('STL62-002: one payment → multiple payables; over-settle rejected', async () => {
    const token = await login();
    const a = await createOpeningPayable(token, '300000000');
    const b = await createOpeningPayable(token, '200000000');
    const paymentId = await createPostedPayment(token, '500000000');

    const s1 = await request(app.getHttpServer())
      .post(`/api/v1/settlements/payables/${a}/settle`)
      .set(auth(token))
      .send({ paymentId, amount: '300000000', requestId: randomUUID() })
      .expect(201);
    trackSettlement(s1.body.data);
    const s2 = await request(app.getHttpServer())
      .post(`/api/v1/settlements/payables/${b}/settle`)
      .set(auth(token))
      .send({ paymentId, amount: '200000000', requestId: randomUUID() })
      .expect(201);
    trackSettlement(s2.body.data);

    const c = await createOpeningPayable(token, '100000000');
    await request(app.getHttpServer())
      .post(`/api/v1/settlements/payables/${c}/settle`)
      .set(auth(token))
      .send({ paymentId, amount: '1', requestId: randomUUID() })
      .expect(409);
  });

  it('STL62-003: allocation reverse restores payable outstanding; payment untouched', async () => {
    const token = await login();
    const payableId = await createOpeningPayable(token, '100000000');
    const paymentId = await createPostedPayment(token, '100000000');
    const settled = await request(app.getHttpServer())
      .post(`/api/v1/settlements/payables/${payableId}/settle`)
      .set(auth(token))
      .send({ paymentId, amount: '100000000', requestId: randomUUID() })
      .expect(201);
    trackSettlement(settled.body.data);
    const allocationId = settled.body.data.allocations[0].id as string;

    await request(app.getHttpServer())
      .post(
        `/api/v1/settlements/${settled.body.data.id}/allocations/${allocationId}/reverse`,
      )
      .set(auth(token))
      .send({ reason: 'wrong match' })
      .expect(200);

    const summary = await request(app.getHttpServer())
      .get(`/api/v1/settlements/payables/${payableId}`)
      .set(auth(token))
      .expect(200);
    expect(summary.body.data.outstandingAmount).toBe('100000000');

    const payment = await request(app.getHttpServer())
      .get(`/api/v1/finance/payments/${paymentId}`)
      .set(auth(token))
      .expect(200);
    expect(payment.body.data.amount).toBe('100000000');
    expect(payment.body.data.status).toBe(PaymentStatus.POSTED);
  });

  it('STL62-004: IRR loan partial/multi repayment + capital isolation', async () => {
    const token = await login();
    const capitalBefore = await request(app.getHttpServer())
      .get('/api/v1/finance/capital-contributions/summary')
      .set(auth(token))
      .expect(200);

    const loanId = await createLoan(token, {
      currency: CurrencyCode.IRR,
      principal: '500000000',
      accountId: bankIrrId,
    });
    const p1 = await createPostedPayment(token, '100000000');
    const p2 = await createPostedPayment(token, '150000000');

    const r1 = await request(app.getHttpServer())
      .post(`/api/v1/settlements/loans/${loanId}/repay`)
      .set(auth(token))
      .send({ paymentId: p1, amount: '100000000', requestId: randomUUID() })
      .expect(201);
    trackSettlement(r1.body.data);

    const mid = await request(app.getHttpServer())
      .get(`/api/v1/settlements/loans/${loanId}`)
      .set(auth(token))
      .expect(200);
    expect(mid.body.data.outstandingPrincipal).toBe('400000000');

    const r2 = await request(app.getHttpServer())
      .post(`/api/v1/settlements/loans/${loanId}/repay`)
      .set(auth(token))
      .send({ paymentId: p2, amount: '150000000', requestId: randomUUID() })
      .expect(201);
    trackSettlement(r2.body.data);

    const after = await request(app.getHttpServer())
      .get(`/api/v1/settlements/loans/${loanId}`)
      .set(auth(token))
      .expect(200);
    expect(after.body.data.outstandingPrincipal).toBe('250000000');
    expect(after.body.data.status).toBe('PARTIALLY_REPAID');

    const capitalAfter = await request(app.getHttpServer())
      .get('/api/v1/finance/capital-contributions/summary')
      .set(auth(token))
      .expect(200);
    expect(capitalAfter.body.data.byCurrency[0].total).toBe(
      capitalBefore.body.data.byCurrency[0].total,
    );
  });

  it('STL62-005: USD loan same-currency + FX IRR repayments (mixed)', async () => {
    const token = await login();
    const loanId = await createLoan(token, {
      currency: CurrencyCode.USD,
      principal: '10000',
      accountId: cashUsdId,
      referenceFxRate: '250000',
    });

    const usdPay = await createPostedPayment(token, '2000', cashUsdId);
    const r1 = await request(app.getHttpServer())
      .post(`/api/v1/settlements/loans/${loanId}/repay`)
      .set(auth(token))
      .send({ paymentId: usdPay, amount: '2000', requestId: randomUUID() })
      .expect(201);
    trackSettlement(r1.body.data);

    let summary = await request(app.getHttpServer())
      .get(`/api/v1/settlements/loans/${loanId}`)
      .set(auth(token))
      .expect(200);
    expect(summary.body.data.outstandingPrincipal).toBe('8000');
    expect(summary.body.data.referenceFxRate).toBe('250000');

    const irrPay1 = await createPostedPayment(token, '900000000');
    const r2 = await request(app.getHttpServer())
      .post(`/api/v1/settlements/loans/${loanId}/repay`)
      .set(auth(token))
      .send({
        paymentId: irrPay1,
        amount: '3000',
        paymentAmount: '900000000',
        fx: {
          rate: '300000',
          rateBaseCurrency: CurrencyCode.USD,
          rateQuoteCurrency: CurrencyCode.IRR,
          rateSourceType: FxRateSourceType.MANUAL,
        },
        requestId: randomUUID(),
      })
      .expect(201);
    trackSettlement(r2.body.data);
    expect(r2.body.data.allocations.at(-1).fx.rate).toBe('300000');

    summary = await request(app.getHttpServer())
      .get(`/api/v1/settlements/loans/${loanId}`)
      .set(auth(token))
      .expect(200);
    expect(summary.body.data.outstandingPrincipal).toBe('5000');

    const irrPay2 = await createPostedPayment(token, '1500000000');
    const r3 = await request(app.getHttpServer())
      .post(`/api/v1/settlements/loans/${loanId}/repay`)
      .set(auth(token))
      .send({
        paymentId: irrPay2,
        amount: '5000',
        paymentAmount: '1500000000',
        fx: {
          rate: '300000',
          rateBaseCurrency: CurrencyCode.USD,
          rateQuoteCurrency: CurrencyCode.IRR,
        },
        requestId: randomUUID(),
      })
      .expect(201);
    trackSettlement(r3.body.data);

    summary = await request(app.getHttpServer())
      .get(`/api/v1/settlements/loans/${loanId}`)
      .set(auth(token))
      .expect(200);
    expect(summary.body.data.outstandingPrincipal).toBe('0');
    expect(summary.body.data.status).toBe('SETTLED');
    expect(summary.body.data.referenceFxRate).toBe('250000');
  });

  it('STL62-006: USD payable FX partial at different rates + reverse restores USD', async () => {
    const token = await login();
    const payableId = await createUsdOpeningPayable(token, '1000');

    const pay1 = await createPostedPayment(token, '100000000');
    const s1 = await request(app.getHttpServer())
      .post(`/api/v1/settlements/payables/${payableId}/settle`)
      .set(auth(token))
      .send({
        paymentId: pay1,
        amount: '400',
        paymentAmount: '100000000',
        fx: {
          rate: '250000',
          rateBaseCurrency: CurrencyCode.USD,
          rateQuoteCurrency: CurrencyCode.IRR,
        },
        requestId: randomUUID(),
      })
      .expect(201);
    trackSettlement(s1.body.data);

    let summary = await request(app.getHttpServer())
      .get(`/api/v1/settlements/payables/${payableId}`)
      .set(auth(token))
      .expect(200);
    expect(summary.body.data.outstandingAmount).toBe('600');
    expect(summary.body.data.currency).toBe(CurrencyCode.USD);
    expect(summary.body.data.referenceFxRate).toBe('250000');

    const pay2 = await createPostedPayment(token, '165000000');
    const s2 = await request(app.getHttpServer())
      .post(`/api/v1/settlements/payables/${payableId}/settle`)
      .set(auth(token))
      .send({
        paymentId: pay2,
        amount: '600',
        paymentAmount: '165000000',
        fx: {
          rate: '275000',
          rateBaseCurrency: CurrencyCode.USD,
          rateQuoteCurrency: CurrencyCode.IRR,
        },
        requestId: randomUUID(),
      })
      .expect(201);
    trackSettlement(s2.body.data);
    expect(s2.body.data.allocations.some((a: { fx?: { rate: string } }) => a.fx?.rate === '250000')).toBe(
      true,
    );
    expect(s2.body.data.allocations.some((a: { fx?: { rate: string } }) => a.fx?.rate === '275000')).toBe(
      true,
    );

    summary = await request(app.getHttpServer())
      .get(`/api/v1/settlements/payables/${payableId}`)
      .set(auth(token))
      .expect(200);
    expect(summary.body.data.outstandingAmount).toBe('0');
    expect(summary.body.data.referenceFxRate).toBe('250000');

    // Reverse last FX allocation
    const lastFx = s2.body.data.allocations.find(
      (a: { status: string; fx?: { rate: string } }) =>
        a.status === SettlementAllocationStatus.ACTIVE && a.fx?.rate === '275000',
    );
    await request(app.getHttpServer())
      .post(`/api/v1/settlements/${s2.body.data.id}/allocations/${lastFx.id}/reverse`)
      .set(auth(token))
      .send({ reason: 'rate correction' })
      .expect(200);

    summary = await request(app.getHttpServer())
      .get(`/api/v1/settlements/payables/${payableId}`)
      .set(auth(token))
      .expect(200);
    expect(summary.body.data.outstandingAmount).toBe('600');
  });

  it('STL62-007: FX validation rejects missing/inconsistent rate; tenant isolation', async () => {
    const token = await login();
    const payableId = await createUsdOpeningPayable(token, '100');
    const irrPay = await createPostedPayment(token, '28000000');

    await request(app.getHttpServer())
      .post(`/api/v1/settlements/payables/${payableId}/settle`)
      .set(auth(token))
      .send({ paymentId: irrPay, amount: '100', requestId: randomUUID() })
      .expect(409);

    await request(app.getHttpServer())
      .post(`/api/v1/settlements/payables/${payableId}/settle`)
      .set(auth(token))
      .send({
        paymentId: irrPay,
        amount: '100',
        paymentAmount: '28000000',
        fx: {
          rate: '0',
          rateBaseCurrency: CurrencyCode.USD,
          rateQuoteCurrency: CurrencyCode.IRR,
        },
        requestId: randomUUID(),
      })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/api/v1/settlements/payables/${payableId}/settle`)
      .set(auth(token, demoBId))
      .send({
        paymentId: irrPay,
        amount: '100',
        paymentAmount: '28000000',
        fx: {
          rate: '280000',
          rateBaseCurrency: CurrencyCode.USD,
          rateQuoteCurrency: CurrencyCode.IRR,
        },
        requestId: randomUUID(),
      })
      .expect(404);
  });

  it('STL62-008: outstanding queries group by currency; idempotent settle', async () => {
    const token = await login();
    await createOpeningPayable(token, '111000000');
    const list = await request(app.getHttpServer())
      .get('/api/v1/settlements/outstanding/payables')
      .set(auth(token))
      .expect(200);
    expect(list.body.meta.totalsByCurrency.IRR).toBeDefined();

    const payableId = await createOpeningPayable(token, '50000000');
    const paymentId = await createPostedPayment(token, '50000000');
    const requestId = randomUUID();
    const first = await request(app.getHttpServer())
      .post(`/api/v1/settlements/payables/${payableId}/settle`)
      .set(auth(token))
      .send({ paymentId, amount: '50000000', requestId })
      .expect(201);
    trackSettlement(first.body.data);
    const retry = await request(app.getHttpServer())
      .post(`/api/v1/settlements/payables/${payableId}/settle`)
      .set(auth(token))
      .send({ paymentId, amount: '50000000', requestId })
      .expect(201);
    expect(
      retry.body.data.allocations.filter(
        (a: { status: string }) => a.status === SettlementAllocationStatus.ACTIVE,
      ),
    ).toHaveLength(1);
  });

  it('STL62-009: payable race cannot over-settle', async () => {
    const token = await login();
    const payableId = await createOpeningPayable(token, '100000000');
    const p1 = await createPostedPayment(token, '100000000');
    const p2 = await createPostedPayment(token, '100000000');

    const results = await Promise.allSettled([
      request(app.getHttpServer())
        .post(`/api/v1/settlements/payables/${payableId}/settle`)
        .set(auth(token))
        .send({ paymentId: p1, amount: '80000000', requestId: randomUUID() }),
      request(app.getHttpServer())
        .post(`/api/v1/settlements/payables/${payableId}/settle`)
        .set(auth(token))
        .send({ paymentId: p2, amount: '80000000', requestId: randomUUID() }),
    ]);
    const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value.status : 0));
    expect(statuses.filter((s) => s === 201).length).toBe(1);
    expect(statuses.filter((s) => s === 409).length).toBe(1);
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.status === 201) {
        trackSettlement(r.value.body.data);
      }
    }

    const summary = await request(app.getHttpServer())
      .get(`/api/v1/settlements/payables/${payableId}`)
      .set(auth(token))
      .expect(200);
    expect(Number(summary.body.data.outstandingAmount)).toBeLessThanOrEqual(100000000);
    expect(Number(summary.body.data.settledAmount)).toBeLessThanOrEqual(100000000);
  });
});
