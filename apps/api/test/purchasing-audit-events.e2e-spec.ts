import request from 'supertest';
import {
  CompanyMemberStatus,
  UserStatus,
  syncOwnerRolePermissions,
  syncPermissions,
} from '@hector/database';
import type { INestApplication } from '@nestjs/common';
import {
  DOMAIN_EVENTS,
  DomainEventBus,
  type DomainEvent,
} from '../src/infrastructure/events';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';

/**
 * Phase 2.15 — consolidated Purchasing Audit + Domain Events gates.
 * Complements entity-specific suites (purchase-orders, suppliers, costs, returns).
 */
describe('Purchasing Audit + Events (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let eventBus: DomainEventBus;

  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;
  const sink: DomainEvent[] = [];

  let pishtehId: string;
  let demoBId: string;
  let supplierId: string;
  let skuId: string;
  let ownerUserId: string;
  let token: string;

  const auth = (accessToken: string, companyId = pishtehId) => ({
    Authorization: `Bearer ${accessToken}`,
    'X-Company-Id': companyId,
  });

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
    supplierId = (
      await database.client.supplier.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'TEH-BEAUTY' },
      })
    ).id;
    skuId = (
      await database.client.sku.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'ESS-MASCARA-01' },
      })
    ).id;

    const owner = await database.client.user.update({
      where: { email: ownerEmail },
      data: { status: UserStatus.ACTIVE },
    });
    ownerUserId = owner.id;
    await database.client.companyMember.updateMany({
      where: { userId: owner.id, companyId: pishtehId },
      data: { status: CompanyMemberStatus.ACTIVE },
    });

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password })
      .expect(200);
    token = login.body.data.accessToken;

    for (const type of [
      DOMAIN_EVENTS.PURCHASING_SUPPLIER_CREATED,
      DOMAIN_EVENTS.PURCHASING_SUPPLIER_OFFER_CREATED,
      DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_CREATED,
      DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_APPROVED,
      DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_ORDERED,
      DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_CANCELLED,
      DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_CORRECTED,
      DOMAIN_EVENTS.PURCHASING_PURCHASE_DUE_DATE_CHANGED,
      DOMAIN_EVENTS.PURCHASING_PURCHASE_RETURN_CREATED,
      DOMAIN_EVENTS.PURCHASING_PURCHASE_RETURN_APPROVED,
    ]) {
      eventBus.subscribe(type, `purchasing-audit-e2e-${type}`, async (event) => {
        sink.push(event);
      });
    }
  });

  beforeEach(() => {
    sink.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  async function createDraftPo(notes = '2.15 audit') {
    const res = await request(app.getHttpServer())
      .post('/api/v1/purchasing/purchase-orders')
      .set(auth(token))
      .send({
        supplierId,
        currency: 'IRR',
        purchaseType: 'CASH',
        paymentTermType: 'IMMEDIATE',
        orderDate: '2026-10-03',
        notes,
        items: [{ skuId, quantity: 10, unitPrice: '1000000' }],
      })
      .expect(201);
    return res.body.data as { id: string; version: number; number: string };
  }

  it('emits SupplierCreated and SupplierOfferCreated with server company/actor', async () => {
    const code = `AUD-${Date.now().toString(36)}`;
    const supplier = await request(app.getHttpServer())
      .post('/api/v1/purchasing/suppliers')
      .set(auth(token))
      .send({ name: `Audit Supplier ${code}`, code })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/purchasing/offers')
      .set(auth(token))
      .send({
        supplierId: supplier.body.data.id,
        skuId,
        currency: 'IRR',
        unitPrice: '2500000',
        quotedAt: '2026-10-03T12:00:00.000Z',
      })
      .expect(201);

    const created = sink.filter((e) => e.type === DOMAIN_EVENTS.PURCHASING_SUPPLIER_CREATED);
    const offers = sink.filter((e) => e.type === DOMAIN_EVENTS.PURCHASING_SUPPLIER_OFFER_CREATED);
    expect(created).toHaveLength(1);
    expect(offers).toHaveLength(1);
    expect(created[0]!.companyId).toBe(pishtehId);
    expect(created[0]!.payload).toEqual(
      expect.objectContaining({ companyId: pishtehId, supplierId: supplier.body.data.id }),
    );
    expect(offers[0]!.payload).toEqual(
      expect.objectContaining({
        companyId: pishtehId,
        supplierId: supplier.body.data.id,
        skuId,
        currency: 'IRR',
      }),
    );
    expect(created[0]!.eventId).not.toBe(supplier.body.data.id);
  });

  it('records PO lifecycle audit + exactly one approve/order event; rejects duplicates', async () => {
    const po = await createDraftPo('lifecycle gate');

    await request(app.getHttpServer())
      .post(`/api/v1/purchasing/purchase-orders/${po.id}/approve`)
      .set(auth(token))
      .send({ expectedVersion: po.version })
      .expect(201);

    const afterApprove = await request(app.getHttpServer())
      .get(`/api/v1/purchasing/purchase-orders/${po.id}`)
      .set(auth(token))
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/purchasing/purchase-orders/${po.id}/approve`)
      .set(auth(token))
      .send({ expectedVersion: afterApprove.body.data.version })
      .expect(409);

    await request(app.getHttpServer())
      .post(`/api/v1/purchasing/purchase-orders/${po.id}/order`)
      .set(auth(token))
      .send({ expectedVersion: afterApprove.body.data.version })
      .expect(201);

    const afterOrder = await request(app.getHttpServer())
      .get(`/api/v1/purchasing/purchase-orders/${po.id}`)
      .set(auth(token))
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/purchasing/purchase-orders/${po.id}/order`)
      .set(auth(token))
      .send({ expectedVersion: afterOrder.body.data.version })
      .expect(409);

    const approved = sink.filter(
      (e) =>
        e.type === DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_APPROVED &&
        (e.payload as { purchaseOrderId: string }).purchaseOrderId === po.id,
    );
    const ordered = sink.filter(
      (e) =>
        e.type === DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_ORDERED &&
        (e.payload as { purchaseOrderId: string }).purchaseOrderId === po.id,
    );
    expect(approved).toHaveLength(1);
    expect(ordered).toHaveLength(1);
    expect(ordered[0]!.payload).toEqual(
      expect.objectContaining({
        companyId: pishtehId,
        purchaseOrderId: po.id,
        purchaseType: 'CASH',
        previousStatus: 'APPROVED',
      }),
    );
    expect((ordered[0]!.payload as { orderedAt?: string | null }).orderedAt).toBeTruthy();

    const audits = await database.client.auditLog.findMany({
      where: {
        companyId: pishtehId,
        entityType: 'PURCHASE_ORDER',
        entityId: po.id,
        action: { in: ['PURCHASE_ORDER_APPROVED', 'PURCHASE_ORDER_ORDERED'] },
      },
    });
    expect(audits.filter((a) => a.action === 'PURCHASE_ORDER_APPROVED')).toHaveLength(1);
    expect(audits.filter((a) => a.action === 'PURCHASE_ORDER_ORDERED')).toHaveLength(1);
    expect(audits.every((a) => a.actorUserId === ownerUserId)).toBe(true);

    // Ordering alone must not create Inventory / Finance side effects.
    // Phase 3.9 owns InventoryMovement; mark-ordered must not post movements.
    expect(
      'stockBalance' in database.client ||
        'accountsPayable' in database.client ||
        'supplierPayment' in database.client,
    ).toBe(false);
    const postedFromOrder = await database.client.goodsReceipt.count({
      where: { companyId: pishtehId, purchaseOrderId: po.id, status: 'POSTED' },
    });
    expect(postedFromOrder).toBe(0);
    const movementsFromOrder = await database.client.inventoryMovement.count({
      where: { companyId: pishtehId, sourceId: po.id },
    });
    expect(movementsFromOrder).toBe(0);
  });

  it('rejects invalid DRAFT→ORDERED with no ORDERED audit/event', async () => {
    const po = await createDraftPo('invalid jump');
    const beforeEvents = sink.filter(
      (e) => e.type === DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_ORDERED,
    ).length;
    const beforeAudit = await database.client.auditLog.count({
      where: {
        companyId: pishtehId,
        entityId: po.id,
        action: 'PURCHASE_ORDER_ORDERED',
      },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/purchasing/purchase-orders/${po.id}/order`)
      .set(auth(token))
      .send({ expectedVersion: po.version })
      .expect(409);

    expect(
      sink.filter((e) => e.type === DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_ORDERED).length,
    ).toBe(beforeEvents);
    expect(
      await database.client.auditLog.count({
        where: {
          companyId: pishtehId,
          entityId: po.id,
          action: 'PURCHASE_ORDER_ORDERED',
        },
      }),
    ).toBe(beforeAudit);
  });

  it('exposes aggregated activity timeline with company isolation', async () => {
    const po = await createDraftPo('activity');
    await request(app.getHttpServer())
      .post(`/api/v1/purchasing/purchase-orders/${po.id}/approve`)
      .set(auth(token))
      .send({ expectedVersion: po.version })
      .expect(201);

    const activity = await request(app.getHttpServer())
      .get(`/api/v1/purchasing/purchase-orders/${po.id}/activity`)
      .query({ page: 1, pageSize: 20 })
      .set(auth(token))
      .expect(200);

    expect(activity.body.meta).toEqual(
      expect.objectContaining({ page: 1, pageSize: 20, total: expect.any(Number) }),
    );
    expect(activity.body.data.length).toBeGreaterThanOrEqual(1);
    expect(activity.body.data[0]).toEqual(
      expect.objectContaining({
        action: expect.any(String),
        summary: expect.any(String),
        actor: expect.objectContaining({ displayName: expect.any(String) }),
        createdAt: expect.any(String),
        changes: expect.any(Array),
      }),
    );
    expect(JSON.stringify(activity.body.data)).not.toMatch(/userAgent|ipAddress/i);

    await request(app.getHttpServer())
      .get(`/api/v1/purchasing/purchase-orders/${po.id}/activity`)
      .set(auth(token, demoBId))
      .expect(404);
  });

  it('cancels with previous status + reason audit/event', async () => {
    const po = await createDraftPo('cancel');
    const approved = await request(app.getHttpServer())
      .post(`/api/v1/purchasing/purchase-orders/${po.id}/approve`)
      .set(auth(token))
      .send({ expectedVersion: po.version })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/purchasing/purchase-orders/${po.id}/cancel`)
      .set(auth(token))
      .send({ expectedVersion: approved.body.data.version, reason: 'تأمین‌کننده موجودی نداشت' })
      .expect(201);

    const cancelled = sink.find(
      (e) =>
        e.type === DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_CANCELLED &&
        (e.payload as { purchaseOrderId: string }).purchaseOrderId === po.id,
    );
    expect(cancelled).toBeDefined();
    expect(cancelled!.payload).toEqual(
      expect.objectContaining({
        previousStatus: 'APPROVED',
        reason: 'تأمین‌کننده موجودی نداشت',
      }),
    );

    const audit = await database.client.auditLog.findFirst({
      where: {
        companyId: pishtehId,
        entityId: po.id,
        action: 'PURCHASE_ORDER_CANCELLED',
      },
    });
    expect(audit?.actorUserId).toBe(ownerUserId);
    expect(JSON.stringify(audit?.after)).toContain('تأمین‌کننده موجودی نداشت');
  });

  it('emits due-date-changed only when due date actually changes via correction', async () => {
    const draft = await request(app.getHttpServer())
      .post('/api/v1/purchasing/purchase-orders')
      .set(auth(token))
      .send({
        supplierId,
        currency: 'IRR',
        purchaseType: 'TERM_CREDIT',
        paymentTermType: 'FIXED_DATE',
        dueDate: '2026-11-01',
        orderDate: '2026-10-03',
        notes: 'due-date event',
        items: [{ skuId, quantity: 10, unitPrice: '1000000' }],
      })
      .expect(201);
    const approved = await request(app.getHttpServer())
      .post(`/api/v1/purchasing/purchase-orders/${draft.body.data.id}/approve`)
      .set(auth(token))
      .send({ expectedVersion: draft.body.data.version })
      .expect(201);
    const ordered = await request(app.getHttpServer())
      .post(`/api/v1/purchasing/purchase-orders/${draft.body.data.id}/order`)
      .set(auth(token))
      .send({ expectedVersion: approved.body.data.version })
      .expect(201);

    const beforeDueEvents = sink.filter(
      (e) => e.type === DOMAIN_EVENTS.PURCHASING_PURCHASE_DUE_DATE_CHANGED,
    ).length;

    await request(app.getHttpServer())
      .post(`/api/v1/purchasing/purchase-orders/${draft.body.data.id}/corrections`)
      .set(auth(token))
      .send({
        type: 'COMMERCIAL_TERM_CORRECTION',
        reason: 'Agreed new due date with supplier',
        version: ordered.body.data.version,
        paymentTermType: 'FIXED_DATE',
        dueDate: '2026-11-20',
      })
      .expect(201);

    const dueEvents = sink.filter(
      (e) =>
        e.type === DOMAIN_EVENTS.PURCHASING_PURCHASE_DUE_DATE_CHANGED &&
        (e.payload as { purchaseOrderId: string }).purchaseOrderId === draft.body.data.id,
    );
    expect(dueEvents.length).toBe(beforeDueEvents + 1);
    expect(dueEvents[dueEvents.length - 1]!.payload).toEqual(
      expect.objectContaining({
        companyId: pishtehId,
        purchaseOrderId: draft.body.data.id,
        newDueDate: expect.stringMatching(/^2026-11-20/),
      }),
    );

    const dueAudits = await database.client.auditLog.count({
      where: {
        companyId: pishtehId,
        entityId: draft.body.data.id,
        action: 'PURCHASE_DUE_DATE_CHANGED',
      },
    });
    expect(dueAudits).toBeGreaterThanOrEqual(1);
  });

  it('emits PurchaseReturnCreated with company/PO identity and no Warehouse tables', async () => {
    const draft = await createDraftPo('return event');
    const approved = await request(app.getHttpServer())
      .post(`/api/v1/purchasing/purchase-orders/${draft.id}/approve`)
      .set(auth(token))
      .send({ expectedVersion: draft.version })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/purchasing/purchase-orders/${draft.id}/order`)
      .set(auth(token))
      .send({ expectedVersion: approved.body.data.version })
      .expect(201);

    const po = await request(app.getHttpServer())
      .get(`/api/v1/purchasing/purchase-orders/${draft.id}`)
      .set(auth(token))
      .expect(200);
    const itemId = po.body.data.items[0].id as string;

    const created = await request(app.getHttpServer())
      .post('/api/v1/purchasing/purchase-returns')
      .set(auth(token))
      .send({
        purchaseOrderId: draft.id,
        reason: 'DEFECTIVE',
        items: [{ purchaseOrderItemId: itemId, quantity: 1 }],
      })
      .expect(201);

    const returnEvents = sink.filter(
      (e) =>
        e.type === DOMAIN_EVENTS.PURCHASING_PURCHASE_RETURN_CREATED &&
        (e.payload as { purchaseReturnId: string }).purchaseReturnId === created.body.data.id,
    );
    expect(returnEvents).toHaveLength(1);
    expect(returnEvents[0]!.payload).toEqual(
      expect.objectContaining({
        companyId: pishtehId,
        purchaseOrderId: draft.id,
        purchaseReturnId: created.body.data.id,
        number: created.body.data.number,
        status: 'DRAFT',
      }),
    );

    // Purchase return create must not write Finance tables / competing stock tables.
    // Phase 3.9 owns inventory_movements; return create still posts none.
    const forbiddenTables = await database.client.$queryRawUnsafe<Array<{ tablename: string }>>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'
       AND tablename = ANY(ARRAY[
         'stock_balances','fifo_layers','payables','payments'
       ])`,
    );
    expect(forbiddenTables).toHaveLength(0);
    const returnMovements = await database.client.inventoryMovement.count({
      where: {
        companyId: pishtehId,
        sourceId: created.body.data.id,
      },
    });
    expect(returnMovements).toBe(0);
  });
});
