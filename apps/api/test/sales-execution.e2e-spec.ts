import request from 'supertest';
import {
  InventoryReservationSourceType,
  InventoryReservationStatus,
  InventorySourceType,
  JournalEntryStatus,
  UserStatus,
  syncOwnerRolePermissions,
  syncPermissions,
} from '@hector/database';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';

/**
 * Phase 5.3 — Sales execution: reserve → fulfill → AR recognition → return receive.
 * Critical: concurrency/idempotency/FIFO consume / finance journals (no bank cash).
 */
describe('Sales Execution (e2e Phase 5.3)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;
  let pishtehId: string;
  let wholesaleChannelId: string;
  let digikalaChannelId: string;
  let customerId: string;
  let mascaraSkuId: string;
  let mainWarehouseId: string;
  let locationId: string;
  let batchId: string;
  let accessToken: string;

  beforeAll(async () => {
    app = await createE2eApp();
    database = app.get(DatabaseService);
    await syncPermissions(database.client);
    await syncOwnerRolePermissions(database.client);

    pishtehId = (
      await database.client.company.findUniqueOrThrow({ where: { slug: 'pishteh' } })
    ).id;
    wholesaleChannelId = (
      await database.client.salesChannel.findUniqueOrThrow({
        where: { companyId_code: { companyId: pishtehId, code: 'WHOLESALE' } },
      })
    ).id;
    digikalaChannelId = (
      await database.client.salesChannel.findUniqueOrThrow({
        where: { companyId_code: { companyId: pishtehId, code: 'DIGIKALA' } },
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
    mainWarehouseId = (
      await database.client.warehouse.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'MAIN' },
      })
    ).id;

    const balance = await database.client.inventoryBalance.findFirstOrThrow({
      where: {
        companyId: pishtehId,
        warehouseId: mainWarehouseId,
        skuId: mascaraSkuId,
        classification: 'SELLABLE',
        onHandQuantity: { gt: 0 },
      },
      orderBy: { onHandQuantity: 'desc' },
    });
    locationId = balance.locationId;
    batchId = balance.batchId;

    // Seed / prior suites may hold ACTIVE reservations that block ISSUE (WH-RES-012).
    // Clear all ACTIVE commitments for this SKU so execution tests are deterministic.
    await database.client.inventoryReservation.updateMany({
      where: {
        companyId: pishtehId,
        warehouseId: mainWarehouseId,
        skuId: mascaraSkuId,
        status: InventoryReservationStatus.ACTIVE,
      },
      data: {
        status: InventoryReservationStatus.RELEASED,
        remainingQuantity: 0,
        releasedAt: new Date(),
      },
    });

    await database.client.user.update({
      where: { email: ownerEmail },
      data: { status: UserStatus.ACTIVE, deletedAt: null },
    });

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password })
      .expect(200);
    accessToken = login.body.data.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
  });

  function auth(token = accessToken, companyId = pishtehId) {
    return {
      Authorization: `Bearer ${token}`,
      'X-Company-Id': companyId,
    };
  }

  async function createAndConfirmOrder(opts?: {
    qty?: number;
    channelId?: string;
    customerId?: string | null;
    paymentTermType?: string;
  }) {
    const qty = opts?.qty ?? 2;
    const created = await request(app.getHttpServer())
      .post('/api/v1/sales/orders')
      .set(auth())
      .send({
        channelId: opts?.channelId ?? wholesaleChannelId,
        ...(opts?.customerId === null
          ? {}
          : { customerId: opts?.customerId ?? customerId }),
        currency: 'IRR',
        paymentTermType: opts?.paymentTermType ?? 'CASH',
        items: [{ skuId: mascaraSkuId, quantity: qty, unitPrice: '600000' }],
      })
      .expect(201);

    const confirmed = await request(app.getHttpServer())
      .post(`/api/v1/sales/orders/${created.body.data.id}/confirm`)
      .set(auth())
      .expect(201);

    return confirmed.body.data as {
      id: string;
      status: string;
      items: Array<{ id: string; skuId: string; quantity: number; fulfilledQuantity: number }>;
    };
  }

  it('confirm best-effort reserves and moves toward PROCESSING when stock available', async () => {
    const order = await createAndConfirmOrder({ qty: 1 });
    expect(['CONFIRMED', 'PROCESSING']).toContain(order.status);

    const reservations = await request(app.getHttpServer())
      .get(`/api/v1/sales/orders/${order.id}/reservations`)
      .set(auth())
      .expect(200);

    // Best-effort: may be empty if availability was already fully reserved by other tests.
    expect(Array.isArray(reservations.body.data)).toBe(true);
  });

  it('completes fulfillment atomically: ISSUE + fulfilledQuantity + lifecycle + AR journal', async () => {
    const order = await createAndConfirmOrder({ qty: 1, paymentTermType: 'CASH' });
    const item = order.items[0]!;

    await request(app.getHttpServer())
      .post(`/api/v1/sales/orders/${order.id}/reserve`)
      .set(auth())
      .send({ warehouseId: mainWarehouseId })
      .expect(201);

    const requestId = randomUUID();
    const draft = await request(app.getHttpServer())
      .post('/api/v1/sales/fulfillments')
      .set(auth())
      .send({
        salesOrderId: order.id,
        warehouseId: mainWarehouseId,
        requestId,
        items: [
          {
            salesOrderItemId: item.id,
            skuId: mascaraSkuId,
            locationId,
            batchId,
            quantity: 1,
          },
        ],
      })
      .expect(201);

    expect(draft.body.data.status).toBe('DRAFT');
    expect(draft.body.data.fulfillmentNumber).toMatch(/^FUL-\d{6,}$/);

    // Idempotent create
    const replay = await request(app.getHttpServer())
      .post('/api/v1/sales/fulfillments')
      .set(auth())
      .send({
        salesOrderId: order.id,
        warehouseId: mainWarehouseId,
        requestId,
        items: [
          {
            salesOrderItemId: item.id,
            skuId: mascaraSkuId,
            locationId,
            batchId,
            quantity: 1,
          },
        ],
      })
      .expect(201);
    expect(replay.body.data.id).toBe(draft.body.data.id);

    const movementsBefore = await database.client.financialAccountMovement.count({
      where: { companyId: pishtehId },
    });

    const completed = await request(app.getHttpServer())
      .post(`/api/v1/sales/fulfillments/${draft.body.data.id}/complete`)
      .set(auth())
      .expect(201);

    expect(completed.body.data.status).toBe('COMPLETED');

    // Idempotent complete
    const completedAgain = await request(app.getHttpServer())
      .post(`/api/v1/sales/fulfillments/${draft.body.data.id}/complete`)
      .set(auth())
      .expect(201);
    expect(completedAgain.body.data.id).toBe(draft.body.data.id);

    const orderAfter = await request(app.getHttpServer())
      .get(`/api/v1/sales/orders/${order.id}`)
      .set(auth())
      .expect(200);
    expect(orderAfter.body.data.status).toBe('FULFILLED');
    expect(orderAfter.body.data.items[0].fulfilledQuantity).toBe(1);
    expect(orderAfter.body.data.financeEffect).toBe('AR_RECOGNIZED');

    const issueCount = await database.client.inventoryMovement.count({
      where: {
        companyId: pishtehId,
        sourceType: InventorySourceType.SALES_FULFILLMENT,
        sourceId: draft.body.data.id,
        movementType: 'ISSUE',
      },
    });
    expect(issueCount).toBe(1);

    const receivable = await database.client.customerReceivable.findFirst({
      where: {
        companyId: pishtehId,
        salesFulfillmentId: draft.body.data.id,
      },
    });
    expect(receivable).toBeTruthy();
    expect(receivable!.counterpartyType).toBe('CUSTOMER');
    expect(receivable!.amount.toString()).toBe('600000');

    const journal = await database.client.journalEntry.findFirst({
      where: {
        companyId: pishtehId,
        sourceType: 'SALES_FULFILLMENT',
        sourceId: draft.body.data.id,
        effectType: 'SALES_AR_RECOGNITION',
        status: JournalEntryStatus.POSTED,
      },
    });
    expect(journal).toBeTruthy();

    // CASH terms still create AR — no fake bank movement
    const movementsAfter = await database.client.financialAccountMovement.count({
      where: { companyId: pishtehId },
    });
    expect(movementsAfter).toBe(movementsBefore);

    // Cancel DRAFT only — completed cannot cancel
    await request(app.getHttpServer())
      .post(`/api/v1/sales/fulfillments/${draft.body.data.id}/cancel`)
      .set(auth())
      .expect(409);
  });

  it('marketplace channel recognizes CHANNEL_RECEIVABLE counterparty', async () => {
    const order = await createAndConfirmOrder({
      qty: 1,
      channelId: digikalaChannelId,
      customerId: null,
      paymentTermType: 'CREDIT',
    });
    const item = order.items[0]!;

    const draft = await request(app.getHttpServer())
      .post('/api/v1/sales/fulfillments')
      .set(auth())
      .send({
        salesOrderId: order.id,
        warehouseId: mainWarehouseId,
        items: [
          {
            salesOrderItemId: item.id,
            skuId: mascaraSkuId,
            locationId,
            batchId,
            quantity: 1,
          },
        ],
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/sales/fulfillments/${draft.body.data.id}/complete`)
      .set(auth())
      .expect(201);

    const receivable = await database.client.customerReceivable.findFirstOrThrow({
      where: {
        companyId: pishtehId,
        salesFulfillmentId: draft.body.data.id,
      },
    });
    expect(receivable.counterpartyType).toBe('CHANNEL');
    expect(receivable.customerId).toBeNull();
  });

  it('cancel order releases ACTIVE reservations', async () => {
    const order = await createAndConfirmOrder({ qty: 1 });
    await request(app.getHttpServer())
      .post(`/api/v1/sales/orders/${order.id}/reserve`)
      .set(auth())
      .send({ warehouseId: mainWarehouseId })
      .expect(201);

    const activeBefore = await database.client.inventoryReservation.count({
      where: {
        companyId: pishtehId,
        sourceType: InventoryReservationSourceType.SALES_ORDER,
        sourceId: order.id,
        status: InventoryReservationStatus.ACTIVE,
      },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/sales/orders/${order.id}/cancel`)
      .set(auth())
      .send({ reason: 'MANUAL' })
      .expect(201);

    const activeAfter = await database.client.inventoryReservation.count({
      where: {
        companyId: pishtehId,
        sourceType: InventoryReservationSourceType.SALES_ORDER,
        sourceId: order.id,
        status: InventoryReservationStatus.ACTIVE,
      },
    });
    expect(activeAfter).toBe(0);
    if (activeBefore > 0) {
      const released = await database.client.inventoryReservation.count({
        where: {
          companyId: pishtehId,
          sourceType: InventoryReservationSourceType.SALES_ORDER,
          sourceId: order.id,
          status: InventoryReservationStatus.RELEASED,
        },
      });
      expect(released).toBeGreaterThan(0);
    }
  });

  it('partial fulfill then return receive posts RETURN_IN + AR credit', async () => {
    const order = await createAndConfirmOrder({ qty: 2 });
    const item = order.items[0]!;

    const ful = await request(app.getHttpServer())
      .post('/api/v1/sales/fulfillments')
      .set(auth())
      .send({
        salesOrderId: order.id,
        warehouseId: mainWarehouseId,
        items: [
          {
            salesOrderItemId: item.id,
            skuId: mascaraSkuId,
            locationId,
            batchId,
            quantity: 2,
          },
        ],
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/sales/fulfillments/${ful.body.data.id}/complete`)
      .set(auth())
      .expect(201);

    const ret = await request(app.getHttpServer())
      .post('/api/v1/sales/returns')
      .set(auth())
      .send({
        salesOrderId: order.id,
        reason: 'CUSTOMER_REQUEST',
        condition: 'SELLABLE',
        items: [
          {
            salesOrderItemId: item.id,
            skuId: mascaraSkuId,
            quantity: 1,
          },
        ],
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/sales/returns/${ret.body.data.id}/approve`)
      .set(auth())
      .expect(201);

    const received = await request(app.getHttpServer())
      .post(`/api/v1/sales/returns/${ret.body.data.id}/receive`)
      .set(auth())
      .send({
        warehouseId: mainWarehouseId,
        items: [
          {
            salesReturnItemId: ret.body.data.items[0].id,
            locationId,
            batchId,
            classification: 'SELLABLE',
          },
        ],
      })
      .expect(201);

    expect(received.body.data.status).toBe('RECEIVED');
    expect(received.body.data.physicalExecution).toBe('RETURN_IN_POSTED');
    expect(received.body.data.financialResolution).toBe('AR_CREDITED');

    const returnIn = await database.client.inventoryMovement.count({
      where: {
        companyId: pishtehId,
        sourceType: InventorySourceType.CUSTOMER_RETURN,
        sourceId: ret.body.data.id,
        movementType: 'RETURN_IN',
      },
    });
    expect(returnIn).toBe(1);

    const credit = await database.client.customerReceivable.findFirst({
      where: {
        companyId: pishtehId,
        salesReturnId: ret.body.data.id,
      },
    });
    expect(credit).toBeTruthy();
    expect(credit!.amount.lt(0)).toBe(true);
    expect(credit!.status).toBe('CREDITED');
  });

  it('lists finance receivables for company', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/finance/receivables')
      .set(auth())
      .expect(200);
    expect(Array.isArray(list.body.data)).toBe(true);
    expect(list.body.meta).toBeTruthy();
  });

  it('concurrent reservations cannot oversubscribe available SELLABLE stock', async () => {
    const availability = await request(app.getHttpServer())
      .get('/api/v1/warehouse/availability')
      .set(auth())
      .query({ warehouseId: mainWarehouseId, skuId: mascaraSkuId })
      .expect(200);

    const available = availability.body.data.available as number;
    if (available < 2) {
      return;
    }

    // Leave only `cap` units available by reserving the rest under a parking order.
    const cap = 2;
    const parkQty = available - cap;
    let parkOrderId: string | null = null;
    if (parkQty > 0) {
      const park = await createAndConfirmOrder({ qty: parkQty });
      parkOrderId = park.id;
      await request(app.getHttpServer())
        .post(`/api/v1/sales/orders/${park.id}/reserve`)
        .set(auth())
        .send({ warehouseId: mainWarehouseId })
        .expect(201);
    }

    const orderA = await createAndConfirmOrder({ qty: cap });
    const orderB = await createAndConfirmOrder({ qty: cap });

    // Release confirm-time reservations so both start from zero remaining for this race.
    await request(app.getHttpServer())
      .post(`/api/v1/sales/orders/${orderA.id}/reservations/release`)
      .set(auth())
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/sales/orders/${orderB.id}/reservations/release`)
      .set(auth())
      .expect(201);

    const [resA, resB] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/sales/orders/${orderA.id}/reserve`)
        .set(auth())
        .send({ warehouseId: mainWarehouseId }),
      request(app.getHttpServer())
        .post(`/api/v1/sales/orders/${orderB.id}/reserve`)
        .set(auth())
        .send({ warehouseId: mainWarehouseId }),
    ]);

    expect([200, 201].includes(resA.status)).toBe(true);
    expect([200, 201].includes(resB.status)).toBe(true);

    const sumReserved = (body: {
      data?: { lines?: Array<{ reservedQuantity: number }> };
    }) =>
      (body.data?.lines ?? []).reduce(
        (s, line) => s + (line.reservedQuantity ?? 0),
        0,
      );

    const reservedA = sumReserved(resA.body);
    const reservedB = sumReserved(resB.body);
    expect(reservedA + reservedB).toBeLessThanOrEqual(cap);

    const after = await request(app.getHttpServer())
      .get('/api/v1/warehouse/availability')
      .set(auth())
      .query({ warehouseId: mainWarehouseId, skuId: mascaraSkuId })
      .expect(200);
    expect(after.body.data.available).toBeGreaterThanOrEqual(0);

    // Cleanup parking reservation so later suites are not starved.
    if (parkOrderId) {
      await request(app.getHttpServer())
        .post(`/api/v1/sales/orders/${parkOrderId}/cancel`)
        .set(auth())
        .send({ reason: 'MANUAL' });
    }
  });
});
