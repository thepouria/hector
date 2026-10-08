import request from 'supertest';
import {
  CurrencyCode,
  InventoryMovementType,
  InventorySourceType,
  PaymentTermType,
  PurchaseCommercialType,
  UserStatus,
  WarehouseLocationType,
  syncOwnerRolePermissions,
  syncPermissions,
} from '@hector/database';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { InventoryLedgerService } from '../src/modules/warehouse/inventory-ledger.service';
import { allocateAllItemsToBatches } from './helpers/batch-allocation';
import {
  deleteInventoryMovements,
  finalizeInventoryE2eCleanup,
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

describe('Inventory Movement Ledger (Phase 3.9 e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let ledger: InventoryLedgerService;
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
  });

  afterAll(async () => {
    if (createdPutawayIds.length > 0) {
      await deleteInventoryMovements(database, {
        sourceType: InventorySourceType.PUTAWAY,
        sourceId: { in: createdPutawayIds },
      });
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
    // Rebuild balances for touched positions is heavy; delete zero/orphan balances created in tests.
    await database.client.inventoryBalance.deleteMany({
      where: {
        companyId: pishtehId,
        onHandQuantity: 0,
        locationId: { in: createdLocationIds },
      },
    });
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
      where: { companyId: pishtehId, status: 'ACTIVE' },
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
    lines: Array<{ receiptBatchAllocationId: string; warehouseLocationId: string; quantity: number }>,
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
    const completed = await request(app.getHttpServer())
      .post(`${PUT_BASE}/${putaway.body.data.id}/complete`)
      .set(auth(token))
      .send({})
      .expect(201);
    return completed.body.data as { id: string; items: Array<{ id: string; quantity: number }> };
  }

  it('creates RECEIVE from completed putaway and exposes On Hand', async () => {
    const token = await login();
    const suffix = randomUUID().slice(0, 8);
    const { goodsReceiptId, allocations } = await createPostedGrn(token, 40);
    const loc = await createLocation(token, `L${suffix}`);

    const putaway = await completePutaway(token, goodsReceiptId, [
      {
        receiptBatchAllocationId: allocations[0].id,
        warehouseLocationId: loc,
        quantity: 40,
      },
    ]);

    const movements = await request(app.getHttpServer())
      .get(`${INV_BASE}/movements`)
      .set(auth(token))
      .query({ sourceType: InventorySourceType.PUTAWAY, locationId: loc })
      .expect(200);
    expect(movements.body.data).toHaveLength(1);
    expect(movements.body.data[0].movementType).toBe(InventoryMovementType.RECEIVE);
    expect(movements.body.data[0].quantityDelta).toBe(40);
    expect(movements.body.data[0].sourceLineId).toBe(putaway.items[0].id);

    const balances = await request(app.getHttpServer())
      .get(INV_BASE)
      .set(auth(token))
      .query({ locationId: loc, onlyPositive: true })
      .expect(200);
    expect(balances.body.data).toHaveLength(1);
    expect(balances.body.data[0].onHandQuantity).toBe(40);
  });

  it('splits putaway into multiple RECEIVE rows and keeps batch separation', async () => {
    const token = await login();
    const suffix = randomUUID().slice(0, 8);
    const { goodsReceiptId, allocations } = await createPostedGrn(token, 100);
    const loc1 = await createLocation(token, `X${suffix}`);
    const loc2 = await createLocation(token, `Y${suffix}`);

    await completePutaway(token, goodsReceiptId, [
      {
        receiptBatchAllocationId: allocations[0].id,
        warehouseLocationId: loc1,
        quantity: 40,
      },
      {
        receiptBatchAllocationId: allocations[0].id,
        warehouseLocationId: loc2,
        quantity: 60,
      },
    ]);

    const m1 = await database.client.inventoryMovement.aggregate({
      where: { locationId: loc1, movementType: InventoryMovementType.RECEIVE },
      _sum: { quantityDelta: true },
    });
    const m2 = await database.client.inventoryMovement.aggregate({
      where: { locationId: loc2, movementType: InventoryMovementType.RECEIVE },
      _sum: { quantityDelta: true },
    });
    expect(m1._sum.quantityDelta).toBe(40);
    expect(m2._sum.quantityDelta).toBe(60);
  });

  it('is idempotent for putaway RECEIVE (retry complete does not duplicate)', async () => {
    const token = await login();
    const suffix = randomUUID().slice(0, 8);
    const { goodsReceiptId, allocations } = await createPostedGrn(token, 10);
    const loc = await createLocation(token, `I${suffix}`);
    const putaway = await completePutaway(token, goodsReceiptId, [
      {
        receiptBatchAllocationId: allocations[0].id,
        warehouseLocationId: loc,
        quantity: 10,
      },
    ]);

    const retry = await request(app.getHttpServer())
      .post(`${PUT_BASE}/${putaway.id}/complete`)
      .set(auth(token))
      .send({});
    expect(retry.status).toBe(409);

    const count = await database.client.inventoryMovement.count({
      where: {
        sourceType: InventorySourceType.PUTAWAY,
        sourceId: putaway.id,
        movementType: InventoryMovementType.RECEIVE,
      },
    });
    expect(count).toBe(1);
  });

  it('supports issue, over-issue rejection, adjustment, return, and transfer', async () => {
    const token = await login();
    const suffix = randomUUID().slice(0, 8);
    const { goodsReceiptId, allocations, skuId } = await createPostedGrn(token, 40);
    const locA = await createLocation(token, `A${suffix}`);
    const locB = await createLocation(token, `B${suffix}`);
    await completePutaway(token, goodsReceiptId, [
      {
        receiptBatchAllocationId: allocations[0].id,
        warehouseLocationId: locA,
        quantity: 40,
      },
    ]);
    const batchId = allocations[0].batchId;

    const issue = await ledger.postIssue(pishtehId, {
      warehouseId: mainWarehouseId,
      locationId: locA,
      skuId,
      batchId,
      quantity: 10,
      sourceType: InventorySourceType.SYSTEM_CORRECTION,
      sourceId: randomUUID(),
      sourceLineId: randomUUID(),
      actorUserId: ownerUserId,
    });
    createdMovementIds.push(issue.id);

    await expect(
      ledger.postIssue(pishtehId, {
        warehouseId: mainWarehouseId,
        locationId: locA,
        skuId,
        batchId,
        quantity: 31,
        sourceType: InventorySourceType.SYSTEM_CORRECTION,
        sourceId: randomUUID(),
        sourceLineId: randomUUID(),
        actorUserId: ownerUserId,
      }),
    ).rejects.toMatchObject({ code: 'INVENTORY_INSUFFICIENT_STOCK' });

    const adj = await ledger.postAdjustment(pishtehId, {
      warehouseId: mainWarehouseId,
      locationId: locA,
      skuId,
      batchId,
      quantityDelta: -2,
      actorUserId: ownerUserId,
      reasonCode: 'DAMAGED',
    });
    createdMovementIds.push(adj.id);

    const ret = await ledger.postMovements(pishtehId, [
      {
        warehouseId: mainWarehouseId,
        locationId: locA,
        skuId,
        batchId,
        movementType: InventoryMovementType.RETURN_IN,
        quantityDelta: 3,
        sourceType: InventorySourceType.SYSTEM_CORRECTION,
        sourceId: randomUUID(),
        sourceLineId: randomUUID(),
        actorUserId: ownerUserId,
      },
    ]);
    createdMovementIds.push(ret[0].id);

    const transfer = await ledger.postTransfer(pishtehId, {
      fromLocationId: locA,
      toLocationId: locB,
      warehouseId: mainWarehouseId,
      skuId,
      batchId,
      quantity: 5,
      actorUserId: ownerUserId,
    });
    createdMovementIds.push(transfer.out.id, transfer.in.id);
    expect(transfer.out.quantityDelta).toBe(-5);
    expect(transfer.in.quantityDelta).toBe(5);
    expect(transfer.out.operationId).toBe(transfer.in.operationId);

    const balA = await database.client.inventoryBalance.findFirstOrThrow({
      where: { locationId: locA, skuId, batchId },
    });
    const balB = await database.client.inventoryBalance.findFirstOrThrow({
      where: { locationId: locB, skuId, batchId },
    });
    // 40 -10 -2 +3 -5 = 26
    expect(balA.onHandQuantity).toBe(26);
    expect(balB.onHandQuantity).toBe(5);

    await expect(
      ledger.postTransfer(pishtehId, {
        fromLocationId: locA,
        toLocationId: locB,
        warehouseId: mainWarehouseId,
        skuId,
        batchId,
        quantity: 100,
        actorUserId: ownerUserId,
      }),
    ).rejects.toMatchObject({ code: 'INVENTORY_INSUFFICIENT_STOCK' });
  });

  it('protects concurrent issues from creating negative stock', async () => {
    const token = await login();
    const suffix = randomUUID().slice(0, 8);
    const { goodsReceiptId, allocations, skuId } = await createPostedGrn(token, 5);
    const loc = await createLocation(token, `C${suffix}`);
    await completePutaway(token, goodsReceiptId, [
      {
        receiptBatchAllocationId: allocations[0].id,
        warehouseLocationId: loc,
        quantity: 5,
      },
    ]);
    const batchId = allocations[0].batchId;

    const results = await Promise.allSettled([
      ledger.postIssue(pishtehId, {
        warehouseId: mainWarehouseId,
        locationId: loc,
        skuId,
        batchId,
        quantity: 4,
        sourceType: InventorySourceType.SYSTEM_CORRECTION,
        sourceId: randomUUID(),
        sourceLineId: randomUUID(),
        actorUserId: ownerUserId,
      }),
      ledger.postIssue(pishtehId, {
        warehouseId: mainWarehouseId,
        locationId: loc,
        skuId,
        batchId,
        quantity: 4,
        sourceType: InventorySourceType.SYSTEM_CORRECTION,
        sourceId: randomUUID(),
        sourceLineId: randomUUID(),
        actorUserId: ownerUserId,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    for (const r of fulfilled) {
      if (r.status === 'fulfilled') createdMovementIds.push(r.value.id);
    }

    const bal = await database.client.inventoryBalance.findFirstOrThrow({
      where: { locationId: loc, skuId, batchId },
    });
    expect(bal.onHandQuantity).toBe(1);
    expect(bal.onHandQuantity).toBeGreaterThanOrEqual(0);
  });

  it('rejects wrong sign / zero / cross-tenant / batch-sku mismatch', async () => {
    const token = await login();
    const suffix = randomUUID().slice(0, 8);
    const { goodsReceiptId, allocations, skuId } = await createPostedGrn(token, 8);
    const loc = await createLocation(token, `Z${suffix}`);
    await completePutaway(token, goodsReceiptId, [
      {
        receiptBatchAllocationId: allocations[0].id,
        warehouseLocationId: loc,
        quantity: 8,
      },
    ]);

    await expect(
      ledger.postMovements(pishtehId, [
        {
          warehouseId: mainWarehouseId,
          locationId: loc,
          skuId,
          batchId: allocations[0].batchId,
          movementType: InventoryMovementType.ISSUE,
          quantityDelta: 5,
          sourceType: InventorySourceType.SYSTEM_CORRECTION,
          sourceId: randomUUID(),
          sourceLineId: randomUUID(),
          actorUserId: ownerUserId,
        },
      ]),
    ).rejects.toMatchObject({ code: 'INVENTORY_INVALID_MOVEMENT_SIGN' });

    await expect(
      ledger.postMovements(pishtehId, [
        {
          warehouseId: mainWarehouseId,
          locationId: loc,
          skuId,
          batchId: allocations[0].batchId,
          movementType: InventoryMovementType.RECEIVE,
          quantityDelta: 0,
          sourceType: InventorySourceType.SYSTEM_CORRECTION,
          sourceId: randomUUID(),
          sourceLineId: randomUUID(),
          actorUserId: ownerUserId,
        },
      ]),
    ).rejects.toMatchObject({ code: 'INVENTORY_INVALID_QUANTITY' });

    const otherSku = await database.client.sku.findFirst({
      where: { companyId: pishtehId, id: { not: skuId }, status: 'ACTIVE' },
    });
    if (otherSku) {
      await expect(
        ledger.postMovements(pishtehId, [
          {
            warehouseId: mainWarehouseId,
            locationId: loc,
            skuId: otherSku.id,
            batchId: allocations[0].batchId,
            movementType: InventoryMovementType.RECEIVE,
            quantityDelta: 1,
            sourceType: InventorySourceType.SYSTEM_CORRECTION,
            sourceId: randomUUID(),
            sourceLineId: randomUUID(),
            actorUserId: ownerUserId,
          },
        ]),
      ).rejects.toMatchObject({ code: 'INVENTORY_BATCH_SKU_MISMATCH' });
    }

    const idor = await request(app.getHttpServer())
      .get(INV_BASE)
      .set(auth(token, demoBId))
      .expect(200);
    expect(
      idor.body.data.every(
        (row: { warehouseId: string }) => row.warehouseId !== mainWarehouseId,
      ),
    ).toBe(true);
  });

  it('supports point-in-time On Hand reconstruction', async () => {
    const token = await login();
    const suffix = randomUUID().slice(0, 8);
    const { goodsReceiptId, allocations, skuId } = await createPostedGrn(token, 100);
    const loc = await createLocation(token, `P${suffix}`);
    await completePutaway(token, goodsReceiptId, [
      {
        receiptBatchAllocationId: allocations[0].id,
        warehouseLocationId: loc,
        quantity: 100,
      },
    ]);
    const batchId = allocations[0].batchId;
    const t1 = new Date('2026-10-05T10:00:00.000Z');
    const t2 = new Date('2026-10-05T11:00:00.000Z');
    const t3 = new Date('2026-10-05T12:00:00.000Z');

    const i1 = await ledger.postIssue(pishtehId, {
      warehouseId: mainWarehouseId,
      locationId: loc,
      skuId,
      batchId,
      quantity: 20,
      sourceType: InventorySourceType.SYSTEM_CORRECTION,
      sourceId: randomUUID(),
      sourceLineId: randomUUID(),
      actorUserId: ownerUserId,
      occurredAt: t2,
    });
    createdMovementIds.push(i1.id);
    const a1 = await ledger.postAdjustment(pishtehId, {
      warehouseId: mainWarehouseId,
      locationId: loc,
      skuId,
      batchId,
      quantityDelta: -5,
      actorUserId: ownerUserId,
      occurredAt: t3,
    });
    createdMovementIds.push(a1.id);

    // Backdate the putaway RECEIVE occurredAt for point-in-time story (seed-style).
    await database.client.inventoryMovement.updateMany({
      where: {
        locationId: loc,
        movementType: InventoryMovementType.RECEIVE,
        sourceType: InventorySourceType.PUTAWAY,
      },
      data: { occurredAt: t1 },
    });

    const asT1 = await ledger.onHandAsOf(
      pishtehId,
      { warehouseId: mainWarehouseId, locationId: loc, skuId, batchId },
      t1,
    );
    const asT2 = await ledger.onHandAsOf(
      pishtehId,
      { warehouseId: mainWarehouseId, locationId: loc, skuId, batchId },
      t2,
    );
    const asT3 = await ledger.onHandAsOf(
      pishtehId,
      { warehouseId: mainWarehouseId, locationId: loc, skuId, batchId },
      t3,
    );
    expect(asT1.onHand).toBe(100);
    expect(asT2.onHand).toBe(80);
    expect(asT3.onHand).toBe(75);
  });

  it('lists movements and balances via read API with RBAC', async () => {
    const token = await login();
    await request(app.getHttpServer()).get(INV_BASE).set(auth(token)).expect(200);
    await request(app.getHttpServer())
      .get(`${INV_BASE}/movements`)
      .set(auth(token))
      .expect(200);

    const unauth = await request(app.getHttpServer()).get(INV_BASE);
    expect(unauth.status).toBe(401);
  });
});
