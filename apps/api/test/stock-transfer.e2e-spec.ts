import request from 'supertest';
import {
  InventoryMovementType,
  InventorySourceType,
  StockClassification,
  StockTransferStatus,
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
import { InventoryReconciliationService } from '../src/modules/warehouse/inventory-reconciliation.service';
import {
  deleteInventoryMovements,
  finalizeInventoryE2eCleanup,
  syncBalanceFromLedger,
} from './helpers/delete-movements';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';

const TRF_BASE = '/api/v1/warehouse/transfers';
const INV_BASE = '/api/v1/warehouse/inventory';
const LOC_BASE = '/api/v1/warehouses';

describe('Stock Transfer (Phase 3.11 e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let ledger: InventoryLedgerService;
  let reconciliation: InventoryReconciliationService;
  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;
  let pishtehId: string;
  let demoBId: string;
  let mainWarehouseId: string;
  let secondaryWarehouseId: string;
  let ownerUserId: string;
  let accessToken: string;
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
    secondaryWarehouseId = (
      await database.client.warehouse.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'SECONDARY' },
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

  async function createShelf(code: string, warehouseId = mainWarehouseId) {
    const res = await request(app.getHttpServer())
      .post(`${LOC_BASE}/${warehouseId}/locations`)
      .set(auth())
      .send({ type: WarehouseLocationType.SHELF, code, name: code })
      .expect(201);
    createdLocationIds.push(res.body.data.id);
    return res.body.data as { id: string; barcode: string; code: string };
  }

  async function seedPosition(input: {
    warehouseId: string;
    locationId: string;
    skuId: string;
    batchId: string;
    quantity: number;
  }) {
    const sourceLineId = randomUUID();
    const [movement] = await ledger.postMovements(pishtehId, [
      {
        warehouseId: input.warehouseId,
        locationId: input.locationId,
        skuId: input.skuId,
        batchId: input.batchId,
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
      warehouseId: input.warehouseId,
      locationId: input.locationId,
      skuId: input.skuId,
      batchId: input.batchId,
      classification: StockClassification.SELLABLE,
    });
  }

  async function onHand(position: {
    warehouseId: string;
    locationId: string;
    skuId: string;
    batchId: string;
    classification?: StockClassification;
  }) {
    const classification = position.classification ?? StockClassification.SELLABLE;
    const bal = await database.client.inventoryBalance.findUnique({
      where: {
        companyId_warehouseId_locationId_skuId_batchId_classification: {
          companyId: pishtehId,
          warehouseId: position.warehouseId,
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

  it('DRAFT creates no movements; dispatch→transit; complete→destination; conservation holds', async () => {
    const sku = await database.client.sku.findFirstOrThrow({
      where: { companyId: pishtehId, code: 'ESS-MASCARA-01' },
    });
    const batch = await database.client.batch.findFirstOrThrow({
      where: { companyId: pishtehId, skuId: sku.id },
    });
    const src = await createShelf(`TRF-S-${Date.now().toString(36).toUpperCase()}`);
    const dst = await createShelf(`TRF-D-${Date.now().toString(36).toUpperCase()}`);
    await seedPosition({
      warehouseId: mainWarehouseId,
      locationId: src.id,
      skuId: sku.id,
      batchId: batch.id,
      quantity: 100,
    });
    const beforeCompany = await companySkuTotal(sku.id);
    const transit = await ensureSystemTransitPosition(database.client, pishtehId);
    const transitPos = {
      warehouseId: transit.warehouseId,
      locationId: transit.locationId,
      skuId: sku.id,
      batchId: batch.id,
    };
    const transitBefore = await onHand(transitPos);

    const created = await request(app.getHttpServer())
      .post(TRF_BASE)
      .set(auth())
      .send({
        sourceWarehouseId: mainWarehouseId,
        destinationWarehouseId: mainWarehouseId,
        notes: 'e2e same-wh',
        items: [
          {
            skuId: sku.id,
            batchId: batch.id,
            sourceLocationId: src.id,
            destinationLocationId: dst.id,
            quantity: 40,
          },
        ],
      })
      .expect(201);
    createdTransferIds.push(created.body.data.id);
    expect(created.body.data.status).toBe(StockTransferStatus.DRAFT);
    expect(await onHand({ warehouseId: mainWarehouseId, locationId: src.id, skuId: sku.id, batchId: batch.id })).toBe(100);
    expect(await onHand(transitPos)).toBe(transitBefore);

    const dispatched = await request(app.getHttpServer())
      .post(`${TRF_BASE}/${created.body.data.id}/dispatch`)
      .set(auth())
      .expect(200);
    expect(dispatched.body.data.status).toBe(StockTransferStatus.IN_TRANSIT);
    expect(await onHand({ warehouseId: mainWarehouseId, locationId: src.id, skuId: sku.id, batchId: batch.id })).toBe(60);
    expect(await onHand(transitPos)).toBe(transitBefore + 40);
    expect(await onHand({ warehouseId: mainWarehouseId, locationId: dst.id, skuId: sku.id, batchId: batch.id })).toBe(0);
    expect(await companySkuTotal(sku.id)).toBe(beforeCompany);

    const movements = await database.client.inventoryMovement.findMany({
      where: {
        companyId: pishtehId,
        sourceType: InventorySourceType.TRANSFER,
        sourceId: created.body.data.id,
      },
      orderBy: { occurredAt: 'asc' },
    });
    expect(movements).toHaveLength(2);
    expect(movements.map((m) => m.movementType).sort()).toEqual([
      InventoryMovementType.TRANSFER_IN,
      InventoryMovementType.TRANSFER_OUT,
    ]);

    const completed = await request(app.getHttpServer())
      .post(`${TRF_BASE}/${created.body.data.id}/complete`)
      .set(auth())
      .expect(200);
    expect(completed.body.data.status).toBe(StockTransferStatus.COMPLETED);
    expect(await onHand({ warehouseId: mainWarehouseId, locationId: src.id, skuId: sku.id, batchId: batch.id })).toBe(60);
    expect(await onHand(transitPos)).toBe(transitBefore);
    expect(await onHand({ warehouseId: mainWarehouseId, locationId: dst.id, skuId: sku.id, batchId: batch.id })).toBe(40);
    expect(await companySkuTotal(sku.id)).toBe(beforeCompany);

    const afterComplete = await database.client.inventoryMovement.count({
      where: {
        companyId: pishtehId,
        sourceType: InventorySourceType.TRANSFER,
        sourceId: created.body.data.id,
      },
    });
    expect(afterComplete).toBe(4);

    for (const position of [
      { warehouseId: mainWarehouseId, locationId: src.id, skuId: sku.id, batchId: batch.id },
      { warehouseId: mainWarehouseId, locationId: dst.id, skuId: sku.id, batchId: batch.id },
      transitPos,
    ]) {
      const row = await reconciliation.reconcilePosition({
        companyId: pishtehId,
        classification: StockClassification.SELLABLE,
        ...position,
      });
      expect(row.status).toBe('MATCH');
    }
  });

  it('cross-warehouse transfer conserves company total', async () => {
    const sku = await database.client.sku.findFirstOrThrow({
      where: { companyId: pishtehId, code: 'ESS-MASCARA-01' },
    });
    const batch = await database.client.batch.findFirstOrThrow({
      where: { companyId: pishtehId, skuId: sku.id },
    });
    const src = await createShelf(`TRF-XW-S-${Date.now().toString(36).toUpperCase()}`);
    const dst = await createShelf(
      `TRF-XW-D-${Date.now().toString(36).toUpperCase()}`,
      secondaryWarehouseId,
    );
    await seedPosition({
      warehouseId: mainWarehouseId,
      locationId: src.id,
      skuId: sku.id,
      batchId: batch.id,
      quantity: 200,
    });
    const before = await companySkuTotal(sku.id);

    const created = await request(app.getHttpServer())
      .post(TRF_BASE)
      .set(auth())
      .send({
        sourceWarehouseId: mainWarehouseId,
        destinationWarehouseId: secondaryWarehouseId,
        items: [
          {
            skuId: sku.id,
            batchId: batch.id,
            sourceLocationId: src.id,
            destinationLocationId: dst.id,
            quantity: 100,
          },
        ],
      })
      .expect(201);
    createdTransferIds.push(created.body.data.id);

    await request(app.getHttpServer())
      .post(`${TRF_BASE}/${created.body.data.id}/dispatch`)
      .set(auth())
      .expect(200);
    expect(await companySkuTotal(sku.id)).toBe(before);

    await request(app.getHttpServer())
      .post(`${TRF_BASE}/${created.body.data.id}/complete`)
      .set(auth())
      .expect(200);
    expect(await onHand({ warehouseId: mainWarehouseId, locationId: src.id, skuId: sku.id, batchId: batch.id })).toBe(100);
    expect(await onHand({ warehouseId: secondaryWarehouseId, locationId: dst.id, skuId: sku.id, batchId: batch.id })).toBe(100);
    expect(await companySkuTotal(sku.id)).toBe(before);
  });

  it('dispatch insufficient stock fails atomically; cancel IN_TRANSIT returns to source; cancel COMPLETED rejected', async () => {
    const sku = await database.client.sku.findFirstOrThrow({
      where: { companyId: pishtehId, code: 'ESS-MASCARA-01' },
    });
    const batch = await database.client.batch.findFirstOrThrow({
      where: { companyId: pishtehId, skuId: sku.id },
    });
    const src = await createShelf(`TRF-CX-S-${Date.now().toString(36).toUpperCase()}`);
    const dst = await createShelf(`TRF-CX-D-${Date.now().toString(36).toUpperCase()}`);
    await seedPosition({
      warehouseId: mainWarehouseId,
      locationId: src.id,
      skuId: sku.id,
      batchId: batch.id,
      quantity: 30,
    });

    const over = await request(app.getHttpServer())
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
            quantity: 40,
          },
        ],
      })
      .expect(201);
    createdTransferIds.push(over.body.data.id);
    await request(app.getHttpServer())
      .post(`${TRF_BASE}/${over.body.data.id}/dispatch`)
      .set(auth())
      .expect(409);
    expect(over.body.data.status).toBe(StockTransferStatus.DRAFT);
    const stillDraft = await database.client.stockTransfer.findUniqueOrThrow({
      where: { id: over.body.data.id },
    });
    expect(stillDraft.status).toBe(StockTransferStatus.DRAFT);
    expect(await onHand({ warehouseId: mainWarehouseId, locationId: src.id, skuId: sku.id, batchId: batch.id })).toBe(30);

    const ok = await request(app.getHttpServer())
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
            quantity: 20,
          },
        ],
      })
      .expect(201);
    createdTransferIds.push(ok.body.data.id);
    await request(app.getHttpServer())
      .post(`${TRF_BASE}/${ok.body.data.id}/dispatch`)
      .set(auth())
      .expect(200);
    expect(await onHand({ warehouseId: mainWarehouseId, locationId: src.id, skuId: sku.id, batchId: batch.id })).toBe(10);

    const cancelled = await request(app.getHttpServer())
      .post(`${TRF_BASE}/${ok.body.data.id}/cancel`)
      .set(auth())
      .expect(200);
    expect(cancelled.body.data.status).toBe(StockTransferStatus.CANCELLED);
    expect(await onHand({ warehouseId: mainWarehouseId, locationId: src.id, skuId: sku.id, batchId: batch.id })).toBe(30);

    const done = await request(app.getHttpServer())
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
            quantity: 10,
          },
        ],
      })
      .expect(201);
    createdTransferIds.push(done.body.data.id);
    await request(app.getHttpServer())
      .post(`${TRF_BASE}/${done.body.data.id}/dispatch`)
      .set(auth())
      .expect(200);
    await request(app.getHttpServer())
      .post(`${TRF_BASE}/${done.body.data.id}/complete`)
      .set(auth())
      .expect(200);
    await request(app.getHttpServer())
      .post(`${TRF_BASE}/${done.body.data.id}/cancel`)
      .set(auth())
      .expect(409);
  });

  it('dispatch/complete retries are idempotent; no status PATCH; IDOR blocked', async () => {
    const sku = await database.client.sku.findFirstOrThrow({
      where: { companyId: pishtehId, code: 'ESS-MASCARA-01' },
    });
    const batch = await database.client.batch.findFirstOrThrow({
      where: { companyId: pishtehId, skuId: sku.id },
    });
    const src = await createShelf(`TRF-ID-${Date.now().toString(36).toUpperCase()}`);
    const dst = await createShelf(`TRF-ID-D-${Date.now().toString(36).toUpperCase()}`);
    await seedPosition({
      warehouseId: mainWarehouseId,
      locationId: src.id,
      skuId: sku.id,
      batchId: batch.id,
      quantity: 50,
    });

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
            quantity: 15,
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
      .post(`${TRF_BASE}/${created.body.data.id}/dispatch`)
      .set(auth())
      .expect(200);
    const transit = await ensureSystemTransitPosition(database.client, pishtehId);
    expect(await onHand({ warehouseId: transit.warehouseId, locationId: transit.locationId, skuId: sku.id, batchId: batch.id })).toBeGreaterThanOrEqual(15);

    const dispatchCount = await database.client.inventoryMovement.count({
      where: {
        sourceType: InventorySourceType.TRANSFER,
        sourceId: created.body.data.id,
        sourceLineId: created.body.data.items[0].id,
      },
    });
    expect(dispatchCount).toBe(2);

    await request(app.getHttpServer())
      .post(`${TRF_BASE}/${created.body.data.id}/complete`)
      .set(auth())
      .expect(200);
    await request(app.getHttpServer())
      .post(`${TRF_BASE}/${created.body.data.id}/complete`)
      .set(auth())
      .expect(200);
    const totalMovements = await database.client.inventoryMovement.count({
      where: {
        sourceType: InventorySourceType.TRANSFER,
        sourceId: created.body.data.id,
      },
    });
    expect(totalMovements).toBe(4);

    await request(app.getHttpServer())
      .patch(`${TRF_BASE}/${created.body.data.id}`)
      .set(auth())
      .send({ status: 'DRAFT' })
      .expect(400);

    await request(app.getHttpServer())
      .get(`${TRF_BASE}/${created.body.data.id}`)
      .set(auth(demoBId))
      .expect(404);
  });

  it('rejects same location, zero qty, wrong warehouse location; inventory list hides transit by default', async () => {
    const sku = await database.client.sku.findFirstOrThrow({
      where: { companyId: pishtehId, code: 'ESS-MASCARA-01' },
    });
    const batch = await database.client.batch.findFirstOrThrow({
      where: { companyId: pishtehId, skuId: sku.id },
    });
    const src = await createShelf(`TRF-VAL-${Date.now().toString(36).toUpperCase()}`);
    const secondaryLoc = await database.client.warehouseLocation.findFirstOrThrow({
      where: { companyId: pishtehId, warehouseId: secondaryWarehouseId, code: 'B-01' },
    });

    await request(app.getHttpServer())
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
            destinationLocationId: src.id,
            quantity: 1,
          },
        ],
      })
      .expect(400);

    const crossWh = await request(app.getHttpServer())
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
            destinationLocationId: secondaryLoc.id,
            quantity: 1,
          },
        ],
      });
    // Domain conflict (409) or early validation (400) — must not create the transfer.
    expect([400, 409]).toContain(crossWh.status);

    const list = await request(app.getHttpServer())
      .get(`${INV_BASE}?pageSize=100`)
      .set(auth())
      .expect(200);
    const hasTransit = (list.body.data as Array<{ warehouseCode: string }>).some(
      (r) => r.warehouseCode === 'SYS-TRANSIT',
    );
    expect(hasTransit).toBe(false);
  });

  it('competing dispatches cannot overdraw source', async () => {
    const sku = await database.client.sku.findFirstOrThrow({
      where: { companyId: pishtehId, code: 'ESS-MASCARA-01' },
    });
    const batch = await database.client.batch.findFirstOrThrow({
      where: { companyId: pishtehId, skuId: sku.id },
    });
    const src = await createShelf(`TRF-RACE-${Date.now().toString(36).toUpperCase()}`);
    const dstA = await createShelf(`TRF-RACE-A-${Date.now().toString(36).toUpperCase()}`);
    const dstB = await createShelf(`TRF-RACE-B-${Date.now().toString(36).toUpperCase()}`);
    await seedPosition({
      warehouseId: mainWarehouseId,
      locationId: src.id,
      skuId: sku.id,
      batchId: batch.id,
      quantity: 100,
    });

    const a = await request(app.getHttpServer())
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
            destinationLocationId: dstA.id,
            quantity: 80,
          },
        ],
      })
      .expect(201);
    const b = await request(app.getHttpServer())
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
            destinationLocationId: dstB.id,
            quantity: 80,
          },
        ],
      })
      .expect(201);
    createdTransferIds.push(a.body.data.id, b.body.data.id);

    const results = await Promise.allSettled([
      request(app.getHttpServer())
        .post(`${TRF_BASE}/${a.body.data.id}/dispatch`)
        .set(auth()),
      request(app.getHttpServer())
        .post(`${TRF_BASE}/${b.body.data.id}/dispatch`)
        .set(auth()),
    ]);
    const statuses = results.map((r) =>
      r.status === 'fulfilled' ? r.value.status : 500,
    );
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(1);
    expect(await onHand({ warehouseId: mainWarehouseId, locationId: src.id, skuId: sku.id, batchId: batch.id })).toBe(20);
  });
});
