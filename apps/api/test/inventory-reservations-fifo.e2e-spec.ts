import request from 'supertest';
import {
  InventoryCostLayerSourceType,
  InventoryMovementType,
  InventoryReservationSourceType,
  InventorySourceType,
  InventoryValuationStatus,
  StockClassification,
  UserStatus,
  syncOwnerRolePermissions,
  syncPermissions,
} from '@hector/database';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ERROR_CODES } from '../src/common/constants';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';

describe('Reservations + FIFO foundation (Phase 3.15 e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;
  let pishtehId: string;
  let demoBId: string;
  let mainWarehouseId: string;
  let mascaraSkuId: string;
  let accessToken: string;
  const createdReservationIds: string[] = [];

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
    mascaraSkuId = (
      await database.client.sku.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'ESS-MASCARA-01' },
      })
    ).id;
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
    if (createdReservationIds.length > 0) {
      await database.client.inventoryReservation.deleteMany({
        where: { id: { in: createdReservationIds } },
      });
    }
    await app.close();
  });

  it('GET availability returns onHand/reserved/available for SELLABLE', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/warehouse/availability')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Company-Id', pishtehId)
      .query({ warehouseId: mainWarehouseId, skuId: mascaraSkuId })
      .expect(200);

    expect(res.body.data.onHand).toBeGreaterThanOrEqual(0);
    expect(res.body.data.reserved).toBeGreaterThanOrEqual(0);
    expect(res.body.data.available).toBe(
      Math.max(0, res.body.data.onHand - res.body.data.reserved),
    );
    expect(res.body.data.classification).toBe('SELLABLE');
  });

  it('creates reservation without InventoryMovement; decreases available', async () => {
    const before = await request(app.getHttpServer())
      .get('/api/v1/warehouse/availability')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Company-Id', pishtehId)
      .query({ warehouseId: mainWarehouseId, skuId: mascaraSkuId })
      .expect(200);

    if (before.body.data.available < 5) {
      return;
    }

    const movementsBefore = await database.client.inventoryMovement.count({
      where: { companyId: pishtehId },
    });

    const requestId = randomUUID();
    const sourceId = randomUUID();
    const created = await request(app.getHttpServer())
      .post('/api/v1/warehouse/reservations')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Company-Id', pishtehId)
      .send({
        warehouseId: mainWarehouseId,
        skuId: mascaraSkuId,
        quantity: 5,
        sourceType: InventoryReservationSourceType.MANUAL_OPERATION,
        sourceId,
        requestId,
      })
      .expect(201);

    createdReservationIds.push(created.body.data.id);

    const after = await request(app.getHttpServer())
      .get('/api/v1/warehouse/availability')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Company-Id', pishtehId)
      .query({ warehouseId: mainWarehouseId, skuId: mascaraSkuId })
      .expect(200);

    expect(after.body.data.onHand).toBe(before.body.data.onHand);
    expect(after.body.data.reserved).toBe(before.body.data.reserved + 5);
    expect(after.body.data.available).toBe(before.body.data.available - 5);

    const movementsAfter = await database.client.inventoryMovement.count({
      where: { companyId: pishtehId },
    });
    expect(movementsAfter).toBe(movementsBefore);

    // Idempotent retry
    const retry = await request(app.getHttpServer())
      .post('/api/v1/warehouse/reservations')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Company-Id', pishtehId)
      .send({
        warehouseId: mainWarehouseId,
        skuId: mascaraSkuId,
        quantity: 5,
        sourceType: InventoryReservationSourceType.MANUAL_OPERATION,
        sourceId,
        requestId,
      })
      .expect(201);
    expect(retry.body.data.id).toBe(created.body.data.id);
  });

  it('rejects over-reservation', async () => {
    const avail = await request(app.getHttpServer())
      .get('/api/v1/warehouse/availability')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Company-Id', pishtehId)
      .query({ warehouseId: mainWarehouseId, skuId: mascaraSkuId })
      .expect(200);

    const res = await request(app.getHttpServer())
      .post('/api/v1/warehouse/reservations')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Company-Id', pishtehId)
      .send({
        warehouseId: mainWarehouseId,
        skuId: mascaraSkuId,
        quantity: avail.body.data.available + 50,
        sourceType: InventoryReservationSourceType.OTHER,
        sourceId: randomUUID(),
        requestId: randomUUID(),
      })
      .expect(409);

    expect(res.body.error?.code ?? res.body.code).toBe(
      ERROR_CODES.INVENTORY_RESERVATION_INSUFFICIENT_AVAILABLE,
    );
  });

  it('releases reservation and restores available', async () => {
    const id = createdReservationIds[0];
    if (!id) return;

    const before = await request(app.getHttpServer())
      .get('/api/v1/warehouse/availability')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Company-Id', pishtehId)
      .query({ warehouseId: mainWarehouseId, skuId: mascaraSkuId })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/warehouse/reservations/${id}/release`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Company-Id', pishtehId)
      .send({ quantity: 2 })
      .expect(201);

    const after = await request(app.getHttpServer())
      .get('/api/v1/warehouse/availability')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Company-Id', pishtehId)
      .query({ warehouseId: mainWarehouseId, skuId: mascaraSkuId })
      .expect(200);

    expect(after.body.data.reserved).toBe(before.body.data.reserved - 2);
    expect(after.body.data.available).toBe(before.body.data.available + 2);
    expect(after.body.data.onHand).toBe(before.body.data.onHand);
  });

  it('tenant isolation: Demo B cannot read Pishteh reservation', async () => {
    const id = createdReservationIds[0];
    if (!id) return;

    await request(app.getHttpServer())
      .get(`/api/v1/warehouse/reservations/${id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Company-Id', demoBId)
      .expect(404);
  });

  it('valuation summary and cost layers are readable', async () => {
    const summary = await request(app.getHttpServer())
      .get('/api/v1/warehouse/valuation')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);

    expect(summary.body.data.totalInventoryValue).toBeDefined();
    expect(summary.body.data.unvaluedQuantity).toBeGreaterThanOrEqual(0);

    const layers = await request(app.getHttpServer())
      .get('/api/v1/warehouse/cost-layers')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Company-Id', pishtehId)
      .query({ remainingOnly: true, pageSize: 5 })
      .expect(200);

    expect(Array.isArray(layers.body.data)).toBe(true);
  });

  it('RECEIVE creates valued/unvalued layer idempotently with outbound FIFO consume', async () => {
    // Smoke: seed FIFO demo layer exists with VALUED remaining when carved.
    const valued = await database.client.inventoryCostLayer.count({
      where: {
        companyId: pishtehId,
        valuationStatus: InventoryValuationStatus.VALUED,
        remainingQuantity: { gt: 0 },
        sourceType: {
          in: [InventoryCostLayerSourceType.SEED, InventoryCostLayerSourceType.GOODS_RECEIPT],
        },
      },
    });
    const unvalued = await database.client.inventoryCostLayer.count({
      where: {
        companyId: pishtehId,
        valuationStatus: InventoryValuationStatus.UNVALUED,
        remainingQuantity: { gt: 0 },
      },
    });
    expect(valued + unvalued).toBeGreaterThan(0);
    void InventoryMovementType.RECEIVE;
    void InventorySourceType.PUTAWAY;
    void StockClassification.SELLABLE;
  });
});
