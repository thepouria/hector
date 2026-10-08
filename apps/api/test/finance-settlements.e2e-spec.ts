import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  CompanyMemberStatus,
  CurrencyCode,
  FinancialAccountType,
  FxRateType,
  JournalEntryStatus,
  JournalLineDirection,
  OWNER_ROLE_KEY,
  PaymentPurposeType,
  PaymentStatus,
  SupplierPayableStatus,
  SupplierPaymentAllocationStatus,
  UserStatus,
  syncOwnerRolePermissions,
  syncPermissions,
} from '@hector/database';
import type { INestApplication } from '@nestjs/common';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';
import { createPartyLinkedSupplier } from './helpers/party-linked-supplier';

describe('Finance Liability Settlements (e2e) Phase 4.9', () => {
  let app: INestApplication;
  let database: DatabaseService;
  const ownerEmail = 'pouria@hector.local';
  const warehouseOperatorEmail = 'hossein@hector.local';
  const password = E2E_PASSWORD;
  let pishtehId: string;
  let demoBId: string;
  let ownerUserId: string;
  let bankIrrId: string;
  const tempCompanyIds: string[] = [];
  const createdPayableIds: string[] = [];
  const createdPaymentIds: string[] = [];
  const createdAllocationIds: string[] = [];

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
    ownerUserId = (
      await database.client.user.update({
        where: { email: ownerEmail },
        data: { status: UserStatus.ACTIVE, deletedAt: null },
      })
    ).id;
    bankIrrId = (
      await database.client.financialAccount.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'BANK-MELLAT-IRR' },
      })
    ).id;

    const token = await login(ownerEmail);
    await request(app.getHttpServer())
      .get('/api/v1/finance/ledger-accounts')
      .set(auth(token, pishtehId))
      .expect(200);
  });

  afterAll(async () => {
    if (createdAllocationIds.length > 0) {
      const settleJournals = await database.client.journalEntry.findMany({
        where: {
          sourceType: 'SUPPLIER_PAYMENT_ALLOCATION',
          sourceId: { in: createdAllocationIds },
        },
        select: { id: true },
      });
      const settleIds = settleJournals.map((j) => j.id);
      const reversalRows = await database.client.journalEntry.findMany({
        where: { reversalOfId: { in: settleIds } },
        select: { id: true },
      });
      const reversalIds = reversalRows.map((j) => j.id);
      const allJournalIds = [...settleIds, ...reversalIds];
      if (allJournalIds.length > 0) {
        await database.client.journalLine.deleteMany({
          where: { journalEntryId: { in: allJournalIds } },
        });
        await database.client.journalEntry.updateMany({
          where: { id: { in: allJournalIds } },
          data: { reversalOfId: null },
        });
        if (reversalIds.length > 0) {
          await database.client.journalEntry.deleteMany({
            where: { id: { in: reversalIds } },
          });
        }
        await database.client.journalEntry.deleteMany({
          where: { id: { in: settleIds } },
        });
      }
      await database.client.supplierLiabilityMovement.deleteMany({
        where: { sourceId: { in: createdAllocationIds } },
      });
      await database.client.supplierPaymentAllocation.deleteMany({
        where: { id: { in: createdAllocationIds } },
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
      // Clear reversalOf links before deleting payments
      await database.client.payment.updateMany({
        where: { id: { in: createdPaymentIds } },
        data: { reversalOfId: null },
      });
      if (reversalPaymentIds.length > 0) {
        await database.client.payment.deleteMany({
          where: { id: { in: reversalPaymentIds } },
        });
      }
      await database.client.payment.deleteMany({
        where: { id: { in: createdPaymentIds } },
      });
    }
    if (createdPayableIds.length > 0) {
      await database.client.supplierLiabilityMovement.deleteMany({
        where: { payableId: { in: createdPayableIds } },
      });
      await database.client.supplierPaymentAllocation.deleteMany({
        where: { payableId: { in: createdPayableIds } },
      });
      await database.client.supplierPayable.deleteMany({
        where: { id: { in: createdPayableIds } },
      });
    }
    for (const companyId of tempCompanyIds) {
      await database.client.journalLine.deleteMany({ where: { companyId } });
      await database.client.journalEntry.deleteMany({ where: { companyId } });
      await database.client.supplierPaymentAllocation.deleteMany({ where: { companyId } });
      await database.client.supplierLiabilityMovement.deleteMany({ where: { companyId } });
      await database.client.supplierPayable.deleteMany({ where: { companyId } });
      await database.client.payment.deleteMany({ where: { companyId } });
      await database.client.financialAccountMovement.deleteMany({ where: { companyId } });
      await database.client.financialAccount.updateMany({
        where: { companyId },
        data: { ledgerAccountId: null },
      });
      await database.client.financialAccount.deleteMany({ where: { companyId } });
      await database.client.ledgerAccount.deleteMany({ where: { companyId } });
      await database.client.supplier.deleteMany({ where: { companyId } });
      await database.client.companyMemberRole.deleteMany({
        where: { companyMember: { companyId } },
      });
      await database.client.companyMember.deleteMany({ where: { companyId } });
      await database.client.rolePermission.deleteMany({
        where: { role: { companyId } },
      });
      await database.client.role.deleteMany({ where: { companyId } });
      await database.client.company.delete({ where: { id: companyId } }).catch(() => undefined);
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

  async function createOpeningPayable(
    token: string,
    companyId: string,
    supplierId: string,
    amount: string,
    currency: CurrencyCode = CurrencyCode.IRR,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/finance/payables/opening')
      .set(auth(token, companyId))
      .send({
        supplierId,
        currency,
        amount,
        notes: 'e2e settlement',
        requestId: randomUUID(),
      })
      .expect(201);
    const id = res.body.data.id as string;
    createdPayableIds.push(id);
    return id;
  }

  async function createPostedPayment(
    token: string,
    companyId: string,
    accountId: string,
    amount: string,
    opts: { purposeType?: PaymentPurposeType; currency?: CurrencyCode } = {},
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/finance/payments')
      .set(auth(token, companyId))
      .send({
        accountId,
        amount,
        purposeType: opts.purposeType ?? PaymentPurposeType.SUPPLIER,
        requestId: randomUUID(),
        postImmediately: true,
      })
      .expect(201);
    const id = res.body.data.id as string;
    createdPaymentIds.push(id);
    expect(res.body.data.status).toBe(PaymentStatus.POSTED);
    return id;
  }

  async function ensureSupplier(companyId: string): Promise<string> {
    // Always create a dedicated party-linked supplier so shared-DB suites cannot
    // leave a seed supplier in an unlinkable / inactive-for-payable state.
    const created = await createPartyLinkedSupplier(database.client, {
      companyId,
      code: `SET-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8)}`,
      name: 'Settlement E2E Supplier',
    });
    return created.id;
  }

  it('FIN-SET-001: Payment alone does not reduce liability', async () => {
    const token = await login(ownerEmail);
    const supplierId = await ensureSupplier(pishtehId);
    const payableId = await createOpeningPayable(token, pishtehId, supplierId, '5000000');
    const paymentId = await createPostedPayment(token, pishtehId, bankIrrId, '5000000');

    const after = await request(app.getHttpServer())
      .get(`/api/v1/finance/payables/${payableId}`)
      .set(auth(token))
      .expect(200);
    expect(after.body.data.outstandingAmount).toBe('5000000');
    expect(after.body.data.status).toBe(SupplierPayableStatus.OPEN);

    const settlements = await request(app.getHttpServer())
      .get(`/api/v1/finance/payments/${paymentId}/settlements`)
      .set(auth(token))
      .expect(200);
    expect(settlements.body.data).toEqual([]);
  });

  it('full settle: reduces liability, journal DR SUPPLIER_PAYABLE · CR UNCLASSIFIED_PAYMENTS, no second Bank', async () => {
    const token = await login(ownerEmail);
    const supplierId = await ensureSupplier(pishtehId);
    const payableId = await createOpeningPayable(token, pishtehId, supplierId, '3000000');
    const paymentId = await createPostedPayment(token, pishtehId, bankIrrId, '3000000');

    const settle = await request(app.getHttpServer())
      .post(`/api/v1/finance/payments/${paymentId}/settlements`)
      .set(auth(token))
      .send({
        lines: [{ payableId, liabilityAmount: '3000000' }],
        requestId: randomUUID(),
      })
      .expect(201);

    const alloc = settle.body.data.allocations[0];
    createdAllocationIds.push(alloc.id);
    expect(alloc.status).toBe(SupplierPaymentAllocationStatus.POSTED);
    expect(alloc.liabilityAmountSettled).toBe('3000000');
    expect(alloc.paymentAmountApplied).toBe('3000000');

    const payable = await request(app.getHttpServer())
      .get(`/api/v1/finance/payables/${payableId}`)
      .set(auth(token))
      .expect(200);
    expect(payable.body.data.outstandingAmount).toBe('0');
    expect(payable.body.data.status).toBe(SupplierPayableStatus.PAID);

    const journal = await database.client.journalEntry.findFirst({
      where: {
        companyId: pishtehId,
        sourceType: 'SUPPLIER_PAYMENT_ALLOCATION',
        sourceId: alloc.id,
        effectType: 'SUPPLIER_AP_SETTLEMENT',
        status: JournalEntryStatus.POSTED,
      },
      include: { lines: { include: { ledgerAccount: true } } },
    });
    expect(journal).toBeTruthy();
    const keys = journal!.lines.map((l) => l.ledgerAccount.systemKey).sort();
    expect(keys).toEqual(['SUPPLIER_PAYABLE', 'UNCLASSIFIED_PAYMENTS'].sort());
    expect(
      journal!.lines.some(
        (l) =>
          l.direction === JournalLineDirection.DEBIT &&
          l.ledgerAccount.systemKey === 'SUPPLIER_PAYABLE',
      ),
    ).toBe(true);
    expect(
      journal!.lines.some(
        (l) =>
          l.direction === JournalLineDirection.CREDIT &&
          l.ledgerAccount.systemKey === 'UNCLASSIFIED_PAYMENTS',
      ),
    ).toBe(true);
    expect(journal!.lines.some((l) => l.ledgerAccount.systemKey === 'CASH_AND_BANK')).toBe(
      false,
    );

    const bankMoves = await database.client.financialAccountMovement.count({
      where: { companyId: pishtehId, sourceType: 'PAYMENT', sourceId: paymentId },
    });
    expect(bankMoves).toBe(1);
  });

  it('partial + multi-liability from one payment; over-settle rejected; idempotent', async () => {
    const token = await login(ownerEmail);
    const supplierId = await ensureSupplier(pishtehId);
    const a = await createOpeningPayable(token, pishtehId, supplierId, '2000000');
    const b = await createOpeningPayable(token, pishtehId, supplierId, '3000000');
    const paymentId = await createPostedPayment(token, pishtehId, bankIrrId, '4000000');
    const requestId = randomUUID();

    const settle = await request(app.getHttpServer())
      .post(`/api/v1/finance/payments/${paymentId}/settlements`)
      .set(auth(token))
      .send({
        requestId,
        lines: [
          { payableId: a, liabilityAmount: '1500000' },
          { payableId: b, liabilityAmount: '2500000' },
        ],
      })
      .expect(201);
    for (const alloc of settle.body.data.allocations) {
      createdAllocationIds.push(alloc.id);
    }
    expect(settle.body.data.allocations).toHaveLength(2);

    const replay = await request(app.getHttpServer())
      .post(`/api/v1/finance/payments/${paymentId}/settlements`)
      .set(auth(token))
      .send({
        requestId,
        lines: [
          { payableId: a, liabilityAmount: '1500000' },
          { payableId: b, liabilityAmount: '2500000' },
        ],
      })
      .expect(201);
    expect(replay.body.data.allocations.map((x: { id: string }) => x.id).sort()).toEqual(
      settle.body.data.allocations.map((x: { id: string }) => x.id).sort(),
    );

    await request(app.getHttpServer())
      .post(`/api/v1/finance/payables/${a}/settle`)
      .set(auth(token))
      .send({ paymentId, liabilityAmount: '1000000' })
      .expect(409);

    const overPay = await createPostedPayment(token, pishtehId, bankIrrId, '1000');
    await request(app.getHttpServer())
      .post(`/api/v1/finance/payments/${overPay}/settlements`)
      .set(auth(token))
      .send({ lines: [{ payableId: b, liabilityAmount: '500000' }] })
      .expect(409);
  });

  it('payment reverse restores liability and reverses settlement journal', async () => {
    const token = await login(ownerEmail);
    const supplierId = await ensureSupplier(pishtehId);
    const payableId = await createOpeningPayable(token, pishtehId, supplierId, '2500000');
    const paymentId = await createPostedPayment(token, pishtehId, bankIrrId, '2500000');

    const settle = await request(app.getHttpServer())
      .post(`/api/v1/finance/payments/${paymentId}/settlements`)
      .set(auth(token))
      .send({ lines: [{ payableId, liabilityAmount: '2500000' }], requestId: randomUUID() })
      .expect(201);
    const allocId = settle.body.data.allocations[0].id as string;
    createdAllocationIds.push(allocId);

    await request(app.getHttpServer())
      .post(`/api/v1/finance/payments/${paymentId}/reverse`)
      .set(auth(token))
      .send({ reason: 'e2e reverse settlement' })
      .expect(200);

    const payable = await request(app.getHttpServer())
      .get(`/api/v1/finance/payables/${payableId}`)
      .set(auth(token))
      .expect(200);
    expect(payable.body.data.outstandingAmount).toBe('2500000');
    expect(payable.body.data.status).toBe(SupplierPayableStatus.OPEN);

    const alloc = await database.client.supplierPaymentAllocation.findFirstOrThrow({
      where: { id: allocId },
    });
    expect(alloc.status).toBe(SupplierPaymentAllocationStatus.REVERSED);

    const journal = await database.client.journalEntry.findFirst({
      where: {
        sourceType: 'SUPPLIER_PAYMENT_ALLOCATION',
        sourceId: allocId,
        effectType: 'SUPPLIER_AP_SETTLEMENT',
      },
    });
    expect(journal?.status).toBe(JournalEntryStatus.REVERSED);
  });

  it('cross-currency settle requires SETTLEMENT rate and posts FX difference', async () => {
    const token = await login(ownerEmail);
    const supplierId = await ensureSupplier(pishtehId);

    const payableRes = await request(app.getHttpServer())
      .post('/api/v1/finance/payables/opening')
      .set(auth(token))
      .send({
        supplierId,
        currency: CurrencyCode.USD,
        amount: '100',
        notes: 'e2e fx settle',
        requestId: randomUUID(),
      })
      .expect(201);
    const payableId = payableRes.body.data.id as string;
    createdPayableIds.push(payableId);

    // Opening USD payable needs reference FX for carrying base — set on payable.
    await database.client.supplierPayable.update({
      where: { id: payableId },
      data: {
        referenceFxRate: '250000',
        referenceFxBaseCurrency: CurrencyCode.USD,
        referenceFxQuoteCurrency: CurrencyCode.IRR,
      },
    });

    const rate = await request(app.getHttpServer())
      .post('/api/v1/finance/fx/rates')
      .set(auth(token))
      .send({
        baseCurrency: CurrencyCode.USD,
        quoteCurrency: CurrencyCode.IRR,
        rate: '260000',
        rateType: FxRateType.SETTLEMENT,
        effectiveAt: new Date().toISOString(),
      })
      .expect(201);

    const paymentId = await createPostedPayment(token, pishtehId, bankIrrId, '26000000');

    await request(app.getHttpServer())
      .post(`/api/v1/finance/payments/${paymentId}/settlements`)
      .set(auth(token))
      .send({
        lines: [{ payableId, liabilityAmount: '100', paymentAmount: '26000000' }],
      })
      .expect(409);

    const settle = await request(app.getHttpServer())
      .post(`/api/v1/finance/payments/${paymentId}/settlements`)
      .set(auth(token))
      .send({
        lines: [
          {
            payableId,
            liabilityAmount: '100',
            paymentAmount: '26000000',
            settlementFxRateId: rate.body.data.id,
          },
        ],
        requestId: randomUUID(),
      })
      .expect(201);
    const alloc = settle.body.data.allocations[0];
    createdAllocationIds.push(alloc.id);
    expect(Number(alloc.fxDifferenceBase)).toBe(1000000); // 26M − 25M carrying

    const journal = await database.client.journalEntry.findFirst({
      where: {
        sourceId: alloc.id,
        effectType: 'SUPPLIER_AP_SETTLEMENT',
        status: JournalEntryStatus.POSTED,
      },
      include: { lines: { include: { ledgerAccount: true } } },
    });
    expect(journal).toBeTruthy();
    expect(journal!.lines.some((l) => l.ledgerAccount.systemKey === 'FX_LOSS')).toBe(true);
    expect(journal!.lines.some((l) => l.ledgerAccount.systemKey === 'CASH_AND_BANK')).toBe(
      false,
    );
  });

  it('concurrency: parallel settle cannot over-allocate payment', async () => {
    const token = await login(ownerEmail);
    const supplierId = await ensureSupplier(pishtehId);
    const a = await createOpeningPayable(token, pishtehId, supplierId, '5000000');
    const b = await createOpeningPayable(token, pishtehId, supplierId, '5000000');
    const paymentId = await createPostedPayment(token, pishtehId, bankIrrId, '5000000');

    const [r1, r2] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/finance/payments/${paymentId}/settlements`)
        .set(auth(token))
        .send({
          lines: [{ payableId: a, liabilityAmount: '5000000' }],
          requestId: randomUUID(),
        }),
      request(app.getHttpServer())
        .post(`/api/v1/finance/payments/${paymentId}/settlements`)
        .set(auth(token))
        .send({
          lines: [{ payableId: b, liabilityAmount: '5000000' }],
          requestId: randomUUID(),
        }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);
    const ok = r1.status === 201 ? r1 : r2;
    for (const alloc of ok.body.data.allocations) {
      createdAllocationIds.push(alloc.id);
    }
  });

  it('IDOR: other company cannot read/settle', async () => {
    const token = await login(ownerEmail);
    const supplierId = await ensureSupplier(pishtehId);
    const payableId = await createOpeningPayable(token, pishtehId, supplierId, '1000000');
    const paymentId = await createPostedPayment(token, pishtehId, bankIrrId, '1000000');

    await request(app.getHttpServer())
      .get(`/api/v1/finance/payments/${paymentId}/settlements`)
      .set(auth(token, demoBId))
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/v1/finance/payments/${paymentId}/settlements`)
      .set(auth(token, demoBId))
      .send({ lines: [{ payableId, liabilityAmount: '1000000' }] })
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/v1/finance/payables/${payableId}/settle`)
      .set(auth(token, demoBId))
      .send({ paymentId, liabilityAmount: '1000000' })
      .expect(404);
  });

  it('warehouse operator without settlements.manage is forbidden', async () => {
    const token = await login(warehouseOperatorEmail);
    const supplierId = await ensureSupplier(pishtehId);
    const payableId = await createOpeningPayable(
      await login(ownerEmail),
      pishtehId,
      supplierId,
      '500000',
    );
    const paymentId = await createPostedPayment(
      await login(ownerEmail),
      pishtehId,
      bankIrrId,
      '500000',
    );

    await request(app.getHttpServer())
      .post(`/api/v1/finance/payments/${paymentId}/settlements`)
      .set(auth(token))
      .send({ lines: [{ payableId, liabilityAmount: '500000' }] })
      .expect(403);
  });

  it('temp company: settle via payables/:id/settle endpoint', async () => {
    const token = await login(ownerEmail);
    const slug = `set-tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const company = await database.client.company.create({
      data: {
        name: `Settle Temp ${slug}`,
        slug,
        baseCurrency: CurrencyCode.IRR,
        timezone: 'Asia/Tehran',
      },
    });
    tempCompanyIds.push(company.id);
    const role = await database.client.role.create({
      data: { companyId: company.id, key: OWNER_ROLE_KEY, name: 'Owner', isSystem: true },
    });
    const template = await database.client.role.findFirstOrThrow({
      where: { companyId: pishtehId, key: OWNER_ROLE_KEY, deletedAt: null },
      include: { permissions: { select: { permissionId: true } } },
    });
    await database.client.rolePermission.createMany({
      data: template.permissions.map((p) => ({
        roleId: role.id,
        permissionId: p.permissionId,
      })),
      skipDuplicates: true,
    });
    const membership = await database.client.companyMember.create({
      data: {
        companyId: company.id,
        userId: ownerUserId,
        status: CompanyMemberStatus.ACTIVE,
      },
    });
    await database.client.companyMemberRole.create({
      data: { companyMemberId: membership.id, roleId: role.id },
    });

    await request(app.getHttpServer())
      .get('/api/v1/finance/ledger-accounts')
      .set(auth(token, company.id))
      .expect(200);

    const bank = await request(app.getHttpServer())
      .post('/api/v1/finance/accounts')
      .set(auth(token, company.id))
      .send({
        code: 'BANK-IRR',
        name: 'Bank',
        type: FinancialAccountType.BANK,
        currency: CurrencyCode.IRR,
        isDefault: true,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/finance/accounts/${bank.body.data.id}/opening-balance`)
      .set(auth(token, company.id))
      .send({ amount: '100000000', requestId: randomUUID() })
      .expect(200);

    const supplierId = await ensureSupplier(company.id);
    const payableId = await createOpeningPayable(token, company.id, supplierId, '8000000');
    const paymentId = await createPostedPayment(
      token,
      company.id,
      bank.body.data.id,
      '8000000',
    );

    const settle = await request(app.getHttpServer())
      .post(`/api/v1/finance/payables/${payableId}/settle`)
      .set(auth(token, company.id))
      .send({ paymentId, liabilityAmount: '8000000', requestId: randomUUID() })
      .expect(201);
    createdAllocationIds.push(settle.body.data.allocations[0].id);
  });
});
