import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  CurrencyCode,
  PaymentTermType,
  PurchaseCommercialType,
  PurchaseOrderStatus,
  SupplierPayableStatus,
  UserStatus,
  syncOwnerRolePermissions,
  syncPermissions,
} from '@hector/database';
import type { INestApplication } from '@nestjs/common';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { SupplierPayablesService } from '../src/modules/finance/supplier-payables.service';
import { allocateAllItemsToBatches } from './helpers/batch-allocation';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';
import { cleanupE2ePurchaseOrders } from './helpers/payable-cleanup';

describe('Finance Supplier Payables (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let payablesService: SupplierPayablesService;
  const ownerEmail = 'pouria@hector.local';
  const warehouseOperatorEmail = 'hossein@hector.local';
  const password = E2E_PASSWORD;
  let pishtehId: string;
  let demoBId: string;
  let mainWarehouseId: string;
  let ownerUserId: string;
  const createdPoIds: string[] = [];
  const createdReceiptIds: string[] = [];
  const createdPayableIds: string[] = [];

  beforeAll(async () => {
    app = await createE2eApp();
    database = app.get(DatabaseService);
    payablesService = app.get(SupplierPayablesService);
    await syncPermissions(database.client);
    await syncOwnerRolePermissions(database.client);

    pishtehId = (
      await database.client.company.findUniqueOrThrow({ where: { slug: 'pishteh' } })
    ).id;
    demoBId = (
      await database.client.company.findUniqueOrThrow({ where: { slug: 'hector-demo-b' } })
    ).id;
    mainWarehouseId = (
      await database.client.warehouse.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'MAIN' },
      })
    ).id;
    ownerUserId = (
      await database.client.user.update({
        where: { email: ownerEmail },
        data: { status: UserStatus.ACTIVE, deletedAt: null },
      })
    ).id;
  });

  afterAll(async () => {
    if (createdPayableIds.length > 0) {
      await database.client.supplierPaymentAllocation.deleteMany({
        where: { payableId: { in: createdPayableIds } },
      });
      await database.client.supplierLiabilityMovement.deleteMany({
        where: { payableId: { in: createdPayableIds } },
      });
      await database.client.supplierPayableLine.deleteMany({
        where: { payableId: { in: createdPayableIds } },
      });
      await database.client.supplierCredit.deleteMany({
        where: { payableId: { in: createdPayableIds } },
      });
      await database.client.supplierPayable.deleteMany({
        where: { id: { in: createdPayableIds } },
      });
    }
    // Must remove POs with GRNs — deleting GRNs alone leaves RECEIVED POs that
    // fail purchasing integrity (received_po_with_remaining).
    await cleanupE2ePurchaseOrders(database, createdPoIds);
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

  async function createOrderedPo(
    token: string,
    opts: {
      quantity?: number;
      unitPrice?: string;
      currency?: CurrencyCode;
      purchaseType?: PurchaseCommercialType;
      paymentTermType?: PaymentTermType;
      netDays?: number;
      referenceFxRate?: string;
      referenceFxBaseCurrency?: CurrencyCode;
      referenceFxQuoteCurrency?: CurrencyCode;
    } = {},
  ): Promise<{ poId: string; itemId: string; skuId: string; supplierId: string }> {
    const supplier = await database.client.supplier.findFirstOrThrow({
      where: { companyId: pishtehId, status: 'ACTIVE' },
    });
    const sku = await database.client.sku.findFirstOrThrow({
      where: { companyId: pishtehId, status: 'ACTIVE' },
    });
    const purchaseType = opts.purchaseType ?? PurchaseCommercialType.CASH;
    const currency = opts.currency ?? CurrencyCode.IRR;
    const body: Record<string, unknown> = {
      supplierId: supplier.id,
      currency,
      purchaseType,
      paymentTermType:
        opts.paymentTermType ??
        (purchaseType === PurchaseCommercialType.CASH
          ? PaymentTermType.IMMEDIATE
          : PaymentTermType.NET_DAYS),
      orderDate: '2026-10-04T00:00:00.000Z',
      items: [
        {
          skuId: sku.id,
          quantity: opts.quantity ?? 1000,
          unitPrice: opts.unitPrice ?? '1000',
        },
      ],
    };
    if (opts.netDays != null) body.netDays = opts.netDays;
    if (opts.referenceFxRate) {
      body.referenceFxRate = opts.referenceFxRate;
      body.referenceFxBaseCurrency = opts.referenceFxBaseCurrency ?? CurrencyCode.USD;
      body.referenceFxQuoteCurrency = opts.referenceFxQuoteCurrency ?? CurrencyCode.IRR;
    }

    const created = await request(app.getHttpServer())
      .post('/api/v1/purchasing/purchase-orders')
      .set(auth(token))
      .send(body)
      .expect(201);
    const poId = created.body.data.id as string;
    createdPoIds.push(poId);
    const itemId = created.body.data.items[0].id as string;
    await request(app.getHttpServer())
      .post(`/api/v1/purchasing/purchase-orders/${poId}/approve`)
      .set(auth(token))
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/purchasing/purchase-orders/${poId}/mark-ordered`)
      .set(auth(token))
      .send({})
      .expect(201);
    return { poId, itemId, skuId: sku.id, supplierId: supplier.id };
  }

  async function createAndPostGrn(
    token: string,
    poId: string,
    itemId: string,
    quantity: number,
  ): Promise<{ id: string; number: string }> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/goods-receipts')
      .set(auth(token))
      .send({
        purchaseOrderId: poId,
        warehouseId: mainWarehouseId,
        items: [{ purchaseOrderItemId: itemId, quantity }],
      })
      .expect(201);
    const grnId = res.body.data.id as string;
    createdReceiptIds.push(grnId);
    await allocateAllItemsToBatches(app, auth(token), grnId);
    const posted = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${grnId}/post`)
      .set(auth(token))
      .send({})
      .expect(201);
    return posted.body.data;
  }

  async function findPayableForPo(poId: string) {
    return database.client.supplierPayable.findFirst({
      where: { companyId: pishtehId, purchaseOrderId: poId },
      include: {
        lines: true,
        movements: true,
      },
    });
  }

  it('TERM_CREDIT partial receipts recognize incrementally (400 then 500 of 1000)', async () => {
    const token = await login(ownerEmail);
    const { poId, itemId } = await createOrderedPo(token, {
      quantity: 1000,
      unitPrice: '1000',
      purchaseType: PurchaseCommercialType.TERM_CREDIT,
      paymentTermType: PaymentTermType.NET_DAYS,
      netDays: 30,
    });

    await createAndPostGrn(token, poId, itemId, 400);
    const after1 = await findPayableForPo(poId);
    expect(after1).toBeTruthy();
    createdPayableIds.push(after1!.id);
    expect(after1!.purchaseType).toBe('TERM_CREDIT');
    expect(after1!.currency).toBe(CurrencyCode.IRR);

    const detail1 = await request(app.getHttpServer())
      .get(`/api/v1/finance/payables/${after1!.id}`)
      .set(auth(token))
      .expect(200);
    expect(detail1.body.data.recognizedAmount).toBe('400000');
    expect(detail1.body.data.outstandingAmount).toBe('400000');
    expect(detail1.body.data.lines).toHaveLength(1);

    await createAndPostGrn(token, poId, itemId, 500);
    const detail2 = await request(app.getHttpServer())
      .get(`/api/v1/finance/payables/${after1!.id}`)
      .set(auth(token))
      .expect(200);
    expect(detail2.body.data.recognizedAmount).toBe('900000');
    expect(detail2.body.data.outstandingAmount).toBe('900000');
    expect(detail2.body.data.lines).toHaveLength(2);
  });

  it('FX_CREDIT preserves foreign currency after fake PO reference rate change', async () => {
    const token = await login(ownerEmail);
    const { poId, itemId } = await createOrderedPo(token, {
      quantity: 10000,
      unitPrice: '1',
      currency: CurrencyCode.USD,
      purchaseType: PurchaseCommercialType.FX_CREDIT,
      paymentTermType: PaymentTermType.NET_DAYS,
      netDays: 30,
      referenceFxRate: '2050000',
      referenceFxBaseCurrency: CurrencyCode.USD,
      referenceFxQuoteCurrency: CurrencyCode.IRR,
    });

    await createAndPostGrn(token, poId, itemId, 10000);
    const payable = await findPayableForPo(poId);
    expect(payable).toBeTruthy();
    createdPayableIds.push(payable!.id);
    expect(payable!.currency).toBe(CurrencyCode.USD);
    expect(payable!.purchaseType).toBe('FX_CREDIT');

    // Simulate a later market rate change on the PO reference (must not rewrite payable currency).
    await database.client.purchaseOrder.update({
      where: { id: poId },
      data: { referenceFxRate: '2500000' },
    });

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/finance/payables/${payable!.id}`)
      .set(auth(token))
      .expect(200);
    expect(detail.body.data.currency).toBe('USD');
    expect(detail.body.data.recognizedAmount).toBe('10000');
    expect(detail.body.data.outstandingAmount).toBe('10000');
  });

  it('CASH receipt creates payable without cash FinancialAccountMovement', async () => {
    const token = await login(ownerEmail);
    const { poId, itemId } = await createOrderedPo(token, {
      quantity: 100,
      unitPrice: '5000',
      purchaseType: PurchaseCommercialType.CASH,
      paymentTermType: PaymentTermType.IMMEDIATE,
    });

    const beforeCash = await database.client.financialAccountMovement.count({
      where: { companyId: pishtehId },
    });
    await createAndPostGrn(token, poId, itemId, 100);
    const payable = await findPayableForPo(poId);
    expect(payable).toBeTruthy();
    createdPayableIds.push(payable!.id);
    expect(payable!.purchaseType).toBe('CASH');
    expect(payable!.status).toBe(SupplierPayableStatus.OPEN);

    const afterCash = await database.client.financialAccountMovement.count({
      where: { companyId: pishtehId },
    });
    expect(afterCash).toBe(beforeCash);
  });

  it('quote/draft PO creates zero payable', async () => {
    const token = await login(ownerEmail);
    const supplier = await database.client.supplier.findFirstOrThrow({
      where: { companyId: pishtehId, status: 'ACTIVE' },
    });
    const sku = await database.client.sku.findFirstOrThrow({
      where: { companyId: pishtehId, status: 'ACTIVE' },
    });
    const draft = await request(app.getHttpServer())
      .post('/api/v1/purchasing/purchase-orders')
      .set(auth(token))
      .send({
        supplierId: supplier.id,
        currency: CurrencyCode.IRR,
        purchaseType: PurchaseCommercialType.TERM_CREDIT,
        paymentTermType: PaymentTermType.NET_DAYS,
        netDays: 30,
        items: [{ skuId: sku.id, quantity: 50, unitPrice: '1000' }],
      })
      .expect(201);
    expect(draft.body.data.status).toBe(PurchaseOrderStatus.DRAFT);

    const count = await database.client.supplierPayable.count({
      where: { companyId: pishtehId, purchaseOrderId: draft.body.data.id },
    });
    expect(count).toBe(0);
  });

  it('cancelled PO before receipt creates zero payable', async () => {
    const token = await login(ownerEmail);
    const { poId } = await createOrderedPo(token, {
      quantity: 50,
      unitPrice: '1000',
      purchaseType: PurchaseCommercialType.TERM_CREDIT,
      paymentTermType: PaymentTermType.NET_DAYS,
      netDays: 30,
    });

    await request(app.getHttpServer())
      .post(`/api/v1/purchasing/purchase-orders/${poId}/cancel`)
      .set(auth(token))
      .send({ reason: 'e2e cancel before receipt' })
      .expect(201);

    const count = await database.client.supplierPayable.count({
      where: { companyId: pishtehId, purchaseOrderId: poId },
    });
    expect(count).toBe(0);
  });

  it('supplier return reduces outstanding; return after full payment creates credit', async () => {
    const token = await login(ownerEmail);
    const supplier = await database.client.supplier.findFirstOrThrow({
      where: { companyId: pishtehId, status: 'ACTIVE' },
    });
    const sku = await database.client.sku.findFirstOrThrow({
      where: { companyId: pishtehId, status: 'ACTIVE' },
    });
    const batch = await database.client.batch.findFirstOrThrow({
      where: { companyId: pishtehId, skuId: sku.id },
    });
    const location = await database.client.warehouseLocation.findFirstOrThrow({
      where: { companyId: pishtehId, warehouse: { code: 'MAIN' } },
    });

    // Path A — return reduces outstanding
    const openingA = await request(app.getHttpServer())
      .post('/api/v1/finance/payables/opening')
      .set(auth(token))
      .send({
        supplierId: supplier.id,
        currency: CurrencyCode.IRR,
        amount: '100000',
        requestId: randomUUID(),
        notes: 'e2e return-reduce opening',
      })
      .expect(201);
    createdPayableIds.push(openingA.body.data.id);

    await database.client.$transaction(async (tx) => {
      await tx.supplierLiabilityMovement.create({
        data: {
          companyId: pishtehId,
          payableId: openingA.body.data.id,
          supplierId: supplier.id,
          direction: 'DECREASE',
          type: 'SUPPLIER_RETURN',
          amount: '40000',
          currency: CurrencyCode.IRR,
          sourceType: 'SUPPLIER_RETURN_EXECUTION_SLICE',
          sourceId: randomUUID(),
          effectiveAt: new Date(),
          notes: `SRE e2e-reduce (${randomUUID()}) return reduction`,
          createdById: ownerUserId,
        },
      });
      await tx.supplierPayable.update({
        where: { id: openingA.body.data.id },
        data: { status: SupplierPayableStatus.PARTIALLY_PAID },
      });
    });

    const reduced = await request(app.getHttpServer())
      .get(`/api/v1/finance/payables/${openingA.body.data.id}`)
      .set(auth(token))
      .expect(200);
    expect(reduced.body.data.outstandingAmount).toBe('60000');

    // Settle Path A remainder so Path B credit case has no open IRR liability to absorb.
    await request(app.getHttpServer())
      .post(`/api/v1/finance/payables/${openingA.body.data.id}/allocations`)
      .set(auth(token))
      .send({
        amount: '60000',
        currency: CurrencyCode.IRR,
        requestId: randomUUID(),
      })
      .expect(201);

    // Path B — full payment then return → SupplierCredit (direct service; SRE warehouse path is heavy)
    const openingB = await request(app.getHttpServer())
      .post('/api/v1/finance/payables/opening')
      .set(auth(token))
      .send({
        supplierId: supplier.id,
        currency: CurrencyCode.IRR,
        amount: '80000',
        requestId: randomUUID(),
        notes: 'e2e full-pay then return credit',
      })
      .expect(201);
    createdPayableIds.push(openingB.body.data.id);

    await request(app.getHttpServer())
      .post(`/api/v1/finance/payables/${openingB.body.data.id}/allocations`)
      .set(auth(token))
      .send({
        amount: '80000',
        currency: CurrencyCode.IRR,
        requestId: randomUUID(),
      })
      .expect(201);

    const paid = await request(app.getHttpServer())
      .get(`/api/v1/finance/payables/${openingB.body.data.id}`)
      .set(auth(token))
      .expect(200);
    expect(paid.body.data.status).toBe(SupplierPayableStatus.PAID);
    expect(paid.body.data.outstandingAmount).toBe('0');

    const po = await database.client.purchaseOrder.create({
      data: {
        companyId: pishtehId,
        number: `PO-E2E-AP-${Date.now().toString(36).toUpperCase()}`,
        supplierId: supplier.id,
        status: PurchaseOrderStatus.ORDERED,
        currency: CurrencyCode.IRR,
        purchaseType: PurchaseCommercialType.CASH,
        paymentTermType: PaymentTermType.IMMEDIATE,
        orderDate: new Date(),
        subtotal: '50000',
        total: '50000',
        createdById: ownerUserId,
        supplierNameSnapshot: supplier.name,
        version: 1,
      },
    });
    const poItem = await database.client.purchaseOrderItem.create({
      data: {
        companyId: pishtehId,
        purchaseOrderId: po.id,
        skuId: sku.id,
        quantity: 50,
        unitPrice: '1000',
        lineSubtotal: '50000',
        skuCodeSnapshot: sku.code,
        productNameSnapshot: 'e2e',
        variantLabelSnapshot: sku.name,
        productIdSnapshot: sku.productId,
      },
    });
    const purchaseReturn = await database.client.purchaseReturn.create({
      data: {
        companyId: pishtehId,
        number: `PR-E2E-${Date.now().toString(36).toUpperCase()}`,
        supplierId: supplier.id,
        purchaseOrderId: po.id,
        status: 'APPROVED',
        reason: 'DEFECTIVE',
        expectedResolution: 'SUPPLIER_CREDIT',
        createdById: ownerUserId,
        approvedById: ownerUserId,
        approvedAt: new Date(),
      },
    });
    const returnItem = await database.client.purchaseReturnItem.create({
      data: {
        companyId: pishtehId,
        purchaseReturnId: purchaseReturn.id,
        purchaseOrderItemId: poItem.id,
        skuId: sku.id,
        quantity: 50,
        reason: 'DEFECTIVE',
      },
    });
    const execution = await database.client.supplierReturnExecution.create({
      data: {
        companyId: pishtehId,
        purchaseReturnId: purchaseReturn.id,
        warehouseId: mainWarehouseId,
        number: `SRE-E2E-${Date.now().toString(36).toUpperCase()}`,
        status: 'DISPATCHED',
        createdById: ownerUserId,
        dispatchedById: ownerUserId,
        dispatchedAt: new Date(),
      },
    });
    await database.client.supplierReturnExecutionItem.create({
      data: {
        companyId: pishtehId,
        supplierReturnExecutionId: execution.id,
        purchaseReturnItemId: returnItem.id,
        skuId: sku.id,
        batchId: batch.id,
        locationId: location.id,
        classification: 'SELLABLE',
        quantity: 50,
      },
    });

    const creditResult = await database.client.$transaction(async (tx) =>
      payablesService.reduceFromSupplierReturnInTx(tx, pishtehId, execution.id, ownerUserId),
    );
    expect(creditResult.reducedTotal).toBe('0');
    expect(creditResult.creditId).toBeTruthy();

    const credit = await database.client.supplierCredit.findUniqueOrThrow({
      where: { id: creditResult.creditId! },
    });
    expect(credit.originalAmount.toFixed()).toBe('50000');
    expect(credit.status).toBe('OPEN');

    await database.client.supplierReturnExecutionItem.deleteMany({
      where: { supplierReturnExecutionId: execution.id },
    });
    await database.client.supplierReturnExecution.delete({ where: { id: execution.id } });
    await database.client.purchaseReturnItem.delete({ where: { id: returnItem.id } });
    await database.client.purchaseReturn.delete({ where: { id: purchaseReturn.id } });
    await database.client.purchaseOrderItem.delete({ where: { id: poItem.id } });
    await database.client.purchaseOrder.delete({ where: { id: po.id } });
    if (creditResult.creditId) {
      await database.client.supplierLiabilityMovement.deleteMany({
        where: { supplierCreditId: creditResult.creditId },
      });
      await database.client.supplierCredit.delete({ where: { id: creditResult.creditId } });
    }
  });

  it('allocation partial / full / over-reject', async () => {
    const token = await login(ownerEmail);
    const supplier = await database.client.supplier.findFirstOrThrow({
      where: { companyId: pishtehId, status: 'ACTIVE' },
    });
    const opening = await request(app.getHttpServer())
      .post('/api/v1/finance/payables/opening')
      .set(auth(token))
      .send({
        supplierId: supplier.id,
        currency: CurrencyCode.IRR,
        amount: '100000',
        requestId: randomUUID(),
      })
      .expect(201);
    createdPayableIds.push(opening.body.data.id);

    const partial = await request(app.getHttpServer())
      .post(`/api/v1/finance/payables/${opening.body.data.id}/allocations`)
      .set(auth(token))
      .send({ amount: '40000', currency: CurrencyCode.IRR, requestId: randomUUID() })
      .expect(201);
    expect(partial.body.data.payable.outstandingAmount).toBe('60000');
    expect(partial.body.data.payable.status).toBe(SupplierPayableStatus.PARTIALLY_PAID);

    const full = await request(app.getHttpServer())
      .post(`/api/v1/finance/payables/${opening.body.data.id}/allocations`)
      .set(auth(token))
      .send({ amount: '60000', currency: CurrencyCode.IRR, requestId: randomUUID() })
      .expect(201);
    expect(full.body.data.payable.outstandingAmount).toBe('0');
    expect(full.body.data.payable.status).toBe(SupplierPayableStatus.PAID);

    const over = await request(app.getHttpServer())
      .post(`/api/v1/finance/payables/${opening.body.data.id}/allocations`)
      .set(auth(token))
      .send({ amount: '1', currency: CurrencyCode.IRR, requestId: randomUUID() })
      .expect(409);
    expect(over.body.error?.code ?? over.body.code).toMatch(/OVER_ALLOCATE|SUPPLIER_PAYABLE/);
  });

  it('concurrent allocation cannot over-allocate outstanding', async () => {
    const token = await login(ownerEmail);
    const supplier = await database.client.supplier.findFirstOrThrow({
      where: { companyId: pishtehId, status: 'ACTIVE' },
    });
    const opening = await request(app.getHttpServer())
      .post('/api/v1/finance/payables/opening')
      .set(auth(token))
      .send({
        supplierId: supplier.id,
        currency: CurrencyCode.IRR,
        amount: '100000',
        requestId: randomUUID(),
        notes: 'e2e concurrent allocation',
      })
      .expect(201);
    const payableId = opening.body.data.id as string;
    createdPayableIds.push(payableId);

    const results = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/finance/payables/${payableId}/allocations`)
        .set(auth(token))
        .send({ amount: '70000', currency: CurrencyCode.IRR, requestId: randomUUID() }),
      request(app.getHttpServer())
        .post(`/api/v1/finance/payables/${payableId}/allocations`)
        .set(auth(token))
        .send({ amount: '70000', currency: CurrencyCode.IRR, requestId: randomUUID() }),
    ]);

    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);

    const stillThere = await database.client.supplierPayable.findFirst({
      where: { id: payableId, companyId: pishtehId },
    });
    expect(stillThere).toBeTruthy();

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/finance/payables/${payableId}`)
      .set(auth(token))
      .expect(200);
    expect(Number(detail.body.data.outstandingAmount)).toBe(30000);
  });

  it('duplicate GRN post is idempotent and line count stays stable', async () => {
    const token = await login(ownerEmail);
    const { poId, itemId } = await createOrderedPo(token, {
      quantity: 200,
      unitPrice: '1000',
      purchaseType: PurchaseCommercialType.TERM_CREDIT,
      paymentTermType: PaymentTermType.NET_DAYS,
      netDays: 30,
    });
    const grn = await createAndPostGrn(token, poId, itemId, 200);
    const payable = await findPayableForPo(poId);
    expect(payable).toBeTruthy();
    createdPayableIds.push(payable!.id);

    const beforeLines = await database.client.supplierPayableLine.count({
      where: { companyId: pishtehId, payableId: payable!.id },
    });
    const beforeMovements = await database.client.supplierLiabilityMovement.count({
      where: { companyId: pishtehId, payableId: payable!.id },
    });

    const dup = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${grn.id}/post`)
      .set(auth(token))
      .send({});
    expect([409, 400]).toContain(dup.status);
    expect(String(dup.body.error?.code ?? dup.body.code ?? '')).toMatch(/ALREADY_POSTED/);

    const afterLines = await database.client.supplierPayableLine.count({
      where: { companyId: pishtehId, payableId: payable!.id },
    });
    const afterMovements = await database.client.supplierLiabilityMovement.count({
      where: { companyId: pishtehId, payableId: payable!.id },
    });
    expect(afterLines).toBe(beforeLines);
    expect(afterMovements).toBe(beforeMovements);
  });

  it('summary reports multi-currency positions without FX aggregation', async () => {
    const token = await login(ownerEmail);
    const supplier = await database.client.supplier.findFirstOrThrow({
      where: { companyId: pishtehId, status: 'ACTIVE' },
    });

    const irr = await request(app.getHttpServer())
      .post('/api/v1/finance/payables/opening')
      .set(auth(token))
      .send({
        supplierId: supplier.id,
        currency: CurrencyCode.IRR,
        amount: '111000',
        requestId: randomUUID(),
      })
      .expect(201);
    createdPayableIds.push(irr.body.data.id);

    const usd = await request(app.getHttpServer())
      .post('/api/v1/finance/payables/opening')
      .set(auth(token))
      .send({
        supplierId: supplier.id,
        currency: CurrencyCode.USD,
        amount: '42.5',
        requestId: randomUUID(),
      })
      .expect(201);
    createdPayableIds.push(usd.body.data.id);

    const summary = await request(app.getHttpServer())
      .get('/api/v1/finance/payables/summary')
      .set(auth(token))
      .expect(200);
    const byCurrency = summary.body.data.byCurrency as Array<{
      currency: string;
      outstandingTotal: string;
    }>;
    expect(byCurrency.some((row) => row.currency === 'IRR')).toBe(true);
    expect(byCurrency.some((row) => row.currency === 'USD')).toBe(true);
    // No single merged total field
    expect(summary.body.data.totalOutstanding).toBeUndefined();
  });

  it('tenant IDOR and mass assignment are rejected', async () => {
    const token = await login(ownerEmail);
    const supplier = await database.client.supplier.findFirstOrThrow({
      where: { companyId: pishtehId, status: 'ACTIVE' },
    });
    const opening = await request(app.getHttpServer())
      .post('/api/v1/finance/payables/opening')
      .set(auth(token))
      .send({
        supplierId: supplier.id,
        currency: CurrencyCode.IRR,
        amount: '5000',
        requestId: randomUUID(),
      })
      .expect(201);
    createdPayableIds.push(opening.body.data.id);

    await request(app.getHttpServer())
      .get(`/api/v1/finance/payables/${opening.body.data.id}`)
      .set(auth(token, demoBId))
      .expect(404);

    const mass = await request(app.getHttpServer())
      .post('/api/v1/finance/payables/opening')
      .set(auth(token))
      .send({
        supplierId: supplier.id,
        currency: CurrencyCode.IRR,
        amount: '1000',
        status: 'PAID',
        outstandingAmount: '0',
        companyId: demoBId,
        requestId: randomUUID(),
      });
    // Whitelist rejects unknown fields (400) or strips them (201) — never honor mass-assigned status/outstanding.
    if (mass.status === 201) {
      createdPayableIds.push(mass.body.data.id);
      expect(mass.body.data.status).toBe(SupplierPayableStatus.OPEN);
      expect(mass.body.data.outstandingAmount).toBe('1000');
    } else {
      expect(mass.status).toBe(400);
    }

    const warehouseToken = await login(warehouseOperatorEmail);
    await request(app.getHttpServer())
      .get('/api/v1/finance/payables')
      .set(auth(warehouseToken))
      .expect(403);
  });

  it('overdue is derived from dueDate + outstanding', async () => {
    const token = await login(ownerEmail);
    const supplier = await database.client.supplier.findFirstOrThrow({
      where: { companyId: pishtehId, status: 'ACTIVE' },
    });
    const opening = await request(app.getHttpServer())
      .post('/api/v1/finance/payables/opening')
      .set(auth(token))
      .send({
        supplierId: supplier.id,
        currency: CurrencyCode.IRR,
        amount: '9000',
        dueDate: '2020-01-01T00:00:00.000Z',
        requestId: randomUUID(),
      })
      .expect(201);
    createdPayableIds.push(opening.body.data.id);
    expect(opening.body.data.overdue).toBe(true);
    expect(opening.body.data.agingBucket).not.toBe('CURRENT');
  });

  it('supplier statement lists liability movements', async () => {
    const token = await login(ownerEmail);
    const supplier = await database.client.supplier.findFirstOrThrow({
      where: { companyId: pishtehId, status: 'ACTIVE' },
    });
    const opening = await request(app.getHttpServer())
      .post('/api/v1/finance/payables/opening')
      .set(auth(token))
      .send({
        supplierId: supplier.id,
        currency: CurrencyCode.IRR,
        amount: '1234',
        requestId: randomUUID(),
      })
      .expect(201);
    createdPayableIds.push(opening.body.data.id);

    const statement = await request(app.getHttpServer())
      .get(`/api/v1/finance/suppliers/${supplier.id}/statement`)
      .set(auth(token))
      .expect(200);
    expect(statement.body.data.supplierId).toBe(supplier.id);
    expect(Array.isArray(statement.body.data.entries)).toBe(true);
    expect(
      statement.body.data.entries.some(
        (e: { payableId: string | null }) => e.payableId === opening.body.data.id,
      ),
    ).toBe(true);
  });
});
