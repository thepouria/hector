import request from 'supertest';
import {
  BarcodeType,
  CurrencyCode,
  PaymentTermType,
  PurchaseCommercialType,
  PurchaseOrderStatus,
  UserStatus,
  syncOwnerRolePermissions,
  syncPermissions,
} from '@hector/database';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { allocateAllItemsToBatches } from './helpers/batch-allocation';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';
import {
  cleanupPayablesForGoodsReceipts,
  cleanupE2ePurchaseOrders,
} from './helpers/payable-cleanup';

const BATCH_BASE = '/api/v1/warehouse/batches';
const GRN_BASE = '/api/v1/goods-receipts';
const PO_BASE = '/api/v1/purchasing/purchase-orders';

describe('Batches & GRN allocations (Phase 3.7 e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;
  let pishtehId: string;
  let demoBId: string;
  let mainWarehouseId: string;
  const createdPoIds: string[] = [];
  const createdReceiptIds: string[] = [];
  const createdBatchIds: string[] = [];
  const createdBarcodeIds: string[] = [];
  const createdSkuIds: string[] = [];

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
    await database.client.user.update({
      where: { email: ownerEmail },
      data: { status: UserStatus.ACTIVE, deletedAt: null },
    });
  });

  afterAll(async () => {
    if (createdBarcodeIds.length > 0) {
      await database.client.barcode.deleteMany({ where: { id: { in: createdBarcodeIds } } });
    }
    if (createdPoIds.length > 0) {
      await cleanupE2ePurchaseOrders(database, createdPoIds);
    } else if (createdReceiptIds.length > 0) {
      await cleanupPayablesForGoodsReceipts(database, createdReceiptIds);
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
    if (createdBatchIds.length > 0) {
      await database.client.goodsReceiptItemBatch.deleteMany({
        where: { batchId: { in: createdBatchIds } },
      });
      await database.client.batch.deleteMany({ where: { id: { in: createdBatchIds } } });
    }
    if (createdSkuIds.length > 0) {
      await database.client.sku.deleteMany({ where: { id: { in: createdSkuIds } } });
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
    quantity = 100,
    skuId?: string,
  ): Promise<{ poId: string; itemId: string; skuId: string }> {
    const supplier = await database.client.supplier.findFirstOrThrow({
      where: { companyId: pishtehId, status: 'ACTIVE' },
    });
    const sku = skuId
      ? await database.client.sku.findFirstOrThrow({ where: { id: skuId, companyId: pishtehId } })
      : await database.client.sku.findFirstOrThrow({
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

  async function createDraftGrn(
    token: string,
    poId: string,
    items: Array<{ purchaseOrderItemId: string; quantity: number }>,
  ) {
    const res = await request(app.getHttpServer())
      .post(GRN_BASE)
      .set(auth(token))
      .send({
        purchaseOrderId: poId,
        warehouseId: mainWarehouseId,
        items,
      })
      .expect(201);
    createdReceiptIds.push(res.body.data.id);
    return res.body.data as { id: string; items: Array<{ id: string; quantity: number }> };
  }

  async function ensureBarcode(skuId: string, value: string): Promise<void> {
    const normalizedValue = value.replace(/\s+/g, '').toUpperCase();
    const existing = await database.client.barcode.findFirst({
      where: { companyId: pishtehId, normalizedValue },
    });
    if (existing) {
      await database.client.barcode.update({
        where: { id: existing.id },
        data: { skuId, value, normalizedValue, archivedAt: null, type: BarcodeType.OTHER },
      });
      return;
    }
    const created = await database.client.barcode.create({
      data: {
        companyId: pishtehId,
        skuId,
        value,
        normalizedValue,
        type: BarcodeType.OTHER,
        isPrimary: false,
      },
    });
    createdBarcodeIds.push(created.id);
  }

  it('creates batch without expiry, with expiry, and rejects manufactured after expiry', async () => {
    const token = await login();
    const { skuId } = await createOrderedPo(token, 10);

    const noExpiry = await request(app.getHttpServer())
      .post(BATCH_BASE)
      .set(auth(token))
      .send({ skuId })
      .expect(201);
    createdBatchIds.push(noExpiry.body.data.id);
    expect(noExpiry.body.data.expiresAt).toBeNull();

    const withExpiry = await request(app.getHttpServer())
      .post(BATCH_BASE)
      .set(auth(token))
      .send({ skuId, expiresAt: '2028-12-31' })
      .expect(201);
    createdBatchIds.push(withExpiry.body.data.id);
    expect(withExpiry.body.data.expiresAt).toBe('2028-12-31');

    const invalid = await request(app.getHttpServer())
      .post(BATCH_BASE)
      .set(auth(token))
      .send({
        skuId,
        manufacturedAt: '2029-06-01',
        expiresAt: '2029-01-01',
      });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('BATCH_INVALID_DATES');
  });

  it('preserves leading-zero supplier batch number', async () => {
    const token = await login();
    const { skuId } = await createOrderedPo(token, 5);
    const supplierLot = '001234';

    const created = await request(app.getHttpServer())
      .post(BATCH_BASE)
      .set(auth(token))
      .send({ skuId, supplierBatchNumber: supplierLot })
      .expect(201);
    createdBatchIds.push(created.body.data.id);
    expect(created.body.data.supplierBatchNumber).toBe(supplierLot);

    const detail = await request(app.getHttpServer())
      .get(`${BATCH_BASE}/${created.body.data.id}`)
      .set(auth(token))
      .expect(200);
    expect(detail.body.data.supplierBatchNumber).toBe(supplierLot);
  });

  it('allows multiple batch identities for one SKU', async () => {
    const token = await login();
    const { skuId } = await createOrderedPo(token, 5);

    const a = await request(app.getHttpServer())
      .post(BATCH_BASE)
      .set(auth(token))
      .send({ skuId, supplierBatchNumber: `MULTI-A-${Date.now()}` })
      .expect(201);
    const b = await request(app.getHttpServer())
      .post(BATCH_BASE)
      .set(auth(token))
      .send({ skuId, supplierBatchNumber: `MULTI-B-${Date.now()}` })
      .expect(201);
    createdBatchIds.push(a.body.data.id, b.body.data.id);
    expect(a.body.data.id).not.toBe(b.body.data.id);

    const list = await request(app.getHttpServer())
      .get(BATCH_BASE)
      .query({ skuId, pageSize: 50 })
      .set(auth(token))
      .expect(200);
    const ids = list.body.data.map((row: { id: string }) => row.id);
    expect(ids).toEqual(expect.arrayContaining([a.body.data.id, b.body.data.id]));
  });

  it('posts GRN with split batch allocations and exposes totalReceived without currentStock', async () => {
    const token = await login();
    const { poId, itemId, skuId } = await createOrderedPo(token, 100);
    const grn = await createDraftGrn(token, poId, [{ purchaseOrderItemId: itemId, quantity: 100 }]);
    const itemIdGrn = grn.items[0]!.id;

    const lotA = `SPLIT-A-${Date.now()}`;
    const lotB = `SPLIT-B-${Date.now()}`;
    await request(app.getHttpServer())
      .post(`${GRN_BASE}/${grn.id}/items/${itemIdGrn}/batches`)
      .set(auth(token))
      .send({ supplierBatchNumber: lotA, quantity: 60 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${GRN_BASE}/${grn.id}/items/${itemIdGrn}/batches`)
      .set(auth(token))
      .send({ supplierBatchNumber: lotB, quantity: 40 })
      .expect(201);

    const allocations = await database.client.goodsReceiptItemBatch.findMany({
      where: { goodsReceiptItemId: itemIdGrn },
    });
    expect(allocations).toHaveLength(2);
    const batchAId = allocations.find((a) => a.quantity === 60)!.batchId;
    const batchBId = allocations.find((a) => a.quantity === 40)!.batchId;
    createdBatchIds.push(batchAId, batchBId);

    await request(app.getHttpServer())
      .post(`${GRN_BASE}/${grn.id}/post`)
      .set(auth(token))
      .send({})
      .expect(201);

    const detailA = await request(app.getHttpServer())
      .get(`${BATCH_BASE}/${batchAId}`)
      .set(auth(token))
      .expect(200);
    const detailB = await request(app.getHttpServer())
      .get(`${BATCH_BASE}/${batchBId}`)
      .set(auth(token))
      .expect(200);
    expect(detailA.body.data.totalReceived).toBe(60);
    expect(detailB.body.data.totalReceived).toBe(40);
    expect(detailA.body.data).not.toHaveProperty('currentStock');
    expect(detailB.body.data).not.toHaveProperty('currentStock');

    const listRow = await request(app.getHttpServer())
      .get(BATCH_BASE)
      .query({ skuId, pageSize: 50 })
      .set(auth(token))
      .expect(200);
    for (const row of listRow.body.data as Array<Record<string, unknown>>) {
      expect(row).not.toHaveProperty('currentStock');
    }
  });

  it('rejects POST when batch allocation is incomplete', async () => {
    const token = await login();
    const { poId, itemId } = await createOrderedPo(token, 50);
    const grn = await createDraftGrn(token, poId, [{ purchaseOrderItemId: itemId, quantity: 50 }]);
    const itemIdGrn = grn.items[0]!.id;

    await request(app.getHttpServer())
      .post(`${GRN_BASE}/${grn.id}/items/${itemIdGrn}/batches`)
      .set(auth(token))
      .send({ supplierBatchNumber: `PARTIAL-${Date.now()}`, quantity: 30 })
      .expect(201);

    const fail = await request(app.getHttpServer())
      .post(`${GRN_BASE}/${grn.id}/post`)
      .set(auth(token))
      .send({});
    expect(fail.status).toBe(409);
    expect(fail.body.error.code).toBe('BATCH_ALLOCATION_INCOMPLETE');
  });

  it('rejects allocation upsert that exceeds item quantity', async () => {
    const token = await login();
    const { poId, itemId } = await createOrderedPo(token, 20);
    const grn = await createDraftGrn(token, poId, [{ purchaseOrderItemId: itemId, quantity: 20 }]);
    const itemIdGrn = grn.items[0]!.id;

    const over = await request(app.getHttpServer())
      .post(`${GRN_BASE}/${grn.id}/items/${itemIdGrn}/batches`)
      .set(auth(token))
      .send({ supplierBatchNumber: `OVER-${Date.now()}`, quantity: 25 });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('BATCH_ALLOCATION_EXCEEDED');
  });

  it('rejects batch from wrong SKU on GRN item allocation', async () => {
    const token = await login();
    const { poId, itemId, skuId: grnSkuId } = await createOrderedPo(token, 10);
    const template = await database.client.sku.findFirstOrThrow({
      where: { id: grnSkuId, companyId: pishtehId },
    });
    const suffix = Date.now().toString(36).toUpperCase();
    const otherSku = await database.client.sku.create({
      data: {
        companyId: pishtehId,
        productId: template.productId,
        code: `BATCH-MISMATCH-${suffix}`,
        normalizedCode: `BATCH-MISMATCH-${suffix}`,
        variantSignature: `BATCH-MISMATCH:${suffix}`,
        name: 'Batch mismatch e2e',
      },
    });
    createdSkuIds.push(otherSku.id);

    const grn = await createDraftGrn(token, poId, [{ purchaseOrderItemId: itemId, quantity: 10 }]);
    const itemIdGrn = grn.items[0]!.id;

    const otherBatch = await request(app.getHttpServer())
      .post(BATCH_BASE)
      .set(auth(token))
      .send({ skuId: otherSku.id, supplierBatchNumber: `WRONG-SKU-${Date.now()}` })
      .expect(201);
    createdBatchIds.push(otherBatch.body.data.id);

    const mismatch = await request(app.getHttpServer())
      .post(`${GRN_BASE}/${grn.id}/items/${itemIdGrn}/batches`)
      .set(auth(token))
      .send({ batchId: otherBatch.body.data.id, quantity: 10 });
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error.code).toBe('BATCH_SKU_MISMATCH');
  });

  it('allows draft allocation edit/delete and blocks after POST', async () => {
    const token = await login();
    const { poId, itemId } = await createOrderedPo(token, 15);
    const grn = await createDraftGrn(token, poId, [{ purchaseOrderItemId: itemId, quantity: 15 }]);
    const itemIdGrn = grn.items[0]!.id;

    const upserted = await request(app.getHttpServer())
      .post(`${GRN_BASE}/${grn.id}/items/${itemIdGrn}/batches`)
      .set(auth(token))
      .send({ supplierBatchNumber: `DRAFT-EDIT-${Date.now()}`, quantity: 15 })
      .expect(201);
    const allocationId = upserted.body.data.items[0].batchAllocations[0].id as string;

    await request(app.getHttpServer())
      .patch(`${GRN_BASE}/${grn.id}/items/${itemIdGrn}/batches/${allocationId}`)
      .set(auth(token))
      .send({ quantity: 10 })
      .expect(200);

    await request(app.getHttpServer())
      .delete(`${GRN_BASE}/${grn.id}/items/${itemIdGrn}/batches/${allocationId}`)
      .set(auth(token))
      .expect(200);

    await request(app.getHttpServer())
      .post(`${GRN_BASE}/${grn.id}/items/${itemIdGrn}/batches`)
      .set(auth(token))
      .send({ supplierBatchNumber: `DRAFT-POST-${Date.now()}`, quantity: 15 })
      .expect(201);

    await request(app.getHttpServer())
      .post(`${GRN_BASE}/${grn.id}/post`)
      .set(auth(token))
      .send({})
      .expect(201);

    const postedDetail = await request(app.getHttpServer())
      .get(`${GRN_BASE}/${grn.id}`)
      .set(auth(token))
      .expect(200);
    const postedAllocId = postedDetail.body.data.items[0].batchAllocations[0].id as string;

    const patchPosted = await request(app.getHttpServer())
      .patch(`${GRN_BASE}/${grn.id}/items/${itemIdGrn}/batches/${postedAllocId}`)
      .set(auth(token))
      .send({ quantity: 5 });
    expect(patchPosted.status).toBe(409);

    const deletePosted = await request(app.getHttpServer())
      .delete(`${GRN_BASE}/${grn.id}/items/${itemIdGrn}/batches/${postedAllocId}`)
      .set(auth(token));
    expect(deletePosted.status).toBe(409);
  });

  it('isolates batches and allocations by tenant', async () => {
    const token = await login();
    const { poId, itemId, skuId } = await createOrderedPo(token, 10);
    const batch = await request(app.getHttpServer())
      .post(BATCH_BASE)
      .set(auth(token))
      .send({ skuId, supplierBatchNumber: `TENANT-A-${Date.now()}` })
      .expect(201);
    createdBatchIds.push(batch.body.data.id);

    await request(app.getHttpServer())
      .get(`${BATCH_BASE}/${batch.body.data.id}`)
      .set(auth(token, demoBId))
      .expect(404);

    const crossCreate = await request(app.getHttpServer())
      .post(BATCH_BASE)
      .set(auth(token, demoBId))
      .send({ skuId, supplierBatchNumber: 'SHOULD-FAIL' });
    expect(crossCreate.status).toBe(404);
    const grn = await createDraftGrn(token, poId, [{ purchaseOrderItemId: itemId, quantity: 5 }]);
    const itemIdGrn = grn.items[0]!.id;
    const demoBatch = await database.client.batch.findFirst({
      where: { companyId: demoBId },
    });
    if (demoBatch) {
      const crossAlloc = await request(app.getHttpServer())
        .post(`${GRN_BASE}/${grn.id}/items/${itemIdGrn}/batches`)
        .set(auth(token))
        .send({ batchId: demoBatch.id, quantity: 5 });
      expect([404, 409]).toContain(crossAlloc.status);
    }
  });

  it('rejects mass-assignment fields on batch create', async () => {
    const token = await login();
    const { skuId } = await createOrderedPo(token, 5);
    const res = await request(app.getHttpServer())
      .post(BATCH_BASE)
      .set(auth(token))
      .send({
        skuId,
        companyId: demoBId,
        batchNumber: 'BAT-HACK-001',
        currentStock: 999,
        totalReceived: 500,
      });
    expect(res.status).toBe(400);
  });

  it('resolves concurrent create of same supplier batch to one identity', async () => {
    const token = await login();
    const { skuId } = await createOrderedPo(token, 5);
    const lot = `CONCURRENT-${Date.now()}`;

    const first = await request(app.getHttpServer())
      .post(BATCH_BASE)
      .set(auth(token))
      .send({ skuId, supplierBatchNumber: lot })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post(BATCH_BASE)
      .set(auth(token))
      .send({ skuId, supplierBatchNumber: lot })
      .expect(201);
    expect(second.body.data.id).toBe(first.body.data.id);
    createdBatchIds.push(first.body.data.id);

    const raced = await Promise.all([
      request(app.getHttpServer())
        .post(BATCH_BASE)
        .set(auth(token))
        .send({ skuId, supplierBatchNumber: `${lot}-RACE` }),
      request(app.getHttpServer())
        .post(BATCH_BASE)
        .set(auth(token))
        .send({ skuId, supplierBatchNumber: `${lot}-RACE` }),
    ]);
    const ok = raced.filter((r) => r.status === 201);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    if (ok.length === 2) {
      expect(ok[0]!.body.data.id).toBe(ok[1]!.body.data.id);
    }
    createdBatchIds.push(ok[0]!.body.data.id);
  });

  it('scanner apply with supplier batch allocates and Phase 3.5 receiving totals hold', async () => {
    const token = await login();
    const mascara = await database.client.sku.findFirstOrThrow({
      where: { companyId: pishtehId, code: 'ESS-MASCARA-01' },
    });
    const barcode = `BATCH-SCAN-${randomUUID().slice(0, 8)}`;
    await ensureBarcode(mascara.id, barcode);

    const { poId: scanPoId } = await createOrderedPo(token, 20, mascara.id);
    const scanDraft = await createDraftGrn(token, scanPoId, []);
    const supplierLot = `SCAN-LOT-${Date.now()}`;

    await request(app.getHttpServer())
      .post(`${GRN_BASE}/${scanDraft.id}/scan/apply`)
      .set(auth(token))
      .send({
        barcode,
        quantity: 10,
        requestId: randomUUID(),
        supplierBatchNumber: supplierLot,
      })
      .expect(201);

    const afterScan = await request(app.getHttpServer())
      .get(`${GRN_BASE}/${scanDraft.id}`)
      .set(auth(token))
      .expect(200);
    expect(afterScan.body.data.items[0].batchAllocations).toHaveLength(1);
    expect(afterScan.body.data.items[0].batchAllocations[0].quantity).toBe(10);
    expect(afterScan.body.data.items[0].batchAllocations[0].supplierBatchNumber).toBe(supplierLot);

    await allocateAllItemsToBatches(app, auth(token), scanDraft.id);
    await request(app.getHttpServer())
      .post(`${GRN_BASE}/${scanDraft.id}/post`)
      .set(auth(token))
      .send({})
      .expect(201);

    const { poId, itemId } = await createOrderedPo(token, 100);
    const grn40 = await createDraftGrn(token, poId, [{ purchaseOrderItemId: itemId, quantity: 40 }]);
    await allocateAllItemsToBatches(app, auth(token), grn40.id);
    await request(app.getHttpServer())
      .post(`${GRN_BASE}/${grn40.id}/post`)
      .set(auth(token))
      .send({})
      .expect(201);

    const grn50 = await createDraftGrn(token, poId, [{ purchaseOrderItemId: itemId, quantity: 50 }]);
    await allocateAllItemsToBatches(app, auth(token), grn50.id);
    await request(app.getHttpServer())
      .post(`${GRN_BASE}/${grn50.id}/post`)
      .set(auth(token))
      .send({})
      .expect(201);

    const receiving = await request(app.getHttpServer())
      .get(`${PO_BASE}/${poId}/receiving`)
      .set(auth(token))
      .expect(200);
    expect(receiving.body.data.items[0].receivedQuantity).toBe(90);
    expect(receiving.body.data.items[0].remainingQuantity).toBe(10);
    expect(receiving.body.data.receivingOutcome).toBe('PARTIAL');

    const po = await database.client.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
    expect(po.status).toBe(PurchaseOrderStatus.PARTIALLY_RECEIVED);
  });
});
