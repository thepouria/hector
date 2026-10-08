import request from 'supertest';
import {
  InventoryCostLayerSourceType,
  InventoryMovementType,
  InventorySourceType,
  InventoryValuationStatus,
  Prisma,
  StockClassification,
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
const LOC_BASE = '/api/v1/warehouses';

/**
 * P.1.1 — multi-layer FIFO issue + transfer cost conservation.
 */
describe('Inventory FIFO transfer / issue (P.1.1 e2e)', () => {
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
  const createdLocationIds: string[] = [];
  const createdMovementIds: string[] = [];
  const createdSkuIds: string[] = [];
  const createdBatchIds: string[] = [];
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
    if (createdSkuIds.length > 0) {
      await deleteInventoryMovements(database, { skuId: { in: createdSkuIds } });
      await database.client.inventoryAvailabilityLock.deleteMany({
        where: { skuId: { in: createdSkuIds } },
      });
      await database.client.inventoryReservation.deleteMany({
        where: { skuId: { in: createdSkuIds } },
      });
      await database.client.inventoryCostLayer.deleteMany({
        where: { skuId: { in: createdSkuIds } },
      });
      await database.client.inventoryBalance.deleteMany({
        where: { skuId: { in: createdSkuIds } },
      });
    }
    if (createdBatchIds.length > 0) {
      await database.client.batch.deleteMany({ where: { id: { in: createdBatchIds } } });
    }
    if (createdSkuIds.length > 0) {
      await database.client.sku.deleteMany({ where: { id: { in: createdSkuIds } } });
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

  async function createIsolatedSkuBatch(prefix: string) {
    const product = await database.client.product.findFirstOrThrow({
      where: { companyId: pishtehId },
      select: { id: true },
    });
    const code = `${prefix}-${Date.now().toString(36).toUpperCase()}`;
    const sku = await database.client.sku.create({
      data: {
        companyId: pishtehId,
        productId: product.id,
        code,
        normalizedCode: code,
        name: `FIFO ${prefix}`,
        variantSignature: `SIMPLE-${code}`,
        status: 'ACTIVE',
      },
    });
    createdSkuIds.push(sku.id);
    const batchNumber = `BAT-${code}`;
    const batch = await database.client.batch.create({
      data: {
        companyId: pishtehId,
        skuId: sku.id,
        batchNumber,
      },
    });
    createdBatchIds.push(batch.id);
    return { sku, batch };
  }

  /**
   * Physical RECEIVE via ledger, then rewrite the resulting SEED layer into a valued
   * layer with explicit receivedAt (test fixture — production uses putaway/PO cost).
   */
  async function seedValuedReceive(input: {
    locationId: string;
    skuId: string;
    batchId: string;
    quantity: number;
    unitCost: string;
    receivedAt: Date;
  }) {
    const sourceLineId = randomUUID();
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
        sourceLineId,
        actorUserId: ownerUserId,
        occurredAt: input.receivedAt,
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

    await database.client.inventoryCostLayer.updateMany({
      where: {
        companyId: pishtehId,
        sourceType: InventoryCostLayerSourceType.SEED,
        sourceLineId,
      },
      data: {
        receivedAt: input.receivedAt,
        valuationStatus: InventoryValuationStatus.VALUED,
        originalCurrency: 'IRR',
        originalUnitAmount: new Prisma.Decimal(input.unitCost),
        baseCurrencyUnitCost: new Prisma.Decimal(input.unitCost),
      },
    });
  }

  async function layerEquationOk(skuId: string) {
    const bad = await database.client.$queryRaw<Array<{ id: string }>>`
      SELECT l.id::text AS id
      FROM inventory_cost_layers l
      WHERE l.company_id = ${pishtehId}::uuid
        AND l.sku_id = ${skuId}::uuid
        AND l.remaining_quantity + COALESCE((
          SELECT SUM(c.quantity) FROM inventory_layer_consumptions c WHERE c.cost_layer_id = l.id
        ), 0) <> l.original_quantity`;
    return bad.length === 0;
  }

  it('multi-layer FIFO issue consumes 100@500k then 20@550k; equation holds', async () => {
    const { sku, batch } = await createIsolatedSkuBatch('ISS');
    const loc = await createShelf(`FIFO-ISS-${Date.now().toString(36).toUpperCase()}`);
    await seedValuedReceive({
      locationId: loc.id,
      skuId: sku.id,
      batchId: batch.id,
      quantity: 100,
      unitCost: '500000',
      receivedAt: new Date('2020-01-01T00:00:00.000Z'),
    });
    await seedValuedReceive({
      locationId: loc.id,
      skuId: sku.id,
      batchId: batch.id,
      quantity: 200,
      unitCost: '550000',
      receivedAt: new Date('2020-02-01T00:00:00.000Z'),
    });

    const created = await request(app.getHttpServer())
      .post(ISS_BASE)
      .set(auth())
      .send({
        warehouseId: mainWarehouseId,
        reason: 'SAMPLE',
        items: [
          {
            locationId: loc.id,
            skuId: sku.id,
            batchId: batch.id,
            quantity: 120,
          },
        ],
      })
      .expect(201);
    createdIssueIds.push(created.body.data.id);
    await request(app.getHttpServer())
      .post(`${ISS_BASE}/${created.body.data.id}/post`)
      .set(auth())
      .expect(200);

    const layers = await database.client.inventoryCostLayer.findMany({
      where: {
        companyId: pishtehId,
        skuId: sku.id,
        sourceType: InventoryCostLayerSourceType.SEED,
      },
      orderBy: { receivedAt: 'asc' },
    });
    expect(layers).toHaveLength(2);
    expect(layers[0]!.remainingQuantity).toBe(0);
    expect(layers[1]!.remainingQuantity).toBe(180);
    expect(await layerEquationOk(sku.id)).toBe(true);

    const row = await reconciliation.reconcilePosition({
      companyId: pishtehId,
      warehouseId: mainWarehouseId,
      locationId: loc.id,
      skuId: sku.id,
      batchId: batch.id,
      classification: StockClassification.SELLABLE,
    });
    expect(row.status).toBe('MATCH');
    expect(row.balanceQuantity).toBe(180);
  });

  it('multi-layer FIFO transfer 150 preserves company valuation', async () => {
    const { sku, batch } = await createIsolatedSkuBatch('TRF');
    const src = await createShelf(`FIFO-TRF-S-${Date.now().toString(36).toUpperCase()}`);
    const dst = await createShelf(`FIFO-TRF-D-${Date.now().toString(36).toUpperCase()}`);
    await seedValuedReceive({
      locationId: src.id,
      skuId: sku.id,
      batchId: batch.id,
      quantity: 100,
      unitCost: '500000',
      receivedAt: new Date('2021-01-01T00:00:00.000Z'),
    });
    await seedValuedReceive({
      locationId: src.id,
      skuId: sku.id,
      batchId: batch.id,
      quantity: 100,
      unitCost: '550000',
      receivedAt: new Date('2021-02-01T00:00:00.000Z'),
    });

    const beforeLayers = await database.client.inventoryCostLayer.findMany({
      where: { companyId: pishtehId, skuId: sku.id, remainingQuantity: { gt: 0 } },
    });
    const beforeValue = beforeLayers.reduce(
      (s, l) =>
        s.add((l.baseCurrencyUnitCost ?? new Prisma.Decimal(0)).mul(l.remainingQuantity)),
      new Prisma.Decimal(0),
    );

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
            quantity: 150,
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

    expect(await layerEquationOk(sku.id)).toBe(true);

    const sourceLayers = await database.client.inventoryCostLayer.findMany({
      where: {
        companyId: pishtehId,
        skuId: sku.id,
        sourceType: InventoryCostLayerSourceType.SEED,
      },
      orderBy: { receivedAt: 'asc' },
    });
    expect(sourceLayers[0]!.remainingQuantity).toBe(0);
    expect(sourceLayers[1]!.remainingQuantity).toBe(50);

    const afterLayers = await database.client.inventoryCostLayer.findMany({
      where: {
        companyId: pishtehId,
        skuId: sku.id,
        remainingQuantity: { gt: 0 },
        valuationStatus: InventoryValuationStatus.VALUED,
      },
    });
    const afterValue = afterLayers.reduce(
      (s, l) =>
        s.add((l.baseCurrencyUnitCost ?? new Prisma.Decimal(0)).mul(l.remainingQuantity)),
      new Prisma.Decimal(0),
    );
    expect(afterValue.toString()).toBe(beforeValue.toString());

    for (const position of [
      { locationId: src.id, skuId: sku.id, batchId: batch.id },
      { locationId: dst.id, skuId: sku.id, batchId: batch.id },
    ]) {
      const row = await reconciliation.reconcilePosition({
        companyId: pishtehId,
        warehouseId: mainWarehouseId,
        classification: StockClassification.SELLABLE,
        ...position,
      });
      expect(row.status).toBe('MATCH');
    }
  });
});
