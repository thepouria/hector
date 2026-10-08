import request from 'supertest';
import {
  CurrencyCode,
  PaymentTermType,
  PurchaseCommercialType,
  PurchaseOrderStatus,
  UserStatus,
  syncOwnerRolePermissions,
  syncPermissions,
} from '@hector/database';
import type { INestApplication } from '@nestjs/common';
import { DOMAIN_EVENTS, DomainEventBus } from '../src/infrastructure/events';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { allocateAllItemsToBatches } from './helpers/batch-allocation';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';
import {
  cleanupPayablesForGoodsReceipts,
  cleanupE2ePurchaseOrders,
} from './helpers/payable-cleanup';

const PO_BASE = '/api/v1/purchasing/purchase-orders';
const GRN_BASE = '/api/v1/goods-receipts';

describe('Purchase Receiving (Phase 3.5 e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let eventBus: DomainEventBus;
  const ownerEmail = 'pouria@hector.local';
  let pishtehId: string;
  let demoBId: string;
  let mainWarehouseId: string;
  let ownerUserId: string;
  const createdPoIds: string[] = [];
  const createdReceiptIds: string[] = [];

  beforeAll(async () => {
    app = await createE2eApp();
    database = app.get(DatabaseService);
    eventBus = app.get(DomainEventBus);
    await syncPermissions(database.client);
    await syncOwnerRolePermissions(database.client);

    pishtehId = (await database.client.company.findUniqueOrThrow({ where: { slug: 'pishteh' } })).id;
    demoBId = (
      await database.client.company.findUniqueOrThrow({ where: { slug: 'hector-demo-b' } })
    ).id;
    mainWarehouseId = (
      await database.client.warehouse.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'MAIN' },
      })
    ).id;
    ownerUserId = (
      await database.client.user.update({
        where: { email: ownerEmail },
        data: { status: UserStatus.ACTIVE, deletedAt: null },
      })
    ).id;
    void ownerUserId;
  });

  afterAll(async () => {
    if (createdPoIds.length > 0) {
      await cleanupE2ePurchaseOrders(database, createdPoIds);
    } else if (createdReceiptIds.length > 0) {
      await cleanupPayablesForGoodsReceipts(database, createdReceiptIds);
      await database.client.goodsReceiptItem.deleteMany({
        where: { goodsReceiptId: { in: createdReceiptIds } },
      });
      await database.client.goodsReceipt.deleteMany({
        where: { id: { in: createdReceiptIds } },
      });
    }
    await app.close();
  });

  async function login(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password: E2E_PASSWORD })
      .expect(200);
    return res.body.data.accessToken as string;
  }

  function auth(token: string, companyId = pishtehId) {
    return { Authorization: `Bearer ${token}`, 'X-Company-Id': companyId };
  }

  async function createOrderedPo(token: string, quantity = 100) {
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
    return {
      poId,
      itemId: created.body.data.items[0].id as string,
      version: created.body.data.version as number,
    };
  }

  async function postReceipt(
    token: string,
    poId: string,
    itemId: string,
    quantity: number,
  ): Promise<string> {
    const draft = await request(app.getHttpServer())
      .post(GRN_BASE)
      .set(auth(token))
      .send({
        purchaseOrderId: poId,
        warehouseId: mainWarehouseId,
        items: [{ purchaseOrderItemId: itemId, quantity }],
      })
      .expect(201);
    createdReceiptIds.push(draft.body.data.id);
    await allocateAllItemsToBatches(app, auth(token), draft.body.data.id);
    await request(app.getHttpServer())
      .post(`${GRN_BASE}/${draft.body.data.id}/post`)
      .set(auth(token))
      .send({})
      .expect(201);
    return draft.body.data.id as string;
  }

  it('tracks ordered/received/short/remaining across multiple GRNs then full receive', async () => {
    const token = await login();
    const { poId, itemId } = await createOrderedPo(token, 100);

    const initial = await request(app.getHttpServer())
      .get(`${PO_BASE}/${poId}/receiving`)
      .set(auth(token))
      .expect(200);
    expect(initial.body.data.items[0].orderedQuantity).toBe(100);
    expect(initial.body.data.items[0].receivedQuantity).toBe(0);
    expect(initial.body.data.items[0].shortQuantity).toBe(0);
    expect(initial.body.data.items[0].remainingQuantity).toBe(100);
    expect(initial.body.data.receivingOutcome).toBe('AWAITING');

    await postReceipt(token, poId, itemId, 40);
    const after1 = await request(app.getHttpServer())
      .get(`${PO_BASE}/${poId}/receiving`)
      .set(auth(token))
      .expect(200);
    expect(after1.body.data.items[0].receivedQuantity).toBe(40);
    expect(after1.body.data.items[0].remainingQuantity).toBe(60);
    expect(after1.body.data.receivingOutcome).toBe('PARTIAL');

    const po1 = await database.client.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
    expect(po1.status).toBe(PurchaseOrderStatus.PARTIALLY_RECEIVED);

    await postReceipt(token, poId, itemId, 50);
    const after2 = await request(app.getHttpServer())
      .get(`${PO_BASE}/${poId}/receiving`)
      .set(auth(token))
      .expect(200);
    expect(after2.body.data.items[0].receivedQuantity).toBe(90);
    expect(after2.body.data.items[0].shortQuantity).toBe(0);
    expect(after2.body.data.items[0].remainingQuantity).toBe(10);

    await postReceipt(token, poId, itemId, 10);
    const after3 = await request(app.getHttpServer())
      .get(`${PO_BASE}/${poId}/receiving`)
      .set(auth(token))
      .expect(200);
    expect(after3.body.data.items[0].receivedQuantity).toBe(100);
    expect(after3.body.data.items[0].remainingQuantity).toBe(0);
    expect(after3.body.data.receivingOutcome).toBe('FULLY_RECEIVED');
    expect(after3.body.data.hasShortage).toBe(false);

    const poFinal = await database.client.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
    expect(poFinal.status).toBe(PurchaseOrderStatus.RECEIVED);
  });

  it('does not auto-short on partial receipt; close-remaining closes with shortage', async () => {
    const token = await login();
    const { poId, itemId } = await createOrderedPo(token, 100);
    await postReceipt(token, poId, itemId, 40);
    await postReceipt(token, poId, itemId, 50);

    const mid = await request(app.getHttpServer())
      .get(`${PO_BASE}/${poId}/receiving`)
      .set(auth(token))
      .expect(200);
    expect(mid.body.data.items[0].receivedQuantity).toBe(90);
    expect(mid.body.data.items[0].shortQuantity).toBe(0);
    expect(mid.body.data.items[0].remainingQuantity).toBe(10);

    const events: string[] = [];
    const handlerId = `recv-short-${Date.now()}`;
    eventBus.subscribe(DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_SHORT_CLOSED, handlerId, (e) => {
      events.push(e.type);
    });
    eventBus.subscribe(DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_RECEIVED, `${handlerId}-r`, (e) => {
      events.push(e.type);
    });

    const closed = await request(app.getHttpServer())
      .post(`${PO_BASE}/${poId}/items/${itemId}/close-remaining`)
      .set(auth(token))
      .send({ reason: 'Supplier cancelled remainder' })
      .expect(201);

    expect(closed.body.data.item.receivedQuantity).toBe(90);
    expect(closed.body.data.item.shortQuantity).toBe(10);
    expect(closed.body.data.item.remainingQuantity).toBe(0);
    expect(closed.body.data.receivingOutcome).toBe('CLOSED_WITH_SHORTAGE');
    expect(closed.body.data.purchaseOrderStatus).toBe(PurchaseOrderStatus.RECEIVED);

    const progress = await request(app.getHttpServer())
      .get(`${PO_BASE}/${poId}/receiving`)
      .set(auth(token))
      .expect(200);
    expect(progress.body.data.receivingOutcome).toBe('CLOSED_WITH_SHORTAGE');
    expect(progress.body.data.hasShortage).toBe(true);
    expect(progress.body.data.shortages.length).toBeGreaterThanOrEqual(1);

    // Warehouse GRN progress shares the same formulas.
    const whProgress = await request(app.getHttpServer())
      .get(`${GRN_BASE}/purchase-orders/${poId}/progress`)
      .set(auth(token))
      .expect(200);
    expect(whProgress.body.data.receivingOutcome).toBe('CLOSED_WITH_SHORTAGE');
    expect(whProgress.body.data.items[0].receivedQuantity).toBe(90);

    expect(events).toContain(DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_SHORT_CLOSED);
    expect(events).toContain(DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_RECEIVED);

    // Draft exclusion still holds
    const draft = await request(app.getHttpServer())
      .post(GRN_BASE)
      .set(auth(token))
      .send({ purchaseOrderId: poId, warehouseId: mainWarehouseId })
      .expect(409);
    expect(draft.body.error.code).toBe('PURCHASE_ORDER_ALREADY_RECEIVED');
  });

  it('excludes draft and cancelled GRNs from received totals', async () => {
    const token = await login();
    const { poId, itemId } = await createOrderedPo(token, 100);
    const draft = await request(app.getHttpServer())
      .post(GRN_BASE)
      .set(auth(token))
      .send({
        purchaseOrderId: poId,
        warehouseId: mainWarehouseId,
        items: [{ purchaseOrderItemId: itemId, quantity: 50 }],
      })
      .expect(201);
    createdReceiptIds.push(draft.body.data.id);

    let progress = await request(app.getHttpServer())
      .get(`${PO_BASE}/${poId}/receiving`)
      .set(auth(token))
      .expect(200);
    expect(progress.body.data.items[0].receivedQuantity).toBe(0);

    await request(app.getHttpServer())
      .post(`${GRN_BASE}/${draft.body.data.id}/cancel`)
      .set(auth(token))
      .send({})
      .expect(201);

    progress = await request(app.getHttpServer())
      .get(`${PO_BASE}/${poId}/receiving`)
      .set(auth(token))
      .expect(200);
    expect(progress.body.data.items[0].receivedQuantity).toBe(0);
    expect(progress.body.data.receipts.some((r: { status: string }) => r.status === 'CANCELLED')).toBe(
      true,
    );
  });

  it('rejects short beyond remaining and concurrent post vs short', async () => {
    const token = await login();
    const { poId, itemId } = await createOrderedPo(token, 100);
    await postReceipt(token, poId, itemId, 90);

    await request(app.getHttpServer())
      .post(`${PO_BASE}/${poId}/items/${itemId}/short-close`)
      .set(auth(token))
      .send({ quantity: 11, reason: 'too much' })
      .expect(400);

    const draftA = await request(app.getHttpServer())
      .post(GRN_BASE)
      .set(auth(token))
      .send({
        purchaseOrderId: poId,
        warehouseId: mainWarehouseId,
        items: [{ purchaseOrderItemId: itemId, quantity: 10 }],
      })
      .expect(201);
    createdReceiptIds.push(draftA.body.data.id);
    const draftB = await request(app.getHttpServer())
      .post(GRN_BASE)
      .set(auth(token))
      .send({
        purchaseOrderId: poId,
        warehouseId: mainWarehouseId,
        items: [{ purchaseOrderItemId: itemId, quantity: 10 }],
      })
      .expect(201);
    createdReceiptIds.push(draftB.body.data.id);

    await allocateAllItemsToBatches(app, auth(token), draftA.body.data.id);

    // Concurrent: one post + one short against remaining 10
    const [postRes, shortRes] = await Promise.all([
      request(app.getHttpServer())
        .post(`${GRN_BASE}/${draftA.body.data.id}/post`)
        .set(auth(token))
        .send({}),
      request(app.getHttpServer())
        .post(`${PO_BASE}/${poId}/items/${itemId}/close-remaining`)
        .set(auth(token))
        .send({ reason: 'race short' }),
    ]);
    expect([postRes.status, shortRes.status].filter((s) => s === 201)).toHaveLength(1);
    expect([postRes.status, shortRes.status].some((s) => s === 400 || s === 409)).toBe(true);

    const progress = await request(app.getHttpServer())
      .get(`${PO_BASE}/${poId}/receiving`)
      .set(auth(token))
      .expect(200);
    const item = progress.body.data.items[0];
    expect(item.receivedQuantity + item.shortQuantity).toBe(100);
    expect(item.remainingQuantity).toBe(0);
    expect(item.receivedQuantity + item.shortQuantity).toBeLessThanOrEqual(100);
  });

  it('blocks IDOR for receiving progress and short-close', async () => {
    const token = await login();
    const { poId, itemId } = await createOrderedPo(token, 20);
    await request(app.getHttpServer())
      .get(`${PO_BASE}/${poId}/receiving`)
      .set(auth(token, demoBId))
      .expect(404);
    await request(app.getHttpServer())
      .post(`${PO_BASE}/${poId}/items/${itemId}/close-remaining`)
      .set(auth(token, demoBId))
      .send({ reason: 'x' })
      .expect(404);
  });

  it('keeps receiving progress query efficient for many lines', async () => {
    const token = await login();
    const supplier = await database.client.supplier.findFirstOrThrow({
      where: { companyId: pishtehId, status: 'ACTIVE' },
    });
    const skus = await database.client.sku.findMany({
      where: { companyId: pishtehId, status: 'ACTIVE' },
      take: 5,
    });
    expect(skus.length).toBeGreaterThanOrEqual(1);

    const created = await request(app.getHttpServer())
      .post(PO_BASE)
      .set(auth(token))
      .send({
        supplierId: supplier.id,
        currency: CurrencyCode.IRR,
        purchaseType: PurchaseCommercialType.CASH,
        paymentTermType: PaymentTermType.IMMEDIATE,
        orderDate: '2026-10-04T00:00:00.000Z',
        items: skus.map((sku) => ({ skuId: sku.id, quantity: 50, unitPrice: '1000' })),
      })
      .expect(201);
    createdPoIds.push(created.body.data.id);
    const poId = created.body.data.id as string;
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

    const started = Date.now();
    const progress = await request(app.getHttpServer())
      .get(`${PO_BASE}/${poId}/receiving`)
      .set(auth(token))
      .expect(200);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(progress.body.data.items.length).toBe(skus.length);
  });

  it('seed fixtures expose partial and closed-with-shortage outcomes', async () => {
    const token = await login();
    const receivingPo = await database.client.purchaseOrder.findUniqueOrThrow({
      where: { companyId_number: { companyId: pishtehId, number: 'SEED-PO-RECEIVING-01' } },
    });
    const shortPo = await database.client.purchaseOrder.findUniqueOrThrow({
      where: { companyId_number: { companyId: pishtehId, number: 'SEED-PO-SHORT-01' } },
    });

    const partial = await request(app.getHttpServer())
      .get(`${PO_BASE}/${receivingPo.id}/receiving`)
      .set(auth(token))
      .expect(200);
    expect(partial.body.data.items[0].receivedQuantity).toBe(90);
    expect(partial.body.data.items[0].remainingQuantity).toBe(10);
    expect(partial.body.data.receivingOutcome).toBe('PARTIAL');

    const closed = await request(app.getHttpServer())
      .get(`${PO_BASE}/${shortPo.id}/receiving`)
      .set(auth(token))
      .expect(200);
    expect(closed.body.data.items[0].receivedQuantity).toBe(90);
    expect(closed.body.data.items[0].shortQuantity).toBe(10);
    expect(closed.body.data.receivingOutcome).toBe('CLOSED_WITH_SHORTAGE');
    expect(closed.body.data.status).toBe(PurchaseOrderStatus.RECEIVED);
  });
});
