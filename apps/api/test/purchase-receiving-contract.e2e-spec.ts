import request from 'supertest';
import { PurchaseOrderStatus } from '@hector/database';
import type { INestApplication } from '@nestjs/common';
import { ERROR_CODES } from '../src/common/constants';
import { AppError } from '../src/common/exceptions/app.error';
import { PurchaseReceivingContract } from '../src/modules/purchasing/contracts/purchase-receiving.contract';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';

const BASE = '/api/v1/purchasing/purchase-orders';

/**
 * Phase 2.10 — Purchasing receiving contract (Warehouse boundary).
 * Does not create GoodsReceipt / stock. No public receive endpoints.
 */
describe('Purchase Receiving Contract (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let receiving: PurchaseReceivingContract;
  const ownerEmail = 'pouria@hector.local';
  let pishtehId: string;
  let demoBId: string;
  let tehranSupplierId: string;
  let mascaraSkuId: string;
  let conc1SkuId: string;
  let demoBPoId: string;
  /** POs created by this suite — deleted in afterAll so synthetic RECEIVED rows do not pollute other e2e. */
  const createdPoIds: string[] = [];

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

  async function createOrderedPo(token: string): Promise<{ id: string; itemId: string }> {
    const h = auth(token);
    const created = await request(app.getHttpServer())
      .post(BASE)
      .set(h)
      .send({
        supplierId: tehranSupplierId,
        currency: 'IRR',
        purchaseType: 'CASH',
        paymentTermType: 'IMMEDIATE',
        orderDate: '2026-10-03',
        items: [
          { skuId: mascaraSkuId, quantity: 500, unitPrice: '1000000' },
          { skuId: conc1SkuId, quantity: 300, unitPrice: '2000000' },
        ],
      })
      .expect(201);
    const id = created.body.data.id as string;
    createdPoIds.push(id);
    await request(app.getHttpServer()).post(`${BASE}/${id}/approve`).set(h).expect(201);
    await request(app.getHttpServer()).post(`${BASE}/${id}/mark-ordered`).set(h).expect(201);
    const detail = await request(app.getHttpServer()).get(`${BASE}/${id}`).set(h).expect(200);
    return { id, itemId: detail.body.data.items[0].id as string };
  }

  beforeAll(async () => {
    app = await createE2eApp();
    database = app.get(DatabaseService);
    receiving = app.get(PurchaseReceivingContract);

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
    const demoBOwner = await db.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    const foreign = await db.purchaseOrder.create({
      data: {
        companyId: demoBId,
        number: `SEED-ISO-RECV-${Date.now()}`,
        supplierId: (
          await db.supplier.findFirstOrThrow({ where: { companyId: demoBId } })
        ).id,
        currency: 'IRR',
        orderDate: new Date(),
        subtotal: 1000,
        total: 1000,
        createdById: demoBOwner.id,
      },
    });
    await db.purchaseOrderItem.create({
      data: {
        companyId: demoBId,
        purchaseOrderId: foreign.id,
        skuId: (await db.sku.findFirstOrThrow({ where: { companyId: demoBId } })).id,
        quantity: 1,
        unitPrice: 1000,
        lineSubtotal: 1000,
      },
    });
    demoBPoId = foreign.id;
    createdPoIds.push(foreign.id);
  });

  afterAll(async () => {
    if (createdPoIds.length > 0) {
      await database.client.purchaseOrderCost.deleteMany({
        where: { purchaseOrderId: { in: createdPoIds } },
      });
      await database.client.purchaseOrderItem.deleteMany({
        where: { purchaseOrderId: { in: createdPoIds } },
      });
      await database.client.purchaseOrder.deleteMany({
        where: { id: { in: createdPoIds } },
      });
    }
    await app.close();
  });

  it('returns receiving context for ORDERED PO with stable item/SKU/quantity identity', async () => {
    const token = await login();
    const { id } = await createOrderedPo(token);
    const company = { companyId: pishtehId, companyMemberId: 'unused-for-contract-read' };
    // companyMemberId is unused by the contract; companyId scopes the query.
    const ctx = await receiving.getReceivingContext(company, id);

    expect(ctx.purchaseOrderId).toBe(id);
    expect(ctx.companyId).toBe(pishtehId);
    expect(ctx.status).toBe(PurchaseOrderStatus.ORDERED);
    expect(ctx.supplierId).toBe(tehranSupplierId);
    expect(ctx.items).toHaveLength(2);
    for (const item of ctx.items) {
      expect(item.purchaseOrderItemId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(item.skuId).toBeTruthy();
      expect(item.orderedQuantity).toBeGreaterThan(0);
    }
    expect(ctx.items.map((i) => i.orderedQuantity).sort()).toEqual([300, 500]);
    // No commercial leakage on the narrow contract.
    expect(ctx).not.toHaveProperty('unitPrice');
    expect(ctx).not.toHaveProperty('obligationAmount');
    expect(ctx).not.toHaveProperty('purchaseCosts');
  });

  it('assertReceivingAllowed: ORDERED/PARTIAL pass; DRAFT/APPROVED/CANCELLED/RECEIVED fail', async () => {
    const token = await login();
    const h = auth(token);
    const company = { companyId: pishtehId, companyMemberId: 'x' };

    const draft = await request(app.getHttpServer())
      .post(BASE)
      .set(h)
      .send({
        supplierId: tehranSupplierId,
        currency: 'IRR',
        purchaseType: 'CASH',
        paymentTermType: 'IMMEDIATE',
        orderDate: '2026-10-03',
        items: [{ skuId: mascaraSkuId, quantity: 10, unitPrice: '1000000' }],
      })
      .expect(201);
    createdPoIds.push(draft.body.data.id as string);
    await expect(
      receiving.assertReceivingAllowed(company, draft.body.data.id),
    ).rejects.toMatchObject({ code: ERROR_CODES.PURCHASE_ORDER_NOT_RECEIVABLE });

    await request(app.getHttpServer())
      .post(`${BASE}/${draft.body.data.id}/approve`)
      .set(h)
      .expect(201);
    await expect(
      receiving.assertReceivingAllowed(company, draft.body.data.id),
    ).rejects.toMatchObject({ code: ERROR_CODES.PURCHASE_ORDER_NOT_RECEIVABLE });

    const { id: orderedId } = await createOrderedPo(token);
    await expect(receiving.assertReceivingAllowed(company, orderedId)).resolves.toMatchObject({
      status: PurchaseOrderStatus.ORDERED,
    });

    // PARTIALLY_RECEIVED eligibility (synthetic status for contract test only — not via public API).
    await database.client.purchaseOrder.update({
      where: { id: orderedId },
      data: { status: PurchaseOrderStatus.PARTIALLY_RECEIVED },
    });
    await expect(receiving.assertReceivingAllowed(company, orderedId)).resolves.toMatchObject({
      status: PurchaseOrderStatus.PARTIALLY_RECEIVED,
    });

    await database.client.purchaseOrder.update({
      where: { id: orderedId },
      data: { status: PurchaseOrderStatus.RECEIVED },
    });
    await expect(receiving.assertReceivingAllowed(company, orderedId)).rejects.toMatchObject({
      code: ERROR_CODES.PURCHASE_ORDER_ALREADY_RECEIVED,
    });

    const cancelled = await createOrderedPo(token);
    await request(app.getHttpServer())
      .post(`${BASE}/${cancelled.id}/cancel`)
      .set(h)
      .send({ reason: 'contract test' })
      .expect(201);
    await expect(receiving.assertReceivingAllowed(company, cancelled.id)).rejects.toMatchObject({
      code: ERROR_CODES.PURCHASE_ORDER_CANCELLED,
    });
  });

  it('enforces company isolation on receiving context', async () => {
    const company = { companyId: pishtehId, companyMemberId: 'x' };
    try {
      await receiving.getReceivingContext(company, demoBPoId);
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ERROR_CODES.PURCHASE_ORDER_NOT_FOUND);
      expect((error as AppError).statusCode).toBe(404);
    }
  });

  it('recalculateReceivingStatus is pure and does not mutate PO / stock / finance', async () => {
    const token = await login();
    const { id } = await createOrderedPo(token);
    const before = await database.client.purchaseOrder.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });
    // Purchasing recalculate must not touch competing stock tables (FIFO / StockBalance).
    // Phase 3.9 owns inventory_movements / inventory_balances — receiving recalculate still
    // must not write them.
    const forbiddenTables = await database.client.$queryRawUnsafe<Array<{ tablename: string }>>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'
       AND tablename = ANY(ARRAY[
         'inventory','stock_balances','fifo_layers'
       ])`,
    );
    expect(forbiddenTables).toHaveLength(0);
    const movementCountBefore = await database.client.inventoryMovement.count({
      where: { companyId: pishtehId },
    });

    const status = receiving.recalculateReceivingStatus(
      before.items.map((i) => ({
        purchaseOrderItemId: i.id,
        orderedQuantity: i.quantity,
      })),
      [
        {
          purchaseOrderItemId: before.items[0]!.id,
          acceptedReceivedQuantity: Math.min(1, before.items[0]!.quantity),
        },
      ],
    );
    expect(status).toBe(PurchaseOrderStatus.PARTIALLY_RECEIVED);

    const after = await database.client.purchaseOrder.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });
    expect(after.status).toBe(PurchaseOrderStatus.ORDERED);
    expect(after.items[0]!.quantity).toBe(before.items[0]!.quantity);
    expect(after.items[0]!.unitPrice.toString()).toBe(before.items[0]!.unitPrice.toString());
    const movementCountAfter = await database.client.inventoryMovement.count({
      where: { companyId: pishtehId },
    });
    expect(movementCountAfter).toBe(movementCountBefore);
  });

  it('exposes no public receive / mark-received / partial-receive endpoints', async () => {
    const token = await login();
    const h = auth(token);
    const { id } = await createOrderedPo(token);
    for (const path of [
      `${BASE}/${id}/receive`,
      `${BASE}/${id}/mark-received`,
      `${BASE}/${id}/partial-receive`,
      `${BASE}/${id}/partially-receive`,
    ]) {
      await request(app.getHttpServer()).post(path).set(h).expect(404);
    }
  });
});
