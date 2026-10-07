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
import { createPartyLinkedSupplier } from './helpers/party-linked-supplier';

describe('Finance Payments + Receipts + Transfers (e2e)', () => {
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
      await database.client.payment.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.receipt.deleteMany({
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
      await database.client.supplierPayableLine.deleteMany({
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
      await database.client.paymentSequence.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.receiptSequence.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.financialAccountTransferSequence.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.supplierPayableSequence.deleteMany({
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
      await database.client.partyRole.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.partyContactPoint.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.partyAddress.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.party.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.partySequence.deleteMany({
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
    const slug = `pay-tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const company = await database.client.company.create({
      data: {
        name: `Pay Temp ${slug}`,
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

  async function createFundedIrrPair(token: string, companyId: string) {
    const bank = await request(app.getHttpServer())
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
    const cash = await request(app.getHttpServer())
      .post('/api/v1/finance/accounts')
      .set(auth(token, companyId))
      .send({
        code: 'CASH-IRR',
        name: 'IRR Cash',
        type: FinancialAccountType.CASH,
        currency: CurrencyCode.IRR,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/finance/accounts/${bank.body.data.id}/opening-balance`)
      .set(auth(token, companyId))
      .send({ amount: '1000000000', requestId: randomUUID() })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/finance/accounts/${cash.body.data.id}/opening-balance`)
      .set(auth(token, companyId))
      .send({ amount: '100000000', requestId: randomUUID() })
      .expect(200);
    return { bankId: bank.body.data.id as string, cashId: cash.body.data.id as string };
  }

  async function balanceOf(token: string, companyId: string, accountId: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/finance/accounts/${accountId}/balance`)
      .set(auth(token, companyId))
      .expect(200);
    return res.body.data.amount as string;
  }

  async function movementCount(
    companyId: string,
    sourceType: string,
    sourceId: string,
  ): Promise<number> {
    return database.client.financialAccountMovement.count({
      where: { companyId, sourceType, sourceId },
    });
  }

  it('payment posts → balance decreases, one OUT movement', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const { bankId } = await createFundedIrrPair(token, companyId);

    const before = await balanceOf(token, companyId, bankId);
    const created = await request(app.getHttpServer())
      .post('/api/v1/finance/payments')
      .set(auth(token, companyId))
      .send({
        accountId: bankId,
        amount: '500000000',
        purposeType: PaymentPurposeType.OTHER,
        requestId: randomUUID(),
        postImmediately: true,
      })
      .expect(201);

    expect(created.body.data.status).toBe('POSTED');
    expect(created.body.data.number).toMatch(/^PAY-\d{6,}$/);
    expect(created.body.data.currency).toBe('IRR');

    const after = await balanceOf(token, companyId, bankId);
    expect(Number(after)).toBe(Number(before) - 500000000);
    expect(await movementCount(companyId, 'PAYMENT', created.body.data.id)).toBe(1);

    const mov = await database.client.financialAccountMovement.findFirstOrThrow({
      where: {
        companyId,
        sourceType: 'PAYMENT',
        sourceId: created.body.data.id,
      },
    });
    expect(mov.direction).toBe('OUT');
    expect(mov.type).toBe('MONEY_OUT');
    expect(mov.amount.toFixed()).toBe('500000000');
  });

  it('receipt posts → balance increases, one IN movement', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const { bankId } = await createFundedIrrPair(token, companyId);

    const before = await balanceOf(token, companyId, bankId);
    const created = await request(app.getHttpServer())
      .post('/api/v1/finance/receipts')
      .set(auth(token, companyId))
      .send({
        accountId: bankId,
        amount: '700000000',
        sourceType: ReceiptSourceType.OTHER,
        requestId: randomUUID(),
        postImmediately: true,
      })
      .expect(201);

    expect(created.body.data.status).toBe('POSTED');
    expect(created.body.data.number).toMatch(/^REC-\d{6,}$/);

    const after = await balanceOf(token, companyId, bankId);
    expect(Number(after)).toBe(Number(before) + 700000000);
    expect(await movementCount(companyId, 'RECEIPT', created.body.data.id)).toBe(1);

    const mov = await database.client.financialAccountMovement.findFirstOrThrow({
      where: {
        companyId,
        sourceType: 'RECEIPT',
        sourceId: created.body.data.id,
      },
    });
    expect(mov.direction).toBe('IN');
    expect(mov.type).toBe('MONEY_IN');
  });

  it('transfer via account-transfers → OUT+IN, total assets unchanged', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const { bankId, cashId } = await createFundedIrrPair(token, companyId);

    const bankBefore = Number(await balanceOf(token, companyId, bankId));
    const cashBefore = Number(await balanceOf(token, companyId, cashId));
    const totalBefore = bankBefore + cashBefore;

    const transfer = await request(app.getHttpServer())
      .post('/api/v1/finance/account-transfers')
      .set(auth(token, companyId))
      .send({
        sourceAccountId: bankId,
        destinationAccountId: cashId,
        amount: '200000000',
        requestId: randomUUID(),
        postImmediately: true,
      })
      .expect(201);

    expect(transfer.body.data.status).toBe('POSTED');
    expect(await movementCount(companyId, 'ACCOUNT_TRANSFER', transfer.body.data.id)).toBe(2);

    const bankAfter = Number(await balanceOf(token, companyId, bankId));
    const cashAfter = Number(await balanceOf(token, companyId, cashId));
    expect(bankAfter).toBe(bankBefore - 200000000);
    expect(cashAfter).toBe(cashBefore + 200000000);
    expect(bankAfter + cashAfter).toBe(totalBefore);
  });

  it('insufficient balance Payment/Transfer reject, no movements', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const { bankId, cashId } = await createFundedIrrPair(token, companyId);

    const payFail = await request(app.getHttpServer())
      .post('/api/v1/finance/payments')
      .set(auth(token, companyId))
      .send({
        accountId: bankId,
        amount: '2000000000',
        purposeType: PaymentPurposeType.OTHER,
        requestId: randomUUID(),
        postImmediately: true,
      })
      .expect(409);
    expect(payFail.body.error.code).toBe('FINANCIAL_ACCOUNT_INSUFFICIENT_BALANCE');
    expect(
      await database.client.financialAccountMovement.count({
        where: { companyId, sourceType: 'PAYMENT' },
      }),
    ).toBe(0);

    const xferFail = await request(app.getHttpServer())
      .post('/api/v1/finance/account-transfers')
      .set(auth(token, companyId))
      .send({
        sourceAccountId: bankId,
        destinationAccountId: cashId,
        amount: '2000000000',
        requestId: randomUUID(),
        postImmediately: true,
      })
      .expect(409);
    expect(xferFail.body.error.code).toBe('FINANCIAL_ACCOUNT_INSUFFICIENT_BALANCE');
    expect(
      await database.client.financialAccountMovement.count({
        where: { companyId, sourceType: 'ACCOUNT_TRANSFER' },
      }),
    ).toBe(0);
  });

  it('rejects cross-currency transfer, same-account transfer, and currency spoof on payment', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const { bankId, cashId } = await createFundedIrrPair(token, companyId);

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
      .post(`/api/v1/finance/accounts/${usd.body.data.id}/opening-balance`)
      .set(auth(token, companyId))
      .send({ amount: '10000', requestId: randomUUID() })
      .expect(200);

    const cross = await request(app.getHttpServer())
      .post('/api/v1/finance/account-transfers')
      .set(auth(token, companyId))
      .send({
        sourceAccountId: bankId,
        destinationAccountId: usd.body.data.id,
        amount: '1000',
        requestId: randomUUID(),
        postImmediately: true,
      })
      .expect(409);
    expect(cross.body.error.code).toBe('ACCOUNT_TRANSFER_CROSS_CURRENCY');

    const same = await request(app.getHttpServer())
      .post('/api/v1/finance/account-transfers')
      .set(auth(token, companyId))
      .send({
        sourceAccountId: bankId,
        destinationAccountId: bankId,
        amount: '1000',
        requestId: randomUUID(),
        postImmediately: true,
      })
      .expect(409);
    expect(same.body.error.code).toBe('ACCOUNT_TRANSFER_SAME_ACCOUNT');

    // Currency is derived from account; client-supplied currency is forbidden/ignored.
    const paySpoof = await request(app.getHttpServer())
      .post('/api/v1/finance/payments')
      .set(auth(token, companyId))
      .send({
        accountId: bankId,
        amount: '1000',
        purposeType: PaymentPurposeType.OTHER,
        currency: 'USD',
        requestId: randomUUID(),
        postImmediately: true,
      });
    if (paySpoof.status === 201) {
      expect(paySpoof.body.data.currency).toBe('IRR');
      expect(paySpoof.body.data.account.currency).toBe('IRR');
    } else {
      expect(paySpoof.status).toBe(400);
      const okPay = await request(app.getHttpServer())
        .post('/api/v1/finance/payments')
        .set(auth(token, companyId))
        .send({
          accountId: bankId,
          amount: '1000',
          purposeType: PaymentPurposeType.OTHER,
          requestId: randomUUID(),
          postImmediately: true,
        })
        .expect(201);
      expect(okPay.body.data.currency).toBe('IRR');
    }

    // USD amount with excessive precision rejected.
    await request(app.getHttpServer())
      .post('/api/v1/finance/payments')
      .set(auth(token, companyId))
      .send({
        accountId: usd.body.data.id,
        amount: '10.1234567',
        purposeType: PaymentPurposeType.OTHER,
        requestId: randomUUID(),
        postImmediately: true,
      })
      .expect(400);

    void cashId;
  });

  it('cancel draft → no movements; cancel posted reject; posted immutability', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const { bankId } = await createFundedIrrPair(token, companyId);

    const draft = await request(app.getHttpServer())
      .post('/api/v1/finance/payments')
      .set(auth(token, companyId))
      .send({
        accountId: bankId,
        amount: '1000000',
        purposeType: PaymentPurposeType.OTHER,
        requestId: randomUUID(),
      })
      .expect(201);
    expect(draft.body.data.status).toBe('DRAFT');

    await request(app.getHttpServer())
      .post(`/api/v1/finance/payments/${draft.body.data.id}/cancel`)
      .set(auth(token, companyId))
      .expect(200);
    expect(await movementCount(companyId, 'PAYMENT', draft.body.data.id)).toBe(0);

    const posted = await request(app.getHttpServer())
      .post('/api/v1/finance/payments')
      .set(auth(token, companyId))
      .send({
        accountId: bankId,
        amount: '2000000',
        purposeType: PaymentPurposeType.OTHER,
        requestId: randomUUID(),
        postImmediately: true,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/finance/payments/${posted.body.data.id}/cancel`)
      .set(auth(token, companyId))
      .expect(409);

    await request(app.getHttpServer())
      .patch(`/api/v1/finance/payments/${posted.body.data.id}`)
      .set(auth(token, companyId))
      .send({ amount: '1', notes: 'mutated' })
      .expect(409);
  });

  it('reverses payment, receipt, and transfer; transfer reverse insufficient dest fails', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const { bankId, cashId } = await createFundedIrrPair(token, companyId);

    const payment = await request(app.getHttpServer())
      .post('/api/v1/finance/payments')
      .set(auth(token, companyId))
      .send({
        accountId: bankId,
        amount: '50000000',
        purposeType: PaymentPurposeType.OTHER,
        requestId: randomUUID(),
        postImmediately: true,
      })
      .expect(201);
    const balAfterPay = await balanceOf(token, companyId, bankId);

    await request(app.getHttpServer())
      .post(`/api/v1/finance/payments/${payment.body.data.id}/reverse`)
      .set(auth(token, companyId))
      .send({ reason: 'Duplicate bank transfer entry' })
      .expect(200);
    expect(await balanceOf(token, companyId, bankId)).toBe(
      String(Number(balAfterPay) + 50000000),
    );

    const receipt = await request(app.getHttpServer())
      .post('/api/v1/finance/receipts')
      .set(auth(token, companyId))
      .send({
        accountId: bankId,
        amount: '25000000',
        sourceType: ReceiptSourceType.OTHER,
        requestId: randomUUID(),
        postImmediately: true,
      })
      .expect(201);
    const balAfterRec = await balanceOf(token, companyId, bankId);
    await request(app.getHttpServer())
      .post(`/api/v1/finance/receipts/${receipt.body.data.id}/reverse`)
      .set(auth(token, companyId))
      .send({ reason: 'Misclassified inflow' })
      .expect(200);
    expect(await balanceOf(token, companyId, bankId)).toBe(
      String(Number(balAfterRec) - 25000000),
    );

    const transfer = await request(app.getHttpServer())
      .post('/api/v1/finance/account-transfers')
      .set(auth(token, companyId))
      .send({
        sourceAccountId: bankId,
        destinationAccountId: cashId,
        amount: '80000000',
        requestId: randomUUID(),
        postImmediately: true,
      })
      .expect(201);

    // Drain destination so reverse cannot pull funds back.
    await request(app.getHttpServer())
      .post('/api/v1/finance/payments')
      .set(auth(token, companyId))
      .send({
        accountId: cashId,
        amount: '180000000',
        purposeType: PaymentPurposeType.OTHER,
        requestId: randomUUID(),
        postImmediately: true,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/finance/account-transfers/${transfer.body.data.id}/reverse`)
      .set(auth(token, companyId))
      .expect(409);

    // Fund destination again and reverse succeeds.
    await request(app.getHttpServer())
      .post('/api/v1/finance/receipts')
      .set(auth(token, companyId))
      .send({
        accountId: cashId,
        amount: '80000000',
        sourceType: ReceiptSourceType.OTHER,
        requestId: randomUUID(),
        postImmediately: true,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/finance/account-transfers/${transfer.body.data.id}/reverse`)
      .set(auth(token, companyId))
      .expect(200);
  });

  it('idempotent post retry and concurrent payments on limited balance', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const { bankId } = await createFundedIrrPair(token, companyId);

    const requestId = randomUUID();
    const first = await request(app.getHttpServer())
      .post('/api/v1/finance/payments')
      .set(auth(token, companyId))
      .send({
        accountId: bankId,
        amount: '100000000',
        purposeType: PaymentPurposeType.OTHER,
        requestId,
        postImmediately: true,
      })
      .expect(201);
    const retry = await request(app.getHttpServer())
      .post('/api/v1/finance/payments')
      .set(auth(token, companyId))
      .send({
        accountId: bankId,
        amount: '100000000',
        purposeType: PaymentPurposeType.OTHER,
        requestId,
        postImmediately: true,
      })
      .expect(201);
    expect(retry.body.data.id).toBe(first.body.data.id);
    expect(await movementCount(companyId, 'PAYMENT', first.body.data.id)).toBe(1);

    // Leave 700M, race two 500M payments — at most one succeeds.
    const draftA = await request(app.getHttpServer())
      .post('/api/v1/finance/payments')
      .set(auth(token, companyId))
      .send({
        accountId: bankId,
        amount: '500000000',
        purposeType: PaymentPurposeType.OTHER,
        requestId: randomUUID(),
      })
      .expect(201);
    const draftB = await request(app.getHttpServer())
      .post('/api/v1/finance/payments')
      .set(auth(token, companyId))
      .send({
        accountId: bankId,
        amount: '500000000',
        purposeType: PaymentPurposeType.OTHER,
        requestId: randomUUID(),
      })
      .expect(201);

    // Spend down to 700M remaining after the 100M payment from 1B.
    const current = Number(await balanceOf(token, companyId, bankId));
    expect(current).toBe(900000000);
    await request(app.getHttpServer())
      .post('/api/v1/finance/payments')
      .set(auth(token, companyId))
      .send({
        accountId: bankId,
        amount: '200000000',
        purposeType: PaymentPurposeType.OTHER,
        requestId: randomUUID(),
        postImmediately: true,
      })
      .expect(201);
    expect(await balanceOf(token, companyId, bankId)).toBe('700000000');

    const [postA, postB] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/finance/payments/${draftA.body.data.id}/post`)
        .set(auth(token, companyId)),
      request(app.getHttpServer())
        .post(`/api/v1/finance/payments/${draftB.body.data.id}/post`)
        .set(auth(token, companyId)),
    ]);
    const statuses = [postA.status, postB.status].sort();
    expect(statuses).toEqual([200, 409]);
    expect(Number(await balanceOf(token, companyId, bankId))).toBe(200000000);
  });

  it('SUPPLIER purpose does not change SupplierPayable open amount; Payment≠Expense; Receipt≠Revenue', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const { bankId } = await createFundedIrrPair(token, companyId);

    const supplier = await createPartyLinkedSupplier(database.client, {
      companyId,
      code: `SUP-${Date.now().toString(36).toUpperCase()}`,
      name: 'E2E Supplier Pay Boundary',
    });

    const opening = await request(app.getHttpServer())
      .post('/api/v1/finance/payables/opening')
      .set(auth(token, companyId))
      .send({
        supplierId: supplier.id,
        currency: CurrencyCode.IRR,
        amount: '500000000',
        notes: 'e2e payment boundary',
        requestId: randomUUID(),
      })
      .expect(201);
    const payableId = opening.body.data.id as string;
    const before = await request(app.getHttpServer())
      .get(`/api/v1/finance/payables/${payableId}`)
      .set(auth(token, companyId))
      .expect(200);
    expect(before.body.data.outstandingAmount).toBe('500000000');

    const payment = await request(app.getHttpServer())
      .post('/api/v1/finance/payments')
      .set(auth(token, companyId))
      .send({
        accountId: bankId,
        amount: '500000000',
        purposeType: PaymentPurposeType.SUPPLIER,
        counterpartyType: 'SUPPLIER',
        counterpartyId: supplier.id,
        counterpartyName: supplier.name,
        requestId: randomUUID(),
        postImmediately: true,
      })
      .expect(201);
    expect(payment.body.data.purposeType).toBe('SUPPLIER');

    const after = await request(app.getHttpServer())
      .get(`/api/v1/finance/payables/${payableId}`)
      .set(auth(token, companyId))
      .expect(200);
    expect(after.body.data.outstandingAmount).toBe('500000000');

    const allocations = await database.client.supplierPaymentAllocation.count({
      where: {
        companyId,
        paymentSourceType: 'PAYMENT',
        paymentSourceId: payment.body.data.id,
      },
    });
    expect(allocations).toBe(0);

    // Phase 4.6/4.7: Payment with purpose EXPENSE does NOT auto-create Expense rows.
    // Expense exists as a separate domain (4.7); cash Payment ≠ Expense recognition.
    const expenseCountBefore = await database.client.expense.count({
      where: { companyId },
    });
    expect(
      (database.client as unknown as { revenue?: unknown }).revenue,
    ).toBeUndefined();

    const expensePurpose = await request(app.getHttpServer())
      .post('/api/v1/finance/payments')
      .set(auth(token, companyId))
      .send({
        accountId: bankId,
        amount: '1000',
        purposeType: PaymentPurposeType.EXPENSE,
        requestId: randomUUID(),
        postImmediately: true,
      })
      .expect(201);
    const expenseCountAfter = await database.client.expense.count({
      where: { companyId },
    });
    expect(expenseCountAfter).toBe(expenseCountBefore);
    const movTypes = await database.client.financialAccountMovement.findMany({
      where: { companyId, sourceId: expensePurpose.body.data.id },
      select: { type: true, sourceType: true },
    });
    expect(movTypes).toEqual([{ type: 'MONEY_OUT', sourceType: 'PAYMENT' }]);

    const receipt = await request(app.getHttpServer())
      .post('/api/v1/finance/receipts')
      .set(auth(token, companyId))
      .send({
        accountId: bankId,
        amount: '1000',
        sourceType: ReceiptSourceType.CUSTOMER,
        requestId: randomUUID(),
        postImmediately: true,
      })
      .expect(201);
    const recMov = await database.client.financialAccountMovement.findMany({
      where: { companyId, sourceId: receipt.body.data.id },
      select: { type: true, sourceType: true },
    });
    expect(recMov).toEqual([{ type: 'MONEY_IN', sourceType: 'RECEIPT' }]);
  });

  it('tenant IDOR, mass assignment ignored, search injection-safe, large IRR precision', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const { bankId } = await createFundedIrrPair(token, companyId);

    await request(app.getHttpServer())
      .post('/api/v1/finance/receipts')
      .set(auth(token, companyId))
      .send({
        accountId: bankId,
        amount: '200000000000',
        sourceType: ReceiptSourceType.OTHER,
        requestId: randomUUID(),
        postImmediately: true,
      })
      .expect(201);

    // Forbidden/unknown fields are rejected by validation whitelist.
    await request(app.getHttpServer())
      .post('/api/v1/finance/payments')
      .set(auth(token, companyId))
      .send({
        accountId: bankId,
        amount: '123456789012',
        purposeType: PaymentPurposeType.OTHER,
        notes: 'precision-check',
        requestId: randomUUID(),
        postImmediately: true,
        companyId: demoBId,
        status: 'CANCELLED',
        postedById: randomUUID(),
      })
      .expect(400);

    const payment = await request(app.getHttpServer())
      .post('/api/v1/finance/payments')
      .set(auth(token, companyId))
      .send({
        accountId: bankId,
        amount: '123456789012',
        purposeType: PaymentPurposeType.OTHER,
        notes: 'precision-check',
        requestId: randomUUID(),
        postImmediately: true,
      })
      .expect(201);
    expect(payment.body.data.status).toBe('POSTED');
    expect(payment.body.data.amount).toBe('123456789012');
    const paymentId = payment.body.data.id as string;

    await request(app.getHttpServer())
      .get(`/api/v1/finance/payments/${paymentId}`)
      .set(auth(token, demoBId))
      .expect(404);

    const whToken = await login(warehouseOperatorEmail);
    await request(app.getHttpServer())
      .get('/api/v1/finance/payments')
      .set(auth(whToken, pishtehId))
      .expect(403);

    const list = await request(app.getHttpServer())
      .get('/api/v1/finance/payments')
      .query({ q: "'; DROP TABLE payments; --" })
      .set(auth(token, companyId))
      .expect(200);
    expect(Array.isArray(list.body.data)).toBe(true);

    const stillThere = await database.client.payment.findUnique({
      where: { id: paymentId },
    });
    expect(stillThere).not.toBeNull();
  });
});
