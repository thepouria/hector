import request from 'supertest';
import {
  InventoryMovementType,
  InventorySourceType,
  StockClassification,
  StockIssueReason,
  StockIssueStatus,
  UserStatus,
  WarehouseLocationType,
  syncOwnerRolePermissions,
  syncPermissions,
  ensureSystemTransitPosition,
} from '@hector/database';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { InventoryLedgerService } from '../src/modules/warehouse/inventory-ledger.service';
import {
  deleteInventoryMovements,
  finalizeInventoryE2eCleanup,
  syncBalanceFromLedger,
} from './helpers/delete-movements';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';

const CLS_BASE = '/api/v1/warehouse/stock';
const ISS_BASE = '/api/v1/warehouse/issues';
const TRF_BASE = '/api/v1/warehouse/transfers';
const LOC_BASE = '/api/v1/warehouses';

describe('Stock Classification + Issue (Phase 3.12 e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let ledger: InventoryLedgerService;
  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;
  let pishtehId: string;
  let demoBId: string;
  let mainWarehouseId: string;
  let ownerUserId: string;
  let accessToken: string;
  const createdChangeIds: string[] = [];
  const createdIssueIds: string[] = [];
  const createdTransferIds: string[] = [];
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
    await ensureSystemTransitPosition(database.client, pishtehId);

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password })
      .expect(200);
    accessToken = login.body.data.accessToken as string;
  });

  afterAll(async () => {
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
    if (createdChangeIds.length > 0) {
      await deleteInventoryMovements(database, { sourceType: InventorySourceType.CLASSIFICATION_CHANGE, sourceId: { in: createdChangeIds } });
      await database.client.stockClassificationChange.deleteMany({
        where: { id: { in: createdChangeIds } },
      });
    }
    if (createdTransferIds.length > 0) {
      await deleteInventoryMovements(database, { sourceType: InventorySourceType.TRANSFER, sourceId: { in: createdTransferIds } });
      await database.client.stockTransferScanRequest.deleteMany({
        where: { transferId: { in: createdTransferIds } },
      });
      await database.client.stockTransferItem.deleteMany({
        where: { transferId: { in: createdTransferIds } },
      });
      await database.client.stockTransfer.deleteMany({
        where: { id: { in: createdTransferIds } },
      });
    }
    if (createdMovementIds.length > 0) {
      await deleteInventoryMovements(database, { id: { in: createdMovementIds } });
    }
    for (const key of touchedBalanceKeys) {
      await syncBalanceFromLedger(database, { companyId: pishtehId, ...key });
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

  async function seedSellable(input: {
    locationId: string;
    skuId: string;
    batchId: string;
    quantity: number;
  }) {
    const sourceLineId = randomUUID();
    const [movement] = await ledger.postMovements(pishtehId, [
      {
        warehouseId: mainWarehouseId,
        locationId: input.locationId,
        skuId: input.skuId,
        batchId: input.batchId,
        classification: StockClassification.SELLABLE,
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
      classification: StockClassification.SELLABLE,
    });
  }

  async function onHand(
    position: {
      locationId: string;
      skuId: string;
      batchId: string;
    },
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

  async function companySkuTotal(skuId: string) {
    const agg = await database.client.inventoryBalance.aggregate({
      where: { companyId: pishtehId, skuId },
      _sum: { onHandQuantity: true },
    });
    return agg._sum.onHandQuantity ?? 0;
  }

  async function loadSkuBatch() {
    const sku = await database.client.sku.findFirstOrThrow({
      where: { companyId: pishtehId, code: 'ESS-MASCARA-01' },
    });
    const batch = await database.client.batch.findFirstOrThrow({
      where: { companyId: pishtehId, skuId: sku.id, batchNumber: 'LOT-001' },
    });
    return { sku, batch };
  }

  it('reclassifies sellable→tester with conservation and paired movements', async () => {
    const { sku, batch } = await loadSkuBatch();
    const loc = await createShelf(`CLS-${Date.now().toString(36).toUpperCase()}`);
    await seedSellable({
      locationId: loc.id,
      skuId: sku.id,
      batchId: batch.id,
      quantity: 50,
    });
    const beforeTotal = await companySkuTotal(sku.id);

    const res = await request(app.getHttpServer())
      .post(`${CLS_BASE}/classification-change`)
      .set(auth())
      .send({
        warehouseId: mainWarehouseId,
        locationId: loc.id,
        skuId: sku.id,
        batchId: batch.id,
        fromClassification: StockClassification.SELLABLE,
        toClassification: StockClassification.TESTER,
        quantity: 12,
      })
      .expect(201);
    createdChangeIds.push(res.body.data.id);

    expect(await onHand({ locationId: loc.id, skuId: sku.id, batchId: batch.id })).toBe(38);
    expect(
      await onHand(
        { locationId: loc.id, skuId: sku.id, batchId: batch.id },
        StockClassification.TESTER,
      ),
    ).toBe(12);
    expect(await companySkuTotal(sku.id)).toBe(beforeTotal);

    const movements = await database.client.inventoryMovement.findMany({
      where: {
        companyId: pishtehId,
        sourceType: InventorySourceType.CLASSIFICATION_CHANGE,
        sourceId: res.body.data.id,
      },
    });
    expect(movements).toHaveLength(2);
    expect(movements.map((m) => m.movementType).sort()).toEqual([
      InventoryMovementType.RECLASSIFY_IN,
      InventoryMovementType.RECLASSIFY_OUT,
    ]);
    expect(movements.reduce((s, m) => s + m.quantityDelta, 0)).toBe(0);
    touchedBalanceKeys.push({
      warehouseId: mainWarehouseId,
      locationId: loc.id,
      skuId: sku.id,
      batchId: batch.id,
      classification: StockClassification.TESTER,
    });
  });

  it('rejects same classification and insufficient stock', async () => {
    const { sku, batch } = await loadSkuBatch();
    const loc = await createShelf(`CLS-REJ-${Date.now().toString(36).toUpperCase()}`);
    await seedSellable({
      locationId: loc.id,
      skuId: sku.id,
      batchId: batch.id,
      quantity: 5,
    });

    const same = await request(app.getHttpServer())
      .post(`${CLS_BASE}/classification-change`)
      .set(auth())
      .send({
        warehouseId: mainWarehouseId,
        locationId: loc.id,
        skuId: sku.id,
        batchId: batch.id,
        fromClassification: StockClassification.SELLABLE,
        toClassification: StockClassification.SELLABLE,
        quantity: 1,
      });
    expect(same.status).toBe(400);
    expect(same.body.error?.code).toBe('STOCK_CLASSIFICATION_SAME');

    const over = await request(app.getHttpServer())
      .post(`${CLS_BASE}/classification-change`)
      .set(auth())
      .send({
        warehouseId: mainWarehouseId,
        locationId: loc.id,
        skuId: sku.id,
        batchId: batch.id,
        fromClassification: StockClassification.SELLABLE,
        toClassification: StockClassification.DAMAGED,
        quantity: 99,
      });
    expect(over.status).toBe(409);
    expect(over.body.error?.code).toBe('INVENTORY_INSUFFICIENT_STOCK');
  });

  it('draft issue has no movement; post decreases; multi-item atomic; post idempotent', async () => {
    const { sku, batch } = await loadSkuBatch();
    const locA = await createShelf(`ISS-A-${Date.now().toString(36).toUpperCase()}`);
    const locB = await createShelf(`ISS-B-${Date.now().toString(36).toUpperCase()}`);
    await seedSellable({
      locationId: locA.id,
      skuId: sku.id,
      batchId: batch.id,
      quantity: 20,
    });
    await seedSellable({
      locationId: locB.id,
      skuId: sku.id,
      batchId: batch.id,
      quantity: 20,
    });

    const created = await request(app.getHttpServer())
      .post(ISS_BASE)
      .set(auth())
      .send({
        warehouseId: mainWarehouseId,
        reason: StockIssueReason.SAMPLE,
        items: [
          {
            skuId: sku.id,
            batchId: batch.id,
            locationId: locA.id,
            classification: StockClassification.SELLABLE,
            quantity: 6,
          },
          {
            skuId: sku.id,
            batchId: batch.id,
            locationId: locB.id,
            classification: StockClassification.SELLABLE,
            quantity: 4,
          },
        ],
      })
      .expect(201);
    createdIssueIds.push(created.body.data.id);
    expect(created.body.data.status).toBe(StockIssueStatus.DRAFT);
    expect(await onHand({ locationId: locA.id, skuId: sku.id, batchId: batch.id })).toBe(20);
    expect(await onHand({ locationId: locB.id, skuId: sku.id, batchId: batch.id })).toBe(20);
    expect(
      await database.client.inventoryMovement.count({
        where: {
          sourceType: InventorySourceType.STOCK_ISSUE,
          sourceId: created.body.data.id,
        },
      }),
    ).toBe(0);

    const posted = await request(app.getHttpServer())
      .post(`${ISS_BASE}/${created.body.data.id}/post`)
      .set(auth())
      .expect(200);
    expect(posted.body.data.status).toBe(StockIssueStatus.POSTED);
    expect(await onHand({ locationId: locA.id, skuId: sku.id, batchId: batch.id })).toBe(14);
    expect(await onHand({ locationId: locB.id, skuId: sku.id, batchId: batch.id })).toBe(16);

    const retry = await request(app.getHttpServer())
      .post(`${ISS_BASE}/${created.body.data.id}/post`)
      .set(auth())
      .expect(200);
    expect(retry.body.data.status).toBe(StockIssueStatus.POSTED);
    expect(
      await database.client.inventoryMovement.count({
        where: {
          sourceType: InventorySourceType.STOCK_ISSUE,
          sourceId: created.body.data.id,
          movementType: InventoryMovementType.ISSUE,
        },
      }),
    ).toBe(2);
  });

  it('issues damaged stock and supports quarantine round-trip reclass', async () => {
    const { sku, batch } = await loadSkuBatch();
    const loc = await createShelf(`ISS-DMG-${Date.now().toString(36).toUpperCase()}`);
    await seedSellable({
      locationId: loc.id,
      skuId: sku.id,
      batchId: batch.id,
      quantity: 20,
    });

    await request(app.getHttpServer())
      .post(`${CLS_BASE}/classification-change`)
      .set(auth())
      .send({
        warehouseId: mainWarehouseId,
        locationId: loc.id,
        skuId: sku.id,
        batchId: batch.id,
        fromClassification: StockClassification.SELLABLE,
        toClassification: StockClassification.DAMAGED,
        quantity: 8,
      })
      .expect(201)
      .then((r) => createdChangeIds.push(r.body.data.id));

    const issue = await request(app.getHttpServer())
      .post(ISS_BASE)
      .set(auth())
      .send({
        warehouseId: mainWarehouseId,
        reason: StockIssueReason.DAMAGE,
        items: [
          {
            skuId: sku.id,
            batchId: batch.id,
            locationId: loc.id,
            classification: StockClassification.DAMAGED,
            quantity: 3,
          },
        ],
      })
      .expect(201);
    createdIssueIds.push(issue.body.data.id);
    await request(app.getHttpServer())
      .post(`${ISS_BASE}/${issue.body.data.id}/post`)
      .set(auth())
      .expect(200);
    expect(
      await onHand(
        { locationId: loc.id, skuId: sku.id, batchId: batch.id },
        StockClassification.DAMAGED,
      ),
    ).toBe(5);

    await request(app.getHttpServer())
      .post(`${CLS_BASE}/classification-change`)
      .set(auth())
      .send({
        warehouseId: mainWarehouseId,
        locationId: loc.id,
        skuId: sku.id,
        batchId: batch.id,
        fromClassification: StockClassification.DAMAGED,
        toClassification: StockClassification.QUARANTINE,
        quantity: 2,
      })
      .expect(201)
      .then((r) => createdChangeIds.push(r.body.data.id));
    expect(
      await onHand(
        { locationId: loc.id, skuId: sku.id, batchId: batch.id },
        StockClassification.QUARANTINE,
      ),
    ).toBe(2);
    touchedBalanceKeys.push(
      {
        warehouseId: mainWarehouseId,
        locationId: loc.id,
        skuId: sku.id,
        batchId: batch.id,
        classification: StockClassification.DAMAGED,
      },
      {
        warehouseId: mainWarehouseId,
        locationId: loc.id,
        skuId: sku.id,
        batchId: batch.id,
        classification: StockClassification.QUARANTINE,
      },
    );
  });

  it('transfer preserves classification on movements', async () => {
    const { sku, batch } = await loadSkuBatch();
    const src = await createShelf(`TRF-CLS-S-${Date.now().toString(36).toUpperCase()}`);
    const dst = await createShelf(`TRF-CLS-D-${Date.now().toString(36).toUpperCase()}`);
    await seedSellable({
      locationId: src.id,
      skuId: sku.id,
      batchId: batch.id,
      quantity: 25,
    });
    await request(app.getHttpServer())
      .post(`${CLS_BASE}/classification-change`)
      .set(auth())
      .send({
        warehouseId: mainWarehouseId,
        locationId: src.id,
        skuId: sku.id,
        batchId: batch.id,
        fromClassification: StockClassification.SELLABLE,
        toClassification: StockClassification.TESTER,
        quantity: 10,
      })
      .expect(201)
      .then((r) => createdChangeIds.push(r.body.data.id));

    const created = await request(app.getHttpServer())
      .post(TRF_BASE)
      .set(auth())
      .send({
        sourceWarehouseId: mainWarehouseId,
        destinationWarehouseId: mainWarehouseId,
        items: [
          {
            skuId: sku.id,
            batchId: batch.id,
            sourceLocationId: src.id,
            destinationLocationId: dst.id,
            classification: StockClassification.TESTER,
            quantity: 5,
          },
        ],
      })
      .expect(201);
    createdTransferIds.push(created.body.data.id);
    await request(app.getHttpServer())
      .post(`${TRF_BASE}/${created.body.data.id}/dispatch`)
      .set(auth())
      .expect(200);
    await request(app.getHttpServer())
      .post(`${TRF_BASE}/${created.body.data.id}/complete`)
      .set(auth())
      .expect(200);

    const movements = await database.client.inventoryMovement.findMany({
      where: {
        sourceType: InventorySourceType.TRANSFER,
        sourceId: created.body.data.id,
      },
    });
    expect(movements.every((m) => m.classification === StockClassification.TESTER)).toBe(true);
    expect(
      await onHand(
        { locationId: dst.id, skuId: sku.id, batchId: batch.id },
        StockClassification.TESTER,
      ),
    ).toBe(5);
    touchedBalanceKeys.push({
      warehouseId: mainWarehouseId,
      locationId: dst.id,
      skuId: sku.id,
      batchId: batch.id,
      classification: StockClassification.TESTER,
    });
  });

  it('scan-apply rejects unknown product barcode; IDOR blocked cross-tenant', async () => {
    const { sku, batch } = await loadSkuBatch();
    const loc = await createShelf(`SCAN-${Date.now().toString(36).toUpperCase()}`);
    await seedSellable({
      locationId: loc.id,
      skuId: sku.id,
      batchId: batch.id,
      quantity: 10,
    });

    const draft = await request(app.getHttpServer())
      .post(ISS_BASE)
      .set(auth())
      .send({
        warehouseId: mainWarehouseId,
        reason: StockIssueReason.SAMPLE,
      })
      .expect(201);
    createdIssueIds.push(draft.body.data.id);

    const unknown = await request(app.getHttpServer())
      .post(`${ISS_BASE}/${draft.body.data.id}/scan-apply`)
      .set(auth())
      .send({
        requestId: randomUUID(),
        locationBarcode: loc.barcode,
        productBarcode: '0000000000000',
        quantity: 1,
      });
    expect(unknown.status).toBe(404);

    await request(app.getHttpServer())
      .get(`${ISS_BASE}/${draft.body.data.id}`)
      .set(auth(demoBId))
      .expect(404);

    await request(app.getHttpServer())
      .post(`${CLS_BASE}/classification-change`)
      .send({
        warehouseId: mainWarehouseId,
        locationId: loc.id,
        skuId: sku.id,
        batchId: batch.id,
        fromClassification: StockClassification.SELLABLE,
        toClassification: StockClassification.TESTER,
        quantity: 1,
      })
      .expect(401);
  });
});
