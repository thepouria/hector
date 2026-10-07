import request from 'supertest';
import {
  CompanyMemberStatus,
  PERMISSIONS,
  UserStatus,
  syncOwnerRolePermissions,
  syncPermissions,
} from '@hector/database';
import type { INestApplication } from '@nestjs/common';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';

describe('Sales Orders (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;
  let pishtehId: string;
  let demoBId: string;
  let wholesaleChannelId: string;
  let customerId: string;
  let mascaraSkuId: string;
  let primerSkuId: string;
  let demoBChannelId: string;
  let demoBSkuId: string;
  let demoBOrderId: string;
  let ownerPasswordHash: string;

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

    wholesaleChannelId = (
      await database.client.salesChannel.findUniqueOrThrow({
        where: { companyId_code: { companyId: pishtehId, code: 'WHOLESALE' } },
      })
    ).id;
    customerId = (
      await database.client.customer.findUniqueOrThrow({
        where: { companyId_code: { companyId: pishtehId, code: 'CUS-DEMO' } },
      })
    ).id;
    mascaraSkuId = (
      await database.client.sku.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'ESS-MASCARA-01' },
      })
    ).id;
    primerSkuId = (
      await database.client.sku.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'FAN-PRIMER-01' },
      })
    ).id;

    demoBChannelId = (
      await database.client.salesChannel.findUniqueOrThrow({
        where: { companyId_code: { companyId: demoBId, code: 'WHOLESALE' } },
      })
    ).id;
    demoBSkuId = (
      await database.client.sku.findFirstOrThrow({
        where: { companyId: demoBId },
      })
    ).id;

    const owner = await database.client.user.update({
      where: { email: ownerEmail },
      data: { status: UserStatus.ACTIVE, deletedAt: null },
    });
    ownerPasswordHash = owner.passwordHash;

    // Foreign order for IDOR (created via API under Demo B context).
    const token = await login(ownerEmail);
    const foreign = await request(app.getHttpServer())
      .post('/api/v1/sales/orders')
      .set(auth(token, demoBId))
      .send({
        channelId: demoBChannelId,
        currency: 'IRR',
        paymentTermType: 'CASH',
        items: [{ skuId: demoBSkuId, quantity: 1, unitPrice: '100000' }],
      })
      .expect(201);
    demoBOrderId = foreign.body.data.id as string;
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(email: string): Promise<string> {
    await database.client.user.update({
      where: { email: ownerEmail },
      data: {
        status: UserStatus.ACTIVE,
        deletedAt: null,
        passwordHash: ownerPasswordHash,
      },
    });
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

  /** Wholesale DRAFT body: 2 SKUs + line discount + order discount + CREDIT + dueDate. */
  function wholesaleDraftBody(overrides: Record<string, unknown> = {}) {
    return {
      channelId: wholesaleChannelId,
      customerId,
      currency: 'IRR',
      paymentTermType: 'CREDIT',
      dueDate: '2026-12-31T00:00:00.000Z',
      orderDiscountTotal: '100000',
      shippingAmount: '50000',
      otherCharges: '25000',
      notes: 'e2e wholesale draft',
      items: [
        {
          skuId: mascaraSkuId,
          quantity: 2,
          unitPrice: '1000000',
          discountAmount: '100000',
        },
        {
          skuId: primerSkuId,
          quantity: 3,
          unitPrice: '500000',
          discountAmount: '0',
        },
      ],
      ...overrides,
    };
  }

  /**
   * Expected server totals for wholesaleDraftBody defaults:
   * line1: 2*1000000=2000000 - 100000 = 1900000
   * line2: 3*500000=1500000 - 0 = 1500000
   * netItems=3400000 - orderDiscount 100000 + ship 50000 + other 25000 = 3375000
   */
  const EXPECTED_GRAND_TOTAL = '3375000';

  it('denies unauthenticated order access', async () => {
    await request(app.getHttpServer()).get('/api/v1/sales/orders').expect(401);
  });

  it('creates DRAFT wholesale-style order with server-computed grandTotal', async () => {
    const token = await login(ownerEmail);
    const created = await request(app.getHttpServer())
      .post('/api/v1/sales/orders')
      .set(auth(token))
      .send(wholesaleDraftBody())
      .expect(201);

    expect(created.body.data.status).toBe('DRAFT');
    expect(created.body.data.channelId).toBe(wholesaleChannelId);
    expect(created.body.data.customerId).toBe(customerId);
    expect(created.body.data.paymentTermType).toBe('CREDIT');
    expect(created.body.data.dueDate).toBeTruthy();
    expect(created.body.data.items).toHaveLength(2);
    expect(created.body.data.subtotal).toBe('3500000');
    expect(created.body.data.itemDiscountTotal).toBe('100000');
    expect(created.body.data.netItemsTotal).toBe('3400000');
    expect(created.body.data.orderDiscountTotal).toBe('100000');
    expect(created.body.data.shippingAmount).toBe('50000');
    expect(created.body.data.otherCharges).toBe('25000');
    expect(created.body.data.grandTotal).toBe(EXPECTED_GRAND_TOTAL);
    expect(created.body.data.inventoryEffect).toBe('NONE');
    expect(created.body.data.financeEffect).toBe('NONE');
    expect(created.body.data.orderNumber).toMatch(/^SO-\d{6,}$/);
  });

  it('confirms DRAFT → CONFIRMED/PROCESSING without finance cash side effects', async () => {
    const token = await login(ownerEmail);
    const created = await request(app.getHttpServer())
      .post('/api/v1/sales/orders')
      .set(auth(token))
      .send(wholesaleDraftBody({ notes: 'confirm side-effect check' }))
      .expect(201);
    const id = created.body.data.id as string;

    const movementsBefore = await database.client.financialAccountMovement.count({
      where: { companyId: pishtehId },
    });

    const confirmed = await request(app.getHttpServer())
      .post(`/api/v1/sales/orders/${id}/confirm`)
      .set(auth(token))
      .expect(201);

    // Best-effort reserve after confirm may move CONFIRMED → PROCESSING.
    expect(['CONFIRMED', 'PROCESSING']).toContain(confirmed.body.data.status);
    expect(confirmed.body.data.confirmedAt).toBeTruthy();
    expect(confirmed.body.data.grandTotal).toBe(EXPECTED_GRAND_TOTAL);
    expect(['NONE', 'RESERVED']).toContain(confirmed.body.data.inventoryEffect);
    expect(confirmed.body.data.financeEffect).toBe('NONE');

    const movementsAfter = await database.client.financialAccountMovement.count({
      where: { companyId: pishtehId },
    });
    expect(movementsAfter).toBe(movementsBefore);
  });

  it('rejects confirmed PATCH of unitPrice (409 not editable)', async () => {
    const token = await login(ownerEmail);
    const created = await request(app.getHttpServer())
      .post('/api/v1/sales/orders')
      .set(auth(token))
      .send(wholesaleDraftBody({ notes: 'immutability' }))
      .expect(201);
    const id = created.body.data.id as string;

    await request(app.getHttpServer())
      .post(`/api/v1/sales/orders/${id}/confirm`)
      .set(auth(token))
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/sales/orders/${id}`)
      .set(auth(token))
      .send({
        items: [
          { skuId: mascaraSkuId, quantity: 2, unitPrice: '1' },
          { skuId: primerSkuId, quantity: 3, unitPrice: '500000' },
        ],
      })
      .expect(409);
  });

  it('partial item cancel keeps ordered quantity; updates cancelledQuantity', async () => {
    const token = await login(ownerEmail);
    const created = await request(app.getHttpServer())
      .post('/api/v1/sales/orders')
      .set(auth(token))
      .send(wholesaleDraftBody({ notes: 'partial cancel' }))
      .expect(201);
    const id = created.body.data.id as string;
    const itemId = created.body.data.items[0].id as string;
    const orderedQty = created.body.data.items[0].quantity as number;

    await request(app.getHttpServer())
      .post(`/api/v1/sales/orders/${id}/confirm`)
      .set(auth(token))
      .expect(201);

    const cancelled = await request(app.getHttpServer())
      .post(`/api/v1/sales/orders/${id}/items/${itemId}/cancel`)
      .set(auth(token))
      .send({ quantity: 1 })
      .expect(201);

    const item = cancelled.body.data.items.find((row: { id: string }) => row.id === itemId);
    expect(item.quantity).toBe(orderedQty);
    expect(item.cancelledQuantity).toBe(1);
    expect(['CONFIRMED', 'PROCESSING']).toContain(cancelled.body.data.status);
  });

  it('fully cancels a confirmed order', async () => {
    const token = await login(ownerEmail);
    const created = await request(app.getHttpServer())
      .post('/api/v1/sales/orders')
      .set(auth(token))
      .send(wholesaleDraftBody({ notes: 'full cancel' }))
      .expect(201);
    const id = created.body.data.id as string;

    await request(app.getHttpServer())
      .post(`/api/v1/sales/orders/${id}/confirm`)
      .set(auth(token))
      .expect(201);

    const cancelled = await request(app.getHttpServer())
      .post(`/api/v1/sales/orders/${id}/cancel`)
      .set(auth(token))
      .send({ reason: 'CUSTOMER_REQUEST', notes: 'full cancel e2e' })
      .expect(201);

    expect(cancelled.body.data.status).toBe('CANCELLED');
    expect(cancelled.body.data.cancelledAt).toBeTruthy();
    expect(cancelled.body.data.cancelReason).toBe('CUSTOMER_REQUEST');
    for (const item of cancelled.body.data.items) {
      expect(item.cancelledQuantity).toBe(item.quantity);
      expect(item.quantity).toBeGreaterThan(0);
    }
  });

  it('blocks cross-company order IDOR with 404', async () => {
    const token = await login(ownerEmail);
    await request(app.getHttpServer())
      .get(`/api/v1/sales/orders/${demoBOrderId}`)
      .set(auth(token, pishtehId))
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/v1/sales/orders/${demoBOrderId}/confirm`)
      .set(auth(token, pishtehId))
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/v1/sales/orders/${demoBOrderId}/cancel`)
      .set(auth(token, pishtehId))
      .send({ reason: 'MANUAL' })
      .expect(404);
  });

  it('enforces sales.orders.read vs confirm RBAC', async () => {
    const limited = await database.client.role.create({
      data: {
        companyId: pishtehId,
        key: `sales-ord-ro-${Date.now()}`,
        name: 'Sales Orders RO',
        isSystem: false,
      },
    });
    const readPerm = await database.client.permission.findUniqueOrThrow({
      where: { key: PERMISSIONS.SALES_ORDERS_READ },
    });
    await database.client.rolePermission.create({
      data: { roleId: limited.id, permissionId: readPerm.id },
    });
    const user = await database.client.user.create({
      data: {
        email: `sales-ord-ro-${Date.now()}@hector.local`,
        firstName: 'RO',
        lastName: 'Orders',
        passwordHash: ownerPasswordHash,
        status: UserStatus.ACTIVE,
      },
    });
    const membership = await database.client.companyMember.create({
      data: {
        companyId: pishtehId,
        userId: user.id,
        status: CompanyMemberStatus.ACTIVE,
      },
    });
    await database.client.companyMemberRole.create({
      data: { companyMemberId: membership.id, roleId: limited.id },
    });

    const ownerToken = await login(ownerEmail);
    const draft = await request(app.getHttpServer())
      .post('/api/v1/sales/orders')
      .set(auth(ownerToken))
      .send(wholesaleDraftBody({ notes: 'rbac confirm deny' }))
      .expect(201);
    const id = draft.body.data.id as string;

    const roToken = await login(user.email);
    await request(app.getHttpServer())
      .get(`/api/v1/sales/orders/${id}`)
      .set(auth(roToken))
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/sales/orders/${id}/confirm`)
      .set(auth(roToken))
      .expect(403);
  });

  it('rejects mass assignment of companyId/grandTotal/status', async () => {
    const token = await login(ownerEmail);
    await request(app.getHttpServer())
      .post('/api/v1/sales/orders')
      .set(auth(token))
      .send({
        ...wholesaleDraftBody({ notes: 'mass assign' }),
        companyId: demoBId,
        grandTotal: '1',
        status: 'CONFIRMED',
      })
      .expect(400);

    const created = await request(app.getHttpServer())
      .post('/api/v1/sales/orders')
      .set(auth(token))
      .send(wholesaleDraftBody({ notes: 'mass assign ok' }))
      .expect(201);

    expect(created.body.data.companyId).toBe(pishtehId);
    expect(created.body.data.status).toBe('DRAFT');
    expect(created.body.data.grandTotal).toBe(EXPECTED_GRAND_TOTAL);
  });

  it('rejects invalid transition (cancel then confirm)', async () => {
    const token = await login(ownerEmail);
    const created = await request(app.getHttpServer())
      .post('/api/v1/sales/orders')
      .set(auth(token))
      .send(wholesaleDraftBody({ notes: 'invalid transition' }))
      .expect(201);
    const id = created.body.data.id as string;

    await request(app.getHttpServer())
      .post(`/api/v1/sales/orders/${id}/cancel`)
      .set(auth(token))
      .send({ reason: 'DUPLICATE_ORDER' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/sales/orders/${id}/confirm`)
      .set(auth(token))
      .expect(409);
  });

  it('rejects duplicate externalOrderId on same channel', async () => {
    const token = await login(ownerEmail);
    const externalOrderId = `EXT-E2E-${Date.now()}`;

    await request(app.getHttpServer())
      .post('/api/v1/sales/orders')
      .set(auth(token))
      .send(wholesaleDraftBody({ externalOrderId, notes: 'ext-1' }))
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/sales/orders')
      .set(auth(token))
      .send(wholesaleDraftBody({ externalOrderId, notes: 'ext-dup' }))
      .expect(409);
  });
});
