import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  CompanyMemberStatus,
  CurrencyCode,
  FinancialAccountStatus,
  FinancialAccountType,
  OWNER_ROLE_KEY,
  UserStatus,
  syncOwnerRolePermissions,
  syncPermissions,
} from '@hector/database';
import type { INestApplication } from '@nestjs/common';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';

describe('Finance Accounts (e2e)', () => {
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
  const tempAccountIds: string[] = [];

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
    if (tempAccountIds.length > 0 || tempCompanyIds.length > 0) {
      const companyFilter =
        tempCompanyIds.length > 0
          ? { companyId: { in: tempCompanyIds } }
          : { id: { in: tempAccountIds } };

      await database.client.financialAccountMovement.deleteMany({
        where:
          tempCompanyIds.length > 0
            ? { companyId: { in: tempCompanyIds } }
            : { accountId: { in: tempAccountIds } },
      });
      await database.client.financialAccountTransfer.deleteMany({
        where:
          tempCompanyIds.length > 0
            ? { companyId: { in: tempCompanyIds } }
            : {
                OR: [
                  { sourceAccountId: { in: tempAccountIds } },
                  { destinationAccountId: { in: tempAccountIds } },
                ],
              },
      });
      await database.client.financialAccount.deleteMany({
        where: companyFilter,
      });
      if (tempCompanyIds.length > 0) {
        await database.client.financialAccountTransferSequence.deleteMany({
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
    const slug = `fin-tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const company = await database.client.company.create({
      data: {
        name: `Finance Temp ${slug}`,
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

  it('creates IRR/USD accounts, opening balances, transfer conservation, and rejects unsafe cases', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();

    const irrBank = await request(app.getHttpServer())
      .post('/api/v1/finance/accounts')
      .set(auth(token, companyId))
      .send({
        code: 'BANK-IRR',
        name: 'IRR Bank',
        type: FinancialAccountType.BANK,
        currency: CurrencyCode.IRR,
        isDefault: true,
      })
      .expect(201);
    tempAccountIds.push(irrBank.body.data.id);

    const irrCash = await request(app.getHttpServer())
      .post('/api/v1/finance/accounts')
      .set(auth(token, companyId))
      .send({
        code: 'CASH-IRR',
        name: 'IRR Cash',
        type: FinancialAccountType.CASH,
        currency: CurrencyCode.IRR,
      })
      .expect(201);
    tempAccountIds.push(irrCash.body.data.id);

    const usdCash = await request(app.getHttpServer())
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
    tempAccountIds.push(usdCash.body.data.id);

    const openingReq = randomUUID();
    const opening = await request(app.getHttpServer())
      .post(`/api/v1/finance/accounts/${irrBank.body.data.id}/opening-balance`)
      .set(auth(token, companyId))
      .send({ amount: '1000000000', requestId: openingReq })
      .expect(200);
    expect(opening.body.data.amount).toBe('1000000000');
    expect(opening.body.data.type).toBe('OPENING_BALANCE');

    // Idempotent retry
    const openingRetry = await request(app.getHttpServer())
      .post(`/api/v1/finance/accounts/${irrBank.body.data.id}/opening-balance`)
      .set(auth(token, companyId))
      .send({ amount: '1000000000', requestId: openingReq })
      .expect(200);
    expect(openingRetry.body.data.id).toBe(opening.body.data.id);

    await request(app.getHttpServer())
      .post(`/api/v1/finance/accounts/${irrCash.body.data.id}/opening-balance`)
      .set(auth(token, companyId))
      .send({ amount: '100000000', requestId: randomUUID() })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/finance/accounts/${usdCash.body.data.id}/opening-balance`)
      .set(auth(token, companyId))
      .send({ amount: '10000', requestId: randomUUID() })
      .expect(200);

    const transferReq = randomUUID();
    const transfer = await request(app.getHttpServer())
      .post('/api/v1/finance/account-transfers')
      .set(auth(token, companyId))
      .send({
        sourceAccountId: irrBank.body.data.id,
        destinationAccountId: irrCash.body.data.id,
        amount: '200000000',
        requestId: transferReq,
        postImmediately: true,
      })
      .expect(201);
    expect(transfer.body.data.status).toBe('POSTED');
    expect(transfer.body.data.number).toMatch(/^FAT-\d{6,}$/);

    const transferRetry = await request(app.getHttpServer())
      .post('/api/v1/finance/account-transfers')
      .set(auth(token, companyId))
      .send({
        sourceAccountId: irrBank.body.data.id,
        destinationAccountId: irrCash.body.data.id,
        amount: '200000000',
        requestId: transferReq,
        postImmediately: true,
      })
      .expect(201);
    expect(transferRetry.body.data.id).toBe(transfer.body.data.id);

    const bankBal = await request(app.getHttpServer())
      .get(`/api/v1/finance/accounts/${irrBank.body.data.id}/balance`)
      .set(auth(token, companyId))
      .expect(200);
    const cashBal = await request(app.getHttpServer())
      .get(`/api/v1/finance/accounts/${irrCash.body.data.id}/balance`)
      .set(auth(token, companyId))
      .expect(200);
    expect(bankBal.body.data).toEqual({ amount: '800000000', currency: 'IRR' });
    expect(cashBal.body.data).toEqual({ amount: '300000000', currency: 'IRR' });

    const summary = await request(app.getHttpServer())
      .get('/api/v1/finance/accounts/summary')
      .set(auth(token, companyId))
      .expect(200);
    const irrBucket = summary.body.data.byCurrency.find(
      (b: { currency: string }) => b.currency === 'IRR',
    );
    expect(irrBucket.total).toBe('1100000000');

    // Insufficient
    await request(app.getHttpServer())
      .post('/api/v1/finance/account-transfers')
      .set(auth(token, companyId))
      .send({
        sourceAccountId: irrBank.body.data.id,
        destinationAccountId: irrCash.body.data.id,
        amount: '900000000',
        requestId: randomUUID(),
        postImmediately: true,
      })
      .expect(409);

    // Cross-currency reject
    const cross = await request(app.getHttpServer())
      .post('/api/v1/finance/account-transfers')
      .set(auth(token, companyId))
      .send({
        sourceAccountId: irrBank.body.data.id,
        destinationAccountId: usdCash.body.data.id,
        amount: '1000',
        requestId: randomUUID(),
        postImmediately: true,
      })
      .expect(409);
    expect(cross.body.error.code).toBe('ACCOUNT_TRANSFER_CROSS_CURRENCY');

    // Currency change reject
    const currencyPatch = await request(app.getHttpServer())
      .patch(`/api/v1/finance/accounts/${irrBank.body.data.id}`)
      .set(auth(token, companyId))
      .send({ currency: 'USD' })
      .expect(409);
    expect(currencyPatch.body.error.code).toBe('FINANCIAL_ACCOUNT_CURRENCY_IMMUTABLE');

    // Mass assignment balance rejected
    const balancePatch = await request(app.getHttpServer())
      .patch(`/api/v1/finance/accounts/${irrBank.body.data.id}`)
      .set(auth(token, companyId))
      .send({ balance: '999999999' })
      .expect(400);
    expect(balancePatch.body.error.code).toBe('FINANCIAL_ACCOUNT_BALANCE_NOT_ACCEPTABLE');

    // Archive with balance reject
    await request(app.getHttpServer())
      .post(`/api/v1/finance/accounts/${irrBank.body.data.id}/archive`)
      .set(auth(token, companyId))
      .expect(409);

    // Concurrent overspend: balance 800M, two 500M posts — at most one succeeds
    const draftA = await request(app.getHttpServer())
      .post('/api/v1/finance/account-transfers')
      .set(auth(token, companyId))
      .send({
        sourceAccountId: irrBank.body.data.id,
        destinationAccountId: irrCash.body.data.id,
        amount: '500000000',
        requestId: randomUUID(),
      })
      .expect(201);
    const draftB = await request(app.getHttpServer())
      .post('/api/v1/finance/account-transfers')
      .set(auth(token, companyId))
      .send({
        sourceAccountId: irrBank.body.data.id,
        destinationAccountId: irrCash.body.data.id,
        amount: '500000000',
        requestId: randomUUID(),
      })
      .expect(201);

    const [postA, postB] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/finance/account-transfers/${draftA.body.data.id}/post`)
        .set(auth(token, companyId)),
      request(app.getHttpServer())
        .post(`/api/v1/finance/account-transfers/${draftB.body.data.id}/post`)
        .set(auth(token, companyId)),
    ]);
    const statuses = [postA.status, postB.status].sort();
    expect(statuses).toEqual([200, 409]);

    const finalBank = await request(app.getHttpServer())
      .get(`/api/v1/finance/accounts/${irrBank.body.data.id}/balance`)
      .set(auth(token, companyId))
      .expect(200);
    expect(Number(finalBank.body.data.amount)).toBeGreaterThanOrEqual(0);
    expect(Number(finalBank.body.data.amount)).toBeLessThanOrEqual(800000000);
  });

  it('rejects cross-tenant IDOR on accounts', async () => {
    const token = await login(ownerEmail);
    const foreign = await database.client.financialAccount.findFirst({
      where: { companyId: demoBId },
    });
    // Create a demo-b account if seed didn't
    let foreignId = foreign?.id;
    if (!foreignId) {
      const created = await database.client.financialAccount.create({
        data: {
          companyId: demoBId,
          code: `TMP-${Date.now()}`,
          name: 'Demo B Cash',
          type: FinancialAccountType.CASH,
          currency: CurrencyCode.IRR,
          status: FinancialAccountStatus.ACTIVE,
        },
      });
      foreignId = created.id;
      tempAccountIds.push(created.id);
    }

    await request(app.getHttpServer())
      .get(`/api/v1/finance/accounts/${foreignId}`)
      .set(auth(token, pishtehId))
      .expect(404);

    await request(app.getHttpServer())
      .get(`/api/v1/finance/accounts/${foreignId}/balance`)
      .set(auth(token, pishtehId))
      .expect(404);
  });

  it('denies warehouse operator without finance permissions', async () => {
    const opToken = await login(warehouseOperatorEmail);
    await request(app.getHttpServer())
      .get('/api/v1/finance/accounts')
      .set(auth(opToken))
      .expect(403);

    await request(app.getHttpServer())
      .post('/api/v1/finance/accounts')
      .set(auth(opToken))
      .send({
        code: 'HACK',
        name: 'Hack',
        type: FinancialAccountType.CASH,
        currency: CurrencyCode.IRR,
      })
      .expect(403);
  });
});
