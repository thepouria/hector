import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  CompanyMemberStatus,
  CurrencyCode,
  ExpensePaymentStatus,
  ExpenseSourceType,
  ExpenseStatus,
  FinancialAccountType,
  InventoryCostLayerSourceType,
  InventoryValuationStatus,
  JournalEntryStatus,
  JournalLineDirection,
  OWNER_ROLE_KEY,
  StockClassification,
  PaymentPurposeType,
  Prisma,
  PurchaseCostAllocationMethod,
  PurchaseCostAllocationTargetType,
  PurchaseCostTreatment,
  PurchaseCostType,
  UserStatus,
  syncOwnerRolePermissions,
  syncPermissions,
} from '@hector/database';
import type { INestApplication } from '@nestjs/common';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';

const PO_COSTS_BASE = '/api/v1/purchasing/purchase-orders';

describe('Finance Expenses + Purchase Costs (e2e) Phase 4.7', () => {
  let app: INestApplication;
  let database: DatabaseService;
  const ownerEmail = 'pouria@hector.local';
  const warehouseOperatorEmail = 'hossein@hector.local';
  const password = E2E_PASSWORD;
  let pishtehId: string;
  let demoBId: string;
  let ownerPasswordHash: string;
  let tehranSupplierId: string;
  let mascaraSkuId: string;
  let mainWarehouseId: string;
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
    tehranSupplierId = (
      await database.client.supplier.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'TEH-BEAUTY' },
      })
    ).id;
    mascaraSkuId = (
      await database.client.sku.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'ESS-MASCARA-01' },
      })
    ).id;
    mainWarehouseId = (
      await database.client.warehouse.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'MAIN' },
      })
    ).id;

    const owner = await database.client.user.update({
      where: { email: ownerEmail },
      data: { status: UserStatus.ACTIVE, deletedAt: null },
    });
    ownerPasswordHash = owner.passwordHash;

    // Ensure default categories exist for pishteh (seed may have run).
    await request(app.getHttpServer()); // keep app warm
    const token = await login(ownerEmail);
    await ensureCategories(token, pishtehId);
  });

  afterAll(async () => {
    if (tempCompanyIds.length > 0) {
      await database.client.expensePaymentAllocation.deleteMany({
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
      await database.client.expense.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.expenseCategory.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.expenseSequence.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.payment.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.financialAccountMovement.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      // Clear FA→ledger mapping before deleting CoA
      await database.client.financialAccount.updateMany({
        where: { companyId: { in: tempCompanyIds } },
        data: { ledgerAccountId: null },
      });
      await database.client.ledgerAccount.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.financialAccount.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.fxRate.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.paymentSequence.deleteMany({
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

  async function ensureCategories(token: string, companyId: string) {
    const list = await request(app.getHttpServer())
      .get('/api/v1/finance/expense-categories')
      .set(auth(token, companyId))
      .expect(200);
    if ((list.body.data as unknown[]).length > 0) return;
    // Seed via DB upsert for temp/missing
    for (const code of ['RENT', 'COURIER', 'OTHER', 'FREIGHT']) {
      await database.client.expenseCategory.upsert({
        where: { companyId_code: { companyId, code } },
        create: {
          companyId,
          code,
          name: code,
          isSystem: true,
        },
        update: {},
      });
    }
  }

  async function createTempCompany(): Promise<{
    companyId: string;
    accountId: string;
    categoryId: string;
  }> {
    const slug = `exp-tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const company = await database.client.company.create({
      data: {
        name: `Exp Temp ${slug}`,
        slug,
        baseCurrency: CurrencyCode.IRR,
        timezone: 'Asia/Tehran',
      },
    });
    tempCompanyIds.push(company.id);
    const owner = await database.client.user.findUniqueOrThrow({
      where: { email: ownerEmail },
    });
    const role = await database.client.role.create({
      data: {
        companyId: company.id,
        name: 'Owner',
        key: OWNER_ROLE_KEY,
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

    for (const code of ['RENT', 'COURIER', 'OTHER', 'FREIGHT']) {
      await database.client.expenseCategory.create({
        data: { companyId: company.id, code, name: code, isSystem: true },
      });
    }
    const category = await database.client.expenseCategory.findUniqueOrThrow({
      where: { companyId_code: { companyId: company.id, code: 'RENT' } },
    });

    const token = await login(ownerEmail);
    // Bootstrap CoA for temp companies (approveImmediately posts recognition journals).
    await request(app.getHttpServer())
      .get('/api/v1/finance/ledger-accounts')
      .set(auth(token, company.id))
      .expect(200);
    const accountRes = await request(app.getHttpServer())
      .post('/api/v1/finance/accounts')
      .set(auth(token, company.id))
      .send({
        code: 'CASH-IRR',
        name: 'Cash IRR',
        type: FinancialAccountType.CASH,
        currency: CurrencyCode.IRR,
        isDefault: true,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/finance/accounts/${accountRes.body.data.id}/opening-balance`)
      .set(auth(token, company.id))
      .send({ amount: '1000000000', requestId: randomUUID() })
      .expect(200);

    return {
      companyId: company.id,
      accountId: accountRes.body.data.id as string,
      categoryId: category.id,
    };
  }

  /**
   * Minimal PO + FREIGHT cost + GOODS_RECEIPT FIFO layer (Prisma-inserted).
   * Avoids full GRN flow while exercising CAPITALIZABLE / PERIOD_EXPENSE allocation.
   */
  async function createPoCostWithLayer(token: string, opts?: { shippingAmount?: string }) {
    const shippingAmount = opts?.shippingAmount ?? '10000000';
    const qty = 100;
    const unitCost = '500000';

    const poRes = await request(app.getHttpServer())
      .post(PO_COSTS_BASE)
      .set(auth(token))
      .send({
        supplierId: tehranSupplierId,
        currency: 'IRR',
        purchaseType: 'CASH',
        items: [{ skuId: mascaraSkuId, quantity: qty, unitPrice: unitCost }],
      })
      .expect(201);
    const po = poRes.body.data as {
      id: string;
      items: Array<{ id: string }>;
    };
    const poItemId = po.items[0]!.id;

    const costRes = await request(app.getHttpServer())
      .post(`${PO_COSTS_BASE}/${po.id}/costs`)
      .set(auth(token))
      .send({
        type: PurchaseCostType.FREIGHT,
        amount: shippingAmount,
        currency: CurrencyCode.IRR,
        description: 'Freight capitalization fixture',
      })
      .expect(201);
    const costId = costRes.body.data.id as string;

    const sourceLineId = randomUUID();
    const layer = await database.client.inventoryCostLayer.create({
      data: {
        companyId: pishtehId,
        warehouseId: mainWarehouseId,
        skuId: mascaraSkuId,
        classification: StockClassification.SELLABLE,
        sourceType: InventoryCostLayerSourceType.GOODS_RECEIPT,
        sourceId: randomUUID(),
        sourceLineId,
        purchaseOrderId: po.id,
        purchaseOrderItemId: poItemId,
        receivedAt: new Date('2026-04-01T12:00:00.000Z'),
        originalQuantity: qty,
        remainingQuantity: qty,
        valuationStatus: InventoryValuationStatus.VALUED,
        originalCurrency: CurrencyCode.IRR,
        originalUnitAmount: new Prisma.Decimal(unitCost),
        baseCurrencyUnitCost: new Prisma.Decimal(unitCost),
        hasUnallocatedPurchaseCosts: true,
      },
    });

    return {
      purchaseOrderId: po.id,
      poItemId,
      costId,
      layerId: layer.id,
      shippingAmount,
      qty,
      unitCost,
    };
  }

  it('110 — unpaid approved expense creates no AccountMovement', async () => {
    const token = await login(ownerEmail);
    const { companyId, categoryId } = await createTempCompany();
    const res = await request(app.getHttpServer())
      .post('/api/v1/finance/expenses')
      .set(auth(token, companyId))
      .send({
        categoryId,
        amount: '100000000',
        currency: CurrencyCode.IRR,
        expenseDate: '2026-04-01T12:00:00.000Z',
        description: 'Rent',
        approveImmediately: true,
        requestId: randomUUID(),
      })
      .expect(201);

    expect(res.body.data.status).toBe(ExpenseStatus.APPROVED);
    expect(res.body.data.paymentStatus).toBe(ExpensePaymentStatus.UNPAID);
    expect(res.body.data.paidAmount).toBe('0');
    expect(res.body.data.outstandingAmount).toBe('100000000');

    const movements = await database.client.financialAccountMovement.count({
      where: { companyId, sourceType: 'EXPENSE', sourceId: res.body.data.id },
    });
    expect(movements).toBe(0);
  });

  it('111+112+113 — pay-now, partial, multiple payments → PAID', async () => {
    const token = await login(ownerEmail);
    const { companyId, accountId, categoryId } = await createTempCompany();
    const created = await request(app.getHttpServer())
      .post('/api/v1/finance/expenses')
      .set(auth(token, companyId))
      .send({
        categoryId,
        amount: '100000000',
        currency: CurrencyCode.IRR,
        expenseDate: '2026-04-01T12:00:00.000Z',
        description: 'Courier batch',
        approveImmediately: true,
        requestId: randomUUID(),
      })
      .expect(201);
    const expenseId = created.body.data.id as string;

    const partial = await request(app.getHttpServer())
      .post(`/api/v1/finance/expenses/${expenseId}/pay-now`)
      .set(auth(token, companyId))
      .send({ accountId, amount: '40000000', requestId: randomUUID() })
      .expect(200);
    expect(partial.body.data.paymentStatus).toBe(ExpensePaymentStatus.PARTIALLY_PAID);
    expect(partial.body.data.paidAmount).toBe('40000000');
    expect(partial.body.data.outstandingAmount).toBe('60000000');

    await request(app.getHttpServer())
      .post(`/api/v1/finance/expenses/${expenseId}/pay-now`)
      .set(auth(token, companyId))
      .send({ accountId, amount: '30000000', requestId: randomUUID() })
      .expect(200);
    const final = await request(app.getHttpServer())
      .post(`/api/v1/finance/expenses/${expenseId}/pay-now`)
      .set(auth(token, companyId))
      .send({ accountId, amount: '30000000', requestId: randomUUID() })
      .expect(200);
    expect(final.body.data.paymentStatus).toBe(ExpensePaymentStatus.PAID);
    expect(final.body.data.outstandingAmount).toBe('0');

    const outs = await database.client.financialAccountMovement.count({
      where: { companyId, type: 'MONEY_OUT', sourceType: 'PAYMENT' },
    });
    expect(outs).toBe(3);
  });

  it('114 — over-allocation rejected', async () => {
    const token = await login(ownerEmail);
    const { companyId, accountId, categoryId } = await createTempCompany();
    const created = await request(app.getHttpServer())
      .post('/api/v1/finance/expenses')
      .set(auth(token, companyId))
      .send({
        categoryId,
        amount: '100000000',
        currency: CurrencyCode.IRR,
        expenseDate: '2026-04-01T12:00:00.000Z',
        description: 'Overpay test',
        approveImmediately: true,
        requestId: randomUUID(),
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/finance/expenses/${created.body.data.id}/pay-now`)
      .set(auth(token, companyId))
      .send({ accountId, amount: '80000000', requestId: randomUUID() })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/finance/expenses/${created.body.data.id}/pay-now`)
      .set(auth(token, companyId))
      .send({ accountId, amount: '30000000', requestId: randomUUID() })
      .expect(409);
  });

  it('115 — payment reverse restores UNPAID', async () => {
    const token = await login(ownerEmail);
    const { companyId, accountId, categoryId } = await createTempCompany();
    const created = await request(app.getHttpServer())
      .post('/api/v1/finance/expenses')
      .set(auth(token, companyId))
      .send({
        categoryId,
        amount: '50000000',
        currency: CurrencyCode.IRR,
        expenseDate: '2026-04-01T12:00:00.000Z',
        description: 'Reverse test',
        approveImmediately: true,
        requestId: randomUUID(),
      });
    if (created.status !== 201) {
      throw new Error(
        `expense create failed: status=${created.status} body=${JSON.stringify(created.body)}`,
      );
    }
    const paid = await request(app.getHttpServer())
      .post(`/api/v1/finance/expenses/${created.body.data.id}/pay-now`)
      .set(auth(token, companyId))
      .send({ accountId, requestId: randomUUID() })
      .expect(200);
    expect(paid.body.data.paymentStatus).toBe(ExpensePaymentStatus.PAID);
    const paymentId = paid.body.data.allocations[0].paymentId as string;

    await request(app.getHttpServer())
      .post(`/api/v1/finance/payments/${paymentId}/reverse`)
      .set(auth(token, companyId))
      .send({ reason: 'Test reverse expense settlement' })
      .expect(200);

    const after = await request(app.getHttpServer())
      .get(`/api/v1/finance/expenses/${created.body.data.id}`)
      .set(auth(token, companyId))
      .expect(200);
    expect(after.body.data.paymentStatus).toBe(ExpensePaymentStatus.UNPAID);
    expect(after.body.data.paidAmount).toBe('0');
  });

  it('116 — cancel paid expense rejected', async () => {
    const token = await login(ownerEmail);
    const { companyId, accountId, categoryId } = await createTempCompany();
    const created = await request(app.getHttpServer())
      .post('/api/v1/finance/expenses')
      .set(auth(token, companyId))
      .send({
        categoryId,
        amount: '10000000',
        currency: CurrencyCode.IRR,
        expenseDate: '2026-04-01T12:00:00.000Z',
        description: 'Cancel paid',
        approveImmediately: true,
        requestId: randomUUID(),
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/finance/expenses/${created.body.data.id}/pay-now`)
      .set(auth(token, companyId))
      .send({ accountId, requestId: randomUUID() })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/finance/expenses/${created.body.data.id}/cancel`)
      .set(auth(token, companyId))
      .expect(409);
  });

  it('117+118 — Payment ≠ Expense; Expense approve ≠ Payment movement', async () => {
    const token = await login(ownerEmail);
    const { companyId, accountId, categoryId } = await createTempCompany();
    await request(app.getHttpServer())
      .post('/api/v1/finance/payments')
      .set(auth(token, companyId))
      .send({
        accountId,
        amount: '100000000',
        purposeType: PaymentPurposeType.OTHER,
        postImmediately: true,
        requestId: randomUUID(),
      })
      .expect(201);
    const expenseCount = await database.client.expense.count({ where: { companyId } });
    expect(expenseCount).toBe(0);

    const exp = await request(app.getHttpServer())
      .post('/api/v1/finance/expenses')
      .set(auth(token, companyId))
      .send({
        categoryId,
        amount: '25000000',
        currency: CurrencyCode.IRR,
        expenseDate: '2026-04-01T12:00:00.000Z',
        description: 'Approve only',
        approveImmediately: true,
        requestId: randomUUID(),
      })
      .expect(201);
    const mov = await database.client.financialAccountMovement.count({
      where: { companyId, sourceId: exp.body.data.id },
    });
    expect(mov).toBe(0);
  });

  it('119+120 — foreign currency preserved; cross-currency allocate rejected', async () => {
    const token = await login(ownerEmail);
    const { companyId, accountId, categoryId } = await createTempCompany();
    const usdCat = await database.client.expenseCategory.findUniqueOrThrow({
      where: { companyId_code: { companyId, code: 'OTHER' } },
    });
    void categoryId;
    const usdAccount = await request(app.getHttpServer())
      .post('/api/v1/finance/accounts')
      .set(auth(token, companyId))
      .send({
        code: 'CASH-USD',
        name: 'Cash USD',
        type: FinancialAccountType.CASH,
        currency: CurrencyCode.USD,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/finance/accounts/${usdAccount.body.data.id}/opening-balance`)
      .set(auth(token, companyId))
      .send({ amount: '1000', requestId: randomUUID() })
      .expect(200);

    // Recognition journal on approve needs USD→IRR REFERENCE rate.
    await request(app.getHttpServer())
      .post('/api/v1/finance/fx/rates')
      .set(auth(token, companyId))
      .send({
        baseCurrency: CurrencyCode.USD,
        quoteCurrency: CurrencyCode.IRR,
        rate: '270000',
        rateType: 'REFERENCE',
        effectiveAt: '2026-03-01T00:00:00.000Z',
      })
      .expect(201);

    const exp = await request(app.getHttpServer())
      .post('/api/v1/finance/expenses')
      .set(auth(token, companyId))
      .send({
        categoryId: usdCat.id,
        amount: '100',
        currency: CurrencyCode.USD,
        expenseDate: '2026-04-01T12:00:00.000Z',
        description: 'USD software',
        approveImmediately: true,
        requestId: randomUUID(),
      })
      .expect(201);
    expect(exp.body.data.amount).toBe('100');
    expect(exp.body.data.currency).toBe(CurrencyCode.USD);

    const irrPayment = await request(app.getHttpServer())
      .post('/api/v1/finance/payments')
      .set(auth(token, companyId))
      .send({
        accountId,
        amount: '27000000',
        purposeType: PaymentPurposeType.EXPENSE,
        postImmediately: true,
        requestId: randomUUID(),
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/finance/expenses/${exp.body.data.id}/allocate-payment`)
      .set(auth(token, companyId))
      .send({ paymentId: irrPayment.body.data.id, amount: '100' })
      .expect(409);
  });

  it('121+122+124 — BY_QUANTITY / BY_VALUE / rounding preview', async () => {
    const { allocateByWeights } = await import(
      '../src/modules/finance/purchase-cost-allocation-math'
    );
    const { Prisma } = await import('@hector/database');
    const byQty = allocateByWeights(new Prisma.Decimal('10000000'), CurrencyCode.IRR, [
      { targetId: 'a', weight: new Prisma.Decimal(40) },
      { targetId: 'b', weight: new Prisma.Decimal(60) },
    ]);
    expect(byQty.find((x) => x.targetId === 'a')!.allocatedAmount.toString()).toBe('4000000');
    expect(byQty.find((x) => x.targetId === 'b')!.allocatedAmount.toString()).toBe('6000000');

    const byVal = allocateByWeights(new Prisma.Decimal('10000000'), CurrencyCode.IRR, [
      { targetId: 'a', weight: new Prisma.Decimal('200000000') },
      { targetId: 'b', weight: new Prisma.Decimal('300000000') },
    ]);
    expect(byVal.find((x) => x.targetId === 'a')!.allocatedAmount.toString()).toBe('4000000');
    expect(byVal.find((x) => x.targetId === 'b')!.allocatedAmount.toString()).toBe('6000000');

    const rounded = allocateByWeights(new Prisma.Decimal('10'), CurrencyCode.IRR, [
      { targetId: 'a', weight: new Prisma.Decimal(1) },
      { targetId: 'b', weight: new Prisma.Decimal(1) },
      { targetId: 'c', weight: new Prisma.Decimal(1) },
    ]);
    const sum = rounded.reduce((a, l) => a.add(l.allocatedAmount), new Prisma.Decimal(0));
    expect(sum.toString()).toBe('10');
  });

  it('123 — MANUAL allocation sum mismatch rejected', async () => {
    const token = await login(ownerEmail);
    const poRes = await request(app.getHttpServer())
      .post(PO_COSTS_BASE)
      .set(auth(token))
      .send({
        supplierId: tehranSupplierId,
        currency: 'IRR',
        purchaseType: 'CASH',
        items: [{ skuId: mascaraSkuId, quantity: 10, unitPrice: '1000000' }],
      })
      .expect(201);
    const purchaseOrderId = poRes.body.data.id as string;
    const costRes = await request(app.getHttpServer())
      .post(`${PO_COSTS_BASE}/${purchaseOrderId}/costs`)
      .set(auth(token))
      .send({
        type: PurchaseCostType.COURIER,
        amount: '10000000',
        currency: CurrencyCode.IRR,
      })
      .expect(201);
    const costId = costRes.body.data.id as string;

    await request(app.getHttpServer())
      .post(`${PO_COSTS_BASE}/${purchaseOrderId}/costs/${costId}/set-treatment`)
      .set(auth(token))
      .send({ treatment: PurchaseCostTreatment.PERIOD_EXPENSE })
      .expect(201);

    // 3 + 6 !== 10_000_000 → sum mismatch
    await request(app.getHttpServer())
      .post(`${PO_COSTS_BASE}/${purchaseOrderId}/costs/${costId}/allocate`)
      .set(auth(token))
      .send({
        method: PurchaseCostAllocationMethod.MANUAL,
        lines: [
          {
            targetType: PurchaseCostAllocationTargetType.PURCHASE_ORDER_ITEM,
            targetId: randomUUID(),
            amount: '3',
          },
          {
            targetType: PurchaseCostAllocationTargetType.PURCHASE_ORDER_ITEM,
            targetId: randomUUID(),
            amount: '6',
          },
        ],
      })
      .expect(409);
  });

  it('125+127+128+147+152 — CAPITALIZABLE allocate raises FIFO unit cost; qty unchanged; component provenance', async () => {
    const token = await login(ownerEmail);
    const fixture = await createPoCostWithLayer(token, { shippingAmount: '10000000' });

    const treatment = await request(app.getHttpServer())
      .post(
        `${PO_COSTS_BASE}/${fixture.purchaseOrderId}/costs/${fixture.costId}/set-treatment`,
      )
      .set(auth(token))
      .send({ treatment: PurchaseCostTreatment.CAPITALIZABLE })
      .expect(201);
    expect(treatment.body.data.treatment).toBe(PurchaseCostTreatment.CAPITALIZABLE);
    expect(treatment.body.data.expenseId).toBeNull();

    const expenseLinked = await database.client.expense.count({
      where: {
        companyId: pishtehId,
        sourceType: ExpenseSourceType.PURCHASE_ORDER_COST,
        sourceId: fixture.costId,
      },
    });
    expect(expenseLinked).toBe(0);

    await request(app.getHttpServer())
      .post(`${PO_COSTS_BASE}/${fixture.purchaseOrderId}/costs/${fixture.costId}/allocate`)
      .set(auth(token))
      .send({ method: PurchaseCostAllocationMethod.BY_QUANTITY })
      .expect(201);

    const layerAfter = await database.client.inventoryCostLayer.findUniqueOrThrow({
      where: { id: fixture.layerId },
    });
    expect(layerAfter.originalQuantity).toBe(fixture.qty);
    expect(layerAfter.remainingQuantity).toBe(fixture.qty);

    const prevTotal = new Prisma.Decimal(fixture.unitCost).mul(fixture.qty);
    const expectedUnit = prevTotal.add(fixture.shippingAmount).div(fixture.qty);
    expect(layerAfter.baseCurrencyUnitCost!.toString()).toBe(expectedUnit.toString());
    expect(layerAfter.originalUnitAmount!.toString()).toBe(expectedUnit.toString());

    const components = await database.client.inventoryCostComponent.findMany({
      where: {
        companyId: pishtehId,
        layerId: fixture.layerId,
        sourceId: fixture.costId,
      },
    });
    expect(components).toHaveLength(1);
    expect(components[0]!.allocatedAmount.toString()).toBe(fixture.shippingAmount);
    expect(components[0]!.costType).toBe(PurchaseCostType.FREIGHT);

    const allocLines = await database.client.purchaseCostAllocationLine.findMany({
      where: { companyId: pishtehId, purchaseOrderCostId: fixture.costId },
    });
    const allocSum = allocLines.reduce(
      (acc, l) => acc.add(l.allocatedAmount),
      new Prisma.Decimal(0),
    );
    expect(allocSum.toString()).toBe(fixture.shippingAmount);
    expect(allocLines[0]!.targetType).toBe(
      PurchaseCostAllocationTargetType.INVENTORY_COST_LAYER,
    );
    expect(allocLines[0]!.targetId).toBe(fixture.layerId);

    // FIN-JRN-018: capitalize journal; no expense recognition for CAPITALIZABLE
    const capitalize = await database.client.journalEntry.findFirst({
      where: {
        companyId: pishtehId,
        sourceId: fixture.costId,
        effectType: 'PURCHASE_COST_CAPITALIZE',
        status: JournalEntryStatus.POSTED,
      },
      include: { lines: { include: { ledgerAccount: true } } },
    });
    expect(capitalize).toBeTruthy();
    expect(
      capitalize!.lines.some(
        (l) =>
          l.direction === JournalLineDirection.DEBIT &&
          l.ledgerAccount.systemKey === 'INVENTORY',
      ),
    ).toBe(true);
    expect(
      capitalize!.lines.some(
        (l) =>
          l.direction === JournalLineDirection.CREDIT &&
          l.ledgerAccount.systemKey === 'FINANCE_CLEARING',
      ),
    ).toBe(true);
  });

  it('126 — PERIOD_EXPENSE creates linked Expense; layer unit cost unchanged', async () => {
    const token = await login(ownerEmail);
    const fixture = await createPoCostWithLayer(token, { shippingAmount: '8000000' });

    const treatment = await request(app.getHttpServer())
      .post(
        `${PO_COSTS_BASE}/${fixture.purchaseOrderId}/costs/${fixture.costId}/set-treatment`,
      )
      .set(auth(token))
      .send({ treatment: PurchaseCostTreatment.PERIOD_EXPENSE })
      .expect(201);
    expect(treatment.body.data.treatment).toBe(PurchaseCostTreatment.PERIOD_EXPENSE);
    expect(treatment.body.data.expenseId).toBeTruthy();

    const expense = await database.client.expense.findFirstOrThrow({
      where: {
        companyId: pishtehId,
        id: treatment.body.data.expenseId as string,
      },
    });
    expect(expense.sourceType).toBe(ExpenseSourceType.PURCHASE_ORDER_COST);
    expect(expense.amount.toString()).toBe(fixture.shippingAmount);
    expect(expense.status).toBe(ExpenseStatus.APPROVED);

    // FIN-JRN-019: setTreatment PERIOD_EXPENSE posts recognition in same TX
    const recognition = await database.client.journalEntry.findFirst({
      where: {
        companyId: pishtehId,
        sourceId: expense.id,
        effectType: 'EXPENSE_RECOGNITION',
        status: JournalEntryStatus.POSTED,
      },
      include: { lines: { include: { ledgerAccount: true } } },
    });
    expect(recognition).toBeTruthy();
    expect(
      recognition!.lines.some(
        (l) =>
          l.direction === JournalLineDirection.DEBIT &&
          l.ledgerAccount.type === 'EXPENSE',
      ),
    ).toBe(true);
    expect(
      recognition!.lines.some(
        (l) =>
          l.direction === JournalLineDirection.CREDIT &&
          l.ledgerAccount.systemKey === 'EXPENSE_PAYABLE',
      ),
    ).toBe(true);
    const capitalizeOnPeriod = await database.client.journalEntry.count({
      where: {
        companyId: pishtehId,
        sourceId: fixture.costId,
        effectType: 'PURCHASE_COST_CAPITALIZE',
      },
    });
    expect(capitalizeOnPeriod).toBe(0);

    await request(app.getHttpServer())
      .post(`${PO_COSTS_BASE}/${fixture.purchaseOrderId}/costs/${fixture.costId}/allocate`)
      .set(auth(token))
      .send({ method: PurchaseCostAllocationMethod.BY_QUANTITY })
      .expect(201);

    const layerAfter = await database.client.inventoryCostLayer.findUniqueOrThrow({
      where: { id: fixture.layerId },
    });
    expect(layerAfter.originalQuantity).toBe(fixture.qty);
    expect(layerAfter.remainingQuantity).toBe(fixture.qty);
    expect(layerAfter.baseCurrencyUnitCost!.toString()).toBe(fixture.unitCost);
    expect(layerAfter.originalUnitAmount!.toString()).toBe(fixture.unitCost);

    const components = await database.client.inventoryCostComponent.count({
      where: {
        companyId: pishtehId,
        layerId: fixture.layerId,
        sourceId: fixture.costId,
      },
    });
    expect(components).toBe(0);
  });

  it('133 — tenant isolation (expense IDOR → 404)', async () => {
    const token = await login(ownerEmail);
    const { companyId, categoryId } = await createTempCompany();
    const created = await request(app.getHttpServer())
      .post('/api/v1/finance/expenses')
      .set(auth(token, companyId))
      .send({
        categoryId,
        amount: '1000',
        currency: CurrencyCode.IRR,
        expenseDate: '2026-04-01T12:00:00.000Z',
        description: 'Isolation',
        requestId: randomUUID(),
      })
      .expect(201);
    await request(app.getHttpServer())
      .get(`/api/v1/finance/expenses/${created.body.data.id}`)
      .set(auth(token, demoBId))
      .expect(404);
  });

  it('134 — mass-assignment of status/paymentStatus rejected', async () => {
    const token = await login(ownerEmail);
    const { companyId, categoryId } = await createTempCompany();
    const res = await request(app.getHttpServer())
      .post('/api/v1/finance/expenses')
      .set(auth(token, companyId))
      .send({
        categoryId,
        amount: '1000',
        currency: CurrencyCode.IRR,
        expenseDate: '2026-04-01T12:00:00.000Z',
        description: 'Mass assign',
        status: ExpenseStatus.APPROVED,
        paymentStatus: ExpensePaymentStatus.PAID,
        paidAmount: '1000',
        companyId: demoBId,
        requestId: randomUUID(),
      });
    // forbidNonWhitelisted must reject forged lifecycle fields.
    expect(res.status).toBe(400);
  });

  it('135 — search injection remains parameterized', async () => {
    const token = await login(ownerEmail);
    await request(app.getHttpServer())
      .get('/api/v1/finance/expenses')
      .query({ q: "'; DROP TABLE expenses; --" })
      .set(auth(token))
      .expect(200);
  });

  it('136 — large IRR decimal-safe', async () => {
    const token = await login(ownerEmail);
    const { companyId, categoryId } = await createTempCompany();
    const amount = '999999999999999';
    const res = await request(app.getHttpServer())
      .post('/api/v1/finance/expenses')
      .set(auth(token, companyId))
      .send({
        categoryId,
        amount,
        currency: CurrencyCode.IRR,
        expenseDate: '2026-04-01T12:00:00.000Z',
        description: 'Large IRR',
        approveImmediately: true,
        requestId: randomUUID(),
      })
      .expect(201);
    expect(res.body.data.amount).toBe(amount);
    expect(res.body.data.outstandingAmount).toBe(amount);
  });

  it('RBAC — warehouse operator denied expenses manage', async () => {
    const token = await login(warehouseOperatorEmail);
    await request(app.getHttpServer())
      .get('/api/v1/finance/expenses')
      .set(auth(token))
      .expect(403);
  });

  it('exports PurchaseCostType enum still usable', () => {
    expect(PurchaseCostType.COURIER).toBe('COURIER');
  });
});
