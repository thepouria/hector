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

/**
 * Phase 5.3 returnable formula:
 *
 *   returnableQuantity = fulfilledQuantity - returnedQuantity
 *
 * These commercial-return tests seed fulfilledQuantity after confirm
 * (physical fulfillment is covered by sales-execution.e2e-spec.ts).
 */
describe('Sales Returns (e2e)', () => {
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
  let demoBOrderItemId: string;
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

    const token = await login(ownerEmail);
    const foreign = await request(app.getHttpServer())
      .post('/api/v1/sales/orders')
      .set(auth(token, demoBId))
      .send({
        channelId: demoBChannelId,
        currency: 'IRR',
        paymentTermType: 'CASH',
        items: [{ skuId: demoBSkuId, quantity: 5, unitPrice: '100000' }],
      })
      .expect(201);
    demoBOrderId = foreign.body.data.id as string;
    demoBOrderItemId = foreign.body.data.items[0].id as string;

    await request(app.getHttpServer())
      .post(`/api/v1/sales/orders/${demoBOrderId}/confirm`)
      .set(auth(token, demoBId))
      .expect(201);
    await database.client.salesOrderItem.update({
      where: { id: demoBOrderItemId },
      data: { fulfilledQuantity: 5 },
    });
    await database.client.salesOrder.update({
      where: { id: demoBOrderId },
      data: { status: 'FULFILLED' },
    });
    // Commercial-only seed: release confirm-time holds so integrity does not see orphans.
    await request(app.getHttpServer())
      .post(`/api/v1/sales/orders/${demoBOrderId}/reservations/release`)
      .set(auth(token, demoBId))
      .expect(201);
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

  async function createConfirmedOrder(token: string, qty = 10) {
    const created = await request(app.getHttpServer())
      .post('/api/v1/sales/orders')
      .set(auth(token))
      .send({
        channelId: wholesaleChannelId,
        customerId,
        currency: 'IRR',
        paymentTermType: 'CREDIT',
        dueDate: '2026-12-31T00:00:00.000Z',
        items: [
          { skuId: mascaraSkuId, quantity: qty, unitPrice: '600000' },
          { skuId: primerSkuId, quantity: 2, unitPrice: '500000' },
        ],
      })
      .expect(201);

    const confirmed = await request(app.getHttpServer())
      .post(`/api/v1/sales/orders/${created.body.data.id}/confirm`)
      .set(auth(token))
      .expect(201);

    const order = confirmed.body.data as {
      id: string;
      items: Array<{ id: string; skuId: string; quantity: number }>;
    };

    // Seed fulfillment truth so returns can use fulfilled − returned.
    for (const item of order.items) {
      await database.client.salesOrderItem.update({
        where: { id: item.id },
        data: { fulfilledQuantity: item.quantity },
      });
    }
    await database.client.salesOrder.update({
      where: { id: order.id },
      data: { status: 'FULFILLED' },
    });
    // Commercial-only seed: release confirm-time holds so integrity does not see orphans.
    await request(app.getHttpServer())
      .post(`/api/v1/sales/orders/${order.id}/reservations/release`)
      .set(auth(token))
      .expect(201);

    return order;
  }

  it('denies unauthenticated return access', async () => {
    await request(app.getHttpServer()).get('/api/v1/sales/returns').expect(401);
  });

  it('creates return against confirmed order item and approves (commercial only)', async () => {
    const token = await login(ownerEmail);
    const order = await createConfirmedOrder(token, 10);
    const item = order.items.find((row) => row.skuId === mascaraSkuId)!;

    const movementsBefore = await database.client.financialAccountMovement.count({
      where: { companyId: pishtehId },
    });

    const created = await request(app.getHttpServer())
      .post('/api/v1/sales/returns')
      .set(auth(token))
      .send({
        salesOrderId: order.id,
        reason: 'CUSTOMER_REQUEST',
        condition: 'SELLABLE',
        items: [
          {
            salesOrderItemId: item.id,
            skuId: mascaraSkuId,
            quantity: 3,
            reason: 'CUSTOMER_REQUEST',
          },
        ],
      })
      .expect(201);

    expect(created.body.data.status).toBe('DRAFT');
    expect(created.body.data.returnNumber).toMatch(/^SR-\d{6,}$/);
    expect(created.body.data.physicalExecution).toBe('DEFERRED_TO_WAREHOUSE');
    expect(created.body.data.financialResolution).toBe('DEFERRED_TO_FINANCE');
    expect(created.body.data.returnablePolicy).toBe('FULFILLED_MINUS_RETURNED');

    const approved = await request(app.getHttpServer())
      .post(`/api/v1/sales/returns/${created.body.data.id}/approve`)
      .set(auth(token))
      .expect(201);

    expect(approved.body.data.status).toBe('APPROVED');
    expect(approved.body.data.approvedAt).toBeTruthy();
    expect(approved.body.data.physicalExecution).toBe('DEFERRED_TO_WAREHOUSE');
    expect(approved.body.data.financialResolution).toBe('DEFERRED_TO_FINANCE');

    const orderAfter = await request(app.getHttpServer())
      .get(`/api/v1/sales/orders/${order.id}`)
      .set(auth(token))
      .expect(200);
    const orderItem = orderAfter.body.data.items.find(
      (row: { id: string }) => row.id === item.id,
    );
    // returnable = ordered - cancelled - returned  → 10 - 0 - 3 = 7 remaining
    expect(orderItem.quantity).toBe(10);
    expect(orderItem.returnedQuantity).toBe(3);
    expect(orderItem.cancelledQuantity).toBe(0);

    const movementsAfter = await database.client.financialAccountMovement.count({
      where: { companyId: pishtehId },
    });
    expect(movementsAfter).toBe(movementsBefore);
  });

  it('supports partial return quantity and rejects over-return', async () => {
    const token = await login(ownerEmail);
    const order = await createConfirmedOrder(token, 5);
    const item = order.items.find((row) => row.skuId === mascaraSkuId)!;

    await request(app.getHttpServer())
      .post('/api/v1/sales/returns')
      .set(auth(token))
      .send({
        salesOrderId: order.id,
        items: [{ salesOrderItemId: item.id, skuId: mascaraSkuId, quantity: 2 }],
      })
      .expect(201);

    // Over-return relative to transitional returnable (5 - 0 - 0 = 5; pending draft 2 → max 3 left)
    await request(app.getHttpServer())
      .post('/api/v1/sales/returns')
      .set(auth(token))
      .send({
        salesOrderId: order.id,
        items: [{ salesOrderItemId: item.id, skuId: mascaraSkuId, quantity: 4 }],
      })
      .expect(400);

    // Exact remaining after pending draft is OK
    await request(app.getHttpServer())
      .post('/api/v1/sales/returns')
      .set(auth(token))
      .send({
        salesOrderId: order.id,
        items: [{ salesOrderItemId: item.id, skuId: mascaraSkuId, quantity: 3 }],
      })
      .expect(201);
  });

  it('rejects unrelated order-item ID', async () => {
    const token = await login(ownerEmail);
    const orderA = await createConfirmedOrder(token, 4);
    const orderB = await createConfirmedOrder(token, 4);
    const foreignItem = orderB.items.find((row) => row.skuId === mascaraSkuId)!;

    await request(app.getHttpServer())
      .post('/api/v1/sales/returns')
      .set(auth(token))
      .send({
        salesOrderId: orderA.id,
        items: [
          {
            salesOrderItemId: foreignItem.id,
            skuId: mascaraSkuId,
            quantity: 1,
          },
        ],
      })
      .expect(400);
  });

  it('blocks cross-company return access with 404', async () => {
    const token = await login(ownerEmail);

    // Create return under Demo B, then try to read/approve from Pishteh.
    const foreignReturn = await request(app.getHttpServer())
      .post('/api/v1/sales/returns')
      .set(auth(token, demoBId))
      .send({
        salesOrderId: demoBOrderId,
        items: [
          {
            salesOrderItemId: demoBOrderItemId,
            skuId: demoBSkuId,
            quantity: 1,
          },
        ],
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/sales/returns/${foreignReturn.body.data.id}`)
      .set(auth(token, pishtehId))
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/v1/sales/returns/${foreignReturn.body.data.id}/approve`)
      .set(auth(token, pishtehId))
      .expect(404);

    // Creating a return against a foreign order from Pishteh context → order not found
    await request(app.getHttpServer())
      .post('/api/v1/sales/returns')
      .set(auth(token, pishtehId))
      .send({
        salesOrderId: demoBOrderId,
        items: [
          {
            salesOrderItemId: demoBOrderItemId,
            skuId: demoBSkuId,
            quantity: 1,
          },
        ],
      })
      .expect(404);
  });

  it('enforces sales.returns.read vs approve RBAC', async () => {
    const limited = await database.client.role.create({
      data: {
        companyId: pishtehId,
        key: `sales-ret-ro-${Date.now()}`,
        name: 'Sales Returns RO',
        isSystem: false,
      },
    });
    const readPerm = await database.client.permission.findUniqueOrThrow({
      where: { key: PERMISSIONS.SALES_RETURNS_READ },
    });
    await database.client.rolePermission.create({
      data: { roleId: limited.id, permissionId: readPerm.id },
    });
    const user = await database.client.user.create({
      data: {
        email: `sales-ret-ro-${Date.now()}@hector.local`,
        firstName: 'RO',
        lastName: 'Returns',
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
    const order = await createConfirmedOrder(ownerToken, 6);
    const item = order.items.find((row) => row.skuId === mascaraSkuId)!;
    const created = await request(app.getHttpServer())
      .post('/api/v1/sales/returns')
      .set(auth(ownerToken))
      .send({
        salesOrderId: order.id,
        items: [{ salesOrderItemId: item.id, skuId: mascaraSkuId, quantity: 1 }],
      })
      .expect(201);

    const roToken = await login(user.email);
    await request(app.getHttpServer())
      .get(`/api/v1/sales/returns/${created.body.data.id}`)
      .set(auth(roToken))
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/sales/returns/${created.body.data.id}/approve`)
      .set(auth(roToken))
      .expect(403);
  });
});
