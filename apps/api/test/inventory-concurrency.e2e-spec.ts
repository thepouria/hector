import request from 'supertest';
import {
  InventoryMovementType,
  InventorySourceType,
  StockClassification,
  StockIssueReason,
  UserStatus,
  WarehouseLocationType,
  ensureSystemTransitPosition,
  syncOwnerRolePermissions,
  syncPermissions,
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
const ISS_BASE = '/api/v1/warehouse/issues';
const CLS_BASE = '/api/v1/warehouse/stock';
const LOC_BASE = '/api/v1/warehouses';

/**
 * P.1.1 — real parallel HTTP concurrency against inventory locks.
 * Negative sellable stock must remain impossible under contention.
 */
describe('Inventory concurrency (P.1.1 e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let ledger: InventoryLedgerService;
  let reconciliation: InventoryReconciliationService;
  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;
  let pishtehId: string;
  let mainWarehouseId: string;
  let ownerUserId: string;
  let accessToken: string;
  const createdTransferIds: string[] = [];
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
    reconciliation = app.get(InventoryReconciliationService);
    await syncPermissions(database.client);
    await syncOwnerRolePermissions(database.client);

    pishtehId = (
      await database.client.company.findUniqueOrThrow({ where: { slug: 'pishteh' } })
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
      await deleteInventoryMovements(database, {
        sourceType: InventorySourceType.STOCK_ISSUE,
        sourceId: { in: createdIssueIds },
      });
      await database.client.stockIssueItem.deleteMany({
        where: { stockIssueId: { in: createdIssueIds } },
      });
      await database.client.stockIssue.deleteMany({
        where: { id: { in: createdIssueIds } },
      });
    }
    if (createdChangeIds.length > 0) {
      await deleteInventoryMovements(database, {
        sourceType: InventorySourceType.CLASSIFICATION_CHANGE,
        sourceId: { in: createdChangeIds },
      });
      await database.client.stockClassificationChange.deleteMany({
        where: { id: { in: createdChangeIds } },
      });
    }
    if (createdTransferIds.length > 0) {
      await deleteInventoryMovements(database, {
        sourceType: InventorySourceType.TRANSFER,
        sourceId: { in: createdTransferIds },
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

  function auth() {
    return {
      Authorization: `Bearer ${accessToken}`,
      'X-Company-Id': pishtehId,
    };
  }

  async function createShelf(code: string) {
    const res = await request(app.getHttpServer())
      .post(`${LOC_BASE}/${mainWarehouseId}/locations`)
      .set(auth())
      .send({ type: WarehouseLocationType.SHELF, code, name: code })
      .expect(201);
    createdLocationIds.push(res.body.data.id);
    return res.body.data as { id: string };
  }

  async function seedSellable(input: {
    locationId: string;
    skuId: string;
    batchId: string;
    quantity: number;
  }) {
    const [movement] = await ledger.postMovements(pishtehId, [
      {
        warehouseId: mainWarehouseId,
        locationId: input.locationId,
        skuId: input.skuId,
        batchId: input.batchId,
        movementType: InventoryMovementType.RECEIVE,
        quantityDelta: input.quantity,
        sourceType: InventorySourceType.SEED,
        sourceId: randomUUID(),
        sourceLineId: randomUUID(),
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

  async function loadSkuBatch() {
    const sku = await database.client.sku.findFirstOrThrow({
      where: { companyId: pishtehId, code: 'ESS-MASCARA-01' },
    });
    const batch = await database.client.batch.findFirstOrThrow({
      where: { companyId: pishtehId, skuId: sku.id },
    });
    return { sku, batch };
  }

  async function onHand(locationId: string, skuId: string, batchId: string) {
    const bal = await database.client.inventoryBalance.findUnique({
      where: {
        companyId_warehouseId_locationId_skuId_batchId_classification: {
          companyId: pishtehId,
          warehouseId: mainWarehouseId,
          locationId,
          skuId,
          batchId,
          classification: StockClassification.SELLABLE,
        },
      },
    });
    return bal?.onHandQuantity ?? 0;
  }

  it('concurrent issues 8+8 on qty 10: at most one full success; never negative', async () => {
    const { sku, batch } = await loadSkuBatch();
    const loc = await createShelf(`CX-ISS-${Date.now().toString(36).toUpperCase()}`);
    await seedSellable({ locationId: loc.id, skuId: sku.id, batchId: batch.id, quantity: 10 });

    const drafts = await Promise.all(
      [0, 1].map(async () => {
        const created = await request(app.getHttpServer())
          .post(ISS_BASE)
          .set(auth())
          .send({
            warehouseId: mainWarehouseId,
            reason: StockIssueReason.SAMPLE,
            items: [
              {
                locationId: loc.id,
                skuId: sku.id,
                batchId: batch.id,
                quantity: 8,
              },
            ],
          })
          .expect(201);
        createdIssueIds.push(created.body.data.id);
        return created.body.data.id as string;
      }),
    );

    const results = await Promise.all(
      drafts.map((id) =>
        request(app.getHttpServer()).post(`${ISS_BASE}/${id}/post`).set(auth()),
      ),
    );

    const successes = results.filter((r) => r.status === 200);
    const failures = results.filter((r) => r.status >= 400);
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    expect(await onHand(loc.id, sku.id, batch.id)).toBe(2);
    expect(await onHand(loc.id, sku.id, batch.id)).toBeGreaterThanOrEqual(0);

    const row = await reconciliation.reconcilePosition({
      companyId: pishtehId,
      warehouseId: mainWarehouseId,
      locationId: loc.id,
      skuId: sku.id,
      batchId: batch.id,
      classification: StockClassification.SELLABLE,
    });
    expect(row.status).toBe('MATCH');
  });

  it('concurrent transfers 8+8 on qty 10: one dispatch succeeds; conservation holds', async () => {
    const { sku, batch } = await loadSkuBatch();
    const src = await createShelf(`CX-TRF-S-${Date.now().toString(36).toUpperCase()}`);
    const dstA = await createShelf(`CX-TRF-A-${Date.now().toString(36).toUpperCase()}`);
    const dstB = await createShelf(`CX-TRF-B-${Date.now().toString(36).toUpperCase()}`);
    await seedSellable({ locationId: src.id, skuId: sku.id, batchId: batch.id, quantity: 10 });
    const before = await onHand(src.id, sku.id, batch.id);

    const drafts = await Promise.all(
      [
        { dst: dstA, q: 8 },
        { dst: dstB, q: 8 },
      ].map(async ({ dst, q }) => {
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
                quantity: q,
              },
            ],
          })
          .expect(201);
        createdTransferIds.push(created.body.data.id);
        return created.body.data.id as string;
      }),
    );

    const results = await Promise.all(
      drafts.map((id) =>
        request(app.getHttpServer()).post(`${TRF_BASE}/${id}/dispatch`).set(auth()),
      ),
    );
    const ok = results.filter((r) => r.status === 200);
    const fail = results.filter((r) => r.status >= 400);
    expect(ok.length).toBe(1);
    expect(fail.length).toBe(1);
    expect(await onHand(src.id, sku.id, batch.id)).toBe(before - 8);

    const winnerId = drafts[results.findIndex((r) => r.status === 200)]!;
    await request(app.getHttpServer())
      .post(`${TRF_BASE}/${winnerId}/complete`)
      .set(auth())
      .expect(200);

    expect(await onHand(src.id, sku.id, batch.id)).toBe(2);
    const destTotal =
      (await onHand(dstA.id, sku.id, batch.id)) + (await onHand(dstB.id, sku.id, batch.id));
    expect(destTotal).toBe(8);
  });

  it('concurrent transfer+issue on qty 10: combined success ≤ 10; never negative', async () => {
    const { sku, batch } = await loadSkuBatch();
    const src = await createShelf(`CX-MIX-S-${Date.now().toString(36).toUpperCase()}`);
    const dst = await createShelf(`CX-MIX-D-${Date.now().toString(36).toUpperCase()}`);
    await seedSellable({ locationId: src.id, skuId: sku.id, batchId: batch.id, quantity: 10 });

    const transfer = await request(app.getHttpServer())
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
            quantity: 8,
          },
        ],
      })
      .expect(201);
    createdTransferIds.push(transfer.body.data.id);

    const issue = await request(app.getHttpServer())
      .post(ISS_BASE)
      .set(auth())
      .send({
        warehouseId: mainWarehouseId,
        reason: StockIssueReason.SAMPLE,
        items: [
          {
            locationId: src.id,
            skuId: sku.id,
            batchId: batch.id,
            quantity: 8,
          },
        ],
      })
      .expect(201);
    createdIssueIds.push(issue.body.data.id);

    const [tr, iss] = await Promise.all([
      request(app.getHttpServer())
        .post(`${TRF_BASE}/${transfer.body.data.id}/dispatch`)
        .set(auth()),
      request(app.getHttpServer()).post(`${ISS_BASE}/${issue.body.data.id}/post`).set(auth()),
    ]);

    const successCount = [tr, iss].filter((r) => r.status === 200).length;
    expect(successCount).toBe(1);
    expect(await onHand(src.id, sku.id, batch.id)).toBeGreaterThanOrEqual(0);
    expect(await onHand(src.id, sku.id, batch.id)).toBeLessThanOrEqual(2);

    if (tr.status === 200) {
      await request(app.getHttpServer())
        .post(`${TRF_BASE}/${transfer.body.data.id}/complete`)
        .set(auth())
        .expect(200);
    }
  });

  it('concurrent reclassify 8→TESTER and 8→DAMAGED on qty 10: one wins', async () => {
    const { sku, batch } = await loadSkuBatch();
    const loc = await createShelf(`CX-CLS-${Date.now().toString(36).toUpperCase()}`);
    await seedSellable({ locationId: loc.id, skuId: sku.id, batchId: batch.id, quantity: 10 });

    const [a, b] = await Promise.all([
      request(app.getHttpServer())
        .post(`${CLS_BASE}/classification-change`)
        .set(auth())
        .send({
          warehouseId: mainWarehouseId,
          locationId: loc.id,
          skuId: sku.id,
          batchId: batch.id,
          fromClassification: StockClassification.SELLABLE,
          toClassification: StockClassification.TESTER,
          quantity: 8,
        }),
      request(app.getHttpServer())
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
        }),
    ]);

    for (const res of [a, b]) {
      if (res.status === 201) createdChangeIds.push(res.body.data.id);
    }
    const ok = [a, b].filter((r) => r.status === 201);
    const fail = [a, b].filter((r) => r.status >= 400);
    expect(ok.length).toBe(1);
    expect(fail.length).toBe(1);
    expect(await onHand(loc.id, sku.id, batch.id)).toBe(2);

    touchedBalanceKeys.push(
      {
        warehouseId: mainWarehouseId,
        locationId: loc.id,
        skuId: sku.id,
        batchId: batch.id,
        classification: StockClassification.TESTER,
      },
      {
        warehouseId: mainWarehouseId,
        locationId: loc.id,
        skuId: sku.id,
        batchId: batch.id,
        classification: StockClassification.DAMAGED,
      },
    );
  });
});
