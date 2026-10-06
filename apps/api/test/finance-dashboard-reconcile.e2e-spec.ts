import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  CompanyMemberStatus,
  CurrencyCode,
  FinancialAccountType,
  OWNER_ROLE_KEY,
  PaymentPurposeType,
  Prisma,
  UserStatus,
  syncOwnerRolePermissions,
  syncPermissions,
} from '@hector/database';
import type { INestApplication } from '@nestjs/common';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';

/**
 * Phase 4.12 — Dashboard snapshot must equal canonical SQL truth.
 */
describe('Finance Dashboard reconciliation (e2e) Phase 4.12', () => {
  let app: INestApplication;
  let database: DatabaseService;
  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;
  let pishtehId: string;
  let ownerUserId: string;
  const tempCompanyIds: string[] = [];
  const createdPayableIds: string[] = [];
  const createdPaymentIds: string[] = [];
  const createdAllocationIds: string[] = [];
  const createdAccountIds: string[] = [];
  const createdTransferIds: string[] = [];
  const createdSupplierIds: string[] = [];
  const createdRoleIds: string[] = [];
  const createdMemberIds: string[] = [];
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    app = await createE2eApp();
    database = app.get(DatabaseService);
    await syncPermissions(database.client);
    await syncOwnerRolePermissions(database.client);

    pishtehId = (
      await database.client.company.findUniqueOrThrow({ where: { slug: 'pishteh' } })
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
      const payJournals = await database.client.journalEntry.findMany({
        where: { sourceType: 'PAYMENT', sourceId: { in: allPaymentIds } },
        select: { id: true },
      });
      if (payJournals.length > 0) {
        await database.client.journalLine.deleteMany({
          where: { journalEntryId: { in: payJournals.map((j) => j.id) } },
        });
        await database.client.journalEntry.deleteMany({
          where: { id: { in: payJournals.map((j) => j.id) } },
        });
      }
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
    if (createdTransferIds.length > 0) {
      await database.client.financialAccountMovement.deleteMany({
        where: { sourceType: 'ACCOUNT_TRANSFER', sourceId: { in: createdTransferIds } },
      });
      await database.client.financialAccountTransfer.deleteMany({
        where: { id: { in: createdTransferIds } },
      });
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
    if (tempCompanyIds.length > 0) {
      await database.client.journalLine.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.journalEntry.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.journalEntrySequence.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.financialAccount.updateMany({
        where: { companyId: { in: tempCompanyIds } },
        data: { ledgerAccountId: null },
      });
      await database.client.ledgerAccount.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.paymentSequence.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.financialAccountTransferSequence.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.supplierPayableSequence.deleteMany({
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
      try {
        await database.client.company.deleteMany({ where: { id: { in: tempCompanyIds } } });
      } catch {
        // Residual FKs — assertions already ran.
      }
    }
    if (createdUserIds.length > 0) {
      await database.client.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    void createdRoleIds;
    void createdMemberIds;
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
    irrCashId: string;
  }> {
    const slug = `dash-rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const company = await database.client.company.create({
      data: {
        name: `Dash Reconcile ${slug}`,
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
    createdRoleIds.push(role.id);
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
    createdMemberIds.push(membership.id);
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
      irrCashId: irrCash.body.data.id as string,
    };
  }

  it('dashboard account totals equal SUM(IN)-SUM(OUT) by currency; overdue matches SQL', async () => {
    const token = await login(ownerEmail);
    const ctx = await createTempCompany();

    await request(app.getHttpServer())
      .post(`/api/v1/finance/accounts/${ctx.irrBankId}/opening-balance`)
      .set(auth(token, ctx.companyId))
      .send({ amount: '88000000000', requestId: randomUUID() })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/finance/accounts/${ctx.irrCashId}/opening-balance`)
      .set(auth(token, ctx.companyId))
      .send({ amount: '1200000000', requestId: randomUUID() })
      .expect(200);

    const payment = await request(app.getHttpServer())
      .post('/api/v1/finance/payments')
      .set(auth(token, ctx.companyId))
      .send({
        accountId: ctx.irrBankId,
        amount: '500000000',
        purposeType: PaymentPurposeType.OTHER,
        postImmediately: true,
        requestId: randomUUID(),
      })
      .expect(201);
    createdPaymentIds.push(payment.body.data.id);

    const transfer = await request(app.getHttpServer())
      .post('/api/v1/finance/account-transfers')
      .set(auth(token, ctx.companyId))
      .send({
        sourceAccountId: ctx.irrBankId,
        destinationAccountId: ctx.irrCashId,
        amount: '250000000',
        postImmediately: true,
        requestId: randomUUID(),
      })
      .expect(201);
    createdTransferIds.push(transfer.body.data.id);

    const supplier = await database.client.supplier.create({
      data: {
        companyId: ctx.companyId,
        name: `Reconcile Supplier ${randomUUID().slice(0, 8)}`,
        code: `RS-${randomUUID().slice(0, 6).toUpperCase()}`,
        status: 'ACTIVE',
      },
    });
    createdSupplierIds.push(supplier.id);

    const overdueDate = new Date();
    overdueDate.setUTCDate(overdueDate.getUTCDate() - 5);
    const overduePayable = await request(app.getHttpServer())
      .post('/api/v1/finance/payables/opening')
      .set(auth(token, ctx.companyId))
      .send({
        supplierId: supplier.id,
        currency: CurrencyCode.IRR,
        amount: '777000777',
        dueDate: overdueDate.toISOString(),
        notes: 'reconcile overdue',
        requestId: randomUUID(),
      })
      .expect(201);
    createdPayableIds.push(overduePayable.body.data.id);

    const dash = await request(app.getHttpServer())
      .get('/api/v1/finance/dashboard?range=30d')
      .set(auth(token, ctx.companyId))
      .expect(200);

    const accounts = dash.body.data.snapshot.accountsByCurrency as Array<{
      currency: string;
      type: string;
      balance: string;
    }>;

    const sqlBalances = await database.client.$queryRaw<
      Array<{ currency: string; type: string; balance: string }>
    >`
      SELECT a.currency::text AS currency, a.type::text AS type,
        COALESCE(SUM(CASE WHEN m.direction = 'IN' THEN m.amount
                          WHEN m.direction = 'OUT' THEN -m.amount
                          ELSE 0 END), 0)::text AS balance
      FROM financial_accounts a
      LEFT JOIN financial_account_movements m
        ON m.account_id = a.id AND m.company_id = a.company_id
      WHERE a.company_id = ${ctx.companyId}::uuid
        AND a.status = 'ACTIVE'
      GROUP BY a.currency, a.type
      ORDER BY a.currency, a.type`;

    for (const row of sqlBalances) {
      const dashRow = accounts.find((a) => a.currency === row.currency && a.type === row.type);
      expect(dashRow).toBeTruthy();
      expect(new Prisma.Decimal(dashRow!.balance).eq(new Prisma.Decimal(row.balance))).toBe(true);
    }

    expect(dash.body.data.semantics.internalTransfersExcludedFromMoneyInOut).toBe(true);
    const moneyOut = dash.body.data.periodMetrics.moneyOutByCurrency as Array<{
      currency: string;
      amount: string;
    }>;
    expect(new Prisma.Decimal(moneyOut.find((r) => r.currency === 'IRR')?.amount ?? '0').eq(
      new Prisma.Decimal('500000000'),
    )).toBe(true);

    const moneyIn = dash.body.data.periodMetrics.moneyInByCurrency as Array<{
      currency: string;
      amount: string;
    }>;
    expect(moneyIn?.length ?? 0).toBe(0);

    const overdueSql = await database.client.$queryRaw<Array<{ id: string }>>`
      SELECT p.id::text AS id
      FROM supplier_payables p
      WHERE p.company_id = ${ctx.companyId}::uuid
        AND p.status <> 'CANCELLED'
        AND p.due_date IS NOT NULL
        AND p.due_date < date_trunc('day', NOW() AT TIME ZONE 'UTC')
        AND (
          COALESCE((
            SELECT SUM(m.amount) FROM supplier_liability_movements m
            WHERE m.payable_id = p.id AND m.company_id = p.company_id
              AND m.direction = 'INCREASE'
          ), 0)
          -
          COALESCE((
            SELECT SUM(m.amount) FROM supplier_liability_movements m
            WHERE m.payable_id = p.id AND m.company_id = p.company_id
              AND m.direction = 'DECREASE'
          ), 0)
        ) > 0`;

    const overdueDash = dash.body.data.snapshot.overdue as Array<{ id: string; type: string }>;
    const payableOverdueDash = overdueDash.filter((i) => i.type === 'SUPPLIER_PAYABLE');
    expect(payableOverdueDash.map((i) => i.id).sort()).toEqual(
      overdueSql.map((r) => r.id).sort(),
    );
    expect(payableOverdueDash.some((i) => i.id === overduePayable.body.data.id)).toBe(true);
  });

  it('RBAC: loans section omitted without loans.read', async () => {
    const ownerToken = await login(ownerEmail);
    const ctx = await createTempCompany();

    const limitedEmail = `dash-rec-limited-${randomUUID().slice(0, 8)}@hector.local`;
    const limited = await database.client.user.create({
      data: {
        email: limitedEmail,
        firstName: 'Dash',
        lastName: 'RecLimited',
        status: UserStatus.ACTIVE,
        passwordHash: (
          await database.client.user.findUniqueOrThrow({ where: { email: ownerEmail } })
        ).passwordHash,
      },
    });
    createdUserIds.push(limited.id);

    const role = await database.client.role.create({
      data: {
        companyId: ctx.companyId,
        key: `dash-rec-limited-${randomUUID().slice(0, 6)}`,
        name: 'Dash Rec Limited',
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
          ],
        },
      },
    });
    await database.client.rolePermission.createMany({
      data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
      skipDuplicates: true,
    });
    const membership = await database.client.companyMember.create({
      data: {
        companyId: ctx.companyId,
        userId: limited.id,
        status: CompanyMemberStatus.ACTIVE,
      },
    });
    createdMemberIds.push(membership.id);
    await database.client.companyMemberRole.create({
      data: { companyMemberId: membership.id, roleId: role.id },
    });

    const limitedToken = await login(limitedEmail);
    const dash = await request(app.getHttpServer())
      .get('/api/v1/finance/dashboard')
      .set(auth(limitedToken, ctx.companyId))
      .expect(200);

    expect(dash.body.data.snapshot.loansByCurrency).toBeUndefined();
    void ownerToken;
  });
});
