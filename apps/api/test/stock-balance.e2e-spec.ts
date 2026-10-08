import request from 'supertest';
import {
  InventoryMovementType,
  InventorySourceType,
  CurrencyCode,
  PaymentTermType,
  PurchaseCommercialType,
  StockClassification,
  UserStatus,
  WarehouseLocationType,
  syncOwnerRolePermissions,
  syncPermissions,
} from '@hector/database';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { InventoryLedgerService } from '../src/modules/warehouse/inventory-ledger.service';
import { InventoryReconciliationService } from '../src/modules/warehouse/inventory-reconciliation.service';
import { allocateAllItemsToBatches } from './helpers/batch-allocation';
import {
  deleteInventoryMovements,
  finalizeInventoryE2eCleanup,
  syncBalanceFromLedger,
} from './helpers/delete-movements';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';
import {
  cleanupPayablesForGoodsReceipts,
  cleanupE2ePurchaseOrders,
} from './helpers/payable-cleanup';

const INV_BASE = '/api/v1/warehouse/inventory';
const PUT_BASE = '/api/v1/warehouse/putaways';
const GRN_BASE = '/api/v1/goods-receipts';
const PO_BASE = '/api/v1/purchasing/purchase-orders';
const LOC_BASE = '/api/v1/warehouses';

