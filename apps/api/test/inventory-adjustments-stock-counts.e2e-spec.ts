import request from 'supertest';
import {
  InventoryAdjustmentDirection,
  InventoryAdjustmentReason,
  InventoryAdjustmentStatus,
  InventoryMovementType,
  InventorySourceType,
  StockClassification,
  StockCountStatus,
  StockCountType,
  StockIssueReason,
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

const ADJ_BASE = '/api/v1/warehouse/adjustments';
const CNT_BASE = '/api/v1/warehouse/counts';
const ISS_BASE = '/api/v1/warehouse/issues';
const CLS_BASE = '/api/v1/warehouse/stock';
const LOC_BASE = '/api/v1/warehouses';

describe('Inventory Adjustments + Stock Counts (Phase 3.13 e2e)', () => {
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

  const createdAdjustmentIds: string[] = [];
  const createdCountIds: string[] = [];
  const createdIssueIds: string[] = [];
  const createdChangeIds: string[] = [];
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
    if (createdAdjustmentIds.length > 0) {
      await deleteInventoryMovements(database, { sourceType: InventorySourceType.MANUAL_ADJUSTMENT, sourceId: { in: createdAdjustmentIds } });
      await database.client.inventoryAdjustmentItem.deleteMany({
        where: { inventoryAdjustmentId: { in: createdAdjustmentIds } },
      });
      await database.client.inventoryAdjustment.deleteMany({
        where: { id: { in: createdAdjustmentIds } },
      });
    }
    if (createdCountIds.length > 0) {
      await deleteInventoryMovements(database, { sourceType: InventorySourceType.STOCK_COUNT, sourceId: { in: createdCountIds } });
      await database.client.stockCountScanRequest.deleteMany({
        where: { stockCountId: { in: createdCountIds } },
      });
      await database.client.stockCountItem.deleteMany({
        where: { stockCountId: { in: createdCountIds } },
      });
      await database.client.stockCountScopeLocation.deleteMany({
        where: { stockCountId: { in: createdCountIds } },
      });
      await database.client.stockCountScopeSku.deleteMany({
        where: { stockCountId: { in: createdCountIds } },
      });
      await database.client.stockCount.deleteMany({
        where: { id: { in: createdCountIds } },
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

  async function loadSkuBatch() {
    const sku = await database.client.sku.findFirstOrThrow({
      where: { companyId: pishtehId, code: 'ESS-MASCARA-01' },
    });
    const batch = await database.client.batch.findFirstOrThrow({
      where: { companyId: pishtehId, skuId: sku.id, batchNumber: 'LOT-001' },
    });
    return { sku, batch };
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

  async function ledgerSumForPosition(
    position: { locationId: string; skuId: string; batchId: string },
    classification = StockClassification.SELLABLE,
  ) {
    const agg = await database.client.inventoryMovement.aggregate({
      where: {
        companyId: pishtehId,
        warehouseId: mainWarehouseId,
        locationId: position.locationId,
        skuId: position.skuId,
        batchId: position.batchId,
        classification,
      },
      _sum: { quantityDelta: true },
    });
    return agg._sum.quantityDelta ?? 0;
  }

  async function submitApprovePostAdjustment(adjustmentId: string) {
    await request(app.getHttpServer())
      .post(`${ADJ_BASE}/${adjustmentId}/submit`)
      .set(auth())
      .expect(200);
    await request(app.getHttpServer())
      .post(`${ADJ_BASE}/${adjustmentId}/approve`)
      .set(auth())
      .expect(200);
    return request(app.getHttpServer())
      .post(`${ADJ_BASE}/${adjustmentId}/post`)
      .set(auth())
      .expect(200);
  }

  async function createScopedCount(
    locationId: string,
    extra?: Partial<{ allowDiscoveredItems: boolean; skuIds: string[] }>,
  ) {
    const res = await request(app.getHttpServer())
      .post(CNT_BASE)
      .set(auth())
      .send({
        warehouseId: mainWarehouseId,
        type: StockCountType.CYCLE,
        locationIds: [locationId],
        ...(extra?.skuIds ? { skuIds: extra.skuIds } : {}),
        ...(extra?.allowDiscoveredItems ? { allowDiscoveredItems: true } : {}),
      })
      .expect(201);
    createdCountIds.push(res.body.data.id);
    return res.body.data as { id: string; status: StockCountStatus };
  }

  async function startCount(countId: string) {
    return request(app.getHttpServer())
      .post(`${CNT_BASE}/${countId}/start`)
      .set(auth())
      .expect(200);
  }

  async function recordCountLine(countId: string, itemId: string, countedQuantity: number) {
    return request(app.getHttpServer())
      .post(`${CNT_BASE}/${countId}/items/${itemId}/record`)
      .set(auth())
      .send({ countedQuantity })
      .expect(200);
  }

  async function submitApprovePostCount(countId: string) {
    await request(app.getHttpServer())
      .post(`${CNT_BASE}/${countId}/submit`)
      .set(auth())
      .expect(200);
    await request(app.getHttpServer())
      .post(`${CNT_BASE}/${countId}/approve`)
      .set(auth())
      .expect(200);
    return request(app.getHttpServer())
      .post(`${CNT_BASE}/${countId}/post`)
      .set(auth())
      .expect(200);
  }

  function findLineForSku(
    detail: { items: Array<{ id: string; skuId: string; snapshotQuantity: number }> },
    skuId: string,
  ) {
    const line = detail.items.find((i) => i.skuId === skuId);
    if (!line) throw new Error('Expected count line for sku');
    return line;
  }

  it('posts FOUND IN +5: balance +5, ADJUSTMENT_IN, ledger matches balance', async () => {
    const { sku, batch } = await loadSkuBatch();
    const loc = await createShelf(`ADJ-IN-${Date.now().toString(36).toUpperCase()}`);
    await seedSellable({ locationId: loc.id, skuId: sku.id, batchId: batch.id, quantity: 10 });
    const before = await onHand({ locationId: loc.id, skuId: sku.id, batchId: batch.id });

    const created = await request(app.getHttpServer())
      .post(ADJ_BASE)
      .set(auth())
      .send({
        warehouseId: mainWarehouseId,
        reason: InventoryAdjustmentReason.FOUND,
        items: [
          {
            locationId: loc.id,
            skuId: sku.id,
            batchId: batch.id,
            classification: StockClassification.SELLABLE,
            direction: InventoryAdjustmentDirection.IN,
            quantity: 5,
          },
        ],
      })
      .expect(201);
    const adjustmentId = created.body.data.id as string;
    createdAdjustmentIds.push(adjustmentId);
    expect(created.body.data.status).toBe(InventoryAdjustmentStatus.DRAFT);
    expect(await onHand({ locationId: loc.id, skuId: sku.id, batchId: batch.id })).toBe(before);

    await submitApprovePostAdjustment(adjustmentId);
    expect(await onHand({ locationId: loc.id, skuId: sku.id, batchId: batch.id })).toBe(
      before + 5,
    );
    const movements = await database.client.inventoryMovement.findMany({
      where: {
        sourceType: InventorySourceType.MANUAL_ADJUSTMENT,
        sourceId: adjustmentId,
      },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0]?.movementType).toBe(InventoryMovementType.ADJUSTMENT_IN);
    expect(movements[0]?.quantityDelta).toBe(5);
    expect(
      await ledgerSumForPosition({ locationId: loc.id, skuId: sku.id, batchId: batch.id }),
    ).toBe(await onHand({ locationId: loc.id, skuId: sku.id, batchId: batch.id }));
  });

  it('rejects MISSING OUT when insufficient stock (409, no movement)', async () => {
    const { sku, batch } = await loadSkuBatch();
    const loc = await createShelf(`ADJ-OUT-${Date.now().toString(36).toUpperCase()}`);
    await seedSellable({ locationId: loc.id, skuId: sku.id, batchId: batch.id, quantity: 3 });

    const created = await request(app.getHttpServer())
      .post(ADJ_BASE)
      .set(auth())
      .send({
        warehouseId: mainWarehouseId,
        reason: InventoryAdjustmentReason.MISSING,
        items: [
          {
            locationId: loc.id,
            skuId: sku.id,
            batchId: batch.id,
            direction: InventoryAdjustmentDirection.OUT,
            quantity: 10,
          },
        ],
      })
      .expect(201);
    createdAdjustmentIds.push(created.body.data.id);

    const post = await request(app.getHttpServer())
      .post(`${ADJ_BASE}/${created.body.data.id}/submit`)
      .set(auth())
      .expect(200);
    await request(app.getHttpServer())
      .post(`${ADJ_BASE}/${created.body.data.id}/approve`)
      .set(auth())
      .expect(200);
    const failed = await request(app.getHttpServer())
      .post(`${ADJ_BASE}/${created.body.data.id}/post`)
      .set(auth());
    expect(failed.status).toBe(409);
    expect(failed.body.error?.code).toBe('INVENTORY_INSUFFICIENT_STOCK');
    expect(post.body.data.status).toBe(InventoryAdjustmentStatus.PENDING_APPROVAL);
    expect(
      await database.client.inventoryMovement.count({
        where: {
          sourceType: InventorySourceType.MANUAL_ADJUSTMENT,
          sourceId: created.body.data.id,
        },
      }),
    ).toBe(0);
    expect(await onHand({ locationId: loc.id, skuId: sku.id, batchId: batch.id })).toBe(3);
  });

  it('rolls back create when one line has invalid batch/sku pairing', async () => {
    const { sku, batch } = await loadSkuBatch();
    const loc = await createShelf(`ADJ-MULTI-${Date.now().toString(36).toUpperCase()}`);
    const otherSku = await database.client.sku.findFirstOrThrow({
      where: { companyId: pishtehId, NOT: { id: sku.id } },
    });

    const beforeCount = await database.client.inventoryAdjustment.count({
      where: { companyId: pishtehId },
    });

    const res = await request(app.getHttpServer())
      .post(ADJ_BASE)
      .set(auth())
      .send({
        warehouseId: mainWarehouseId,
        reason: InventoryAdjustmentReason.FOUND,
        items: [
          {
            locationId: loc.id,
            skuId: sku.id,
            batchId: batch.id,
            direction: InventoryAdjustmentDirection.IN,
            quantity: 1,
          },
          {
            locationId: loc.id,
            skuId: otherSku.id,
            batchId: batch.id,
            direction: InventoryAdjustmentDirection.IN,
            quantity: 1,
          },
        ],
      });
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('INVENTORY_ADJUSTMENT_BATCH_SKU_MISMATCH');
    expect(await database.client.inventoryAdjustment.count({ where: { companyId: pishtehId } })).toBe(
      beforeCount,
    );
  });

  it('post rolls back all lines when one OUT line is insufficient', async () => {
    const { sku, batch } = await loadSkuBatch();
    const locA = await createShelf(`ADJ-AT-${Date.now().toString(36).toUpperCase()}`);
    const locB = await createShelf(`ADJ-BT-${Date.now().toString(36).toUpperCase()}`);
    await seedSellable({ locationId: locA.id, skuId: sku.id, batchId: batch.id, quantity: 20 });
    await seedSellable({ locationId: locB.id, skuId: sku.id, batchId: batch.id, quantity: 2 });

    const created = await request(app.getHttpServer())
      .post(ADJ_BASE)
      .set(auth())
      .send({
        warehouseId: mainWarehouseId,
        reason: InventoryAdjustmentReason.MISSING,
        items: [
          {
            locationId: locA.id,
            skuId: sku.id,
            batchId: batch.id,
            direction: InventoryAdjustmentDirection.OUT,
            quantity: 5,
          },
          {
            locationId: locB.id,
            skuId: sku.id,
            batchId: batch.id,
            direction: InventoryAdjustmentDirection.OUT,
            quantity: 5,
          },
        ],
      })
      .expect(201);
    createdAdjustmentIds.push(created.body.data.id);

    await request(app.getHttpServer())
      .post(`${ADJ_BASE}/${created.body.data.id}/submit`)
      .set(auth())
      .expect(200);
    await request(app.getHttpServer())
      .post(`${ADJ_BASE}/${created.body.data.id}/approve`)
      .set(auth())
      .expect(200);
    const failed = await request(app.getHttpServer())
      .post(`${ADJ_BASE}/${created.body.data.id}/post`)
      .set(auth());
    expect(failed.status).toBe(409);

    expect(await onHand({ locationId: locA.id, skuId: sku.id, batchId: batch.id })).toBe(20);
    expect(await onHand({ locationId: locB.id, skuId: sku.id, batchId: batch.id })).toBe(2);
    expect(
      await database.client.inventoryMovement.count({
        where: {
          sourceType: InventorySourceType.MANUAL_ADJUSTMENT,
          sourceId: created.body.data.id,
        },
      }),
    ).toBe(0);
  });

  it('adjustment post retry is idempotent (POSTED, single movement set)', async () => {
    const { sku, batch } = await loadSkuBatch();
    const loc = await createShelf(`ADJ-IDEM-${Date.now().toString(36).toUpperCase()}`);
    await seedSellable({ locationId: loc.id, skuId: sku.id, batchId: batch.id, quantity: 8 });

    const created = await request(app.getHttpServer())
      .post(ADJ_BASE)
      .set(auth())
      .send({
        warehouseId: mainWarehouseId,
        reason: InventoryAdjustmentReason.FOUND,
        items: [
          {
            locationId: loc.id,
            skuId: sku.id,
            batchId: batch.id,
            direction: InventoryAdjustmentDirection.IN,
            quantity: 2,
          },
        ],
      })
      .expect(201);
    createdAdjustmentIds.push(created.body.data.id);
    await submitApprovePostAdjustment(created.body.data.id);
    const retry = await request(app.getHttpServer())
      .post(`${ADJ_BASE}/${created.body.data.id}/post`)
      .set(auth())
      .expect(200);
    expect(retry.body.data.status).toBe(InventoryAdjustmentStatus.POSTED);
    expect(
      await database.client.inventoryMovement.count({
        where: {
          sourceType: InventorySourceType.MANUAL_ADJUSTMENT,
          sourceId: created.body.data.id,
        },
      }),
    ).toBe(1);
  });

  it('concurrent adjustment OUT vs issue: no negative on-hand', async () => {
    const { sku, batch } = await loadSkuBatch();
    const loc = await createShelf(`ADJ-RACE-${Date.now().toString(36).toUpperCase()}`);
    await seedSellable({ locationId: loc.id, skuId: sku.id, batchId: batch.id, quantity: 10 });

    const adj = await request(app.getHttpServer())
      .post(ADJ_BASE)
      .set(auth())
      .send({
        warehouseId: mainWarehouseId,
        reason: InventoryAdjustmentReason.MISSING,
        items: [
          {
            locationId: loc.id,
            skuId: sku.id,
            batchId: batch.id,
            direction: InventoryAdjustmentDirection.OUT,
            quantity: 7,
          },
        ],
      })
      .expect(201);
    createdAdjustmentIds.push(adj.body.data.id);
    await request(app.getHttpServer())
      .post(`${ADJ_BASE}/${adj.body.data.id}/submit`)
      .set(auth())
      .expect(200);
    await request(app.getHttpServer())
      .post(`${ADJ_BASE}/${adj.body.data.id}/approve`)
      .set(auth())
      .expect(200);

    const issue = await request(app.getHttpServer())
      .post(ISS_BASE)
      .set(auth())
      .send({
        warehouseId: mainWarehouseId,
        reason: StockIssueReason.SAMPLE,
        items: [
          {
            skuId: sku.id,
            batchId: batch.id,
            locationId: loc.id,
            classification: StockClassification.SELLABLE,
            quantity: 7,
          },
        ],
      })
      .expect(201);
    createdIssueIds.push(issue.body.data.id);

    const [adjPost, issuePost] = await Promise.all([
      request(app.getHttpServer()).post(`${ADJ_BASE}/${adj.body.data.id}/post`).set(auth()),
      request(app.getHttpServer()).post(`${ISS_BASE}/${issue.body.data.id}/post`).set(auth()),
    ]);

    const statuses = [adjPost.status, issuePost.status].sort();
    expect(statuses).toContain(200);
    expect(statuses).toContain(409);
    expect(await onHand({ locationId: loc.id, skuId: sku.id, batchId: batch.id })).toBeGreaterThanOrEqual(
      0,
    );
    expect(await onHand({ locationId: loc.id, skuId: sku.id, batchId: batch.id })).toBe(3);
  });

  it('TESTER adjustment does not change SELLABLE on-hand', async () => {
    const { sku, batch } = await loadSkuBatch();
    const loc = await createShelf(`ADJ-CLS-${Date.now().toString(36).toUpperCase()}`);
    await seedSellable({ locationId: loc.id, skuId: sku.id, batchId: batch.id, quantity: 15 });

    const reclass = await request(app.getHttpServer())
      .post(`${CLS_BASE}/classification-change`)
      .set(auth())
      .send({
        warehouseId: mainWarehouseId,
        locationId: loc.id,
        skuId: sku.id,
        batchId: batch.id,
        fromClassification: StockClassification.SELLABLE,
        toClassification: StockClassification.TESTER,
        quantity: 6,
      })
      .expect(201);
    createdChangeIds.push(reclass.body.data.id);
    touchedBalanceKeys.push({
      warehouseId: mainWarehouseId,
      locationId: loc.id,
      skuId: sku.id,
      batchId: batch.id,
      classification: StockClassification.TESTER,
    });

    const sellableBefore = await onHand({ locationId: loc.id, skuId: sku.id, batchId: batch.id });
    const testerBefore = await onHand(
      { locationId: loc.id, skuId: sku.id, batchId: batch.id },
      StockClassification.TESTER,
    );

    const created = await request(app.getHttpServer())
      .post(ADJ_BASE)
      .set(auth())
      .send({
        warehouseId: mainWarehouseId,
        reason: InventoryAdjustmentReason.FOUND,
        items: [
          {
            locationId: loc.id,
            skuId: sku.id,
            batchId: batch.id,
            classification: StockClassification.TESTER,
            direction: InventoryAdjustmentDirection.IN,
            quantity: 4,
          },
        ],
      })
      .expect(201);
    createdAdjustmentIds.push(created.body.data.id);
    await submitApprovePostAdjustment(created.body.data.id);

    expect(await onHand({ locationId: loc.id, skuId: sku.id, batchId: batch.id })).toBe(
      sellableBefore,
    );
    expect(
      await onHand(
        { locationId: loc.id, skuId: sku.id, batchId: batch.id },
        StockClassification.TESTER,
      ),
    ).toBe(testerBefore + 4);
  });

  it('draft count start snapshots lines without ledger movements until post', async () => {
    const { sku, batch } = await loadSkuBatch();
    const loc = await createShelf(`CNT-DRAFT-${Date.now().toString(36).toUpperCase()}`);
    await seedSellable({ locationId: loc.id, skuId: sku.id, batchId: batch.id, quantity: 12 });
    const beforeMovements = await database.client.inventoryMovement.count({
      where: { locationId: loc.id, sourceType: InventorySourceType.STOCK_COUNT },
    });

    const draft = await createScopedCount(loc.id, { skuIds: [sku.id] });
    expect(draft.status).toBe(StockCountStatus.DRAFT);
    const started = await startCount(draft.id);
    expect(started.body.data.status).toBe(StockCountStatus.IN_PROGRESS);
    const line = findLineForSku(started.body.data, sku.id);
    expect(line.snapshotQuantity).toBe(12);
    expect(
      await database.client.inventoryMovement.count({
        where: { locationId: loc.id, sourceType: InventorySourceType.STOCK_COUNT },
      }),
    ).toBe(beforeMovements);
    expect(await onHand({ locationId: loc.id, skuId: sku.id, batchId: batch.id })).toBe(12);
  });

  it('count exact match posts with zero STOCK_COUNT adjustment movements', async () => {
    const { sku, batch } = await loadSkuBatch();
    const loc = await createShelf(`CNT-EXACT-${Date.now().toString(36).toUpperCase()}`);
    await seedSellable({ locationId: loc.id, skuId: sku.id, batchId: batch.id, quantity: 7 });

    const draft = await createScopedCount(loc.id, { skuIds: [sku.id] });
    const started = await startCount(draft.id);
    const line = findLineForSku(started.body.data, sku.id);
    await recordCountLine(draft.id, line.id, 7);
    await submitApprovePostCount(draft.id);

    const movements = await database.client.inventoryMovement.findMany({
      where: { sourceType: InventorySourceType.STOCK_COUNT, sourceId: draft.id },
    });
    expect(movements).toHaveLength(0);
    expect(await onHand({ locationId: loc.id, skuId: sku.id, batchId: batch.id })).toBe(7);
  });

  it('count shortage, surplus, and explicit zero each post correct adjustment movements', async () => {
    const { sku, batch } = await loadSkuBatch();
    const locShort = await createShelf(`CNT-SHT-${Date.now().toString(36).toUpperCase()}`);
    const locSurp = await createShelf(`CNT-SUR-${Date.now().toString(36).toUpperCase()}`);
    const locZero = await createShelf(`CNT-ZRO-${Date.now().toString(36).toUpperCase()}`);
    await seedSellable({ locationId: locShort.id, skuId: sku.id, batchId: batch.id, quantity: 10 });
    await seedSellable({ locationId: locSurp.id, skuId: sku.id, batchId: batch.id, quantity: 10 });
    await seedSellable({ locationId: locZero.id, skuId: sku.id, batchId: batch.id, quantity: 8 });

    const countShort = await createScopedCount(locShort.id, { skuIds: [sku.id] });
    const startedShort = await startCount(countShort.id);
    const lineShort = findLineForSku(startedShort.body.data, sku.id);
    await recordCountLine(countShort.id, lineShort.id, 8);
    await submitApprovePostCount(countShort.id);
    const movShort = await database.client.inventoryMovement.findMany({
      where: { sourceType: InventorySourceType.STOCK_COUNT, sourceId: countShort.id },
    });
    expect(movShort).toHaveLength(1);
    expect(movShort[0]?.movementType).toBe(InventoryMovementType.STOCK_COUNT_ADJUSTMENT_OUT);
    expect(movShort[0]?.quantityDelta).toBe(-2);
    expect(await onHand({ locationId: locShort.id, skuId: sku.id, batchId: batch.id })).toBe(8);

    const countSurp = await createScopedCount(locSurp.id, { skuIds: [sku.id] });
    const startedSurp = await startCount(countSurp.id);
    const lineSurp = findLineForSku(startedSurp.body.data, sku.id);
    await recordCountLine(countSurp.id, lineSurp.id, 13);
    await submitApprovePostCount(countSurp.id);
    const movSurp = await database.client.inventoryMovement.findMany({
      where: { sourceType: InventorySourceType.STOCK_COUNT, sourceId: countSurp.id },
    });
    expect(movSurp).toHaveLength(1);
    expect(movSurp[0]?.movementType).toBe(InventoryMovementType.STOCK_COUNT_ADJUSTMENT_IN);
    expect(movSurp[0]?.quantityDelta).toBe(3);
    expect(await onHand({ locationId: locSurp.id, skuId: sku.id, batchId: batch.id })).toBe(13);

    const countZero = await createScopedCount(locZero.id, { skuIds: [sku.id] });
    const startedZero = await startCount(countZero.id);
    const lineZero = findLineForSku(startedZero.body.data, sku.id);
    await recordCountLine(countZero.id, lineZero.id, 0);
    await submitApprovePostCount(countZero.id);
    const movZero = await database.client.inventoryMovement.findMany({
      where: { sourceType: InventorySourceType.STOCK_COUNT, sourceId: countZero.id },
    });
    expect(movZero).toHaveLength(1);
    expect(movZero[0]?.quantityDelta).toBe(-8);
    expect(await onHand({ locationId: locZero.id, skuId: sku.id, batchId: batch.id })).toBe(0);
  });

  it('blocks submit when a line is still uncounted (NULL ≠ 0)', async () => {
    const { sku, batch } = await loadSkuBatch();
    const locA = await createShelf(`CNT-NULL-A-${Date.now().toString(36).toUpperCase()}`);
    const locB = await createShelf(`CNT-NULL-B-${Date.now().toString(36).toUpperCase()}`);
    await seedSellable({ locationId: locA.id, skuId: sku.id, batchId: batch.id, quantity: 4 });
    await seedSellable({ locationId: locB.id, skuId: sku.id, batchId: batch.id, quantity: 4 });

    const draft = await request(app.getHttpServer())
      .post(CNT_BASE)
      .set(auth())
      .send({
        warehouseId: mainWarehouseId,
        type: StockCountType.CYCLE,
        locationIds: [locA.id, locB.id],
        skuIds: [sku.id],
      })
      .expect(201);
    createdCountIds.push(draft.body.data.id);
    const started = await startCount(draft.body.data.id);
    const lines = started.body.data.items as Array<{
      id: string;
      location: { id: string };
    }>;
    const lineA = lines.find((l) => l.location.id === locA.id);
    expect(lineA).toBeDefined();
    await recordCountLine(draft.body.data.id, lineA!.id, 4);

    const submit = await request(app.getHttpServer())
      .post(`${CNT_BASE}/${draft.body.data.id}/submit`)
      .set(auth());
    expect(submit.status).toBe(409);
    expect(submit.body.error?.code).toBe('STOCK_COUNT_UNCOUNTED_LINES');
  });

  it('supports discovered stock when allowDiscoveredItems is enabled', async () => {
    const { sku, batch } = await loadSkuBatch();
    const loc = await createShelf(`CNT-DISC-${Date.now().toString(36).toUpperCase()}`);

    const draft = await createScopedCount(loc.id, {
      skuIds: [sku.id],
      allowDiscoveredItems: true,
    });
    await startCount(draft.id);

    const add = await request(app.getHttpServer())
      .post(`${CNT_BASE}/${draft.id}/discovered-items`)
      .set(auth())
      .send({
        locationId: loc.id,
        skuId: sku.id,
        batchId: batch.id,
        classification: StockClassification.SELLABLE,
        countedQuantity: 5,
      })
      .expect(200);
    const discovered = add.body.data.items.find(
      (i: { isDiscovered: boolean }) => i.isDiscovered,
    );
    expect(discovered).toBeDefined();
    expect(discovered.countedQuantity).toBe(5);

    await submitApprovePostCount(draft.id);
    expect(await onHand({ locationId: loc.id, skuId: sku.id, batchId: batch.id })).toBe(5);
  });

  it('uses snapshot + movements during count (issue −20, count 78 → adj −2 only)', async () => {
    const { sku, batch } = await loadSkuBatch();
    const loc = await createShelf(`CNT-MOVE-${Date.now().toString(36).toUpperCase()}`);
    await seedSellable({ locationId: loc.id, skuId: sku.id, batchId: batch.id, quantity: 100 });

    const draft = await createScopedCount(loc.id, { skuIds: [sku.id] });
    const started = await startCount(draft.id);
    const line = findLineForSku(started.body.data, sku.id);
    expect(line.snapshotQuantity).toBe(100);

    const issue = await request(app.getHttpServer())
      .post(ISS_BASE)
      .set(auth())
      .send({
        warehouseId: mainWarehouseId,
        reason: StockIssueReason.SAMPLE,
        items: [
          {
            skuId: sku.id,
            batchId: batch.id,
            locationId: loc.id,
            classification: StockClassification.SELLABLE,
            quantity: 20,
          },
        ],
      })
      .expect(201);
    createdIssueIds.push(issue.body.data.id);
    await request(app.getHttpServer())
      .post(`${ISS_BASE}/${issue.body.data.id}/post`)
      .set(auth())
      .expect(200);
    expect(await onHand({ locationId: loc.id, skuId: sku.id, batchId: batch.id })).toBe(80);

    await recordCountLine(draft.id, line.id, 78);
    await submitApprovePostCount(draft.id);

    const countMovements = await database.client.inventoryMovement.findMany({
      where: {
        sourceType: InventorySourceType.STOCK_COUNT,
        sourceId: draft.id,
        movementType: {
          in: [
            InventoryMovementType.STOCK_COUNT_ADJUSTMENT_IN,
            InventoryMovementType.STOCK_COUNT_ADJUSTMENT_OUT,
          ],
        },
      },
    });
    expect(countMovements).toHaveLength(1);
    expect(countMovements[0]?.quantityDelta).toBe(-2);

    const item = await database.client.stockCountItem.findUniqueOrThrow({ where: { id: line.id } });
    expect(item.expectedQuantity).toBe(80);
    expect(item.difference).toBe(-2);
    expect(await onHand({ locationId: loc.id, skuId: sku.id, batchId: batch.id })).toBe(78);
  });

  it('count post retry is idempotent', async () => {
    const { sku, batch } = await loadSkuBatch();
    const loc = await createShelf(`CNT-IDEM-${Date.now().toString(36).toUpperCase()}`);
    await seedSellable({ locationId: loc.id, skuId: sku.id, batchId: batch.id, quantity: 6 });

    const draft = await createScopedCount(loc.id, { skuIds: [sku.id] });
    const started = await startCount(draft.id);
    const line = findLineForSku(started.body.data, sku.id);
    await recordCountLine(draft.id, line.id, 5);
    await submitApprovePostCount(draft.id);
    const retry = await request(app.getHttpServer())
      .post(`${CNT_BASE}/${draft.id}/post`)
      .set(auth())
      .expect(200);
    expect(retry.body.data.status).toBe(StockCountStatus.POSTED);
    expect(
      await database.client.inventoryMovement.count({
        where: { sourceType: InventorySourceType.STOCK_COUNT, sourceId: draft.id },
      }),
    ).toBe(1);
  });

  it('blocks cross-tenant read of adjustment and count', async () => {
    const { sku, batch } = await loadSkuBatch();
    const loc = await createShelf(`CNT-TEN-${Date.now().toString(36).toUpperCase()}`);
    await seedSellable({ locationId: loc.id, skuId: sku.id, batchId: batch.id, quantity: 1 });

    const adj = await request(app.getHttpServer())
      .post(ADJ_BASE)
      .set(auth())
      .send({
        warehouseId: mainWarehouseId,
        reason: InventoryAdjustmentReason.FOUND,
        items: [
          {
            locationId: loc.id,
            skuId: sku.id,
            batchId: batch.id,
            direction: InventoryAdjustmentDirection.IN,
            quantity: 1,
          },
        ],
      })
      .expect(201);
    createdAdjustmentIds.push(adj.body.data.id);

    const cnt = await createScopedCount(loc.id, { skuIds: [sku.id] });

    await request(app.getHttpServer())
      .get(`${ADJ_BASE}/${adj.body.data.id}`)
      .set(auth(demoBId))
      .expect(404);
    await request(app.getHttpServer())
      .get(`${CNT_BASE}/${cnt.id}`)
      .set(auth(demoBId))
      .expect(404);
  });

  it('rejects mass-assignment of status/companyId/postedAt on create and patch', async () => {
    const { sku, batch } = await loadSkuBatch();
    const loc = await createShelf(`CNT-MASS-${Date.now().toString(36).toUpperCase()}`);

    const badCreate = await request(app.getHttpServer())
      .post(ADJ_BASE)
      .set(auth())
      .send({
        warehouseId: mainWarehouseId,
        reason: InventoryAdjustmentReason.FOUND,
        status: InventoryAdjustmentStatus.POSTED,
        companyId: randomUUID(),
        postedAt: new Date().toISOString(),
      });
    expect(badCreate.status).toBe(400);

    const adj = await request(app.getHttpServer())
      .post(ADJ_BASE)
      .set(auth())
      .send({
        warehouseId: mainWarehouseId,
        reason: InventoryAdjustmentReason.FOUND,
        items: [
          {
            locationId: loc.id,
            skuId: sku.id,
            batchId: batch.id,
            direction: InventoryAdjustmentDirection.IN,
            quantity: 1,
          },
        ],
      })
      .expect(201);
    createdAdjustmentIds.push(adj.body.data.id);

    const badPatchAdj = await request(app.getHttpServer())
      .patch(`${ADJ_BASE}/${adj.body.data.id}`)
      .set(auth())
      .send({ status: InventoryAdjustmentStatus.POSTED, postedAt: new Date().toISOString() });
    expect(badPatchAdj.status).toBe(400);

    const cnt = await createScopedCount(loc.id, { skuIds: [sku.id] });
    const badPatchCnt = await request(app.getHttpServer())
      .patch(`${CNT_BASE}/${cnt.id}`)
      .set(auth())
      .send({ status: StockCountStatus.POSTED, companyId: randomUUID() });
    expect(badPatchCnt.status).toBe(400);
  });

  it('posted adjustment and count cannot be patched', async () => {
    const { sku, batch } = await loadSkuBatch();
    const loc = await createShelf(`CNT-IMM-${Date.now().toString(36).toUpperCase()}`);
    await seedSellable({ locationId: loc.id, skuId: sku.id, batchId: batch.id, quantity: 5 });

    const adj = await request(app.getHttpServer())
      .post(ADJ_BASE)
      .set(auth())
      .send({
        warehouseId: mainWarehouseId,
        reason: InventoryAdjustmentReason.FOUND,
        items: [
          {
            locationId: loc.id,
            skuId: sku.id,
            batchId: batch.id,
            direction: InventoryAdjustmentDirection.IN,
            quantity: 1,
          },
        ],
      })
      .expect(201);
    createdAdjustmentIds.push(adj.body.data.id);
    await submitApprovePostAdjustment(adj.body.data.id);

    const patchAdj = await request(app.getHttpServer())
      .patch(`${ADJ_BASE}/${adj.body.data.id}`)
      .set(auth())
      .send({ notes: 'should fail' });
    expect(patchAdj.status).toBe(409);
    expect(patchAdj.body.error?.code).toBe('INVENTORY_ADJUSTMENT_NOT_EDITABLE');

    const cnt = await createScopedCount(loc.id, { skuIds: [sku.id] });
    const started = await startCount(cnt.id);
    const line = findLineForSku(started.body.data, sku.id);
    await recordCountLine(cnt.id, line.id, 5);
    await submitApprovePostCount(cnt.id);

    const patchCnt = await request(app.getHttpServer())
      .patch(`${CNT_BASE}/${cnt.id}`)
      .set(auth())
      .send({ notes: 'nope' });
    expect(patchCnt.status).toBe(409);
    expect(patchCnt.body.error?.code).toBe('STOCK_COUNT_NOT_EDITABLE');
  });
});
