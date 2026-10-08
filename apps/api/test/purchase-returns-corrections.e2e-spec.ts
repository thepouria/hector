import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { ERROR_CODES } from '../src/common/constants';
import { DOMAIN_EVENTS } from '../src/infrastructure/events';
import { DomainEventBus } from '../src/infrastructure/events/domain-event.bus';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';

const PO_BASE = '/api/v1/purchasing/purchase-orders';
const RETURN_BASE = '/api/v1/purchasing/purchase-returns';

describe('Purchase Returns / Corrections (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let eventBus: DomainEventBus;
  const ownerEmail = 'pouria@hector.local';
  let pishtehId: string;
  let demoBId: string;
  let tehranSupplierId: string;
  let mascaraSkuId: string;
  let conc1SkuId: string;
  const createdPoIds: string[] = [];
  const createdReturnIds: string[] = [];

  const auth = (token: string, companyId = pishtehId) => ({
    Authorization: `Bearer ${token}`,
    'X-Company-Id': companyId,
  });

  async function login(email = ownerEmail): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: E2E_PASSWORD })
      .expect(200);
    return res.body.data.accessToken as string;
  }

  async function createOrderedPo(token: string) {
    const h = auth(token);
    const created = await request(app.getHttpServer())
      .post(PO_BASE)
      .set(h)
      .send({
        supplierId: tehranSupplierId,
        currency: 'IRR',
        purchaseType: 'CASH',
        paymentTermType: 'IMMEDIATE',
        orderDate: '2026-10-03',
        items: [
          { skuId: mascaraSkuId, quantity: 1000, unitPrice: '1000000' },
          { skuId: conc1SkuId, quantity: 500, unitPrice: '2000000' },
        ],
      })
      .expect(201);
    const id = created.body.data.id as string;
    createdPoIds.push(id);
    await request(app.getHttpServer()).post(`${PO_BASE}/${id}/approve`).set(h).expect(201);
    const ordered = await request(app.getHttpServer())
      .post(`${PO_BASE}/${id}/order`)
      .set(h)
      .expect(201);
    return ordered.body.data as {
      id: string;
      version: number;
      items: Array<{ id: string; skuId: string; quantity: number }>;
    };
  }

  beforeAll(async () => {
    app = await createE2eApp();
    database = app.get(DatabaseService);
    eventBus = app.get(DomainEventBus);
    const db = database.client;
    pishtehId = (await db.company.findUniqueOrThrow({ where: { slug: 'pishteh' } })).id;
    demoBId = (await db.company.findUniqueOrThrow({ where: { slug: 'hector-demo-b' } })).id;
    tehranSupplierId = (
      await db.supplier.findFirstOrThrow({ where: { companyId: pishtehId, code: 'TEH-BEAUTY' } })
    ).id;
    mascaraSkuId = (
      await db.sku.findFirstOrThrow({ where: { companyId: pishtehId, code: 'ESS-MASCARA-01' } })
    ).id;
    conc1SkuId = (
      await db.sku.findFirstOrThrow({ where: { companyId: pishtehId, code: 'FAN-CONC-01' } })
    ).id;
  });

  afterAll(async () => {
    if (createdReturnIds.length > 0) {
      await database.client.purchaseReturnItem.deleteMany({
        where: { purchaseReturnId: { in: createdReturnIds } },
      });
      await database.client.purchaseReturn.deleteMany({
        where: { id: { in: createdReturnIds } },
      });
    }
    if (createdPoIds.length > 0) {
      const { cleanupE2ePurchaseOrders } = await import('./helpers/payable-cleanup');
      await cleanupE2ePurchaseOrders(database, createdPoIds);
    }
    await app.close();
  });

  it('applies explicit quantity correction with before/after audit and event', async () => {
    const token = await login();
    const h = auth(token);
    const po = await createOrderedPo(token);
    const item = po.items[0]!;

    const events: Array<{ type: string }> = [];
    const handlerId = `corr-${Date.now()}`;
    eventBus.subscribe(DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_CORRECTED, handlerId, async (e) => {
      events.push({ type: e.type });
    });

    const corrected = await request(app.getHttpServer())
      .post(`${PO_BASE}/${po.id}/corrections`)
      .set(h)
      .send({
        type: 'QUANTITY_CORRECTION',
        reason: 'Supplier confirmed actual order was 900',
        version: po.version,
        purchaseOrderItemId: item.id,
        quantity: 900,
      })
      .expect(201);

    expect(corrected.body.data.beforeSnapshot.quantity).toBe(1000);
    expect(corrected.body.data.afterSnapshot.quantity).toBe(900);
    expect(corrected.body.data.reason).toContain('900');

    const detail = await request(app.getHttpServer()).get(`${PO_BASE}/${po.id}`).set(h).expect(200);
    const line = detail.body.data.items.find((i: { id: string }) => i.id === item.id);
    expect(line.quantity).toBe(900);

    // Generic PATCH still blocked on committed commercial fields.
    await request(app.getHttpServer())
      .patch(`${PO_BASE}/${po.id}/items/${item.id}`)
      .set(h)
      .send({ quantity: 800 })
      .expect(409);

    expect(events).toHaveLength(1);

    const audits = await database.client.auditLog.findMany({
      where: {
        companyId: pishtehId,
        action: 'PURCHASE_ORDER_CORRECTED',
        entityId: corrected.body.data.id,
      },
    });
    expect(audits).toHaveLength(1);
  });

  it('blocks supplier and purchase-type correction paths', async () => {
    const token = await login();
    const h = auth(token);
    const po = await createOrderedPo(token);
    const res = await request(app.getHttpServer())
      .post(`${PO_BASE}/${po.id}/corrections`)
      .set(h)
      .send({
        type: 'SUPPLIER_CORRECTION',
        reason: 'wrong supplier',
        version: po.version,
      })
      .expect(409);
    expect(res.body.error.code).toBe(ERROR_CODES.PURCHASE_CORRECTION_UNSUPPORTED);
  });

  it('short-closes without rewriting ordered quantity', async () => {
    const token = await login();
    const h = auth(token);
    const po = await createOrderedPo(token);
    const item = po.items[0]!;

    const closed = await request(app.getHttpServer())
      .post(`${PO_BASE}/${po.id}/items/${item.id}/short-close`)
      .set(h)
      .send({ quantity: 100, reason: 'Supplier out of stock for remainder' })
      .expect(201);

    expect(closed.body.data.item.orderedQuantity).toBe(1000);
    expect(closed.body.data.item.closedUnfulfilledQuantity).toBe(100);
    expect(closed.body.data.discrepancy.type).toBe('SHORT_SHIPMENT');
    expect(closed.body.data.discrepancy.status).toBe('SHORT_CLOSED');

    const detail = await request(app.getHttpServer()).get(`${PO_BASE}/${po.id}`).set(h).expect(200);
    const line = detail.body.data.items.find((i: { id: string }) => i.id === item.id);
    expect(line.quantity).toBe(1000);
    expect(line.closedUnfulfilledQuantity).toBe(100);
  });

  it('records discrepancy without mutating ordered quantity', async () => {
    const token = await login();
    const h = auth(token);
    const po = await createOrderedPo(token);
    const item = po.items[0]!;
    const res = await request(app.getHttpServer())
      .post(`${PO_BASE}/${po.id}/discrepancies`)
      .set(h)
      .send({
        purchaseOrderItemId: item.id,
        type: 'DAMAGED',
        source: 'AFTER_RECEIPT',
        quantity: 20,
        reason: 'Carton crushed — purchasing note only',
      })
      .expect(201);
    expect(res.body.data.quantity).toBe(20);

    const detail = await request(app.getHttpServer()).get(`${PO_BASE}/${po.id}`).set(h).expect(200);
    const line = detail.body.data.items.find((i: { id: string }) => i.id === item.id);
    expect(line.quantity).toBe(1000);
  });

  it('supports purchase return lifecycle without stock/finance side effects', async () => {
    const token = await login();
    const h = auth(token);
    const po = await createOrderedPo(token);
    const itemA = po.items[0]!;
    const itemB = po.items[1]!;

    const created = await request(app.getHttpServer())
      .post(RETURN_BASE)
      .set(h)
      .send({
        purchaseOrderId: po.id,
        reason: 'DEFECTIVE',
        expectedResolution: 'SUPPLIER_CREDIT',
        notes: 'Will ship back after Warehouse exists',
        items: [
          { purchaseOrderItemId: itemA.id, quantity: 100 },
          { purchaseOrderItemId: itemB.id, quantity: 10, reason: 'WRONG_ITEM' },
        ],
      })
      .expect(201);
    createdReturnIds.push(created.body.data.id);
    expect(created.body.data.status).toBe('DRAFT');
    expect(created.body.data.number).toMatch(/^PR-\d{4}-\d{6,}$/);
    expect(created.body.data.items).toHaveLength(2);
    expect(created.body.data.physicalExecution).toBe('DEFERRED_TO_WAREHOUSE');
    expect(created.body.data.financialResolution).toBe('DEFERRED_TO_FINANCE');
    expect(created.body.data.supplierId).toBe(tehranSupplierId);

    const approved = await request(app.getHttpServer())
      .post(`${RETURN_BASE}/${created.body.data.id}/approve`)
      .set(h)
      .expect(201);
    expect(approved.body.data.status).toBe('APPROVED');

    // Purchase Return approve must not write Inventory Ledger or Finance tables.
    // Phase 3.9 owns inventory_movements; returns still do not create movements.
    const forbiddenTables = await database.client.$queryRawUnsafe<Array<{ tablename: string }>>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'
       AND tablename = ANY(ARRAY[
         'inventory','stock_balances','fifo_layers','payables'
       ])`,
    );
    expect(forbiddenTables).toHaveLength(0);
    const returnMovements = await database.client.inventoryMovement.count({
      where: {
        companyId: pishtehId,
        sourceType: 'SUPPLIER_RETURN',
        sourceId: created.body.data.id,
      },
    });
    expect(returnMovements).toBe(0);

    // Second return against same PO is allowed.
    const second = await request(app.getHttpServer())
      .post(RETURN_BASE)
      .set(h)
      .send({
        purchaseOrderId: po.id,
        reason: 'DAMAGED',
        items: [{ purchaseOrderItemId: itemA.id, quantity: 5 }],
      })
      .expect(201);
    createdReturnIds.push(second.body.data.id);

    await request(app.getHttpServer())
      .post(`${RETURN_BASE}/${second.body.data.id}/cancel`)
      .set(h)
      .send({ reason: 'plan abandoned' })
      .expect(201);
  });

  it('rejects return item not on PO and mismatched SKU', async () => {
    const token = await login();
    const h = auth(token);
    const po = await createOrderedPo(token);
    const foreignItem = await database.client.purchaseOrderItem.findFirst({
      where: { companyId: pishtehId, purchaseOrderId: { not: po.id } },
    });
    expect(foreignItem).toBeTruthy();

    const badItem = await request(app.getHttpServer())
      .post(RETURN_BASE)
      .set(h)
      .send({
        purchaseOrderId: po.id,
        reason: 'OTHER',
        items: [{ purchaseOrderItemId: foreignItem!.id, quantity: 1 }],
      })
      .expect(400);
    expect(badItem.body.error.code).toBe(ERROR_CODES.PURCHASE_RETURN_ITEM_INVALID);

    const badSku = await request(app.getHttpServer())
      .post(RETURN_BASE)
      .set(h)
      .send({
        purchaseOrderId: po.id,
        reason: 'OTHER',
        items: [
          {
            purchaseOrderItemId: po.items[0]!.id,
            skuId: conc1SkuId,
            quantity: 1,
          },
        ],
      })
      .expect(400);
    expect(badSku.body.error.code).toBe(ERROR_CODES.PURCHASE_RETURN_SKU_MISMATCH);
  });

  it('enforces company isolation for corrections and returns', async () => {
    const token = await login();
    const h = auth(token);
    const po = await createOrderedPo(token);

    // Demo B company context cannot see Pishteh PO.
    const foreign = await request(app.getHttpServer())
      .post(`${PO_BASE}/${po.id}/corrections`)
      .set(auth(token, demoBId))
      .send({
        type: 'QUANTITY_CORRECTION',
        reason: 'cross company',
        version: 1,
        purchaseOrderItemId: po.items[0]!.id,
        quantity: 1,
      })
      .expect(404);
    expect(foreign.body.error.code).toBe(ERROR_CODES.PURCHASE_ORDER_NOT_FOUND);

    await request(app.getHttpServer())
      .post(RETURN_BASE)
      .set(auth(token, demoBId))
      .send({
        purchaseOrderId: po.id,
        reason: 'OTHER',
        items: [{ purchaseOrderItemId: po.items[0]!.id, quantity: 1 }],
      })
      .expect(404);

    // Mass assignment: unknown/system fields are rejected by ValidationPipe.
    await request(app.getHttpServer())
      .post(RETURN_BASE)
      .set(h)
      .send({
        purchaseOrderId: po.id,
        reason: 'QUALITY_ISSUE',
        items: [{ purchaseOrderItemId: po.items[0]!.id, quantity: 2 }],
        companyId: demoBId,
        status: 'APPROVED',
        approvedById: '00000000-0000-0000-0000-000000000000',
      })
      .expect(400);

    const created = await request(app.getHttpServer())
      .post(RETURN_BASE)
      .set(h)
      .send({
        purchaseOrderId: po.id,
        reason: 'QUALITY_ISSUE',
        items: [{ purchaseOrderItemId: po.items[0]!.id, quantity: 2 }],
      })
      .expect(201);
    createdReturnIds.push(created.body.data.id);
    expect(created.body.data.companyId).toBe(pishtehId);
    expect(created.body.data.status).toBe('DRAFT');
    expect(created.body.data.approvedBy).toBeNull();
  });

  it('lets exactly one concurrent return approve win', async () => {
    const token = await login();
    const h = auth(token);
    const po = await createOrderedPo(token);
    const created = await request(app.getHttpServer())
      .post(RETURN_BASE)
      .set(h)
      .send({
        purchaseOrderId: po.id,
        reason: 'DEFECTIVE',
        items: [{ purchaseOrderItemId: po.items[0]!.id, quantity: 5 }],
      })
      .expect(201);
    createdReturnIds.push(created.body.data.id);

    const results = await Promise.all(
      [1, 2, 3].map(() =>
        request(app.getHttpServer())
          .post(`${RETURN_BASE}/${created.body.data.id}/approve`)
          .set(h),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);

    const row = await database.client.purchaseReturn.findUniqueOrThrow({
      where: { id: created.body.data.id },
    });
    expect(row.status).toBe('APPROVED');
    expect(row.version).toBe(2);

    const audits = await database.client.auditLog.count({
      where: {
        companyId: pishtehId,
        entityId: created.body.data.id,
        action: 'PURCHASE_RETURN_APPROVED',
      },
    });
    expect(audits).toBe(1);
  });

  it('blocks zero/negative return quantities', async () => {
    const token = await login();
    const h = auth(token);
    const po = await createOrderedPo(token);
    await request(app.getHttpServer())
      .post(RETURN_BASE)
      .set(h)
      .send({
        purchaseOrderId: po.id,
        reason: 'OTHER',
        items: [{ purchaseOrderItemId: po.items[0]!.id, quantity: 0 }],
      })
      .expect(400);
  });
});
