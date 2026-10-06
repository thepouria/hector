import request from 'supertest';
import {
  CompanyMemberStatus,
  CurrencyCode,
  GoodsReceiptStatus,
  OWNER_ROLE_KEY,
  PaymentTermType,
  PurchaseCommercialType,
  PurchaseOrderStatus,
  UserStatus,
  WarehouseStatus,
  syncOwnerRolePermissions,
  syncPermissions,
} from '@hector/database';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { DOMAIN_EVENTS, DomainEventBus } from '../src/infrastructure/events';
import { allocateAllItemsToBatches } from './helpers/batch-allocation';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';
import { cleanupPayablesForGoodsReceipts } from './helpers/payable-cleanup';

describe('Goods Receipts (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let eventBus: DomainEventBus;
  const ownerEmail = 'pouria@hector.local';
  const warehouseOperatorEmail = 'hossein@hector.local';
  const password = E2E_PASSWORD;
  let pishtehId: string;
  let demoBId: string;
  let ownerUserId: string;
  let mainWarehouseId: string;
  let demoBWarehouseId: string;
  const tempCompanyIds: string[] = [];
  const createdReceiptIds: string[] = [];

  beforeAll(async () => {
    app = await createE2eApp();
    database = app.get(DatabaseService);
    eventBus = app.get(DomainEventBus);
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
    demoBWarehouseId = (
      await database.client.warehouse.findFirstOrThrow({
        where: { companyId: demoBId, code: 'MAIN' },
      })
    ).id;
    ownerUserId = (
      await database.client.user.update({
        where: { email: ownerEmail },
        data: { status: UserStatus.ACTIVE, deletedAt: null },
      })
    ).id;

    const opRole = await database.client.role.findFirstOrThrow({
      where: { companyId: pishtehId, key: 'WAREHOUSE_OPERATOR', deletedAt: null },
    });
    const receiptPerms = await database.client.permission.findMany({
      where: {
        key: {
          in: [
            'warehouse.receipt.read',
            'warehouse.receipt.manage',
            'warehouse.receipt.post',
            'warehouse.read',
          ],
        },
      },
    });
    for (const permission of receiptPerms) {
      await database.client.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId: opRole.id, permissionId: permission.id },
        },
        update: {},
        create: { roleId: opRole.id, permissionId: permission.id },
      });
    }
  });

  afterAll(async () => {
    if (createdReceiptIds.length > 0) {
      await cleanupPayablesForGoodsReceipts(database, createdReceiptIds);
      await database.client.goodsReceiptItem.deleteMany({
        where: { goodsReceiptId: { in: createdReceiptIds } },
      });
      await database.client.goodsReceipt.deleteMany({
        where: { id: { in: createdReceiptIds } },
      });
    }
    if (tempCompanyIds.length > 0) {
      const tempReceiptIds = (
        await database.client.goodsReceipt.findMany({
          where: { companyId: { in: tempCompanyIds } },
          select: { id: true },
        })
      ).map((r) => r.id);
      await cleanupPayablesForGoodsReceipts(database, tempReceiptIds);
      await database.client.goodsReceiptItem.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.goodsReceipt.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.goodsReceiptSequence.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.purchaseOrderItem.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.purchaseOrder.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.purchaseOrderSequence.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.supplier.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.sku.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.product.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.warehouseLocation.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.warehouse.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.auditLog.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.companyMemberRole.deleteMany({
        where: { companyMember: { companyId: { in: tempCompanyIds } } },
      });
      await database.client.rolePermission.deleteMany({
        where: { role: { companyId: { in: tempCompanyIds } } },
      });
      await database.client.companyMember.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.role.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.company.deleteMany({
        where: { id: { in: tempCompanyIds } },
      });
    }
    await app.close();
  });

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return res.body.data.accessToken as string;
  }

  function auth(token: string, companyId = pishtehId) {
    return {
      Authorization: `Bearer ${token}`,
      'X-Company-Id': companyId,
    };
  }

  async function createOrderedPo(
    token: string,
    quantity = 1000,
  ): Promise<{ poId: string; itemId: string; skuId: string }> {
    const supplier = await database.client.supplier.findFirstOrThrow({
      where: { companyId: pishtehId, status: 'ACTIVE' },
    });
    const sku = await database.client.sku.findFirstOrThrow({
      where: { companyId: pishtehId, status: 'ACTIVE' },
    });
    const created = await request(app.getHttpServer())
      .post('/api/v1/purchasing/purchase-orders')
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
    const itemId = created.body.data.items[0].id as string;
    await request(app.getHttpServer())
      .post(`/api/v1/purchasing/purchase-orders/${poId}/approve`)
      .set(auth(token))
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/purchasing/purchase-orders/${poId}/mark-ordered`)
      .set(auth(token))
      .send({})
      .expect(201);
    return { poId, itemId, skuId: sku.id };
  }

  async function createDraftGrn(
    token: string,
    body: {
      purchaseOrderId: string;
      warehouseId?: string;
      items?: Array<{ purchaseOrderItemId: string; quantity: number }>;
      notes?: string;
    },
  ) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/goods-receipts')
      .set(auth(token))
      .send({
        purchaseOrderId: body.purchaseOrderId,
        warehouseId: body.warehouseId ?? mainWarehouseId,
        items: body.items,
        notes: body.notes,
      })
      .expect(201);
    createdReceiptIds.push(res.body.data.id);
    return res.body.data;
  }

  it('creates draft, mutates items, posts partial then completes with second GRN', async () => {
    const token = await login(ownerEmail);
    const { poId, itemId } = await createOrderedPo(token, 1000);

    const draft = await createDraftGrn(token, {
      purchaseOrderId: poId,
      items: [{ purchaseOrderItemId: itemId, quantity: 600 }],
    });
    expect(draft.status).toBe(GoodsReceiptStatus.DRAFT);
    expect(draft.number).toMatch(/^GRN-\d{4}-\d{6,}$/);

    const progressBefore = await request(app.getHttpServer())
      .get(`/api/v1/goods-receipts/purchase-orders/${poId}/progress`)
      .set(auth(token))
      .expect(200);
    expect(progressBefore.body.data.items[0].postedReceivedQuantity).toBe(0);
    expect(progressBefore.body.data.items[0].remainingQuantity).toBe(1000);

    const received: string[] = [];
    const handlerId = `grn-e2e-${Date.now()}`;
    for (const type of [
      DOMAIN_EVENTS.WAREHOUSE_GOODS_RECEIPT_POSTED,
      DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_PARTIALLY_RECEIVED,
      DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_RECEIVED,
    ]) {
      eventBus.subscribe(type, `${handlerId}-${type}`, (event) => {
        received.push(event.type);
      });
    }

    await allocateAllItemsToBatches(app, auth(token), draft.id);
    const posted1 = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${draft.id}/post`)
      .set(auth(token))
      .send({})
      .expect(201);
    expect(posted1.body.data.status).toBe(GoodsReceiptStatus.POSTED);
    expect(posted1.body.data.postedAt).toBeTruthy();

    const poAfter1 = await database.client.purchaseOrder.findUniqueOrThrow({
      where: { id: poId },
    });
    expect(poAfter1.status).toBe(PurchaseOrderStatus.PARTIALLY_RECEIVED);

    const progressMid = await request(app.getHttpServer())
      .get(`/api/v1/goods-receipts/purchase-orders/${poId}/progress`)
      .set(auth(token))
      .expect(200);
    expect(progressMid.body.data.items[0].postedReceivedQuantity).toBe(600);
    expect(progressMid.body.data.items[0].remainingQuantity).toBe(400);

    const draft2 = await createDraftGrn(token, {
      purchaseOrderId: poId,
      items: [{ purchaseOrderItemId: itemId, quantity: 400 }],
    });
    await allocateAllItemsToBatches(app, auth(token), draft2.id);
    await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${draft2.id}/post`)
      .set(auth(token))
      .send({})
      .expect(201);

    const poAfter2 = await database.client.purchaseOrder.findUniqueOrThrow({
      where: { id: poId },
    });
    expect(poAfter2.status).toBe(PurchaseOrderStatus.RECEIVED);

    const overCreate = await request(app.getHttpServer())
      .post('/api/v1/goods-receipts')
      .set(auth(token))
      .send({
        purchaseOrderId: poId,
        warehouseId: mainWarehouseId,
        items: [{ purchaseOrderItemId: itemId, quantity: 1 }],
      });
    expect(overCreate.status).toBe(409);
    expect(overCreate.body.error.code).toBe('PURCHASE_ORDER_ALREADY_RECEIVED');

    expect(received).toContain(DOMAIN_EVENTS.WAREHOUSE_GOODS_RECEIPT_POSTED);
    expect(received).toContain(DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_PARTIALLY_RECEIVED);
    expect(received).toContain(DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_RECEIVED);
  });

  it('excludes draft quantities from received totals', async () => {
    const token = await login(ownerEmail);
    const { poId, itemId } = await createOrderedPo(token, 1000);
    await createDraftGrn(token, {
      purchaseOrderId: poId,
      items: [{ purchaseOrderItemId: itemId, quantity: 400 }],
    });
    const progress = await request(app.getHttpServer())
      .get(`/api/v1/goods-receipts/purchase-orders/${poId}/progress`)
      .set(auth(token))
      .expect(200);
    expect(progress.body.data.items[0].postedReceivedQuantity).toBe(0);
    expect(progress.body.data.items[0].remainingQuantity).toBe(1000);
  });

  it('rejects over-receipt and accepts exact remaining', async () => {
    const token = await login(ownerEmail);
    const { poId, itemId } = await createOrderedPo(token, 1000);
    const g1 = await createDraftGrn(token, {
      purchaseOrderId: poId,
      items: [{ purchaseOrderItemId: itemId, quantity: 900 }],
    });
    await allocateAllItemsToBatches(app, auth(token), g1.id);
    await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${g1.id}/post`)
      .set(auth(token))
      .send({})
      .expect(201);

    const tooMuch = await createDraftGrn(token, {
      purchaseOrderId: poId,
      items: [{ purchaseOrderItemId: itemId, quantity: 101 }],
    });
    await allocateAllItemsToBatches(app, auth(token), tooMuch.id);
    const fail = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${tooMuch.id}/post`)
      .set(auth(token))
      .send({});
    expect(fail.status).toBe(409);
    expect(fail.body.error.code).toBe('PURCHASE_ORDER_OVER_RECEIPT_NOT_ALLOWED');

    const exact = await createDraftGrn(token, {
      purchaseOrderId: poId,
      items: [{ purchaseOrderItemId: itemId, quantity: 100 }],
    });
    await allocateAllItemsToBatches(app, auth(token), exact.id);
    await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${exact.id}/post`)
      .set(auth(token))
      .send({})
      .expect(201);
  });

  it('enforces posted immutability and draft-only cancel', async () => {
    const token = await login(ownerEmail);
    const { poId, itemId } = await createOrderedPo(token, 50);
    const draft = await createDraftGrn(token, {
      purchaseOrderId: poId,
      items: [{ purchaseOrderItemId: itemId, quantity: 10 }],
    });
    await allocateAllItemsToBatches(app, auth(token), draft.id);
    await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${draft.id}/post`)
      .set(auth(token))
      .send({})
      .expect(201);

    const patch = await request(app.getHttpServer())
      .patch(`/api/v1/goods-receipts/${draft.id}`)
      .set(auth(token))
      .send({ notes: 'hack' });
    expect(patch.status).toBe(409);

    const add = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${draft.id}/items`)
      .set(auth(token))
      .send({ purchaseOrderItemId: itemId, quantity: 1 });
    expect(add.status).toBe(409);

    const cancelPosted = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${draft.id}/cancel`)
      .set(auth(token))
      .send({});
    expect(cancelPosted.status).toBe(409);

    const draft2 = await createDraftGrn(token, { purchaseOrderId: poId });
    await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${draft2.id}/cancel`)
      .set(auth(token))
      .send({ reason: 'operator abort' })
      .expect(201);
    const cancelled = await request(app.getHttpServer())
      .get(`/api/v1/goods-receipts/${draft2.id}`)
      .set(auth(token))
      .expect(200);
    expect(cancelled.body.data.status).toBe(GoodsReceiptStatus.CANCELLED);
  });

  it('rejects wrong PO item, inactive warehouse, cancelled PO, mass assignment', async () => {
    const token = await login(ownerEmail);
    const a = await createOrderedPo(token, 100);
    const b = await createOrderedPo(token, 100);

    const massAssign = await request(app.getHttpServer())
      .post('/api/v1/goods-receipts')
      .set(auth(token))
      .send({
        purchaseOrderId: a.poId,
        warehouseId: mainWarehouseId,
        companyId: demoBId,
        status: 'POSTED',
        postedAt: '2026-10-04T00:00:00.000Z',
      });
    expect(massAssign.status).toBe(400);

    const createWrong = await request(app.getHttpServer())
      .post('/api/v1/goods-receipts')
      .set(auth(token))
      .send({
        purchaseOrderId: a.poId,
        warehouseId: mainWarehouseId,
        items: [{ purchaseOrderItemId: b.itemId, quantity: 10 }],
      });
    expect(createWrong.status).toBe(400);
    expect(createWrong.body.error.code).toBe('GOODS_RECEIPT_PO_ITEM_MISMATCH');

    const inactive = await database.client.warehouse.create({
      data: {
        companyId: pishtehId,
        code: `INACT-${Date.now().toString(36).toUpperCase()}`,
        name: 'Inactive temp',
        status: WarehouseStatus.INACTIVE,
        isDefault: false,
      },
    });
    const inactiveCreate = await request(app.getHttpServer())
      .post('/api/v1/goods-receipts')
      .set(auth(token))
      .send({
        purchaseOrderId: a.poId,
        warehouseId: inactive.id,
        items: [{ purchaseOrderItemId: a.itemId, quantity: 1 }],
      });
    expect(inactiveCreate.status).toBe(409);
    await database.client.warehouse.delete({ where: { id: inactive.id } });

    const cancelledPo = await createOrderedPo(token, 20);
    await request(app.getHttpServer())
      .post(`/api/v1/purchasing/purchase-orders/${cancelledPo.poId}/cancel`)
      .set(auth(token))
      .send({ reason: 'cancel for grn test' })
      .expect(201);
    const againstCancelled = await request(app.getHttpServer())
      .post('/api/v1/goods-receipts')
      .set(auth(token))
      .send({
        purchaseOrderId: cancelledPo.poId,
        warehouseId: mainWarehouseId,
      });
    expect(againstCancelled.status).toBe(409);
  });

  it('blocks cross-company IDOR and demo-B warehouse with Pishteh PO', async () => {
    const token = await login(ownerEmail);
    const { poId, itemId } = await createOrderedPo(token, 30);
    const grn = await createDraftGrn(token, {
      purchaseOrderId: poId,
      items: [{ purchaseOrderItemId: itemId, quantity: 5 }],
    });

    const idorGet = await request(app.getHttpServer())
      .get(`/api/v1/goods-receipts/${grn.id}`)
      .set(auth(token, demoBId));
    expect(idorGet.status).toBe(404);

    const idorPost = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${grn.id}/post`)
      .set(auth(token, demoBId))
      .send({});
    expect(idorPost.status).toBe(404);

    const crossWh = await request(app.getHttpServer())
      .post('/api/v1/goods-receipts')
      .set(auth(token))
      .send({
        purchaseOrderId: poId,
        warehouseId: demoBWarehouseId,
        items: [{ purchaseOrderItemId: itemId, quantity: 1 }],
      });
    expect(crossWh.status).toBe(404);
  });

  it('enforces RBAC for warehouse operator vs unauthorized', async () => {
    const ownerToken = await login(ownerEmail);
    const opToken = await login(warehouseOperatorEmail);
    const { poId, itemId } = await createOrderedPo(ownerToken, 40);

    await request(app.getHttpServer())
      .get('/api/v1/goods-receipts')
      .set(auth(opToken))
      .expect(200);

    const draft = await request(app.getHttpServer())
      .post('/api/v1/goods-receipts')
      .set(auth(opToken))
      .send({
        purchaseOrderId: poId,
        warehouseId: mainWarehouseId,
        items: [{ purchaseOrderItemId: itemId, quantity: 10 }],
      })
      .expect(201);
    createdReceiptIds.push(draft.body.data.id);

    await allocateAllItemsToBatches(app, auth(opToken), draft.body.data.id);
    await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${draft.body.data.id}/post`)
      .set(auth(opToken))
      .send({})
      .expect(201);

    const slug = `grn-rbac-${Date.now()}`;
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
        key: 'NO_RECEIPT',
        name: 'No Receipt',
        isSystem: false,
      },
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
    const denied = await request(app.getHttpServer())
      .get('/api/v1/goods-receipts')
      .set(auth(ownerToken, company.id));
    expect(denied.status).toBe(403);
  });

  it('serializes concurrent post of same GRN and concurrent over-receipt across GRNs', async () => {
    const token = await login(ownerEmail);
    const { poId, itemId } = await createOrderedPo(token, 100);

    const same = await createDraftGrn(token, {
      purchaseOrderId: poId,
      items: [{ purchaseOrderItemId: itemId, quantity: 50 }],
    });
    await allocateAllItemsToBatches(app, auth(token), same.id);
    const [a, b] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/goods-receipts/${same.id}/post`)
        .set(auth(token))
        .send({}),
      request(app.getHttpServer())
        .post(`/api/v1/goods-receipts/${same.id}/post`)
        .set(auth(token))
        .send({}),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const postedCount = await database.client.goodsReceipt.count({
      where: { id: same.id, status: GoodsReceiptStatus.POSTED },
    });
    expect(postedCount).toBe(1);

    const { poId: po2, itemId: item2 } = await createOrderedPo(token, 100);
    const gA = await createDraftGrn(token, {
      purchaseOrderId: po2,
      items: [{ purchaseOrderItemId: item2, quantity: 100 }],
    });
    const gB = await createDraftGrn(token, {
      purchaseOrderId: po2,
      items: [{ purchaseOrderItemId: item2, quantity: 100 }],
    });
    await allocateAllItemsToBatches(app, auth(token), gA.id);
    await allocateAllItemsToBatches(app, auth(token), gB.id);
    const [c, d] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/goods-receipts/${gA.id}/post`)
        .set(auth(token))
        .send({}),
      request(app.getHttpServer())
        .post(`/api/v1/goods-receipts/${gB.id}/post`)
        .set(auth(token))
        .send({}),
    ]);
    const race = [c.status, d.status].sort();
    expect(race).toEqual([201, 409]);
    const sum = await database.client.goodsReceiptItem.aggregate({
      where: {
        purchaseOrderItemId: item2,
        goodsReceipt: { status: GoodsReceiptStatus.POSTED },
      },
      _sum: { quantity: true },
    });
    expect(sum._sum.quantity).toBe(100);
  });

  it('allocates unique GRN numbers under concurrent creates', async () => {
    const token = await login(ownerEmail);
    const { poId } = await createOrderedPo(token, 10);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app.getHttpServer())
          .post('/api/v1/goods-receipts')
          .set(auth(token))
          .send({ purchaseOrderId: poId, warehouseId: mainWarehouseId }),
      ),
    );
    for (const res of results) {
      expect(res.status).toBe(201);
      createdReceiptIds.push(res.body.data.id);
    }
    const numbers = results.map((r) => r.body.data.number as string);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('keeps list/detail/progress within sanity bounds for 100 POs / 500 GRNs / 2000 items', async () => {
    const token = await login(ownerEmail);
    const slug = `grn-perf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const company = await database.client.company.create({
      data: {
        name: `GRN Perf ${slug}`,
        slug,
        baseCurrency: CurrencyCode.IRR,
        timezone: 'Asia/Tehran',
      },
    });
    tempCompanyIds.push(company.id);

    // Synthetic POSTED rows bypass recognition hooks (list/progress perf only).
    // Clean immediately in finally so --forceExit cannot leave integrity orphans.
    try {
      const role = await database.client.role.create({
        data: {
          companyId: company.id,
          key: OWNER_ROLE_KEY,
          name: 'Owner',
          isSystem: true,
        },
      });
      const templateOwner = await database.client.role.findFirstOrThrow({
        where: { companyId: pishtehId, key: OWNER_ROLE_KEY, deletedAt: null },
        include: { permissions: { select: { permissionId: true } } },
      });
      if (templateOwner.permissions.length > 0) {
        await database.client.rolePermission.createMany({
          data: templateOwner.permissions.map((p) => ({
            roleId: role.id,
            permissionId: p.permissionId,
          })),
          skipDuplicates: true,
        });
      }
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

      const warehouse = await database.client.warehouse.create({
        data: {
          companyId: company.id,
          code: 'MAIN',
          name: 'اصلی',
          status: WarehouseStatus.ACTIVE,
          isDefault: true,
        },
      });
      const supplier = await database.client.supplier.create({
        data: {
          companyId: company.id,
          name: 'Perf Supplier',
          code: 'PERF-SUP',
        },
      });
      const product = await database.client.product.create({
        data: {
          companyId: company.id,
          name: 'Perf Product',
          normalizedName: 'perf product',
          code: 'PERF-P',
          normalizedCode: 'PERF-P',
        },
      });
      const skuIds: string[] = [];
      for (let i = 0; i < 4; i += 1) {
        const sku = await database.client.sku.create({
          data: {
            companyId: company.id,
            productId: product.id,
            code: `PERF-SKU-${i + 1}`,
            normalizedCode: `PERF-SKU-${i + 1}`,
            variantSignature: `PERF:${i + 1}`,
            name: `Variant ${i + 1}`,
          },
        });
        skuIds.push(sku.id);
      }

      const poCount = 100;
      const grnsPerPo = 5;
      const lineQty = 1000;
      const unitPrice = '10000';
      const lineSubtotal = '10000000';
      const orderDate = new Date('2026-10-01T12:00:00.000Z');
      const poRows = Array.from({ length: poCount }, (_, i) => ({
        id: randomUUID(),
        companyId: company.id,
        number: `PERF-PO-${String(i + 1).padStart(4, '0')}`,
        supplierId: supplier.id,
        status: PurchaseOrderStatus.PARTIALLY_RECEIVED,
        currency: CurrencyCode.IRR,
        purchaseType: PurchaseCommercialType.CASH,
        paymentTermType: PaymentTermType.IMMEDIATE,
        orderDate,
        subtotal: lineSubtotal,
        total: String(Number(lineSubtotal) * skuIds.length),
        createdById: ownerUserId,
        orderedById: ownerUserId,
        orderedAt: orderDate,
        supplierNameSnapshot: supplier.name,
        supplierCodeSnapshot: supplier.code,
        version: 1,
      }));
      for (let i = 0; i < poRows.length; i += 50) {
        await database.client.purchaseOrder.createMany({ data: poRows.slice(i, i + 50) });
      }

      const poItemRows: Array<{
        id: string;
        companyId: string;
        purchaseOrderId: string;
        skuId: string;
        quantity: number;
        unitPrice: string;
        lineSubtotal: string;
        skuCodeSnapshot: string;
        productNameSnapshot: string;
      }> = [];
      for (const po of poRows) {
        for (let s = 0; s < skuIds.length; s += 1) {
          poItemRows.push({
            id: randomUUID(),
            companyId: company.id,
            purchaseOrderId: po.id,
            skuId: skuIds[s]!,
            quantity: lineQty,
            unitPrice,
            lineSubtotal,
            skuCodeSnapshot: `PERF-SKU-${s + 1}`,
            productNameSnapshot: 'Perf Product',
          });
        }
      }
      for (let i = 0; i < poItemRows.length; i += 200) {
        await database.client.purchaseOrderItem.createMany({ data: poItemRows.slice(i, i + 200) });
      }

      const itemsByPo = new Map<string, typeof poItemRows>();
      for (const item of poItemRows) {
        const list = itemsByPo.get(item.purchaseOrderId) ?? [];
        list.push(item);
        itemsByPo.set(item.purchaseOrderId, list);
      }

      const grnRows: Array<{
        id: string;
        companyId: string;
        number: string;
        warehouseId: string;
        purchaseOrderId: string;
        supplierId: string;
        status: typeof GoodsReceiptStatus.POSTED;
        receivedAt: Date;
        postedAt: Date;
        createdById: string;
        postedById: string;
        version: number;
      }> = [];
      const itemRows: Array<{
        companyId: string;
        goodsReceiptId: string;
        purchaseOrderItemId: string;
        skuId: string;
        quantity: number;
      }> = [];
      let grnSeq = 0;
      for (const po of poRows) {
        const poItems = itemsByPo.get(po.id)!;
        for (let g = 0; g < grnsPerPo; g += 1) {
          grnSeq += 1;
          const grnId = randomUUID();
          grnRows.push({
            id: grnId,
            companyId: company.id,
            number: `GRN-2026-${String(grnSeq).padStart(6, '0')}`,
            warehouseId: warehouse.id,
            purchaseOrderId: po.id,
            supplierId: supplier.id,
            status: GoodsReceiptStatus.POSTED,
            receivedAt: orderDate,
            postedAt: orderDate,
            createdById: ownerUserId,
            postedById: ownerUserId,
            version: 1,
          });
          for (const poi of poItems) {
            itemRows.push({
              companyId: company.id,
              goodsReceiptId: grnId,
              purchaseOrderItemId: poi.id,
              skuId: poi.skuId,
              quantity: 1,
            });
          }
        }
      }
      for (let i = 0; i < grnRows.length; i += 100) {
        await database.client.goodsReceipt.createMany({ data: grnRows.slice(i, i + 100) });
      }
      for (let i = 0; i < itemRows.length; i += 400) {
        await database.client.goodsReceiptItem.createMany({ data: itemRows.slice(i, i + 400) });
      }

      expect(grnRows.length).toBe(500);
      expect(itemRows.length).toBe(2000);

      const listStarted = Date.now();
      const list = await request(app.getHttpServer())
        .get('/api/v1/goods-receipts')
        .query({ pageSize: 50, page: 1 })
        .set(auth(token, company.id))
        .expect(200);
      const listMs = Date.now() - listStarted;
      expect(list.body.meta.total).toBe(500);
      expect(listMs).toBeLessThan(10_000);

      const detailStarted = Date.now();
      const detail = await request(app.getHttpServer())
        .get(`/api/v1/goods-receipts/${grnRows[0]!.id}`)
        .set(auth(token, company.id))
        .expect(200);
      const detailMs = Date.now() - detailStarted;
      expect(detail.body.data.items).toHaveLength(4);
      expect(detailMs).toBeLessThan(5_000);

      const progressStarted = Date.now();
      const progress = await request(app.getHttpServer())
        .get(`/api/v1/goods-receipts/purchase-orders/${poRows[0]!.id}/progress`)
        .set(auth(token, company.id))
        .expect(200);
      const progressMs = Date.now() - progressStarted;
      expect(progress.body.data.items).toHaveLength(4);
      expect(progress.body.data.items[0].postedReceivedQuantity).toBe(grnsPerPo);
      expect(progress.body.data.items[0].remainingQuantity).toBe(lineQty - grnsPerPo);
      expect(progressMs).toBeLessThan(5_000);
    } finally {
      const receiptIds = (
        await database.client.goodsReceipt.findMany({
          where: { companyId: company.id },
          select: { id: true },
        })
      ).map((r) => r.id);
      await cleanupPayablesForGoodsReceipts(database, receiptIds);
      await database.client.goodsReceiptItem.deleteMany({ where: { companyId: company.id } });
      await database.client.goodsReceipt.deleteMany({ where: { companyId: company.id } });
      await database.client.goodsReceiptSequence.deleteMany({ where: { companyId: company.id } });
      await database.client.purchaseOrderItem.deleteMany({ where: { companyId: company.id } });
      await database.client.purchaseOrder.deleteMany({ where: { companyId: company.id } });
      await database.client.purchaseOrderSequence.deleteMany({ where: { companyId: company.id } });
      await database.client.supplier.deleteMany({ where: { companyId: company.id } });
      await database.client.sku.deleteMany({ where: { companyId: company.id } });
      await database.client.product.deleteMany({ where: { companyId: company.id } });
      await database.client.warehouseLocation.deleteMany({ where: { companyId: company.id } });
      await database.client.warehouse.deleteMany({ where: { companyId: company.id } });
      await database.client.auditLog.deleteMany({ where: { companyId: company.id } });
      await database.client.companyMemberRole.deleteMany({
        where: { companyMember: { companyId: company.id } },
      });
      await database.client.rolePermission.deleteMany({
        where: { role: { companyId: company.id } },
      });
      await database.client.companyMember.deleteMany({ where: { companyId: company.id } });
      await database.client.role.deleteMany({ where: { companyId: company.id } });
      await database.client.company.delete({ where: { id: company.id } }).catch(() => undefined);
      const idx = tempCompanyIds.indexOf(company.id);
      if (idx >= 0) tempCompanyIds.splice(idx, 1);
    }
  }, 120_000);

  it('writes audit records for create/post/cancel', async () => {
    const token = await login(ownerEmail);
    const { poId, itemId } = await createOrderedPo(token, 25);
    const draft = await createDraftGrn(token, {
      purchaseOrderId: poId,
      items: [{ purchaseOrderItemId: itemId, quantity: 5 }],
      notes: 'audit trail',
    });
    await allocateAllItemsToBatches(app, auth(token), draft.id);
    await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${draft.id}/post`)
      .set(auth(token))
      .send({})
      .expect(201);

    const audits = await database.client.auditLog.findMany({
      where: {
        companyId: pishtehId,
        entityId: draft.id,
        action: { in: ['GOODS_RECEIPT_CREATED', 'GOODS_RECEIPT_POSTED'] },
      },
    });
    expect(audits.map((a) => a.action).sort()).toEqual([
      'GOODS_RECEIPT_CREATED',
      'GOODS_RECEIPT_POSTED',
    ]);

    const draftCancel = await createDraftGrn(token, { purchaseOrderId: poId });
    await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${draftCancel.id}/cancel`)
      .set(auth(token))
      .send({})
      .expect(201);
    const cancelAudit = await database.client.auditLog.findFirst({
      where: { entityId: draftCancel.id, action: 'GOODS_RECEIPT_CANCELLED' },
    });
    expect(cancelAudit).toBeTruthy();
  });
});