describe('Stock Balance (Phase 3.10 e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let ledger: InventoryLedgerService;
  let reconciliation: InventoryReconciliationService;
  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;
  let pishtehId: string;
  let demoBId: string;
  let mainWarehouseId: string;
  let ownerUserId: string;
  const createdPoIds: string[] = [];
  const createdReceiptIds: string[] = [];
  const createdPutawayIds: string[] = [];
  const createdLocationIds: string[] = [];
  const createdMovementIds: string[] = [];
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
    reconciliation = app.get(InventoryReconciliationService);
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
    await database.client.user.update({
      where: { email: ownerEmail },
      data: { status: UserStatus.ACTIVE, deletedAt: null },
    });
  });

  afterAll(async () => {
    if (createdPutawayIds.length > 0) {
      await deleteInventoryMovements(database, { sourceType: InventorySourceType.PUTAWAY, sourceId: { in: createdPutawayIds } });
      await database.client.putawayScanRequest.deleteMany({
        where: { putawayId: { in: createdPutawayIds } },
      });
      await database.client.putawayItem.deleteMany({
        where: { putawayId: { in: createdPutawayIds } },
      });
      await database.client.putaway.deleteMany({ where: { id: { in: createdPutawayIds } } });
    }
    if (createdMovementIds.length > 0) {
      await deleteInventoryMovements(database, { id: { in: createdMovementIds } });
    }
    for (const key of touchedBalanceKeys) {
      await syncBalanceFromLedger(database, { companyId: pishtehId, ...key });
    }
    if (createdPoIds.length > 0) {
      await cleanupE2ePurchaseOrders(database, createdPoIds);
    } else if (createdReceiptIds.length > 0) {
      await cleanupPayablesForGoodsReceipts(database, createdReceiptIds);
      await database.client.goodsReceiptItemBatch.deleteMany({
        where: { goodsReceiptItem: { goodsReceiptId: { in: createdReceiptIds } } },
      });
      await database.client.goodsReceiptItem.deleteMany({
        where: { goodsReceiptId: { in: createdReceiptIds } },
      });
      await database.client.goodsReceipt.deleteMany({
        where: { id: { in: createdReceiptIds } },
      });
    }
    if (createdLocationIds.length > 0) {
      await deleteInventoryMovements(database, { locationId: { in: createdLocationIds } });
      await database.client.inventoryBalance.deleteMany({
        where: { locationId: { in: createdLocationIds } },
      });
      await database.client.warehouseLocation.deleteMany({
        where: { id: { in: createdLocationIds } },
      });
    }
    await finalizeInventoryE2eCleanup(database, pishtehId);
    await app.close();
  });

  async function login(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password })
      .expect(200);
    return res.body.data.accessToken as string;
  }

  function auth(token: string, companyId = pishtehId) {
    return { Authorization: `Bearer ${token}`, 'X-Company-Id': companyId };
  }

  async function createLocation(token: string, code: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`${LOC_BASE}/${mainWarehouseId}/locations`)
      .set(auth(token))
      .send({ type: WarehouseLocationType.SHELF, code, name: code, sortOrder: 1 })
      .expect(201);
    createdLocationIds.push(res.body.data.id);
    return res.body.data.id as string;
  }

  async function createPostedGrn(token: string, quantity: number) {
    const supplier = await database.client.supplier.findFirstOrThrow({
      where: { companyId: pishtehId, status: 'ACTIVE' },
    });
    const sku = await database.client.sku.findFirstOrThrow({
      where: { companyId: pishtehId, code: 'ESS-MASCARA-01' },
    });
    const po = await request(app.getHttpServer())
      .post(PO_BASE)
      .set(auth(token))
      .send({
        supplierId: supplier.id,
        currency: CurrencyCode.IRR,
        purchaseType: PurchaseCommercialType.CASH,
        paymentTermType: PaymentTermType.IMMEDIATE,
        orderDate: '2026-10-04T00:00:00.000Z',
        items: [{ skuId: sku.id, quantity, unitPrice: '10000' }],
      })
      .expect(201);
    createdPoIds.push(po.body.data.id);
    await request(app.getHttpServer())
      .post(`${PO_BASE}/${po.body.data.id}/approve`)
      .set(auth(token))
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post(`${PO_BASE}/${po.body.data.id}/mark-ordered`)
      .set(auth(token))
      .send({})
      .expect(201);

    const grn = await request(app.getHttpServer())
      .post(GRN_BASE)
      .set(auth(token))
      .send({
        purchaseOrderId: po.body.data.id,
        warehouseId: mainWarehouseId,
        items: [{ purchaseOrderItemId: po.body.data.items[0].id, quantity }],
      })
      .expect(201);
    createdReceiptIds.push(grn.body.data.id);
    await allocateAllItemsToBatches(app, auth(token), grn.body.data.id);
    await request(app.getHttpServer())
      .post(`${GRN_BASE}/${grn.body.data.id}/post`)
      .set(auth(token))
      .send({})
      .expect(201);

    const detail = await request(app.getHttpServer())
      .get(`${GRN_BASE}/${grn.body.data.id}`)
      .set(auth(token))
      .expect(200);
    return {
      goodsReceiptId: grn.body.data.id as string,
      skuId: sku.id as string,
      allocations: detail.body.data.items[0].batchAllocations as Array<{
        id: string;
        batchId: string;
        quantity: number;
      }>,
    };
  }

  async function completePutaway(
    token: string,
    goodsReceiptId: string,
    lines: Array<{
      receiptBatchAllocationId: string;
      warehouseLocationId: string;
      quantity: number;
    }>,
  ) {
    const putaway = await request(app.getHttpServer())
      .post(PUT_BASE)
      .set(auth(token))
      .send({ goodsReceiptId })
      .expect(201);
    createdPutawayIds.push(putaway.body.data.id);
    for (const line of lines) {
      await request(app.getHttpServer())
        .post(`${PUT_BASE}/${putaway.body.data.id}/items`)
        .set(auth(token))
        .send(line)
        .expect(201);
    }
    await request(app.getHttpServer())
      .post(`${PUT_BASE}/${putaway.body.data.id}/complete`)
      .set(auth(token))
      .send({})
      .expect(201);
    return putaway.body.data.id as string;
  }

  function trackBalance(key: {
    warehouseId: string;
    locationId: string;
    skuId: string;
    batchId: string;
    classification?: StockClassification;
  }) {
    touchedBalanceKeys.push({
      ...key,
      classification: key.classification ?? StockClassification.SELLABLE,
    });
  }

  it('posts movements to balance 83 and aggregates by SKU / warehouse / batch / location', async () => {
    const token = await login();
    const suffix = randomUUID().slice(0, 8);
    const { goodsReceiptId, allocations, skuId } = await createPostedGrn(token, 100);
    const locA = await createLocation(token, `BA${suffix}`);
    const locB = await createLocation(token, `BB${suffix}`);
    await completePutaway(token, goodsReceiptId, [
      {
        receiptBatchAllocationId: allocations[0].id,
        warehouseLocationId: locA,
        quantity: 100,
      },
    ]);
    const batchId = allocations[0].batchId;
    trackBalance({
      warehouseId: mainWarehouseId,
      locationId: locA,
      skuId,
      batchId,
    });
    trackBalance({
      warehouseId: mainWarehouseId,
      locationId: locB,
      skuId,
      batchId,
    });

    const issue = await ledger.postIssue(pishtehId, {
      warehouseId: mainWarehouseId,
      locationId: locA,
      skuId,
      batchId,
      quantity: 20,
      sourceType: InventorySourceType.SYSTEM_CORRECTION,
      sourceId: randomUUID(),
      sourceLineId: randomUUID(),
      actorUserId: ownerUserId,
    });
    createdMovementIds.push(issue.id);

    const ret = await ledger.postMovements(pishtehId, [
      {
        warehouseId: mainWarehouseId,
        locationId: locA,
        skuId,
        batchId,
        movementType: InventoryMovementType.RETURN_IN,
        quantityDelta: 5,
        sourceType: InventorySourceType.SYSTEM_CORRECTION,
        sourceId: randomUUID(),
        sourceLineId: randomUUID(),
        actorUserId: ownerUserId,
      },
    ]);
    createdMovementIds.push(ret[0].id);

    const adj = await ledger.postMovements(pishtehId, [
      {
        warehouseId: mainWarehouseId,
        locationId: locA,
        skuId,
        batchId,
        movementType: InventoryMovementType.ADJUSTMENT_OUT,
        quantityDelta: -2,
        sourceType: InventorySourceType.SYSTEM_CORRECTION,
        sourceId: randomUUID(),
        sourceLineId: randomUUID(),
        actorUserId: ownerUserId,
        reasonCode: 'DATA_CORRECTION',
      },
    ]);
    createdMovementIds.push(adj[0].id);

    const balA = await database.client.inventoryBalance.findFirstOrThrow({
      where: { locationId: locA, skuId, batchId },
    });
    expect(balA.onHandQuantity).toBe(83);

    const transfer = await ledger.postTransfer(pishtehId, {
      fromLocationId: locA,
      toLocationId: locB,
      warehouseId: mainWarehouseId,
      skuId,
      batchId,
      quantity: 30,
      actorUserId: ownerUserId,
    });
    createdMovementIds.push(transfer.out.id, transfer.in.id);

    const afterA = await database.client.inventoryBalance.findFirstOrThrow({
      where: { locationId: locA, skuId, batchId },
    });
    const afterB = await database.client.inventoryBalance.findFirstOrThrow({
      where: { locationId: locB, skuId, batchId },
    });
    expect(afterA.onHandQuantity).toBe(53);
    expect(afterB.onHandQuantity).toBe(30);

    const skuSummary = await request(app.getHttpServer())
      .get(`${INV_BASE}/skus/${skuId}`)
      .set(auth(token))
      .expect(200);
    expect(skuSummary.body.data.totalOnHand).toBeGreaterThanOrEqual(83);
    const locQty =
      (skuSummary.body.data.byLocation as Array<{ id: string; onHandQuantity: number }>).find(
        (l) => l.id === locA,
      )?.onHandQuantity ?? 0;
    const locBQty =
      (skuSummary.body.data.byLocation as Array<{ id: string; onHandQuantity: number }>).find(
        (l) => l.id === locB,
      )?.onHandQuantity ?? 0;
    expect(locQty).toBe(53);
    expect(locBQty).toBe(30);

    const batchSummary = await request(app.getHttpServer())
      .get(`${INV_BASE}/batches/${batchId}`)
      .set(auth(token))
      .expect(200);
    expect(batchSummary.body.data.totalOnHand).toBeGreaterThanOrEqual(83);

    const list = await request(app.getHttpServer())
      .get(INV_BASE)
      .query({ skuId, locationId: locA, includeZero: true })
      .set(auth(token))
      .expect(200);
    expect(list.body.data[0].onHandQuantity).toBe(53);
    expect(list.body.data[0].warnings).toBeDefined();
  });

  it('rejects balance mutation routes and blocks cross-company reads', async () => {
    const token = await login();
    const sku = await database.client.sku.findFirstOrThrow({
      where: { companyId: pishtehId, code: 'ESS-MASCARA-01' },
    });

    await request(app.getHttpServer())
      .patch(`${INV_BASE}/${randomUUID()}`)
      .set(auth(token))
      .send({ onHandQuantity: 999 })
      .expect(404);

    await request(app.getHttpServer())
      .put(`${INV_BASE}/${randomUUID()}`)
      .set(auth(token))
      .send({ onHandQuantity: 999 })
      .expect(404);

    await request(app.getHttpServer())
      .post(INV_BASE)
      .set(auth(token))
      .send({ onHandQuantity: 1, skuId: sku.id })
      .expect(404);

    await request(app.getHttpServer())
      .get(`${INV_BASE}/skus/${sku.id}`)
      .set(auth(token, demoBId))
      .expect(404);
  });

  it('detects MISMATCH / MISSING_BALANCE / ORPHAN_BALANCE and rebuilds from ledger', async () => {
    const token = await login();
    const suffix = randomUUID().slice(0, 8);
    const { goodsReceiptId, allocations, skuId } = await createPostedGrn(token, 40);
    const loc = await createLocation(token, `RC${suffix}`);
    await completePutaway(token, goodsReceiptId, [
      {
        receiptBatchAllocationId: allocations[0].id,
        warehouseLocationId: loc,
        quantity: 40,
      },
    ]);
    const batchId = allocations[0].batchId;
    trackBalance({
      warehouseId: mainWarehouseId,
      locationId: loc,
      skuId,
      batchId,
    });

    const position = {
      companyId: pishtehId,
      warehouseId: mainWarehouseId,
      locationId: loc,
      skuId,
      batchId,
      classification: StockClassification.SELLABLE,
    };

    const ok = await reconciliation.reconcilePosition(position);
    expect(ok.status).toBe('MATCH');
    expect(ok.ledgerQuantity).toBe(40);
    expect(ok.balanceQuantity).toBe(40);

    await database.client.inventoryBalance.updateMany({
      where: position,
      data: { onHandQuantity: 35 },
    });
    const mismatch = await reconciliation.reconcilePosition(position);
    expect(mismatch.status).toBe('MISMATCH');
    expect(mismatch.difference).toBe(-5);

    await database.client.inventoryBalance.deleteMany({ where: position });
    const missing = await reconciliation.reconcilePosition(position);
    expect(missing.status).toBe('MISSING_BALANCE');

    // Orphan on a separate empty location (no ledger history).
    const orphanLoc = await createLocation(token, `OR${suffix}`);
    const orphanPosition = {
      companyId: pishtehId,
      warehouseId: mainWarehouseId,
      locationId: orphanLoc,
      skuId,
      batchId,
      classification: StockClassification.SELLABLE,
    };
    trackBalance({
      warehouseId: mainWarehouseId,
      locationId: orphanLoc,
      skuId,
      batchId,
    });
    await database.client.inventoryBalance.create({
      data: { ...orphanPosition, onHandQuantity: 50 },
    });
    const orphan = await reconciliation.reconcilePosition(orphanPosition);
    expect(orphan.status).toBe('ORPHAN_BALANCE');

    // Restore balance row for the original position, then corrupt and rebuild.
    await database.client.inventoryBalance.create({
      data: { ...position, onHandQuantity: 1 },
    });

    const movementCountBefore = await database.client.inventoryMovement.count({
      where: { companyId: pishtehId, locationId: loc, skuId, batchId },
    });
    const movementHashBefore = await database.client.inventoryMovement.findMany({
      where: { companyId: pishtehId, locationId: loc, skuId, batchId },
      select: { id: true, quantityDelta: true },
      orderBy: { id: 'asc' },
    });

    const rebuild1 = await reconciliation.rebuildBalances({
      companyId: pishtehId,
      dryRun: false,
    });
    expect(rebuild1.updates + rebuild1.creates).toBeGreaterThan(0);

    const after = await reconciliation.reconcilePosition(position);
    expect(after.status).toBe('MATCH');
    expect(after.balanceQuantity).toBe(40);

    const rebuild2 = await reconciliation.rebuildBalances({
      companyId: pishtehId,
      dryRun: false,
    });
    expect(rebuild2.updates).toBe(0);

    const movementCountAfter = await database.client.inventoryMovement.count({
      where: { companyId: pishtehId, locationId: loc, skuId, batchId },
    });
    const movementHashAfter = await database.client.inventoryMovement.findMany({
      where: { companyId: pishtehId, locationId: loc, skuId, batchId },
      select: { id: true, quantityDelta: true },
      orderBy: { id: 'asc' },
    });
    expect(movementCountAfter).toBe(movementCountBefore);
    expect(movementHashAfter).toEqual(movementHashBefore);
  });

  it('handles concurrent inbound receives on a new position', async () => {
    const token = await login();
    const suffix = randomUUID().slice(0, 8);
    const sku = await database.client.sku.findFirstOrThrow({
      where: { companyId: pishtehId, code: 'ESS-MASCARA-01' },
    });
    const batch = await database.client.batch.findFirstOrThrow({
      where: { companyId: pishtehId, skuId: sku.id },
    });
    const loc = await createLocation(token, `CI${suffix}`);
    trackBalance({
      warehouseId: mainWarehouseId,
      locationId: loc,
      skuId: sku.id,
      batchId: batch.id,
    });

    const posts = [
      {
        warehouseId: mainWarehouseId,
        locationId: loc,
        skuId: sku.id,
        batchId: batch.id,
        movementType: InventoryMovementType.RECEIVE,
        quantityDelta: 40,
        sourceType: InventorySourceType.SYSTEM_CORRECTION,
        sourceId: randomUUID(),
        sourceLineId: randomUUID(),
        actorUserId: ownerUserId,
      },
      {
        warehouseId: mainWarehouseId,
        locationId: loc,
        skuId: sku.id,
        batchId: batch.id,
        movementType: InventoryMovementType.RECEIVE,
        quantityDelta: 60,
        sourceType: InventorySourceType.SYSTEM_CORRECTION,
        sourceId: randomUUID(),
        sourceLineId: randomUUID(),
        actorUserId: ownerUserId,
      },
    ] as const;

    const results = await Promise.allSettled([
      ledger.postMovements(pishtehId, [posts[0]]),
      ledger.postMovements(pishtehId, [posts[1]]),
    ]);

    // Retry any transient serialization/deadlock failures once (position create race).
    for (let i = 0; i < results.length; i += 1) {
      const r = results[i];
      if (r.status === 'fulfilled') {
        createdMovementIds.push(r.value[0].id);
        continue;
      }
      const retry = await ledger.postMovements(pishtehId, [posts[i]]);
      createdMovementIds.push(retry[0].id);
    }

    const balances = await database.client.inventoryBalance.findMany({
      where: { companyId: pishtehId, locationId: loc, skuId: sku.id, batchId: batch.id },
    });
    expect(balances).toHaveLength(1);
    expect(balances[0].onHandQuantity).toBe(100);

    const recon = await reconciliation.reconcilePosition({
      companyId: pishtehId,
      warehouseId: mainWarehouseId,
      locationId: loc,
      skuId: sku.id,
      batchId: batch.id,
      classification: StockClassification.SELLABLE,
    });
    expect(recon.status).toBe('MATCH');
    expect(recon.ledgerQuantity).toBe(100);
  });

  it('resolves product barcode and location barcode to On Hand views', async () => {
    const token = await login();
    const barcode = await database.client.barcode.findFirst({
      where: {
        companyId: pishtehId,
        sku: { code: 'ESS-MASCARA-01' },
        archivedAt: null,
      },
    });
    expect(barcode).toBeTruthy();

    const productLookup = await request(app.getHttpServer())
      .get(`${INV_BASE}/lookup`)
      .query({ value: barcode!.value, kind: 'PRODUCT' })
      .set(auth(token))
      .expect(200);
    expect(productLookup.body.data.kind).toBe('PRODUCT_BARCODE');
    expect(productLookup.body.data.sku.skuCode).toBe('ESS-MASCARA-01');
    expect(typeof productLookup.body.data.sku.totalOnHand).toBe('number');

    const leadingZeroLookup = await request(app.getHttpServer())
      .get(`${INV_BASE}/lookup`)
      .query({ value: '000-A-03', kind: 'LOCATION' })
      .set(auth(token))
      .expect(200);
    expect(leadingZeroLookup.body.data.kind).toBe('LOCATION_BARCODE');
    expect(leadingZeroLookup.body.data.normalizedValue).toBe('000-A-03');
    expect(leadingZeroLookup.body.data.location.locationCode).toBe('A-00');

    const locLookup = await request(app.getHttpServer())
      .get(`${INV_BASE}/lookup`)
      .query({ value: 'LOC-A-03', kind: 'LOCATION' })
      .set(auth(token))
      .expect(200);
    expect(locLookup.body.data.location.locationCode).toBe('A-03');
  });

  it('keeps archived SKU with stock visible in inventory list', async () => {
    const token = await login();
    const suffix = randomUUID().slice(0, 8);
    const { goodsReceiptId, allocations, skuId } = await createPostedGrn(token, 7);
    const loc = await createLocation(token, `AR${suffix}`);
    await completePutaway(token, goodsReceiptId, [
      {
        receiptBatchAllocationId: allocations[0].id,
        warehouseLocationId: loc,
        quantity: 7,
      },
    ]);
    trackBalance({
      warehouseId: mainWarehouseId,
      locationId: loc,
      skuId,
      batchId: allocations[0].batchId,
    });

    // Temporarily mark SKU archived for visibility check, then restore.
    const before = await database.client.sku.findUniqueOrThrow({ where: { id: skuId } });
    await database.client.sku.update({
      where: { id: skuId },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });

    try {
      const list = await request(app.getHttpServer())
        .get(INV_BASE)
        .query({ skuId, locationId: loc })
        .set(auth(token))
        .expect(200);
      expect(list.body.data.length).toBe(1);
      expect(list.body.data[0].onHandQuantity).toBe(7);
      expect(list.body.data[0].warnings.archivedSku).toBe(true);

      const summary = await request(app.getHttpServer())
        .get(`${INV_BASE}/skus/${skuId}`)
        .set(auth(token))
        .expect(200);
      expect(summary.body.data.totalOnHand).toBeGreaterThanOrEqual(7);
    } finally {
      await database.client.sku.update({
        where: { id: skuId },
        data: { status: before.status, archivedAt: before.archivedAt },
      });
    }
  });
});
