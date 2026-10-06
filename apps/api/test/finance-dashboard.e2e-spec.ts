import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  CompanyMemberStatus,
  CurrencyCode,
  FinancialAccountType,
  OWNER_ROLE_KEY,
  PaymentPurposeType,
  ReceiptSourceType,
  UserStatus,
  syncOwnerRolePermissions,
  syncPermissions,
} from '@hector/database';
import type { INestApplication } from '@nestjs/common';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';

describe('Finance Dashboard (e2e) Phase 4.11', () => {
  let app: INestApplication;
  let database: DatabaseService;
  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;
  let pishtehId: string;
  let demoBId: string;
  let ownerUserId: string;
  const tempCompanyIds: string[] = [];
  const createdPayableIds: string[] = [];
  const createdPaymentIds: string[] = [];
  const createdAllocationIds: string[] = [];
  const createdReceiptIds: string[] = [];
  const createdLoanIds: string[] = [];
  const createdAccountIds: string[] = [];
  const createdTransferIds: string[] = [];
  const createdSupplierIds: string[] = [];
  const createdMemberIds: string[] = [];
  const createdRoleIds: string[] = [];
  const createdUserIds: string[] = [];

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
  });

  afterAll(async () => {
    if (createdAllocationIds.length > 0) {
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
      const allPaymentIds = [
        ...createdPaymentIds,
        ...reversalPayments.map((p) => p.id),
      ];
      await database.client.financialAccountMovement.deleteMany({
        where: { sourceType: 'PAYMENT', sourceId: { in: allPaymentIds } },
      });
      await database.client.payment.updateMany({
        where: { id: { in: createdPaymentIds } },
        data: { reversalOfId: null },
      });
      if (reversalPayments.length > 0) {
        await database.client.payment.deleteMany({
          where: { id: { in: reversalPayments.map((p) => p.id) } },
        });
      }
      await database.client.payment.deleteMany({
        where: { id: { in: createdPaymentIds } },
      });
    }
    if (createdReceiptIds.length > 0) {
      const reversalReceipts = await database.client.receipt.findMany({
        where: { reversalOfId: { in: createdReceiptIds } },
        select: { id: true },
      });
      const allReceiptIds = [
        ...createdReceiptIds,
        ...reversalReceipts.map((r) => r.id),
      ];
      await database.client.financialAccountMovement.deleteMany({
        where: { sourceType: 'RECEIPT', sourceId: { in: allReceiptIds } },
      });
      await database.client.receipt.updateMany({
        where: { id: { in: createdReceiptIds } },
        data: { reversalOfId: null },
      });
      if (reversalReceipts.length > 0) {
        await database.client.receipt.deleteMany({
          where: { id: { in: reversalReceipts.map((r) => r.id) } },
        });
      }
      await database.client.receipt.deleteMany({
        where: { id: { in: createdReceiptIds } },
      });
    }
    if (createdTransferIds.length > 0) {
      await database.client.financialAccountMovement.deleteMany({
        where: { sourceType: 'ACCOUNT_TRANSFER', sourceId: { in: createdTransferIds } },
      });
      await database.client.financialAccountTransfer.deleteMany({
        where: { id: { in: createdTransferIds } },
      });
    }
    if (createdLoanIds.length > 0) {
      await database.client.financialAccountMovement.deleteMany({
        where: {
          OR: [
            { sourceType: 'LOAN_DISBURSEMENT', sourceId: { in: createdLoanIds } },
            { sourceType: 'LOAN_REPAYMENT' },
          ],
        },
      });
      const disbursements = await database.client.loanDisbursement.findMany({
        where: { loanId: { in: createdLoanIds } },
        select: { id: true },
      });
      const disbursementIds = disbursements.map((d) => d.id);
      if (disbursementIds.length > 0) {
        await database.client.financialAccountMovement.deleteMany({
          where: { sourceType: 'LOAN_DISBURSEMENT', sourceId: { in: disbursementIds } },
        });
      }
      await database.client.loanRepayment.deleteMany({
        where: { loanId: { in: createdLoanIds } },
      });
      await database.client.loanDisbursement.deleteMany({
        where: { loanId: { in: createdLoanIds } },
      });
      await database.client.loan.deleteMany({ where: { id: { in: createdLoanIds } } });
    }
    if (createdPayableIds.length > 0) {
      await database.client.supplierLiabilityMovement.deleteMany({
        where: { payableId: { in: createdPayableIds } },
      });
      await database.client.supplierPayable.deleteMany({
        where: { id: { in: createdPayableIds } },
      });
    }
    if (createdSupplierIds.length > 0) {
      await database.client.supplier.deleteMany({
        where: { id: { in: createdSupplierIds } },
      });
    }
    if (createdAccountIds.length > 0) {
      await database.client.financialAccountMovement.deleteMany({
        where: { accountId: { in: createdAccountIds } },
      });
      await database.client.financialAccount.deleteMany({
        where: { id: { in: createdAccountIds } },
      });
    }
    if (createdMemberIds.length > 0) {
      await database.client.companyMemberRole.deleteMany({
        where: { companyMemberId: { in: createdMemberIds } },
      });
      await database.client.companyMember.deleteMany({
        where: { id: { in: createdMemberIds } },
      });
    }
    if (createdRoleIds.length > 0) {
      await database.client.rolePermission.deleteMany({
        where: { roleId: { in: createdRoleIds } },
      });
      await database.client.role.deleteMany({ where: { id: { in: createdRoleIds } } });
    }
    if (createdUserIds.length > 0) {
      await database.client.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    if (tempCompanyIds.length > 0) {
      await database.client.auditLog.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.journalLine.deleteMany({
        where: { journalEntry: { companyId: { in: tempCompanyIds } } },
      });
      await database.client.journalEntry.updateMany({
        where: { companyId: { in: tempCompanyIds } },
        data: { reversalOfId: null },
      });
      await database.client.journalEntry.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.ledgerAccount.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.companyMemberRole.deleteMany({
        where: { companyMember: { companyId: { in: tempCompanyIds } } },
      });
      await database.client.companyMember.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.rolePermission.deleteMany({
        where: { role: { companyId: { in: tempCompanyIds } } },
      });
      await database.client.role.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.financialAccountMovement.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.loanRepayment.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.loanDisbursement.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.loan.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.receipt.updateMany({
        where: { companyId: { in: tempCompanyIds } },
        data: { reversalOfId: null },
      });
      await database.client.receipt.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.payment.updateMany({
        where: { companyId: { in: tempCompanyIds } },
        data: { reversalOfId: null },
      });
      await database.client.payment.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.financialAccountTransfer.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.supplierPaymentAllocation.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.supplierLiabilityMovement.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.supplierPayable.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.supplier.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.financialAccount.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      // Sequences / COA leftovers — best-effort company wipe.
      await database.client.supplierPayableSequence.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.supplierCreditSequence.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.paymentSequence.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.receiptSequence.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.financialAccountTransferSequence.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.loanSequence.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.loanDisbursementSequence.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.loanRepaymentSequence.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.journalEntrySequence.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      try {
        await database.client.company.deleteMany({ where: { id: { in: tempCompanyIds } } });
      } catch {
        // Leave temp companies if residual FKs remain; tests already asserted.
      }
    }
    await app.close();
  });

  function auth(token: string, companyId = pishtehId) {
    return {
      Authorization: `Bearer ${token}`,
      'X-Company-Id': companyId,
    };
  }

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return res.body.data.accessToken as string;
  }

  async function createTempCompany(): Promise<{
    companyId: string;
    irrBankId: string;
    usdBankId: string;
    irrCashId: string;
  }> {
    const slug = `dash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const company = await database.client.company.create({
      data: {
        name: `Dash Temp ${slug}`,
        slug,
        baseCurrency: CurrencyCode.IRR,
        timezone: 'Asia/Tehran',
      },
    });
    tempCompanyIds.push(company.id);

    const role = await database.client.role.create({
      data: {
        companyId: company.id,
        key: OWNER_ROLE_KEY,
        name: 'Owner',
        isSystem: true,
      },
    });
    const templateOwner = await database.client.role.findFirstOrThrow({
      where: { companyId: pishtehId, key: OWNER_ROLE_KEY, deletedAt: null },
      include: { permissions: { select: { permissionId: true } } },
    });
    await database.client.rolePermission.createMany({
      data: templateOwner.permissions.map((p) => ({
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

    const token = await login(ownerEmail);
    await request(app.getHttpServer())
      .get('/api/v1/finance/ledger-accounts')
      .set(auth(token, company.id))
      .expect(200);

    const irrBank = await request(app.getHttpServer())
      .post('/api/v1/finance/accounts')
      .set(auth(token, company.id))
      .send({
        code: 'BANK-IRR',
        name: 'IRR Bank',
        type: FinancialAccountType.BANK,
        currency: CurrencyCode.IRR,
        isDefault: true,
      })
      .expect(201);
    createdAccountIds.push(irrBank.body.data.id);

    const usdBank = await request(app.getHttpServer())
      .post('/api/v1/finance/accounts')
      .set(auth(token, company.id))
      .send({
        code: 'BANK-USD',
        name: 'USD Bank',
        type: FinancialAccountType.BANK,
        currency: CurrencyCode.USD,
      })
      .expect(201);
    createdAccountIds.push(usdBank.body.data.id);

    const irrCash = await request(app.getHttpServer())
      .post('/api/v1/finance/accounts')
      .set(auth(token, company.id))
      .send({
        code: 'CASH-IRR',
        name: 'IRR Cash',
        type: FinancialAccountType.CASH,
        currency: CurrencyCode.IRR,
      })
      .expect(201);
    createdAccountIds.push(irrCash.body.data.id);

    return {
      companyId: company.id,
      irrBankId: irrBank.body.data.id as string,
      usdBankId: usdBank.body.data.id as string,
      irrCashId: irrCash.body.data.id as string,
    };
  }

  async function ensureSupplier(companyId: string): Promise<string> {
    const supplier = await database.client.supplier.create({
      data: {
        companyId,
        name: `Dash Supplier ${randomUUID().slice(0, 8)}`,
        code: `DS-${randomUUID().slice(0, 6).toUpperCase()}`,
        status: 'ACTIVE',
      },
    });
    createdSupplierIds.push(supplier.id);
    return supplier.id;
  }

  it('multi-currency balances stay separate; large IRR exact; semantics forbid revenue/profit', async () => {
    const token = await login(ownerEmail);
    const ctx = await createTempCompany();
    const largeIrr = '123456789012345678';

    await request(app.getHttpServer())
      .post(`/api/v1/finance/accounts/${ctx.irrBankId}/opening-balance`)
      .set(auth(token, ctx.companyId))
      .send({ amount: largeIrr, requestId: randomUUID() })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/finance/accounts/${ctx.usdBankId}/opening-balance`)
      .set(auth(token, ctx.companyId))
      .send({ amount: '1500.50', requestId: randomUUID() })
      .expect(200);

    const accountDetail = await request(app.getHttpServer())
      .get(`/api/v1/finance/accounts/${ctx.irrBankId}`)
      .set(auth(token, ctx.companyId))
      .expect(200);
    expect(accountDetail.body.data.balance.amount).toBe(largeIrr);

    const dash = await request(app.getHttpServer())
      .get('/api/v1/finance/dashboard')
      .set(auth(token, ctx.companyId))
      .expect(200);

    const data = dash.body.data;
    expect(data.semantics.moneyInIsNotRevenue).toBe(true);
    expect(data.semantics.moneyOutIsNotExpense).toBe(true);
    expect(data.semantics.cashMovementIsNotProfit).toBe(true);
    expect(data.semantics.internalTransfersExcludedFromMoneyInOut).toBe(true);
    expect(data).not.toHaveProperty('revenue');
    expect(data).not.toHaveProperty('profit');
    expect(data.periodMetrics).not.toHaveProperty('revenueByCurrency');

    const accounts = data.snapshot.accountsByCurrency as Array<{
      currency: string;
      type: string;
      balance: string;
    }>;
    const irrBank = accounts.find((a) => a.currency === 'IRR' && a.type === 'BANK');
    const usdBank = accounts.find((a) => a.currency === 'USD' && a.type === 'BANK');
    expect(irrBank?.balance).toBe(largeIrr);
    expect(usdBank?.balance).toBe('1500.5');
    // Never treat summed Number as authoritative — currencies remain separate rows.
    expect(accounts.some((a) => a.currency === 'IRR' && a.balance === largeIrr)).toBe(true);
    expect(accounts.some((a) => a.currency === 'USD')).toBe(true);
  });

  it('partial settlement updates outstanding; overdue / due soon lists', async () => {
    const token = await login(ownerEmail);
    const ctx = await createTempCompany();
    await request(app.getHttpServer())
      .post(`/api/v1/finance/accounts/${ctx.irrBankId}/opening-balance`)
      .set(auth(token, ctx.companyId))
      .send({ amount: '100000000', requestId: randomUUID() })
      .expect(200);

    const supplierId = await ensureSupplier(ctx.companyId);
    const overdueDate = new Date();
    overdueDate.setUTCDate(overdueDate.getUTCDate() - 3);
    const dueSoonDate = new Date();
    dueSoonDate.setUTCDate(dueSoonDate.getUTCDate() + 3);

    const overduePayable = await request(app.getHttpServer())
      .post('/api/v1/finance/payables/opening')
      .set(auth(token, ctx.companyId))
      .send({
        supplierId,
        currency: CurrencyCode.IRR,
        amount: '5000000',
        dueDate: overdueDate.toISOString(),
        notes: 'overdue',
        requestId: randomUUID(),
      })
      .expect(201);
    createdPayableIds.push(overduePayable.body.data.id);

    const dueSoonPayable = await request(app.getHttpServer())
      .post('/api/v1/finance/payables/opening')
      .set(auth(token, ctx.companyId))
      .send({
        supplierId,
        currency: CurrencyCode.IRR,
        amount: '2000000',
        dueDate: dueSoonDate.toISOString(),
        notes: 'due soon',
        requestId: randomUUID(),
      })
      .expect(201);
    createdPayableIds.push(dueSoonPayable.body.data.id);

    const payment = await request(app.getHttpServer())
      .post('/api/v1/finance/payments')
      .set(auth(token, ctx.companyId))
      .send({
        accountId: ctx.irrBankId,
        amount: '1500000',
        purposeType: PaymentPurposeType.SUPPLIER,
        postImmediately: true,
        requestId: randomUUID(),
      })
      .expect(201);
    createdPaymentIds.push(payment.body.data.id);

    const settle = await request(app.getHttpServer())
      .post(`/api/v1/finance/payments/${payment.body.data.id}/settlements`)
      .set(auth(token, ctx.companyId))
      .send({
        lines: [{ payableId: overduePayable.body.data.id, liabilityAmount: '1500000' }],
        requestId: randomUUID(),
      })
      .expect(201);
    createdAllocationIds.push(settle.body.data.allocations[0].id);

    const dash = await request(app.getHttpServer())
      .get('/api/v1/finance/dashboard')
      .set(auth(token, ctx.companyId))
      .expect(200);

    const payables = dash.body.data.snapshot.supplierPayablesByCurrency as Array<{
      currency: string;
      amount: string;
    }>;
    expect(payables.find((p) => p.currency === 'IRR')?.amount).toBe('5500000');

    const overdue = dash.body.data.snapshot.overdue as Array<{ id: string; type: string }>;
    const dueSoon = dash.body.data.snapshot.dueSoon as Array<{ id: string; type: string }>;
    expect(overdue.some((i) => i.id === overduePayable.body.data.id)).toBe(true);
    expect(dueSoon.some((i) => i.id === dueSoonPayable.body.data.id)).toBe(true);
  });

  it('loan disbursement money is not labeled revenue; internal transfer excluded from money in/out', async () => {
    const token = await login(ownerEmail);
    const ctx = await createTempCompany();
    await request(app.getHttpServer())
      .post(`/api/v1/finance/accounts/${ctx.irrBankId}/opening-balance`)
      .set(auth(token, ctx.companyId))
      .send({ amount: '500000000', requestId: randomUUID() })
      .expect(200);

    const before = await request(app.getHttpServer())
      .get('/api/v1/finance/dashboard?range=30d')
      .set(auth(token, ctx.companyId))
      .expect(200);

    const moneyInBefore = before.body.data.periodMetrics.moneyInByCurrency ?? [];
    const moneyOutBefore = before.body.data.periodMetrics.moneyOutByCurrency ?? [];

    const loan = await request(app.getHttpServer())
      .post('/api/v1/finance/loans')
      .set(auth(token, ctx.companyId))
      .send({
        lenderType: 'EXTERNAL_PERSON',
        lenderName: 'Dash Lender',
        currency: CurrencyCode.IRR,
        contractedPrincipal: '100000000',
        receivingAccountId: ctx.irrBankId,
        firstDisbursement: { accountId: ctx.irrBankId, amount: '100000000' },
        postImmediately: true,
        requestId: randomUUID(),
      })
      .expect(201);
    createdLoanIds.push(loan.body.data.id);

    const receipt = await request(app.getHttpServer())
      .post('/api/v1/finance/receipts')
      .set(auth(token, ctx.companyId))
      .send({
        accountId: ctx.irrBankId,
        amount: '25000000',
        sourceType: ReceiptSourceType.LOAN,
        postImmediately: true,
        requestId: randomUUID(),
      })
      .expect(201);
    createdReceiptIds.push(receipt.body.data.id);

    const afterLoanReceipt = await request(app.getHttpServer())
      .get('/api/v1/finance/dashboard?range=30d')
      .set(auth(token, ctx.companyId))
      .expect(200);

    expect(afterLoanReceipt.body.data.semantics.moneyInIsNotRevenue).toBe(true);
    expect(JSON.stringify(afterLoanReceipt.body.data).toLowerCase()).not.toMatch(/"revenue"/);
    expect(afterLoanReceipt.body.data.snapshot.loansByCurrency?.[0]?.amount).toBe('100000000');

    const moneyInAfterReceipt = afterLoanReceipt.body.data.periodMetrics.moneyInByCurrency as Array<{
      currency: string;
      amount: string;
    }>;
    expect(moneyInAfterReceipt.find((r) => r.currency === 'IRR')?.amount).toBe('25000000');

    const transfer = await request(app.getHttpServer())
      .post('/api/v1/finance/account-transfers')
      .set(auth(token, ctx.companyId))
      .send({
        sourceAccountId: ctx.irrBankId,
        destinationAccountId: ctx.irrCashId,
        amount: '10000000',
        postImmediately: true,
        requestId: randomUUID(),
      })
      .expect(201);
    createdTransferIds.push(transfer.body.data.id);

    const afterTransfer = await request(app.getHttpServer())
      .get('/api/v1/finance/dashboard?range=30d')
      .set(auth(token, ctx.companyId))
      .expect(200);

    expect(afterTransfer.body.data.periodMetrics.moneyInByCurrency).toEqual(moneyInAfterReceipt);
    expect(afterTransfer.body.data.periodMetrics.moneyOutByCurrency).toEqual(
      afterLoanReceipt.body.data.periodMetrics.moneyOutByCurrency,
    );
    // Transfer must not inflate both money-in and money-out by the transfer amount.
    const inDelta =
      Number(afterTransfer.body.data.periodMetrics.moneyInByCurrency?.[0]?.amount ?? 0) -
      Number(moneyInBefore[0]?.amount ?? 0);
    const outDelta =
      Number(afterTransfer.body.data.periodMetrics.moneyOutByCurrency?.[0]?.amount ?? 0) -
      Number(moneyOutBefore[0]?.amount ?? 0);
    expect(inDelta).not.toBe(10000000);
    expect(outDelta).not.toBe(10000000);
  });

  it('RBAC: user without loans.read omits loans section; tenant isolation', async () => {
    const ownerToken = await login(ownerEmail);
    const ctx = await createTempCompany();
    await request(app.getHttpServer())
      .post(`/api/v1/finance/accounts/${ctx.irrBankId}/opening-balance`)
      .set(auth(ownerToken, ctx.companyId))
      .send({ amount: '777000777000', requestId: randomUUID() })
      .expect(200);

    const loan = await request(app.getHttpServer())
      .post('/api/v1/finance/loans')
      .set(auth(ownerToken, ctx.companyId))
      .send({
        lenderType: 'EXTERNAL_PERSON',
        lenderName: 'Hidden Loan',
        currency: CurrencyCode.IRR,
        contractedPrincipal: '500000',
        receivingAccountId: ctx.irrBankId,
        firstDisbursement: { accountId: ctx.irrBankId, amount: '500000' },
        postImmediately: true,
        requestId: randomUUID(),
      })
      .expect(201);
    createdLoanIds.push(loan.body.data.id);

    const email = `dash-limited-${randomUUID().slice(0, 8)}@hector.local`;
    const limitedUser = await database.client.user.create({
      data: {
        email,
        passwordHash: (
          await database.client.user.findUniqueOrThrow({ where: { email: ownerEmail } })
        ).passwordHash,
        firstName: 'Dash',
        lastName: 'Limited',
        status: UserStatus.ACTIVE,
      },
    });
    createdUserIds.push(limitedUser.id);

    const role = await database.client.role.create({
      data: {
        companyId: ctx.companyId,
        key: `dash-limited-${randomUUID().slice(0, 6)}`,
        name: 'Dash Limited',
        isSystem: false,
      },
    });
    createdRoleIds.push(role.id);

    const perms = await database.client.permission.findMany({
      where: {
        key: {
          in: [
            'finance.dashboard.read',
            'finance.accounts.read',
            'finance.payables.read',
            'finance.payments.read',
            'finance.receipts.read',
            'finance.expenses.read',
          ],
        },
      },
    });
    await database.client.rolePermission.createMany({
      data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
    });
    const membership = await database.client.companyMember.create({
      data: {
        companyId: ctx.companyId,
        userId: limitedUser.id,
        status: CompanyMemberStatus.ACTIVE,
      },
    });
    createdMemberIds.push(membership.id);
    await database.client.companyMemberRole.create({
      data: { companyMemberId: membership.id, roleId: role.id },
    });

    const limitedToken = await login(email);
    const limitedDash = await request(app.getHttpServer())
      .get('/api/v1/finance/dashboard')
      .set(auth(limitedToken, ctx.companyId))
      .expect(200);

    expect(limitedDash.body.data.snapshot.accountsByCurrency).toBeDefined();
    expect(limitedDash.body.data.snapshot).not.toHaveProperty('loansByCurrency');

    const isolated = await request(app.getHttpServer())
      .get('/api/v1/finance/dashboard')
      .set(auth(ownerToken, demoBId))
      .expect(200);
    const demoAccounts = (isolated.body.data.snapshot.accountsByCurrency ?? []) as Array<{
      currency: string;
      balance: string;
    }>;
    // Unique marker balance must not leak to demo-B.
    expect(
      demoAccounts.some(
        (a) => a.currency === 'IRR' && a.balance.includes('777000777000'),
      ),
    ).toBe(false);
  });

  it('finance audit list restricts entity types', async () => {
    const token = await login(ownerEmail);
    const ok = await request(app.getHttpServer())
      .get('/api/v1/finance/audit?entityType=PAYMENT')
      .set(auth(token))
      .expect(200);
    expect(Array.isArray(ok.body.data)).toBe(true);

    await request(app.getHttpServer())
      .get('/api/v1/finance/audit?entityType=PRODUCT')
      .set(auth(token))
      .expect(400);
  });
});
