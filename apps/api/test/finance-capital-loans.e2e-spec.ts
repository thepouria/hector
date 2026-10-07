import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  CompanyMemberStatus,
  CurrencyCode,
  FinancialAccountType,
  OWNER_ROLE_KEY,
  UserStatus,
  syncOwnerRolePermissions,
  syncPermissions,
} from '@hector/database';
import type { INestApplication } from '@nestjs/common';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';

describe('Finance Capital + Loans (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  const ownerEmail = 'pouria@hector.local';
  const warehouseOperatorEmail = 'hossein@hector.local';
  const password = E2E_PASSWORD;
  let pishtehId: string;
  let demoBId: string;
  const tempCompanyIds: string[] = [];

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
    if (tempCompanyIds.length > 0) {
      await database.client.financialAccountMovement.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.loanRepayment.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.loanDisbursement.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.loan.deleteMany({ where: { companyId: { in: tempCompanyIds } } });
      await database.client.capitalContribution.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.financialAccount.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.loanRepaymentSequence.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.loanDisbursementSequence.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.loanSequence.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.capitalContributionSequence.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.partner.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.partyRelationship.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.partyRole.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.partyContactPoint.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.partyAddress.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.partyMigrationMap.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.party.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.partySequence.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.journalLine.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.journalEntry.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.journalEntrySequence.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.ledgerAccount.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.auditLog.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.companyMemberRole.deleteMany({
        where: { companyMember: { companyId: { in: tempCompanyIds } } },
      });
      await database.client.rolePermission.deleteMany({
        where: { role: { companyId: { in: tempCompanyIds } } },
      });
      await database.client.companyMember.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.role.deleteMany({ where: { companyId: { in: tempCompanyIds } } });
      await database.client.company.deleteMany({ where: { id: { in: tempCompanyIds } } });
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

  async function createIsolatedCompany(): Promise<{
    companyId: string;
    irrAccountId: string;
    usdAccountId: string;
    token: string;
  }> {
    const owner = await database.client.user.findUniqueOrThrow({
      where: { email: ownerEmail },
    });
    const company = await database.client.company.create({
      data: {
        name: `CapLoan ${randomUUID().slice(0, 8)}`,
        slug: `cap-loan-${randomUUID().slice(0, 8)}`,
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
    const perms = await database.client.permission.findMany({
      where: {
        key: {
          in: [
            'finance.capital.read',
            'finance.capital.manage',
            'finance.loans.read',
            'finance.loans.manage',
            'finance.accounts.read',
            'finance.accounts.manage',
          ],
        },
      },
    });
    await database.client.rolePermission.createMany({
      data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
    });
    const member = await database.client.companyMember.create({
      data: {
        companyId: company.id,
        userId: owner.id,
        status: CompanyMemberStatus.ACTIVE,
      },
    });
    await database.client.companyMemberRole.create({
      data: { companyMemberId: member.id, roleId: role.id },
    });

    const irr = await database.client.financialAccount.create({
      data: {
        companyId: company.id,
        code: 'CASH-IRR',
        name: 'Cash IRR',
        type: FinancialAccountType.CASH,
        currency: CurrencyCode.IRR,
        isDefault: true,
      },
    });
    const usd = await database.client.financialAccount.create({
      data: {
        companyId: company.id,
        code: 'CASH-USD',
        name: 'Cash USD',
        type: FinancialAccountType.CASH,
        currency: CurrencyCode.USD,
        isDefault: true,
      },
    });

    // Seed opening so repayments have cash
    await database.client.financialAccountMovement.create({
      data: {
        companyId: company.id,
        accountId: usd.id,
        direction: 'IN',
        amount: '20000',
        currency: CurrencyCode.USD,
        type: 'OPENING_BALANCE',
        sourceType: 'OPENING_BALANCE',
        effectiveAt: new Date(),
        postedAt: new Date(),
      },
    });
    await database.client.financialAccountMovement.create({
      data: {
        companyId: company.id,
        accountId: irr.id,
        direction: 'IN',
        amount: '100000000',
        currency: CurrencyCode.IRR,
        type: 'OPENING_BALANCE',
        sourceType: 'OPENING_BALANCE',
        effectiveAt: new Date(),
        postedAt: new Date(),
      },
    });

    return {
      companyId: company.id,
      irrAccountId: irr.id,
      usdAccountId: usd.id,
      token: await login(ownerEmail),
    };
  }

  it('A–C: Ahmad equity + Pouria equity + Ahmad loan (same person equity≠debt)', async () => {
    const ctx = await createIsolatedCompany();

    const ahmadEquity = await request(app.getHttpServer())
      .post('/api/v1/finance/capital-contributions')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Company-Id', ctx.companyId)
      .send({
        fundingType: 'PARTNER_EQUITY',
        contributorType: 'PARTNER',
        contributorName: 'Ahmad',
        accountId: ctx.irrAccountId,
        amount: '2000000000',
        postImmediately: true,
        requestId: randomUUID(),
      })
      .expect(201);
    expect(ahmadEquity.body.data.status).toBe('POSTED');
    expect(ahmadEquity.body.data.fundingType).toBe('PARTNER_EQUITY');

    await request(app.getHttpServer())
      .post('/api/v1/finance/capital-contributions')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Company-Id', ctx.companyId)
      .send({
        fundingType: 'PARTNER_EQUITY',
        contributorType: 'PARTNER',
        contributorName: 'Pouria',
        accountId: ctx.irrAccountId,
        amount: '1000000000',
        postImmediately: true,
        requestId: randomUUID(),
      })
      .expect(201);

    const ahmadLoan = await request(app.getHttpServer())
      .post('/api/v1/finance/loans')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Company-Id', ctx.companyId)
      .send({
        lenderType: 'PARTNER',
        lenderName: 'Ahmad',
        currency: 'IRR',
        contractedPrincipal: '500000000',
        receivingAccountId: ctx.irrAccountId,
        firstDisbursement: {
          accountId: ctx.irrAccountId,
          amount: '500000000',
        },
        postImmediately: true,
        requestId: randomUUID(),
      })
      .expect(201);

    expect(ahmadLoan.body.data.status).toBe('ACTIVE');
    expect(ahmadLoan.body.data.outstandingPrincipal).toBe('500000000');
    expect(ahmadLoan.body.data.receivedPrincipal).toBe('500000000');

    const summary = await request(app.getHttpServer())
      .get('/api/v1/finance/capital-contributions/summary')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Company-Id', ctx.companyId)
      .expect(200);
    expect(summary.body.data.byCurrency[0].currency).toBe('IRR');
    expect(summary.body.data.byCurrency[0].total).toBe('3000000000');
  });

  it('D–E: USD loan + partial/full repay + overpay/insufficient/wrong currency reject', async () => {
    const ctx = await createIsolatedCompany();

    const loan = await request(app.getHttpServer())
      .post('/api/v1/finance/loans')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Company-Id', ctx.companyId)
      .send({
        lenderType: 'EXTERNAL_PERSON',
        lenderName: 'External USD Lender',
        currency: 'USD',
        contractedPrincipal: '10000',
        referenceFxRate: '250000',
        referenceFxBaseCurrency: 'USD',
        referenceFxQuoteCurrency: 'IRR',
        receivingAccountId: ctx.usdAccountId,
        firstDisbursement: { accountId: ctx.usdAccountId, amount: '10000' },
        postImmediately: true,
        requestId: randomUUID(),
      })
      .expect(201);

    expect(loan.body.data.currency).toBe('USD');
    expect(loan.body.data.outstandingPrincipal).toBe('10000');
    expect(loan.body.data.referenceFxRate).toBe('250000');

    const partial = await request(app.getHttpServer())
      .post(`/api/v1/finance/loans/${loan.body.data.id}/repayments`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Company-Id', ctx.companyId)
      .send({
        accountId: ctx.usdAccountId,
        principalAmount: '3000',
        postImmediately: true,
        requestId: randomUUID(),
      })
      .expect(201);
    expect(partial.body.data.status).toBe('POSTED');

    const afterPartial = await request(app.getHttpServer())
      .get(`/api/v1/finance/loans/${loan.body.data.id}`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Company-Id', ctx.companyId)
      .expect(200);
    expect(afterPartial.body.data.outstandingPrincipal).toBe('7000');
    expect(afterPartial.body.data.status).toBe('PARTIALLY_REPAID');

    await request(app.getHttpServer())
      .post(`/api/v1/finance/loans/${loan.body.data.id}/repayments`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Company-Id', ctx.companyId)
      .send({
        accountId: ctx.usdAccountId,
        principalAmount: '8000',
        postImmediately: true,
        requestId: randomUUID(),
      })
      .expect(409);

    await request(app.getHttpServer())
      .post(`/api/v1/finance/loans/${loan.body.data.id}/repayments`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Company-Id', ctx.companyId)
      .send({
        accountId: ctx.irrAccountId,
        principalAmount: '1000',
        postImmediately: true,
        requestId: randomUUID(),
      })
      .expect(409);

    // Insufficient cash: repay from a zero-balance USD account.
    const tiny = await createIsolatedCompany();
    const loan2 = await request(app.getHttpServer())
      .post('/api/v1/finance/loans')
      .set('Authorization', `Bearer ${tiny.token}`)
      .set('X-Company-Id', tiny.companyId)
      .send({
        lenderType: 'EXTERNAL_PERSON',
        lenderName: 'Lender',
        currency: 'USD',
        contractedPrincipal: '5000',
        referenceFxRate: '250000',
        referenceFxBaseCurrency: 'USD',
        referenceFxQuoteCurrency: 'IRR',
        firstDisbursement: { accountId: tiny.usdAccountId, amount: '5000' },
        postImmediately: true,
        requestId: randomUUID(),
      })
      .expect(201);

    const emptyUsd = await database.client.financialAccount.create({
      data: {
        companyId: tiny.companyId,
        code: `EMPTY-USD-${randomUUID().slice(0, 6).toUpperCase()}`,
        name: 'Empty USD',
        type: FinancialAccountType.CASH,
        currency: CurrencyCode.USD,
        isDefault: false,
      },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/finance/loans/${loan2.body.data.id}/repayments`)
      .set('Authorization', `Bearer ${tiny.token}`)
      .set('X-Company-Id', tiny.companyId)
      .send({
        accountId: emptyUsd.id,
        principalAmount: '100',
        postImmediately: true,
        requestId: randomUUID(),
      })
      .expect(409);

    const full = await request(app.getHttpServer())
      .post(`/api/v1/finance/loans/${loan.body.data.id}/repayments`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Company-Id', ctx.companyId)
      .send({
        accountId: ctx.usdAccountId,
        principalAmount: '7000',
        postImmediately: true,
        requestId: randomUUID(),
      })
      .expect(201);
    expect(full.body.data.status).toBe('POSTED');

    const settled = await request(app.getHttpServer())
      .get(`/api/v1/finance/loans/${loan.body.data.id}`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Company-Id', ctx.companyId)
      .expect(200);
    expect(settled.body.data.outstandingPrincipal).toBe('0');
    expect(settled.body.data.status).toBe('SETTLED');
  });

  it('idempotency, posted mutation reject, mass assignment, IDOR, RBAC', async () => {
    const ctx = await createIsolatedCompany();
    const requestId = randomUUID();

    const first = await request(app.getHttpServer())
      .post('/api/v1/finance/capital-contributions')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Company-Id', ctx.companyId)
      .send({
        fundingType: 'PARTNER_EQUITY',
        contributorType: 'PARTNER',
        contributorName: 'Ahmad',
        accountId: ctx.irrAccountId,
        amount: '1000000',
        postImmediately: true,
        requestId,
      })
      .expect(201);

    const second = await request(app.getHttpServer())
      .post('/api/v1/finance/capital-contributions')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Company-Id', ctx.companyId)
      .send({
        fundingType: 'PARTNER_EQUITY',
        contributorType: 'PARTNER',
        contributorName: 'Ahmad',
        accountId: ctx.irrAccountId,
        amount: '1000000',
        postImmediately: true,
        requestId,
      })
      .expect(201);
    expect(second.body.data.id).toBe(first.body.data.id);

    await request(app.getHttpServer())
      .post('/api/v1/finance/capital-contributions')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Company-Id', ctx.companyId)
      .send({
        fundingType: 'OWNER_EQUITY',
        contributorType: 'PARTNER',
        contributorName: 'Ahmad',
        accountId: ctx.irrAccountId,
        amount: '2000000',
        postImmediately: true,
        requestId,
      })
      .expect(409);

    await request(app.getHttpServer())
      .patch(`/api/v1/finance/capital-contributions/${first.body.data.id}`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Company-Id', ctx.companyId)
      .send({ amount: '999' })
      .expect(409);

    await request(app.getHttpServer())
      .get(`/api/v1/finance/capital-contributions/${first.body.data.id}`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Company-Id', demoBId)
      .expect(404);

    const warehouseToken = await login(warehouseOperatorEmail);
    await request(app.getHttpServer())
      .get('/api/v1/finance/capital-contributions')
      .set('Authorization', `Bearer ${warehouseToken}`)
      .set('X-Company-Id', pishtehId)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/finance/loans')
      .set('Authorization', `Bearer ${warehouseToken}`)
      .set('X-Company-Id', pishtehId)
      .expect(403);
  });

  it('concurrent repayments cannot over-repay', async () => {
    const ctx = await createIsolatedCompany();
    const loan = await request(app.getHttpServer())
      .post('/api/v1/finance/loans')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Company-Id', ctx.companyId)
      .send({
        lenderType: 'EXTERNAL_PERSON',
        lenderName: 'Concurrent Lender',
        currency: 'USD',
        contractedPrincipal: '10000',
        referenceFxRate: '250000',
        referenceFxBaseCurrency: 'USD',
        referenceFxQuoteCurrency: 'IRR',
        firstDisbursement: { accountId: ctx.usdAccountId, amount: '10000' },
        postImmediately: true,
        requestId: randomUUID(),
      })
      .expect(201);

    const results = await Promise.allSettled([
      request(app.getHttpServer())
        .post(`/api/v1/finance/loans/${loan.body.data.id}/repayments`)
        .set('Authorization', `Bearer ${ctx.token}`)
        .set('X-Company-Id', ctx.companyId)
        .send({
          accountId: ctx.usdAccountId,
          principalAmount: '7000',
          postImmediately: true,
          requestId: randomUUID(),
        }),
      request(app.getHttpServer())
        .post(`/api/v1/finance/loans/${loan.body.data.id}/repayments`)
        .set('Authorization', `Bearer ${ctx.token}`)
        .set('X-Company-Id', ctx.companyId)
        .send({
          accountId: ctx.usdAccountId,
          principalAmount: '7000',
          postImmediately: true,
          requestId: randomUUID(),
        }),
    ]);

    const statuses = results.map((r) =>
      r.status === 'fulfilled' ? r.value.status : 500,
    );
    expect(statuses.filter((s) => s === 201).length).toBe(1);
    expect(statuses.filter((s) => s === 409).length).toBe(1);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/finance/loans/${loan.body.data.id}`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Company-Id', ctx.companyId)
      .expect(200);
    expect(detail.body.data.outstandingPrincipal).toBe('3000');
  });

  it('OTHER_FUNDING requires notes; seed fixtures exist for Pishteh', async () => {
    const ctx = await createIsolatedCompany();
    await request(app.getHttpServer())
      .post('/api/v1/finance/capital-contributions')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Company-Id', ctx.companyId)
      .send({
        fundingType: 'OTHER_FUNDING',
        contributorType: 'OTHER',
        contributorName: 'Mystery',
        accountId: ctx.irrAccountId,
        amount: '1000',
        postImmediately: true,
        requestId: randomUUID(),
      })
      .expect(400);

    const token = await login(ownerEmail);
    const list = await request(app.getHttpServer())
      .get('/api/v1/finance/capital-contributions')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);
    expect(list.body.data.length).toBeGreaterThanOrEqual(2);

    const loans = await request(app.getHttpServer())
      .get('/api/v1/finance/loans')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);
    expect(loans.body.data.length).toBeGreaterThanOrEqual(2);
  });
});
