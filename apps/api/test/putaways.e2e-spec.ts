import request from 'supertest';
import {
  CompanyMemberStatus,
  CurrencyCode,
  PaymentTermType,
  PurchaseCommercialType,
  PutawayStatus,
  UserStatus,
  WarehouseLocationType,
  WarehouseStatus,
  syncOwnerRolePermissions,
  syncPermissions,
  PERMISSIONS,
} from '@hector/database';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { allocateAllItemsToBatches } from './helpers/batch-allocation';
import { deleteInventoryMovements } from './helpers/delete-movements';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';
import {
  cleanupPayablesForGoodsReceipts,
  cleanupPayablesForPurchaseOrders,
} from './helpers/payable-cleanup';

const PUT_BASE = '/api/v1/warehouse/putaways';
const GRN_BASE = '/api/v1/goods-receipts';
const PO_BASE = '/api/v1/purchasing/purchase-orders';
const LOC_BASE = '/api/v1/warehouses';

describe('Putaways (Phase 3.8 e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  const ownerEmail = 'pouria@hector.local';
  const warehouseOperatorEmail = 'hossein@hector.local';
  const password = E2E_PASSWORD;
  let pishtehId: string;
  let demoBId: string;
  let mainWarehouseId: string;
  let returnsWarehouseId: string;
  let ownerUserId: string;
  const createdPoIds: string[] = [];
  const createdReceiptIds: string[] = [];
  const createdPutawayIds: string[] = [];
  const createdLocationIds: string[] = [];
  const createdBatchIds: string[] = [];
  const tempCompanyIds: string[] = [];
  const tempUserIds: string[] = [];

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
    mainWarehouseId = (
      await database.client.warehouse.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'MAIN' },
      })
    ).id;
    returnsWarehouseId = (
      await database.client.warehouse.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'RETURNS' },
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
      await deleteInventoryMovements(database, { sourceType: 'PUTAWAY', sourceId: { in: createdPutawayIds } });
      await database.client.putawayScanRequest.deleteMany({
        where: { putawayId: { in: createdPutawayIds } },
      });
      await database.client.putawayItem.deleteMany({
        where: { putawayId: { in: createdPutawayIds } },
      });
      await database.client.putaway.deleteMany({
        where: { id: { in: createdPutawayIds } },
      });
    }
    if (createdLocationIds.length > 0) {
      await database.client.inventoryBalance.deleteMany({
        where: { locationId: { in: createdLocationIds } },
      });
      await deleteInventoryMovements(database, { locationId: { in: createdLocationIds } });
    }
    if (createdReceiptIds.length > 0) {
      await cleanupPayablesForGoodsReceipts(database, createdReceiptIds);
      await database.client.goodsReceiptItemBatch.deleteMany({
        where: { goodsReceiptItem: { goodsReceiptId: { in: createdReceiptIds } } },
      });
      await database.client.goodsReceiptScanRequest.deleteMany({
        where: { goodsReceiptId: { in: createdReceiptIds } },
      });
      await database.client.goodsReceiptItem.deleteMany({
        where: { goodsReceiptId: { in: createdReceiptIds } },
      });
      await database.client.goodsReceipt.deleteMany({
        where: { id: { in: createdReceiptIds } },
      });
    }
    if (createdPoIds.length > 0) {
      await cleanupPayablesForPurchaseOrders(database, createdPoIds);
      await database.client.purchaseOrderItem.deleteMany({
        where: { purchaseOrderId: { in: createdPoIds } },
      });
      await database.client.purchaseOrder.deleteMany({
        where: { id: { in: createdPoIds } },
      });
    }
    if (createdBatchIds.length > 0) {
      await database.client.goodsReceiptItemBatch.deleteMany({
        where: { batchId: { in: createdBatchIds } },
      });
      await database.client.batch.deleteMany({ where: { id: { in: createdBatchIds } } });
    }
    if (createdLocationIds.length > 0) {
      await database.client.warehouseLocation.deleteMany({
        where: { id: { in: createdLocationIds } },
      });
    }
    if (tempCompanyIds.length > 0) {
      await database.client.companyMemberRole.deleteMany({
        where: { companyMember: { companyId: { in: tempCompanyIds } } },
      });
      await database.client.companyMember.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.rolePermission.deleteMany({
        where: { role: { companyId: { in: tempCompanyIds } } },
      });
      await database.client.role.deleteMany({ where: { companyId: { in: tempCompanyIds } } });
      await database.client.company.deleteMany({ where: { id: { in: tempCompanyIds } } });
    }
    if (tempUserIds.length > 0) {
      await database.client.user.deleteMany({ where: { id: { in: tempUserIds } } });
    }
    await app.close();
  });

  async function login(email = ownerEmail): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return res.body.data.accessToken as string;
  }

  function auth(token: string, companyId = pishtehId) {
    return { Authorization: `Bearer ${token}`, 'X-Company-Id': companyId };
  }

  async function createOrderedPo(
    token: string,
    quantity: number,
  ): Promise<{ poId: string; itemId: string; skuId: string }> {
    const supplier = await database.client.supplier.findFirstOrThrow({
      where: { companyId: pishtehId, status: 'ACTIVE' },
    });
    const sku = await database.client.sku.findFirstOrThrow({
      where: { companyId: pishtehId, status: 'ACTIVE' },
    });
    const created = await request(app.getHttpServer())
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
    const poId = created.body.data.id as string;
    createdPoIds.push(poId);
    await request(app.getHttpServer())
      .post(`${PO_BASE}/${poId}/approve`)
      .set(auth(token))
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post(`${PO_BASE}/${poId}/mark-ordered`)
      .set(auth(token))
      .send({})
      .expect(201);
    return { poId, itemId: created.body.data.items[0].id as string, skuId: sku.id };
  }

  async function createPostedGrn(
    token: string,
    quantity: number,
    options?: { splitBatches?: Array<{ supplierBatchNumber: string; quantity: number }> },
  ): Promise<{
    goodsReceiptId: string;
    itemId: string;
    allocations: Array<{ id: string; batchId: string; quantity: number }>;
  }> {
    const { poId, itemId } = await createOrderedPo(token, quantity);
    const draft = await request(app.getHttpServer())
      .post(GRN_BASE)
      .set(auth(token))
      .send({
        purchaseOrderId: poId,
        warehouseId: mainWarehouseId,
        items: [{ purchaseOrderItemId: itemId, quantity }],
      })
      .expect(201);
    const goodsReceiptId = draft.body.data.id as string;
    createdReceiptIds.push(goodsReceiptId);
    const grnItemId = draft.body.data.items[0].id as string;

    if (options?.splitBatches) {
      for (const split of options.splitBatches) {
        await request(app.getHttpServer())
          .post(`${GRN_BASE}/${goodsReceiptId}/items/${grnItemId}/batches`)
          .set(auth(token))
          .send({
            supplierBatchNumber: split.supplierBatchNumber,
            quantity: split.quantity,
          })
          .expect(201);
      }
    } else {
      await allocateAllItemsToBatches(app, auth(token), goodsReceiptId);
    }

    await request(app.getHttpServer())
      .post(`${GRN_BASE}/${goodsReceiptId}/post`)
      .set(auth(token))
      .send({})
      .expect(201);

    const detail = await request(app.getHttpServer())
      .get(`${GRN_BASE}/${goodsReceiptId}`)
      .set(auth(token))
      .expect(200);
    const allocations = (detail.body.data.items[0].batchAllocations ?? []) as Array<{
      id: string;
      batchId: string;
      quantity: number;
    }>;
    return { goodsReceiptId, itemId: grnItemId, allocations };
  }

  async function createLocation(
    token: string,
    code: string,
    barcode: string,
    warehouseId = mainWarehouseId,
    status: WarehouseStatus = WarehouseStatus.ACTIVE,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`${LOC_BASE}/${warehouseId}/locations`)
      .set(auth(token))
      .send({
        type: WarehouseLocationType.SHELF,
        code,
        name: code,
        sortOrder: 1,
      })
      .expect(201);
    const id = res.body.data.id as string;
    createdLocationIds.push(id);
    await database.client.warehouseLocation.update({
      where: { id },
      data: {
        barcode,
        ...(status !== WarehouseStatus.ACTIVE ? { status } : {}),
      },
    });
    return id;
  }

  async function createPutaway(token: string, goodsReceiptId: string) {
    const res = await request(app.getHttpServer())
      .post(PUT_BASE)
      .set(auth(token))
      .send({ goodsReceiptId })
      .expect(201);
    createdPutawayIds.push(res.body.data.id);
    return res.body.data as { id: string; number: string; status: string; warehouseId: string };
  }

  it('completes happy-path putaway and clears remaining', async () => {
    const token = await login();
    const suffix = randomUUID().slice(0, 8);
    const { goodsReceiptId, allocations } = await createPostedGrn(token, 40);
    const locationId = await createLocation(token, `P${suffix}`, `LOC-P${suffix}`);

    const putaway = await createPutaway(token, goodsReceiptId);
    await request(app.getHttpServer())
      .post(`${PUT_BASE}/${putaway.id}/items`)
      .set(auth(token))
      .send({
        receiptBatchAllocationId: allocations[0].id,
        warehouseLocationId: locationId,
        quantity: 40,
      })
      .expect(201);

    const completed = await request(app.getHttpServer())
      .post(`${PUT_BASE}/${putaway.id}/complete`)
      .set(auth(token))
      .send({})
      .expect(201);
    expect(completed.body.data.status).toBe(PutawayStatus.COMPLETED);
    expect(completed.body.data.completedBy).toBeTruthy();

    const pending = await request(app.getHttpServer())
      .get(`${PUT_BASE}/pending`)
      .set(auth(token))
      .query({ goodsReceiptId })
      .expect(200);
    expect(pending.body.data).toEqual([]);
  });

  it('supports partial putaway then second putaway for remainder', async () => {
    const token = await login();
    const suffix = randomUUID().slice(0, 8);
    const { goodsReceiptId, allocations } = await createPostedGrn(token, 100);
    const locA = await createLocation(token, `A${suffix}`, `LOC-A${suffix}`);
    const locB = await createLocation(token, `B${suffix}`, `LOC-B${suffix}`);

    const p1 = await createPutaway(token, goodsReceiptId);
    await request(app.getHttpServer())
      .post(`${PUT_BASE}/${p1.id}/items`)
      .set(auth(token))
      .send({
        receiptBatchAllocationId: allocations[0].id,
        warehouseLocationId: locA,
        quantity: 40,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${PUT_BASE}/${p1.id}/complete`)
      .set(auth(token))
      .send({})
      .expect(201);

    const pendingAfterP1 = await request(app.getHttpServer())
      .get(`${PUT_BASE}/pending`)
      .set(auth(token))
      .query({ goodsReceiptId })
      .expect(200);
    expect(pendingAfterP1.body.data).toHaveLength(1);
    expect(pendingAfterP1.body.data[0].remainingToPutAway).toBe(60);
    expect(pendingAfterP1.body.data[0].receiptPutawayProgress).toBe('PARTIALLY_PUT_AWAY');

    const p2 = await createPutaway(token, goodsReceiptId);
    await request(app.getHttpServer())
      .post(`${PUT_BASE}/${p2.id}/items`)
      .set(auth(token))
      .send({
        receiptBatchAllocationId: allocations[0].id,
        warehouseLocationId: locB,
        quantity: 60,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${PUT_BASE}/${p2.id}/complete`)
      .set(auth(token))
      .send({})
      .expect(201);

    const pendingAfterP2 = await request(app.getHttpServer())
      .get(`${PUT_BASE}/pending`)
      .set(auth(token))
      .query({ goodsReceiptId })
      .expect(200);
    expect(pendingAfterP2.body.data).toEqual([]);
  });

  it('splits one batch allocation across multiple locations', async () => {
    const token = await login();
    const suffix = randomUUID().slice(0, 8);
    const { goodsReceiptId, allocations } = await createPostedGrn(token, 100);
    const loc1 = await createLocation(token, `S1${suffix}`, `LOC-S1${suffix}`);
    const loc2 = await createLocation(token, `S2${suffix}`, `LOC-S2${suffix}`);

    const putaway = await createPutaway(token, goodsReceiptId);
    await request(app.getHttpServer())
      .post(`${PUT_BASE}/${putaway.id}/items`)
      .set(auth(token))
      .send({
        receiptBatchAllocationId: allocations[0].id,
        warehouseLocationId: loc1,
        quantity: 40,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${PUT_BASE}/${putaway.id}/items`)
      .set(auth(token))
      .send({
        receiptBatchAllocationId: allocations[0].id,
        warehouseLocationId: loc2,
        quantity: 60,
      })
      .expect(201);
    const completed = await request(app.getHttpServer())
      .post(`${PUT_BASE}/${putaway.id}/complete`)
      .set(auth(token))
      .send({})
      .expect(201);
    expect(completed.body.data.items).toHaveLength(2);
    expect(completed.body.data.totals.totalQuantity).toBe(100);
  });

  it('preserves multiple batch identities independently', async () => {
    const token = await login();
    const suffix = randomUUID().slice(0, 8);
    const { goodsReceiptId, allocations } = await createPostedGrn(token, 100, {
      splitBatches: [
        { supplierBatchNumber: `LOT-A-${suffix}`, quantity: 60 },
        { supplierBatchNumber: `LOT-B-${suffix}`, quantity: 40 },
      ],
    });
    expect(allocations).toHaveLength(2);
    const loc = await createLocation(token, `M${suffix}`, `LOC-M${suffix}`);

    const putaway = await createPutaway(token, goodsReceiptId);
    await request(app.getHttpServer())
      .post(`${PUT_BASE}/${putaway.id}/items`)
      .set(auth(token))
      .send({
        receiptBatchAllocationId: allocations[0].id,
        warehouseLocationId: loc,
        quantity: 60,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${PUT_BASE}/${putaway.id}/items`)
      .set(auth(token))
      .send({
        receiptBatchAllocationId: allocations[1].id,
        warehouseLocationId: loc,
        quantity: 40,
      })
      .expect(201);
    const detail = await request(app.getHttpServer())
      .get(`${PUT_BASE}/${putaway.id}`)
      .set(auth(token))
      .expect(200);
    expect(detail.body.data.items.map((i: { batchId: string }) => i.batchId).sort()).toEqual(
      [allocations[0].batchId, allocations[1].batchId].sort(),
    );
  });

  it('rejects over-putaway, zero, and negative quantities', async () => {
    const token = await login();
    const suffix = randomUUID().slice(0, 8);
    const { goodsReceiptId, allocations } = await createPostedGrn(token, 40);
    const locationId = await createLocation(token, `O${suffix}`, `LOC-O${suffix}`);
    const putaway = await createPutaway(token, goodsReceiptId);

    const over = await request(app.getHttpServer())
      .post(`${PUT_BASE}/${putaway.id}/items`)
      .set(auth(token))
      .send({
        receiptBatchAllocationId: allocations[0].id,
        warehouseLocationId: locationId,
        quantity: 41,
      });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('PUTAWAY_QUANTITY_EXCEEDED');

    const zero = await request(app.getHttpServer())
      .post(`${PUT_BASE}/${putaway.id}/items`)
      .set(auth(token))
      .send({
        receiptBatchAllocationId: allocations[0].id,
        warehouseLocationId: locationId,
        quantity: 0,
      });
    expect(zero.status).toBeGreaterThanOrEqual(400);

    const negative = await request(app.getHttpServer())
      .post(`${PUT_BASE}/${putaway.id}/items`)
      .set(auth(token))
      .send({
        receiptBatchAllocationId: allocations[0].id,
        warehouseLocationId: locationId,
        quantity: -1,
      });
    expect(negative.status).toBeGreaterThanOrEqual(400);
  });

  it('rejects putaway from DRAFT GRN', async () => {
    const token = await login();
    const { poId, itemId } = await createOrderedPo(token, 10);
    const draft = await request(app.getHttpServer())
      .post(GRN_BASE)
      .set(auth(token))
      .send({
        purchaseOrderId: poId,
        warehouseId: mainWarehouseId,
        items: [{ purchaseOrderItemId: itemId, quantity: 10 }],
      })
      .expect(201);
    createdReceiptIds.push(draft.body.data.id);

    const res = await request(app.getHttpServer())
      .post(PUT_BASE)
      .set(auth(token))
      .send({ goodsReceiptId: draft.body.data.id });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GRN_NOT_POSTED');
  });

  it('rejects wrong-warehouse and inactive locations; unknown barcode has no mutation', async () => {
    const token = await login();
    const suffix = randomUUID().slice(0, 8);
    const { goodsReceiptId, allocations } = await createPostedGrn(token, 20);
    const putaway = await createPutaway(token, goodsReceiptId);

    const returnsLoc = await createLocation(
      token,
      `R${suffix}`,
      `LOC-R${suffix}`,
      returnsWarehouseId,
    );
    const wrongWh = await request(app.getHttpServer())
      .post(`${PUT_BASE}/${putaway.id}/items`)
      .set(auth(token))
      .send({
        receiptBatchAllocationId: allocations[0].id,
        warehouseLocationId: returnsLoc,
        quantity: 5,
      });
    expect(wrongWh.status).toBe(409);
    expect(wrongWh.body.error.code).toBe('LOCATION_NOT_IN_PUTAWAY_WAREHOUSE');

    const inactiveId = await createLocation(
      token,
      `I${suffix}`,
      `LOC-I${suffix}`,
      mainWarehouseId,
      WarehouseStatus.INACTIVE,
    );
    const inactive = await request(app.getHttpServer())
      .post(`${PUT_BASE}/${putaway.id}/items`)
      .set(auth(token))
      .send({
        receiptBatchAllocationId: allocations[0].id,
        warehouseLocationId: inactiveId,
        quantity: 5,
      });
    expect(inactive.status).toBe(409);
    expect(inactive.body.error.code).toBe('LOCATION_NOT_AVAILABLE');

    const before = await request(app.getHttpServer())
      .get(`${PUT_BASE}/${putaway.id}`)
      .set(auth(token))
      .expect(200);
    const unknown = await request(app.getHttpServer())
      .post(`${PUT_BASE}/${putaway.id}/location/resolve`)
      .set(auth(token))
      .send({ barcode: `UNKNOWN-${suffix}` });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('UNKNOWN_LOCATION_BARCODE');
    const after = await request(app.getHttpServer())
      .get(`${PUT_BASE}/${putaway.id}`)
      .set(auth(token))
      .expect(200);
    expect(after.body.data.items).toEqual(before.body.data.items);
  });

  it('resolves leading-zero location barcode exactly', async () => {
    const token = await login();
    const suffix = randomUUID().slice(0, 8);
    const { goodsReceiptId } = await createPostedGrn(token, 5);
    const barcode = `000-Z-${suffix}`;
    await createLocation(token, `Z${suffix}`, barcode);
    const putaway = await createPutaway(token, goodsReceiptId);

    const resolved = await request(app.getHttpServer())
      .post(`${PUT_BASE}/${putaway.id}/location/resolve`)
      .set(auth(token))
      .send({ barcode })
      .expect(200);
    expect(resolved.body.data.barcode).toBe(barcode);
  });

  it('aggregates duplicate allocation+location on same putaway', async () => {
    const token = await login();
    const suffix = randomUUID().slice(0, 8);
    const { goodsReceiptId, allocations } = await createPostedGrn(token, 50);
    const locationId = await createLocation(token, `D${suffix}`, `LOC-D${suffix}`);
    const putaway = await createPutaway(token, goodsReceiptId);

    await request(app.getHttpServer())
      .post(`${PUT_BASE}/${putaway.id}/items`)
      .set(auth(token))
      .send({
        receiptBatchAllocationId: allocations[0].id,
        warehouseLocationId: locationId,
        quantity: 20,
      })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post(`${PUT_BASE}/${putaway.id}/items`)
      .set(auth(token))
      .send({
        receiptBatchAllocationId: allocations[0].id,
        warehouseLocationId: locationId,
        quantity: 30,
      })
      .expect(201);
    expect(second.body.data.items).toHaveLength(1);
    expect(second.body.data.items[0].quantity).toBe(30);
  });

  it('prevents concurrent completion from exceeding received quantity', async () => {
    const token = await login();
    const suffix = randomUUID().slice(0, 8);
    const { goodsReceiptId, allocations } = await createPostedGrn(token, 50);
    const locA = await createLocation(token, `CA${suffix}`, `LOC-CA${suffix}`);
    const locB = await createLocation(token, `CB${suffix}`, `LOC-CB${suffix}`);

    const p1 = await createPutaway(token, goodsReceiptId);
    const p2 = await createPutaway(token, goodsReceiptId);
    await request(app.getHttpServer())
      .post(`${PUT_BASE}/${p1.id}/items`)
      .set(auth(token))
      .send({
        receiptBatchAllocationId: allocations[0].id,
        warehouseLocationId: locA,
        quantity: 30,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${PUT_BASE}/${p2.id}/items`)
      .set(auth(token))
      .send({
        receiptBatchAllocationId: allocations[0].id,
        warehouseLocationId: locB,
        quantity: 30,
      })
      .expect(201);

    const [r1, r2] = await Promise.all([
      request(app.getHttpServer()).post(`${PUT_BASE}/${p1.id}/complete`).set(auth(token)).send({}),
      request(app.getHttpServer()).post(`${PUT_BASE}/${p2.id}/complete`).set(auth(token)).send({}),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);
    const failed = r1.status === 409 ? r1 : r2;
    expect(failed.body.error.code).toBe('PUTAWAY_QUANTITY_EXCEEDED');

    const completedQty = await database.client.putawayItem.aggregate({
      where: {
        goodsReceiptItemBatchId: allocations[0].id,
        putaway: { status: PutawayStatus.COMPLETED },
      },
      _sum: { quantity: true },
    });
    expect(completedQty._sum.quantity ?? 0).toBeLessThanOrEqual(50);
    expect(completedQty._sum.quantity ?? 0).toBe(30);
  });

  it('makes completed putaway immutable', async () => {
    const token = await login();
    const suffix = randomUUID().slice(0, 8);
    const { goodsReceiptId, allocations } = await createPostedGrn(token, 10);
    const locA = await createLocation(token, `IA${suffix}`, `LOC-IA${suffix}`);
    const locB = await createLocation(token, `IB${suffix}`, `LOC-IB${suffix}`);
    const putaway = await createPutaway(token, goodsReceiptId);
    const upserted = await request(app.getHttpServer())
      .post(`${PUT_BASE}/${putaway.id}/items`)
      .set(auth(token))
      .send({
        receiptBatchAllocationId: allocations[0].id,
        warehouseLocationId: locA,
        quantity: 10,
      })
      .expect(201);
    const itemId = upserted.body.data.items[0].id as string;
    await request(app.getHttpServer())
      .post(`${PUT_BASE}/${putaway.id}/complete`)
      .set(auth(token))
      .send({})
      .expect(201);

    const qtyEdit = await request(app.getHttpServer())
      .patch(`${PUT_BASE}/${putaway.id}/items/${itemId}`)
      .set(auth(token))
      .send({ quantity: 5 });
    expect(qtyEdit.status).toBe(409);
    expect(qtyEdit.body.error.code).toBe('PUTAWAY_ALREADY_COMPLETED');

    const locEdit = await request(app.getHttpServer())
      .patch(`${PUT_BASE}/${putaway.id}/items/${itemId}`)
      .set(auth(token))
      .send({ warehouseLocationId: locB });
    expect(locEdit.status).toBe(409);

    const del = await request(app.getHttpServer())
      .delete(`${PUT_BASE}/${putaway.id}/items/${itemId}`)
      .set(auth(token));
    expect(del.status).toBe(409);
  });

  it('enforces tenant isolation for putaway, allocation, and location', async () => {
    const token = await login();
    const suffix = randomUUID().slice(0, 8);
    const { goodsReceiptId, allocations } = await createPostedGrn(token, 12);
    const locationId = await createLocation(token, `T${suffix}`, `LOC-T${suffix}`);
    const putaway = await createPutaway(token, goodsReceiptId);

    const idorGet = await request(app.getHttpServer())
      .get(`${PUT_BASE}/${putaway.id}`)
      .set(auth(token, demoBId));
    expect(idorGet.status).toBe(404);

    const idorCreate = await request(app.getHttpServer())
      .post(PUT_BASE)
      .set(auth(token, demoBId))
      .send({ goodsReceiptId });
    expect(idorCreate.status).toBe(404);

    await request(app.getHttpServer())
      .post(`${PUT_BASE}/${putaway.id}/items`)
      .set(auth(token))
      .send({
        receiptBatchAllocationId: allocations[0].id,
        warehouseLocationId: locationId,
        quantity: 5,
      })
      .expect(201);

    const crossTenantComplete = await request(app.getHttpServer())
      .post(`${PUT_BASE}/${putaway.id}/complete`)
      .set(auth(token, demoBId))
      .send({});
    expect(crossTenantComplete.status).toBe(404);
  });

  it('enforces RBAC for reader / manager / completer', async () => {
    const ownerToken = await login();
    const opToken = await login(warehouseOperatorEmail);
    const suffix = randomUUID().slice(0, 8);
    const { goodsReceiptId, allocations } = await createPostedGrn(ownerToken, 8);
    const locationId = await createLocation(ownerToken, `RB${suffix}`, `LOC-RB${suffix}`);

    await request(app.getHttpServer())
      .get(PUT_BASE)
      .set(auth(opToken))
      .expect(200);

    const putaway = await createPutaway(opToken, goodsReceiptId);
    await request(app.getHttpServer())
      .post(`${PUT_BASE}/${putaway.id}/items`)
      .set(auth(opToken))
      .send({
        receiptBatchAllocationId: allocations[0].id,
        warehouseLocationId: locationId,
        quantity: 8,
      })
      .expect(201);

    const slug = `put-rbac-${Date.now()}`;
    const company = await database.client.company.create({
      data: {
        name: slug,
        slug,
        baseCurrency: CurrencyCode.IRR,
        timezone: 'Asia/Tehran',
      },
    });
    tempCompanyIds.push(company.id);
    const role = await database.client.role.create({
      data: {
        companyId: company.id,
        key: 'PUTAWAY_READ_ONLY',
        name: 'Putaway Read Only',
        isSystem: false,
      },
    });
    const readPerm = await database.client.permission.findUniqueOrThrow({
      where: { key: PERMISSIONS.WAREHOUSE_PUTAWAY_READ },
    });
    await database.client.rolePermission.create({
      data: { roleId: role.id, permissionId: readPerm.id },
    });
    const membership = await database.client.companyMember.create({
      data: {
        companyId: company.id,
        userId: ownerUserId,
        status: CompanyMemberStatus.ACTIVE,
      },
    });
    await database.client.companyMemberRole.create({
      data: { companyMemberId: membership.id, roleId: role.id },
    });

    const readerToken = await login();
    const forbiddenCreate = await request(app.getHttpServer())
      .post(PUT_BASE)
      .set(auth(readerToken, company.id))
      .send({ goodsReceiptId });
    expect(forbiddenCreate.status).toBe(403);

    await request(app.getHttpServer())
      .post(`${PUT_BASE}/${putaway.id}/complete`)
      .set(auth(opToken))
      .send({})
      .expect(201);
  });

  it('supports scanner apply idempotency and intentional repeats', async () => {
    const token = await login();
    const suffix = randomUUID().slice(0, 8);
    const { goodsReceiptId, allocations } = await createPostedGrn(token, 40);
    const barcode = `LOC-SC${suffix}`;
    await createLocation(token, `SC${suffix}`, barcode);
    const putaway = await createPutaway(token, goodsReceiptId);
    const requestId = randomUUID();

    const first = await request(app.getHttpServer())
      .post(`${PUT_BASE}/${putaway.id}/scan/apply`)
      .set(auth(token))
      .send({
        receiptBatchAllocationId: allocations[0].id,
        locationBarcode: barcode,
        quantity: 10,
        requestId,
      })
      .expect(201);
    expect(first.body.data.replayed).toBe(false);

    const replay = await request(app.getHttpServer())
      .post(`${PUT_BASE}/${putaway.id}/scan/apply`)
      .set(auth(token))
      .send({
        receiptBatchAllocationId: allocations[0].id,
        locationBarcode: barcode,
        quantity: 10,
        requestId,
      })
      .expect(201);
    expect(replay.body.data.replayed).toBe(true);

    const secondIntent = await request(app.getHttpServer())
      .post(`${PUT_BASE}/${putaway.id}/scan/apply`)
      .set(auth(token))
      .send({
        receiptBatchAllocationId: allocations[0].id,
        locationBarcode: barcode,
        quantity: 5,
        requestId: randomUUID(),
      })
      .expect(201);
    expect(secondIntent.body.data.replayed).toBe(false);

    const detail = await request(app.getHttpServer())
      .get(`${PUT_BASE}/${putaway.id}`)
      .set(auth(token))
      .expect(200);
    expect(detail.body.data.items[0].quantity).toBe(15);
  });
});
