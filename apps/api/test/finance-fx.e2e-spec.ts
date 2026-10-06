import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  CompanyMemberStatus,
  CurrencyCode,
  FinancialAccountType,
  FxRateType,
  OWNER_ROLE_KEY,
  UserStatus,
  syncOwnerRolePermissions,
  syncPermissions,
} from '@hector/database';
import type { INestApplication } from '@nestjs/common';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';

describe('Finance FX (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  const ownerEmail = 'pouria@hector.local';
  const warehouseOperatorEmail = 'hossein@hector.local';
  const password = E2E_PASSWORD;
  let pishtehId: string;
  let demoBId: string;
  let ownerPasswordHash: string;
  let ownerUserId: string;
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

    const owner = await database.client.user.update({
      where: { email: ownerEmail },
      data: { status: UserStatus.ACTIVE, deletedAt: null },
    });
    ownerPasswordHash = owner.passwordHash;
    ownerUserId = owner.id;
  });

  afterAll(async () => {
    if (tempCompanyIds.length > 0) {
      await database.client.financialAccountMovement.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.fxConversion.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.fxRate.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.financialAccount.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.fxConversionSequence.deleteMany({
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
      await database.client.role.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.company.deleteMany({
        where: { id: { in: tempCompanyIds } },
      });
    }
    await app.close();
  });

  async function login(email: string): Promise<string> {
    await database.client.user.update({
      where: { email: ownerEmail },
      data: {
        status: UserStatus.ACTIVE,
        deletedAt: null,
        passwordHash: ownerPasswordHash,
      },
    });
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

  async function createTempCompany(): Promise<string> {
    const slug = `fx-tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const company = await database.client.company.create({
      data: {
        name: `FX Temp ${slug}`,
        slug,
        baseCurrency: CurrencyCode.IRR,
        timezone: 'Asia/Tehran',
      },
    });
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
    if (templateOwner.permissions.length > 0) {
      await database.client.rolePermission.createMany({
        data: templateOwner.permissions.map((p) => ({
          roleId: role.id,
          permissionId: p.permissionId,
        })),
        skipDuplicates: true,
      });
    }
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
    tempCompanyIds.push(company.id);
    return company.id;
  }

  async function seedAccounts(token: string, companyId: string) {
    const irr = await request(app.getHttpServer())
      .post('/api/v1/finance/accounts')
      .set(auth(token, companyId))
      .send({
        code: 'CASH-IRR',
        name: 'IRR Cash',
        type: FinancialAccountType.CASH,
        currency: CurrencyCode.IRR,
        isDefault: true,
      })
      .expect(201);
    const usd = await request(app.getHttpServer())
      .post('/api/v1/finance/accounts')
      .set(auth(token, companyId))
      .send({
        code: 'CASH-USD',
        name: 'USD Cash',
        type: FinancialAccountType.CASH,
        currency: CurrencyCode.USD,
        isDefault: true,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/finance/accounts/${irr.body.data.id}/opening-balance`)
      .set(auth(token, companyId))
      .send({ amount: '500000000', requestId: randomUUID() })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/finance/accounts/${usd.body.data.id}/opening-balance`)
      .set(auth(token, companyId))
      .send({ amount: '100', requestId: randomUUID() })
      .expect(200);
    return { irrId: irr.body.data.id as string, usdId: usd.body.data.id as string };
  }

  it('rate history asOf, conversion IRR→USD, rejects unsafe cases, reverse original, positions', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const { irrId, usdId } = await seedAccounts(token, companyId);

    const early = await request(app.getHttpServer())
      .post('/api/v1/finance/fx/rates')
      .set(auth(token, companyId))
      .send({
        baseCurrency: 'USD',
        quoteCurrency: 'IRR',
        rate: '240000',
        rateType: FxRateType.REFERENCE,
        effectiveAt: '2026-01-01T00:00:00.000Z',
      })
      .expect(201);
    expect(early.body.data.rateDisplay).toBe('1 USD = 240000 IRR');

    await request(app.getHttpServer())
      .post('/api/v1/finance/fx/rates')
      .set(auth(token, companyId))
      .send({
        baseCurrency: 'USD',
        quoteCurrency: 'IRR',
        rate: '250000',
        rateType: FxRateType.REFERENCE,
        effectiveAt: '2026-03-01T00:00:00.000Z',
      })
      .expect(201);

    const latestAsOf = await request(app.getHttpServer())
      .get('/api/v1/finance/fx/rates/latest')
      .query({
        base: 'USD',
        quote: 'IRR',
        rateType: 'REFERENCE',
        asOf: '2026-02-15T00:00:00.000Z',
      })
      .set(auth(token, companyId))
      .expect(200);
    expect(latestAsOf.body.data.rate).toMatch(/^240000(\.0+)?$/);

    await request(app.getHttpServer())
      .post('/api/v1/finance/fx/rates')
      .set(auth(token, companyId))
      .send({
        baseCurrency: 'USD',
        quoteCurrency: 'IRR',
        rate: '0',
        rateType: FxRateType.REFERENCE,
      })
      .expect(400);

    const preview = await request(app.getHttpServer())
      .post('/api/v1/finance/fx/convert/preview')
      .set(auth(token, companyId))
      .send({
        fromAmount: '250000000',
        fromCurrency: 'IRR',
        toCurrency: 'USD',
        appliedRate: '250000',
        rateBaseCurrency: 'USD',
        rateQuoteCurrency: 'IRR',
      })
      .expect(200);
    expect(preview.body.data.toAmount).toMatch(/^1000(\.0+)?$/);
    expect(preview.body.data.rateDisplay).toBe('1 USD = 250000 IRR');

    const requestId = randomUUID();
    const conversion = await request(app.getHttpServer())
      .post('/api/v1/finance/fx/conversions')
      .set(auth(token, companyId))
      .send({
        sourceAccountId: irrId,
        destinationAccountId: usdId,
        fromAmount: '250000000',
        fromCurrency: 'IRR',
        toAmount: '1000',
        toCurrency: 'USD',
        appliedRate: '250000',
        rateBaseCurrency: 'USD',
        rateQuoteCurrency: 'IRR',
        postImmediately: true,
        requestId,
      })
      .expect(201);
    expect(conversion.body.data.status).toBe('POSTED');
    expect(conversion.body.data.number).toMatch(/^FXC-\d{6,}$/);

    const idempotent = await request(app.getHttpServer())
      .post('/api/v1/finance/fx/conversions')
      .set(auth(token, companyId))
      .send({
        sourceAccountId: irrId,
        destinationAccountId: usdId,
        fromAmount: '250000000',
        fromCurrency: 'IRR',
        toAmount: '1000',
        toCurrency: 'USD',
        appliedRate: '250000',
        rateBaseCurrency: 'USD',
        rateQuoteCurrency: 'IRR',
        postImmediately: true,
        requestId,
      })
      .expect(201);
    expect(idempotent.body.data.id).toBe(conversion.body.data.id);

    await request(app.getHttpServer())
      .post('/api/v1/finance/fx/conversions')
      .set(auth(token, companyId))
      .send({
        sourceAccountId: irrId,
        destinationAccountId: usdId,
        fromAmount: '100',
        fromCurrency: 'IRR',
        toAmount: '100',
        toCurrency: 'IRR',
        appliedRate: '250000',
        rateBaseCurrency: 'USD',
        rateQuoteCurrency: 'IRR',
        requestId: randomUUID(),
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/finance/fx/conversions')
      .set(auth(token, companyId))
      .send({
        sourceAccountId: usdId,
        destinationAccountId: irrId,
        fromAmount: '10',
        fromCurrency: 'IRR',
        toAmount: '2500000',
        toCurrency: 'IRR',
        appliedRate: '250000',
        rateBaseCurrency: 'USD',
        rateQuoteCurrency: 'IRR',
        requestId: randomUUID(),
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/finance/fx/conversions')
      .set(auth(token, companyId))
      .send({
        sourceAccountId: usdId,
        destinationAccountId: irrId,
        fromAmount: '2500000',
        fromCurrency: 'IRR',
        toAmount: '10',
        toCurrency: 'USD',
        appliedRate: '250000',
        rateBaseCurrency: 'USD',
        rateQuoteCurrency: 'IRR',
        requestId: randomUUID(),
      })
      .expect(409);

    await request(app.getHttpServer())
      .post('/api/v1/finance/fx/conversions')
      .set(auth(token, companyId))
      .send({
        sourceAccountId: irrId,
        destinationAccountId: usdId,
        fromAmount: '999999999999',
        fromCurrency: 'IRR',
        toAmount: '3999999.999996',
        toCurrency: 'USD',
        appliedRate: '250000',
        rateBaseCurrency: 'USD',
        rateQuoteCurrency: 'IRR',
        postImmediately: true,
        requestId: randomUUID(),
      })
      .expect(409);

    const positions = await request(app.getHttpServer())
      .get('/api/v1/finance/fx/positions')
      .set(auth(token, companyId))
      .expect(200);
    const irrPos = positions.body.data.positions.find(
      (p: { currency: string }) => p.currency === 'IRR',
    );
    const usdPos = positions.body.data.positions.find(
      (p: { currency: string }) => p.currency === 'USD',
    );
    expect(Number(irrPos.cashBalance)).toBe(250000000);
    expect(Number(usdPos.cashBalance)).toBe(1100);
    expect(Number(irrPos.net)).toBe(Number(irrPos.cashBalance));

    await request(app.getHttpServer())
      .post('/api/v1/finance/fx/rates')
      .set(auth(token, companyId))
      .send({
        baseCurrency: 'USD',
        quoteCurrency: 'IRR',
        rate: '270000',
        rateType: FxRateType.VALUATION,
        effectiveAt: '2026-01-01T00:00:00.000Z',
      })
      .expect(201);

    const valuation = await request(app.getHttpServer())
      .get('/api/v1/finance/fx/valuation')
      .query({ rateType: 'VALUATION' })
      .set(auth(token, companyId))
      .expect(200);
    expect(valuation.body.data.lines.some((l: { status: string }) => l.status === 'VALUED')).toBe(
      true,
    );

    const missingValuationCompany = await createTempCompany();
    await seedAccounts(token, missingValuationCompany);
    const unavailable = await request(app.getHttpServer())
      .get('/api/v1/finance/fx/valuation')
      .query({ rateType: 'VALUATION' })
      .set(auth(token, missingValuationCompany))
      .expect(200);
    const usdLines = unavailable.body.data.lines.filter(
      (l: { currency: string; status: string }) =>
        l.currency === 'USD' && l.status === 'UNAVAILABLE',
    );
    expect(usdLines.length).toBeGreaterThan(0);
    expect(usdLines[0].baseAmount).toBeNull();

    const reversed = await request(app.getHttpServer())
      .post(`/api/v1/finance/fx/conversions/${conversion.body.data.id}/reverse`)
      .set(auth(token, companyId))
      .expect(200);
    expect(reversed.body.data.status).toBe('REVERSED');

    const afterReverse = await request(app.getHttpServer())
      .get('/api/v1/finance/fx/positions')
      .set(auth(token, companyId))
      .expect(200);
    const irrAfter = afterReverse.body.data.positions.find(
      (p: { currency: string }) => p.currency === 'IRR',
    );
    const usdAfter = afterReverse.body.data.positions.find(
      (p: { currency: string }) => p.currency === 'USD',
    );
    expect(Number(irrAfter.cashBalance)).toBe(500000000);
    expect(Number(usdAfter.cashBalance)).toBe(100);
  });

  it('tenant IDOR + mass assignment + warehouse deny', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const rate = await request(app.getHttpServer())
      .post('/api/v1/finance/fx/rates')
      .set(auth(token, companyId))
      .send({
        baseCurrency: 'USD',
        quoteCurrency: 'IRR',
        rate: '250000',
        rateType: FxRateType.REFERENCE,
        companyId: demoBId,
      });
    // Whitelist rejects unknown fields (400) or strips them (201) — never honor mass-assigned companyId.
    if (rate.status === 201) {
      expect(rate.body.data.companyId).toBe(companyId);
      await request(app.getHttpServer())
        .get(`/api/v1/finance/fx/rates/${rate.body.data.id}`)
        .set(auth(token, demoBId))
        .expect(404);
    } else {
      expect(rate.status).toBe(400);
    }

    const warehouseToken = await login(warehouseOperatorEmail);
    await request(app.getHttpServer())
      .get('/api/v1/finance/fx/rates')
      .set(auth(warehouseToken, pishtehId))
      .expect(403);
  });

  it('seeded PISHTEH REFERENCE/VALUATION rates exist and preserve payable/loan under valuation', async () => {
    const token = await login(ownerEmail);
    const ref = await request(app.getHttpServer())
      .get('/api/v1/finance/fx/rates/latest')
      .query({ base: 'USD', quote: 'IRR', rateType: 'REFERENCE' })
      .set(auth(token, pishtehId))
      .expect(200);
    expect(ref.body.data?.rateDisplay).toContain('1 USD =');

    const val = await request(app.getHttpServer())
      .get('/api/v1/finance/fx/valuation')
      .query({ rateType: 'VALUATION' })
      .set(auth(token, pishtehId))
      .expect(200);

    const usdLoanBefore = await database.client.loan.findFirst({
      where: { companyId: pishtehId, currency: CurrencyCode.USD },
    });
    expect(usdLoanBefore?.currency).toBe(CurrencyCode.USD);

    await request(app.getHttpServer())
      .get('/api/v1/finance/fx/positions')
      .set(auth(token, pishtehId))
      .expect(200);

    const usdLoanAfter = await database.client.loan.findFirst({
      where: { id: usdLoanBefore!.id },
    });
    expect(usdLoanAfter?.currency).toBe(CurrencyCode.USD);
    expect(val.body.data.note).toContain('Does not mutate');
  });

  it('concurrent conversion balance race: one wins, one insufficient', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const { irrId, usdId } = await seedAccounts(token, companyId);

    // Leave only enough IRR for one 250M conversion (opening was 500M).
    await request(app.getHttpServer())
      .post('/api/v1/finance/fx/conversions')
      .set(auth(token, companyId))
      .send({
        sourceAccountId: irrId,
        destinationAccountId: usdId,
        fromAmount: '250000000',
        fromCurrency: 'IRR',
        toAmount: '1000',
        toCurrency: 'USD',
        appliedRate: '250000',
        rateBaseCurrency: 'USD',
        rateQuoteCurrency: 'IRR',
        postImmediately: true,
        requestId: randomUUID(),
      })
      .expect(201);

    const [a, b] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/finance/fx/conversions')
        .set(auth(token, companyId))
        .send({
          sourceAccountId: irrId,
          destinationAccountId: usdId,
          fromAmount: '250000000',
          fromCurrency: 'IRR',
          toAmount: '1000',
          toCurrency: 'USD',
          appliedRate: '250000',
          rateBaseCurrency: 'USD',
          rateQuoteCurrency: 'IRR',
          postImmediately: true,
          requestId: randomUUID(),
        }),
      request(app.getHttpServer())
        .post('/api/v1/finance/fx/conversions')
        .set(auth(token, companyId))
        .send({
          sourceAccountId: irrId,
          destinationAccountId: usdId,
          fromAmount: '250000000',
          fromCurrency: 'IRR',
          toAmount: '1000',
          toCurrency: 'USD',
          appliedRate: '250000',
          rateBaseCurrency: 'USD',
          rateQuoteCurrency: 'IRR',
          postImmediately: true,
          requestId: randomUUID(),
        }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
  });
});
