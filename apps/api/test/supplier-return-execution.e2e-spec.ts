import request from 'supertest';
import {
  InventoryMovementType,
  InventorySourceType,
  StockClassification,
  StockIssueReason,
  UserStatus,
  WarehouseLocationType,
  syncOwnerRolePermissions,
  syncPermissions,
  ensureSystemTransitPosition,
} from '@hector/database';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ERROR_CODES } from '../src/common/constants';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { InventoryLedgerService } from '../src/modules/warehouse/inventory-ledger.service';
import { deleteInventoryMovements } from './helpers/delete-movements';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';

const SRE_RETURNS = '/api/v1/warehouse/supplier-returns';
const SRE_EXEC = '/api/v1/warehouse/supplier-return-executions';
const ISS = '/api/v1/warehouse/issues';
const PURCH_RETURNS = '/api/v1/purchasing/purchase-returns';
const PO_BASE = '/api/v1/purchasing/purchase-orders';
const LOC_BASE = '/api/v1/warehouses';

describe('Supplier Return Execution (Phase 3.14 e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let ledger: InventoryLedgerService;
  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;
  let pishtehId: string;
  let demoBId: string;
  let mainWarehouseId: string;
  let ownerUserId: string;
  let tehranSupplierId: string;
  let mascaraSkuId: string;
  let conc1SkuId: string;
  let accessToken: string;

  const createdPoIds: string[] = [];
  const createdReturnIds: string[] = [];
  const createdExecutionIds: string[] = [];
  const createdIssueIds: string[] = [];
  const createdLocationIds: string[] = [];
  const createdMovementIds: string[] = [];
  const createdBarcodeIds: string[] = [];
  const touchedBalanceKeys: Array<{
    warehouseId: string;
    locationId: string;
    skuId: string;
    batchId: string;
    classification: StockClassification;
  }> = [];

  beforeAll(async () => {
    app = await createE2eApp();
    database = app.get(DatabaseService);
    ledger = app.get(InventoryLedgerService);
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
      await database.client.user.findUniqueOrThrow({ where: { email: ownerEmail } })
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
    conc1SkuId = (
      await database.client.sku.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'FAN-CONC-01' },
      })
    ).id;
    await database.client.user.update({
      where: { email: ownerEmail },
      data: { status: UserStatus.ACTIVE, deletedAt: null },
    });
    await ensureSystemTransitPosition(database.client, pishtehId);

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password })
      .expect(200);
    accessToken = login.body.data.accessToken as string;
  });

  afterAll(async () => {
    if (createdExecutionIds.length > 0) {
      await deleteInventoryMovements(database, { sourceType: InventorySourceType.SUPPLIER_RETURN, sourceId: { in: createdExecutionIds } });
      await database.client.supplierReturnExecutionScanRequest.deleteMany({
        where: { supplierReturnExecutionId: { in: createdExecutionIds } },
      });
      await database.client.supplierReturnExecutionItem.deleteMany({
        where: { supplierReturnExecutionId: { in: createdExecutionIds } },
      });
      await database.client.supplierReturnExecution.deleteMany({
        where: { id: { in: createdExecutionIds } },
      });
    }
    if (createdIssueIds.length > 0) {
      await deleteInventoryMovements(database, { sourceType: InventorySourceType.STOCK_ISSUE, sourceId: { in: createdIssueIds } });
      await database.client.stockIssueScanRequest.deleteMany({
        where: { stockIssueId: { in: createdIssueIds } },
      });
      await database.client.stockIssueItem.deleteMany({
        where: { stockIssueId: { in: createdIssueIds } },
      });
      await database.client.stockIssue.deleteMany({
        where: { id: { in: createdIssueIds } },
      });
    }
    if (createdReturnIds.length > 0) {
      await database.client.purchaseReturnItem.deleteMany({
        where: { purchaseReturnId: { in: createdReturnIds } },
      });
      await database.client.purchaseReturn.deleteMany({
        where: { id: { in: createdReturnIds } },
      });
    }
    if (createdPoIds.length > 0) {
      await database.client.purchaseOrderCorrection.deleteMany({
        where: { purchaseOrderId: { in: createdPoIds } },
      });
      await database.client.purchaseDiscrepancy.deleteMany({
        where: { purchaseOrderId: { in: createdPoIds } },
      });
      await database.client.purchaseOrderCost.deleteMany({
        where: { purchaseOrderId: { in: createdPoIds } },
      });
      await database.client.purchaseOrderItem.deleteMany({
        where: { purchaseOrderId: { in: createdPoIds } },
      });
      await database.client.purchaseOrder.deleteMany({
        where: { id: { in: createdPoIds } },
      });
    }
    if (createdMovementIds.length > 0) {
      await deleteInventoryMovements(database, { id: { in: createdMovementIds } });
    }
    if (createdBarcodeIds.length > 0) {
      await database.client.barcode.deleteMany({
        where: { id: { in: createdBarcodeIds } },
      });
    }
    for (const key of touchedBalanceKeys) {
      const sum = await database.client.inventoryMovement.aggregate({
        where: {
          companyId: pishtehId,
          warehouseId: key.warehouseId,
          locationId: key.locationId,
          skuId: key.skuId,
          batchId: key.batchId,
          classification: key.classification,
        },
        _sum: { quantityDelta: true },
      });
      const qty = sum._sum.quantityDelta ?? 0;
      const whereKey = {
        companyId: pishtehId,
        warehouseId: key.warehouseId,
        locationId: key.locationId,
        skuId: key.skuId,
        batchId: key.batchId,
        classification: key.classification,
      };
      if (qty === 0) {
        await database.client.inventoryBalance.deleteMany({ where: whereKey });
      } else {
        await database.client.inventoryBalance.upsert({
          where: {
            companyId_warehouseId_locationId_skuId_batchId_classification: whereKey,
          },
          update: { onHandQuantity: qty },
          create: { ...whereKey, onHandQuantity: qty },
        });
      }
    }
    if (createdLocationIds.length > 0) {
      await database.client.inventoryBalance.deleteMany({
        where: { locationId: { in: createdLocationIds } },
      });
      await deleteInventoryMovements(database, { locationId: { in: createdLocationIds } });
      await database.client.warehouseLocation.deleteMany({
        where: { id: { in: createdLocationIds } },
      });
    }
    await app.close();
  });

  function auth(companyId = pishtehId) {
    return {
      Authorization: `Bearer ${accessToken}`,
      'X-Company-Id': companyId,
    };
  }

  async function createShelf(code: string) {
    const res = await request(app.getHttpServer())
      .post(`${LOC_BASE}/${mainWarehouseId}/locations`)
      .set(auth())
      .send({ type: WarehouseLocationType.SHELF, code, name: code })
      .expect(201);
    createdLocationIds.push(res.body.data.id);
    return res.body.data as { id: string; barcode: string; code: string };
  }

  async function loadMascaraBatches() {
    const batch1 = await database.client.batch.findFirstOrThrow({
      where: { companyId: pishtehId, skuId: mascaraSkuId, batchNumber: 'LOT-001' },
    });
    const batch2 = await database.client.batch.findFirstOrThrow({
      where: { companyId: pishtehId, skuId: mascaraSkuId, batchNumber: 'LOT-002' },
    });
    return { batch1, batch2 };
  }

  async function seedStock(input: {
    locationId: string;
    skuId: string;
    batchId: string;
    quantity: number;
    classification?: StockClassification;
  }) {
    const classification = input.classification ?? StockClassification.SELLABLE;
    const sourceLineId = randomUUID();
    const [movement] = await ledger.postMovements(pishtehId, [
      {
        warehouseId: mainWarehouseId,
        locationId: input.locationId,
        skuId: input.skuId,
        batchId: input.batchId,
        classification,
        movementType: InventoryMovementType.RECEIVE,
        quantityDelta: input.quantity,
        sourceType: InventorySourceType.SEED,
        sourceId: randomUUID(),
        sourceLineId,
        actorUserId: ownerUserId,
      },
    ]);
    createdMovementIds.push(movement.id);
    touchedBalanceKeys.push({
      warehouseId: mainWarehouseId,
      locationId: input.locationId,
      skuId: input.skuId,
      batchId: input.batchId,
      classification,
    });
  }

  async function onHand(
    position: { locationId: string; skuId: string; batchId: string },
    classification = StockClassification.SELLABLE,
  ) {
    const bal = await database.client.inventoryBalance.findUnique({
      where: {
        companyId_warehouseId_locationId_skuId_batchId_classification: {
          companyId: pishtehId,
          warehouseId: mainWarehouseId,
          locationId: position.locationId,
          skuId: position.skuId,
          batchId: position.batchId,
          classification,
        },
      },
    });
    return bal?.onHandQuantity ?? 0;
  }

  async function createOrderedPo(lineQty = 1000) {
    const created = await request(app.getHttpServer())
      .post(PO_BASE)
      .set(auth())
      .send({
        supplierId: tehranSupplierId,
        currency: 'IRR',
        purchaseType: 'CASH',
        paymentTermType: 'IMMEDIATE',
        orderDate: '2026-10-03',
        items: [{ skuId: mascaraSkuId, quantity: lineQty, unitPrice: '1000000' }],
      })
      .expect(201);
    const id = created.body.data.id as string;
    createdPoIds.push(id);
    await request(app.getHttpServer()).post(`${PO_BASE}/${id}/approve`).set(auth()).expect(201);
    const ordered = await request(app.getHttpServer())
      .post(`${PO_BASE}/${id}/order`)
      .set(auth())
      .expect(201);
    return ordered.body.data as {
      id: string;
      items: Array<{ id: string; skuId: string; quantity: number }>;
    };
  }

  async function createApprovedReturn(returnQty: number) {
    const po = await createOrderedPo(Math.max(returnQty * 3, 200));
    const poItem = po.items[0]!;
    const draft = await request(app.getHttpServer())
      .post(PURCH_RETURNS)
      .set(auth())
      .send({
        purchaseOrderId: po.id,
        reason: 'DEFECTIVE',
        expectedResolution: 'SUPPLIER_CREDIT',
        items: [{ purchaseOrderItemId: poItem.id, quantity: returnQty }],
      })
      .expect(201);
    const purchaseReturnId = draft.body.data.id as string;
    createdReturnIds.push(purchaseReturnId);
    const returnItemId = draft.body.data.items[0]!.id as string;

    const approved = await request(app.getHttpServer())
      .post(`${PURCH_RETURNS}/${purchaseReturnId}/approve`)
      .set(auth())
      .expect(201);
    expect(approved.body.data.status).toBe('APPROVED');

    return { purchaseReturnId, returnItemId, skuId: poItem.skuId };
  }

  async function createDraftExecution(
    purchaseReturnId: string,
    items?: Array<{
      purchaseReturnItemId: string;
      skuId: string;
      batchId: string;
      locationId: string;
      quantity: number;
      classification?: StockClassification;
    }>,
  ) {
    const res = await request(app.getHttpServer())
      .post(`${SRE_RETURNS}/${purchaseReturnId}/executions`)
      .set(auth())
      .send({ warehouseId: mainWarehouseId, items })
      .expect(201);
    createdExecutionIds.push(res.body.data.id);
    return res.body.data as { id: string; status: string };
  }

  function dispatchExecution(executionId: string) {
    return request(app.getHttpServer())
      .post(`${SRE_EXEC}/${executionId}/dispatch`)
      .set(auth());
  }

  async function returnProgress(purchaseReturnId: string) {
    const detail = await request(app.getHttpServer())
      .get(`${SRE_RETURNS}/${purchaseReturnId}`)
      .set(auth())
      .expect(200);
    return detail.body.data.progress as {
      approvedQuantity: number;
      dispatchedQuantity: number;
      remainingQuantity: number;
      fulfillmentStatus: string;
    };
  }

  it('approve return and draft execution do not post RETURN_OUT', async () => {
    const { batch1 } = await loadMascaraBatches();
    const loc = await createShelf(`SRE-DRAFT-${Date.now().toString(36).toUpperCase()}`);
    await seedStock({
      locationId: loc.id,
      skuId: mascaraSkuId,
      batchId: batch1.id,
      quantity: 50,
    });
    const before = await onHand({ locationId: loc.id, skuId: mascaraSkuId, batchId: batch1.id });

    const po = await createOrderedPo(500);
    const poItem = po.items[0]!;
    const draftReturn = await request(app.getHttpServer())
      .post(PURCH_RETURNS)
      .set(auth())
      .send({
        purchaseOrderId: po.id,
        reason: 'DEFECTIVE',
        items: [{ purchaseOrderItemId: poItem.id, quantity: 40 }],
      })
      .expect(201);
    const purchaseReturnId = draftReturn.body.data.id as string;
    createdReturnIds.push(purchaseReturnId);
    const returnItemId = draftReturn.body.data.items[0]!.id as string;

    await request(app.getHttpServer())
      .post(`${PURCH_RETURNS}/${purchaseReturnId}/approve`)
      .set(auth())
      .expect(201);
    expect(await onHand({ locationId: loc.id, skuId: mascaraSkuId, batchId: batch1.id })).toBe(
      before,
    );

    const execution = await createDraftExecution(purchaseReturnId, [
      {
        purchaseReturnItemId: returnItemId,
        skuId: mascaraSkuId,
        batchId: batch1.id,
        locationId: loc.id,
        quantity: 10,
      },
    ]);
    expect(execution.status).toBe('DRAFT');

    const movements = await database.client.inventoryMovement.count({
      where: {
        companyId: pishtehId,
        sourceType: InventorySourceType.SUPPLIER_RETURN,
        sourceId: execution.id,
      },
    });
    expect(movements).toBe(0);
    expect(await onHand({ locationId: loc.id, skuId: mascaraSkuId, batchId: batch1.id })).toBe(
      before,
    );
  });

  it('full dispatch posts RETURN_OUT and marks FULLY_DISPATCHED', async () => {
    const { purchaseReturnId, returnItemId } = await createApprovedReturn(25);
    const { batch1 } = await loadMascaraBatches();
    const loc = await createShelf(`SRE-FULL-${Date.now().toString(36).toUpperCase()}`);
    await seedStock({
      locationId: loc.id,
      skuId: mascaraSkuId,
      batchId: batch1.id,
      quantity: 30,
    });
    const before = await onHand({ locationId: loc.id, skuId: mascaraSkuId, batchId: batch1.id });

    const execution = await createDraftExecution(purchaseReturnId, [
      {
        purchaseReturnItemId: returnItemId,
        skuId: mascaraSkuId,
        batchId: batch1.id,
        locationId: loc.id,
        quantity: 25,
      },
    ]);
    const dispatched = await dispatchExecution(execution.id).expect(200);
    expect(dispatched.body.data.status).toBe('DISPATCHED');

    const progress = await returnProgress(purchaseReturnId);
    expect(progress.fulfillmentStatus).toBe('FULLY_DISPATCHED');
    expect(progress.dispatchedQuantity).toBe(25);
    expect(progress.remainingQuantity).toBe(0);
    expect(await onHand({ locationId: loc.id, skuId: mascaraSkuId, batchId: batch1.id })).toBe(
      before - 25,
    );

    const movements = await database.client.inventoryMovement.findMany({
      where: {
        sourceType: InventorySourceType.SUPPLIER_RETURN,
        sourceId: execution.id,
      },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0]!.movementType).toBe(InventoryMovementType.RETURN_OUT);
    expect(movements[0]!.quantityDelta).toBe(-25);
  });

  it('partial dispatch across two executions leaves remaining authorized quantity', async () => {
    const { purchaseReturnId, returnItemId } = await createApprovedReturn(100);
    const { batch1 } = await loadMascaraBatches();
    const loc = await createShelf(`SRE-PART-${Date.now().toString(36).toUpperCase()}`);
    await seedStock({
      locationId: loc.id,
      skuId: mascaraSkuId,
      batchId: batch1.id,
      quantity: 200,
    });

    const first = await createDraftExecution(purchaseReturnId, [
      {
        purchaseReturnItemId: returnItemId,
        skuId: mascaraSkuId,
        batchId: batch1.id,
        locationId: loc.id,
        quantity: 40,
      },
    ]);
    await dispatchExecution(first.id).expect(200);

    const second = await createDraftExecution(purchaseReturnId, [
      {
        purchaseReturnItemId: returnItemId,
        skuId: mascaraSkuId,
        batchId: batch1.id,
        locationId: loc.id,
        quantity: 30,
      },
    ]);
    await dispatchExecution(second.id).expect(200);

    const progress = await returnProgress(purchaseReturnId);
    expect(progress.dispatchedQuantity).toBe(70);
    expect(progress.remainingQuantity).toBe(30);
    expect(progress.fulfillmentStatus).toBe('PARTIALLY_DISPATCHED');
  });

  it('rejects dispatch over authorized quantity after prior dispatch', async () => {
    const { purchaseReturnId, returnItemId } = await createApprovedReturn(100);
    const { batch1 } = await loadMascaraBatches();
    const loc = await createShelf(`SRE-OVER-${Date.now().toString(36).toUpperCase()}`);
    await seedStock({
      locationId: loc.id,
      skuId: mascaraSkuId,
      batchId: batch1.id,
      quantity: 200,
    });

    const first = await createDraftExecution(purchaseReturnId, [
      {
        purchaseReturnItemId: returnItemId,
        skuId: mascaraSkuId,
        batchId: batch1.id,
        locationId: loc.id,
        quantity: 80,
      },
    ]);
    await dispatchExecution(first.id).expect(200);

    const second = await createDraftExecution(purchaseReturnId, [
      {
        purchaseReturnItemId: returnItemId,
        skuId: mascaraSkuId,
        batchId: batch1.id,
        locationId: loc.id,
        quantity: 30,
      },
    ]);
    const over = await dispatchExecution(second.id);
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe(ERROR_CODES.SUPPLIER_RETURN_EXECUTION_OVER_AUTHORIZED);
  });

  it('serializes concurrent over-dispatch so total dispatched stays within authorization', async () => {
    const { purchaseReturnId, returnItemId } = await createApprovedReturn(100);
    const { batch1 } = await loadMascaraBatches();
    const loc = await createShelf(`SRE-RACE-${Date.now().toString(36).toUpperCase()}`);
    await seedStock({
      locationId: loc.id,
      skuId: mascaraSkuId,
      batchId: batch1.id,
      quantity: 200,
    });

    const execA = await createDraftExecution(purchaseReturnId, [
      {
        purchaseReturnItemId: returnItemId,
        skuId: mascaraSkuId,
        batchId: batch1.id,
        locationId: loc.id,
        quantity: 70,
      },
    ]);
    const execB = await createDraftExecution(purchaseReturnId, [
      {
        purchaseReturnItemId: returnItemId,
        skuId: mascaraSkuId,
        batchId: batch1.id,
        locationId: loc.id,
        quantity: 70,
      },
    ]);

    const [resA, resB] = await Promise.all([
      dispatchExecution(execA.id),
      dispatchExecution(execB.id),
    ]);
    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toContain(200);
    expect(statuses).toContain(409);

    const progress = await returnProgress(purchaseReturnId);
    expect(progress.dispatchedQuantity).toBeLessThanOrEqual(100);
    expect(progress.dispatchedQuantity).toBeGreaterThanOrEqual(70);
  });

  it('rejects dispatch when on-hand is insufficient', async () => {
    const { purchaseReturnId, returnItemId } = await createApprovedReturn(20);
    const { batch1 } = await loadMascaraBatches();
    const loc = await createShelf(`SRE-STK-${Date.now().toString(36).toUpperCase()}`);
    await seedStock({
      locationId: loc.id,
      skuId: mascaraSkuId,
      batchId: batch1.id,
      quantity: 5,
    });

    const execution = await createDraftExecution(purchaseReturnId, [
      {
        purchaseReturnItemId: returnItemId,
        skuId: mascaraSkuId,
        batchId: batch1.id,
        locationId: loc.id,
        quantity: 10,
      },
    ]);
    const res = await dispatchExecution(execution.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe(ERROR_CODES.INVENTORY_INSUFFICIENT_STOCK);
    expect(await onHand({ locationId: loc.id, skuId: mascaraSkuId, batchId: batch1.id })).toBe(5);
  });

  it('dispatches multi-location multi-batch lines in one execution', async () => {
    const { purchaseReturnId, returnItemId } = await createApprovedReturn(50);
    const { batch1, batch2 } = await loadMascaraBatches();
    const locA = await createShelf(`SRE-ML-A-${Date.now().toString(36).toUpperCase()}`);
    const locB = await createShelf(`SRE-ML-B-${Date.now().toString(36).toUpperCase()}`);
    await seedStock({
      locationId: locA.id,
      skuId: mascaraSkuId,
      batchId: batch1.id,
      quantity: 30,
    });
    await seedStock({
      locationId: locB.id,
      skuId: mascaraSkuId,
      batchId: batch2.id,
      quantity: 30,
    });

    const execution = await createDraftExecution(purchaseReturnId, [
      {
        purchaseReturnItemId: returnItemId,
        skuId: mascaraSkuId,
        batchId: batch1.id,
        locationId: locA.id,
        quantity: 20,
      },
      {
        purchaseReturnItemId: returnItemId,
        skuId: mascaraSkuId,
        batchId: batch2.id,
        locationId: locB.id,
        quantity: 15,
      },
    ]);
    await dispatchExecution(execution.id).expect(200);

    expect(await onHand({ locationId: locA.id, skuId: mascaraSkuId, batchId: batch1.id })).toBe(10);
    expect(await onHand({ locationId: locB.id, skuId: mascaraSkuId, batchId: batch2.id })).toBe(
      15,
    );
    const movements = await database.client.inventoryMovement.count({
      where: { sourceType: InventorySourceType.SUPPLIER_RETURN, sourceId: execution.id },
    });
    expect(movements).toBe(2);
  });

  it('QUARANTINE dispatch decreases quarantine on-hand only', async () => {
    const { purchaseReturnId, returnItemId } = await createApprovedReturn(12);
    const { batch1 } = await loadMascaraBatches();
    const loc = await createShelf(`SRE-Q-${Date.now().toString(36).toUpperCase()}`);
    await seedStock({
      locationId: loc.id,
      skuId: mascaraSkuId,
      batchId: batch1.id,
      quantity: 20,
      classification: StockClassification.QUARANTINE,
    });
    await seedStock({
      locationId: loc.id,
      skuId: mascaraSkuId,
      batchId: batch1.id,
      quantity: 20,
      classification: StockClassification.SELLABLE,
    });

    const execution = await createDraftExecution(purchaseReturnId, [
      {
        purchaseReturnItemId: returnItemId,
        skuId: mascaraSkuId,
        batchId: batch1.id,
        locationId: loc.id,
        quantity: 8,
        classification: StockClassification.QUARANTINE,
      },
    ]);
    await dispatchExecution(execution.id).expect(200);

    expect(
      await onHand(
        { locationId: loc.id, skuId: mascaraSkuId, batchId: batch1.id },
        StockClassification.QUARANTINE,
      ),
    ).toBe(12);
    expect(await onHand({ locationId: loc.id, skuId: mascaraSkuId, batchId: batch1.id })).toBe(20);
  });

  it('rejects wrong SKU on upsert and scan-apply', async () => {
    const { purchaseReturnId, returnItemId } = await createApprovedReturn(5);
    const { batch1 } = await loadMascaraBatches();
    const loc = await createShelf(`SRE-SKU-${Date.now().toString(36).toUpperCase()}`);
    await seedStock({
      locationId: loc.id,
      skuId: mascaraSkuId,
      batchId: batch1.id,
      quantity: 10,
    });
    const execution = await createDraftExecution(purchaseReturnId);

    const upsertBad = await request(app.getHttpServer())
      .post(`${SRE_EXEC}/${execution.id}/items`)
      .set(auth())
      .send({
        purchaseReturnItemId: returnItemId,
        skuId: conc1SkuId,
        batchId: batch1.id,
        locationId: loc.id,
        quantity: 1,
      });
    expect(upsertBad.status).toBe(409);
    expect(upsertBad.body.error.code).toBe(ERROR_CODES.SUPPLIER_RETURN_EXECUTION_SKU_MISMATCH);

    const wrongSkuScanValue = `SRE-WRONG-${randomUUID().slice(0, 8).toUpperCase()}`;
    const wrongSkuBarcode = await database.client.barcode.create({
      data: {
        companyId: pishtehId,
        skuId: conc1SkuId,
        value: wrongSkuScanValue,
        normalizedValue: wrongSkuScanValue,
        type: 'INTERNAL',
        isPrimary: false,
      },
    });
    createdBarcodeIds.push(wrongSkuBarcode.id);

    const scanBad = await request(app.getHttpServer())
      .post(`${SRE_EXEC}/${execution.id}/scan-apply`)
      .set(auth())
      .send({
        requestId: randomUUID(),
        purchaseReturnItemId: returnItemId,
        locationBarcode: loc.barcode,
        productBarcode: wrongSkuScanValue,
        batchId: batch1.id,
        quantity: 1,
      });
    expect(scanBad.status).toBe(409);
    expect(scanBad.body.error.code).toBe(ERROR_CODES.SUPPLIER_RETURN_EXECUTION_SKU_MISMATCH);
  });

  it('dispatch retry is idempotent and concurrent dispatch posts once', async () => {
    const { purchaseReturnId, returnItemId } = await createApprovedReturn(15);
    const { batch1 } = await loadMascaraBatches();
    const loc = await createShelf(`SRE-IDEM-${Date.now().toString(36).toUpperCase()}`);
    await seedStock({
      locationId: loc.id,
      skuId: mascaraSkuId,
      batchId: batch1.id,
      quantity: 20,
    });

    const execution = await createDraftExecution(purchaseReturnId, [
      {
        purchaseReturnItemId: returnItemId,
        skuId: mascaraSkuId,
        batchId: batch1.id,
        locationId: loc.id,
        quantity: 12,
      },
    ]);

    const [first, second] = await Promise.all([
      dispatchExecution(execution.id),
      dispatchExecution(execution.id),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.data.status).toBe('DISPATCHED');
    expect(second.body.data.status).toBe('DISPATCHED');

    const retry = await dispatchExecution(execution.id).expect(200);
    expect(retry.body.data.status).toBe('DISPATCHED');

    const movementCount = await database.client.inventoryMovement.count({
      where: {
        sourceType: InventorySourceType.SUPPLIER_RETURN,
        sourceId: execution.id,
        movementType: InventoryMovementType.RETURN_OUT,
      },
    });
    expect(movementCount).toBe(1);

    const progress = await returnProgress(purchaseReturnId);
    expect(progress.dispatchedQuantity).toBe(12);
  });

  it('concurrent supplier return dispatch vs stock issue avoids negative on-hand', async () => {
    const { purchaseReturnId, returnItemId } = await createApprovedReturn(20);
    const { batch1 } = await loadMascaraBatches();
    const loc = await createShelf(`SRE-VS-ISS-${Date.now().toString(36).toUpperCase()}`);
    await seedStock({
      locationId: loc.id,
      skuId: mascaraSkuId,
      batchId: batch1.id,
      quantity: 10,
    });

    const execution = await createDraftExecution(purchaseReturnId, [
      {
        purchaseReturnItemId: returnItemId,
        skuId: mascaraSkuId,
        batchId: batch1.id,
        locationId: loc.id,
        quantity: 7,
      },
    ]);
    const issue = await request(app.getHttpServer())
      .post(ISS)
      .set(auth())
      .send({
        warehouseId: mainWarehouseId,
        reason: StockIssueReason.SAMPLE,
        items: [
          {
            skuId: mascaraSkuId,
            batchId: batch1.id,
            locationId: loc.id,
            classification: StockClassification.SELLABLE,
            quantity: 7,
          },
        ],
      })
      .expect(201);
    createdIssueIds.push(issue.body.data.id);

    const [dispatchRes, issuePost] = await Promise.all([
      dispatchExecution(execution.id),
      request(app.getHttpServer()).post(`${ISS}/${issue.body.data.id}/post`).set(auth()),
    ]);
    const statuses = [dispatchRes.status, issuePost.status].sort();
    expect(statuses).toContain(200);
    expect(statuses).toContain(409);
    expect(await onHand({ locationId: loc.id, skuId: mascaraSkuId, batchId: batch1.id })).toBe(3);
    expect(
      await onHand({ locationId: loc.id, skuId: mascaraSkuId, batchId: batch1.id }),
    ).toBeGreaterThanOrEqual(0);
  });

  it('cancels draft execution and rejects cancel after dispatch', async () => {
    const { purchaseReturnId, returnItemId } = await createApprovedReturn(10);
    const { batch1 } = await loadMascaraBatches();
    const loc = await createShelf(`SRE-CXL-${Date.now().toString(36).toUpperCase()}`);
    await seedStock({
      locationId: loc.id,
      skuId: mascaraSkuId,
      batchId: batch1.id,
      quantity: 15,
    });

    const draftOnly = await createDraftExecution(purchaseReturnId, [
      {
        purchaseReturnItemId: returnItemId,
        skuId: mascaraSkuId,
        batchId: batch1.id,
        locationId: loc.id,
        quantity: 4,
      },
    ]);
    const cancelled = await request(app.getHttpServer())
      .post(`${SRE_EXEC}/${draftOnly.id}/cancel`)
      .set(auth())
      .expect(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');

    const toDispatch = await createDraftExecution(purchaseReturnId, [
      {
        purchaseReturnItemId: returnItemId,
        skuId: mascaraSkuId,
        batchId: batch1.id,
        locationId: loc.id,
        quantity: 3,
      },
    ]);
    await dispatchExecution(toDispatch.id).expect(200);
    const rejectCancel = await request(app.getHttpServer())
      .post(`${SRE_EXEC}/${toDispatch.id}/cancel`)
      .set(auth());
    expect(rejectCancel.status).toBe(409);
    expect(rejectCancel.body.error.code).toBe(
      ERROR_CODES.SUPPLIER_RETURN_EXECUTION_CANCEL_NOT_ALLOWED,
    );
  });

  it('blocks purchase return cancel after a dispatched execution', async () => {
    const { purchaseReturnId, returnItemId } = await createApprovedReturn(8);
    const { batch1 } = await loadMascaraBatches();
    const loc = await createShelf(`SRE-PRC-${Date.now().toString(36).toUpperCase()}`);
    await seedStock({
      locationId: loc.id,
      skuId: mascaraSkuId,
      batchId: batch1.id,
      quantity: 12,
    });
    const execution = await createDraftExecution(purchaseReturnId, [
      {
        purchaseReturnItemId: returnItemId,
        skuId: mascaraSkuId,
        batchId: batch1.id,
        locationId: loc.id,
        quantity: 5,
      },
    ]);
    await dispatchExecution(execution.id).expect(200);

    const cancelReturn = await request(app.getHttpServer())
      .post(`${PURCH_RETURNS}/${purchaseReturnId}/cancel`)
      .set(auth())
      .send({ reason: 'should be blocked after dispatch' });
    expect(cancelReturn.status).toBe(409);
    expect(cancelReturn.body.error.code).toBe(ERROR_CODES.PURCHASE_RETURN_HAS_DISPATCHED_EXECUTION);
  });

  it('isolates supplier return APIs to the active company', async () => {
    const { purchaseReturnId, returnItemId } = await createApprovedReturn(5);
    const { batch1 } = await loadMascaraBatches();
    const loc = await createShelf(`SRE-TEN-${Date.now().toString(36).toUpperCase()}`);
    await seedStock({
      locationId: loc.id,
      skuId: mascaraSkuId,
      batchId: batch1.id,
      quantity: 8,
    });
    const execution = await createDraftExecution(purchaseReturnId, [
      {
        purchaseReturnItemId: returnItemId,
        skuId: mascaraSkuId,
        batchId: batch1.id,
        locationId: loc.id,
        quantity: 2,
      },
    ]);

    await request(app.getHttpServer())
      .get(`${SRE_RETURNS}/${purchaseReturnId}`)
      .set(auth(demoBId))
      .expect(404);
    await request(app.getHttpServer())
      .get(`${SRE_EXEC}/${execution.id}`)
      .set(auth(demoBId))
      .expect(404);
  });

  it('rejects mass assignment on create execution DTO', async () => {
    const { purchaseReturnId } = await createApprovedReturn(3);
    const res = await request(app.getHttpServer())
      .post(`${SRE_RETURNS}/${purchaseReturnId}/executions`)
      .set(auth())
      .send({ warehouseId: mainWarehouseId, companyId: pishtehId });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('VALIDATION_ERROR');
  });

  // Provenance mismatch (batch received only from another supplier via POSTED GRN) is skipped here:
  // exercising it cleanly requires a full GRN/post/putaway path for a non-TEH-BEAUTY supplier.
});
