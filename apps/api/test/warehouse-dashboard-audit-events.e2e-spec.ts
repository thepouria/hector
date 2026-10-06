import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  InventoryReservationSourceType,
  InventoryReservationStatus,
  UserStatus,
  syncOwnerRolePermissions,
  syncPermissions,
} from '@hector/database';
import type { INestApplication } from '@nestjs/common';
import { requestContext } from '../src/common/context/request-context';
import { DOMAIN_EVENTS, DomainEventBus, type DomainEvent } from '../src/infrastructure/events';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { AUDIT_ACTIONS } from '../src/modules/audit/audit.constants';
import { InventoryReservationsService } from '../src/modules/warehouse/inventory-reservations.service';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';

describe('Warehouse Dashboard + Audit + Events (Phase 3.17 e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let eventBus: DomainEventBus;
  let reservations: InventoryReservationsService;
  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;
  let pishtehId: string;
  let demoBId: string;
  let ownerUserId: string;
  let ownerMemberId: string;

  const auth = (token: string, companyId: string) => ({
    Authorization: `Bearer ${token}`,
    'X-Company-Id': companyId,
  });

  async function login(email: string) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return res.body.data.accessToken as string;
  }

  beforeAll(async () => {
    app = await createE2eApp();
    database = app.get(DatabaseService);
    eventBus = app.get(DomainEventBus);
    reservations = app.get(InventoryReservationsService);
    await syncPermissions(database.client);
    await syncOwnerRolePermissions(database.client);

    pishtehId = (
      await database.client.company.findUniqueOrThrow({ where: { slug: 'pishteh' } })
    ).id;
    demoBId = (
      await database.client.company.findUniqueOrThrow({ where: { slug: 'hector-demo-b' } })
    ).id;
    const owner = await database.client.user.update({
      where: { email: ownerEmail },
      data: { status: UserStatus.ACTIVE, deletedAt: null },
    });
    ownerUserId = owner.id;
    ownerMemberId = (
      await database.client.companyMember.findFirstOrThrow({
        where: { companyId: pishtehId, userId: ownerUserId },
      })
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns goods receipt activity from company-scoped audit projection', async () => {
    const token = await login(ownerEmail);
    const receipt = await database.client.goodsReceipt.findFirst({
      where: { companyId: pishtehId },
      orderBy: { createdAt: 'desc' },
    });
    if (!receipt) {
      // Seed always creates receipts for Pishteh; skip soft-fail is not allowed — assert present.
      throw new Error('Expected seeded goods receipt for pishteh');
    }

    const res = await request(app.getHttpServer())
      .get(`/api/v1/goods-receipts/${receipt.id}/activity`)
      .set(auth(token, pishtehId))
      .expect(200);

    expect(res.body.data).toEqual(expect.any(Array));
    expect(res.body.meta).toEqual(
      expect.objectContaining({
        page: 1,
        pageSize: expect.any(Number),
        total: expect.any(Number),
      }),
    );

    await request(app.getHttpServer())
      .get(`/api/v1/goods-receipts/${receipt.id}/activity`)
      .set(auth(token, demoBId))
      .expect(404);
  });

  it('emits InventoryReservationConsumed exactly once for consume()', async () => {
    const warehouse = await database.client.warehouse.findFirstOrThrow({
      where: { companyId: pishtehId, code: 'MAIN' },
    });
    const sku = await database.client.sku.findFirstOrThrow({
      where: { companyId: pishtehId, code: 'ESS-MASCARA-01' },
    });

    const reservation = await database.client.inventoryReservation.create({
      data: {
        companyId: pishtehId,
        warehouseId: warehouse.id,
        skuId: sku.id,
        quantity: 5,
        remainingQuantity: 5,
        status: InventoryReservationStatus.ACTIVE,
        sourceType: InventoryReservationSourceType.MANUAL_OPERATION,
        sourceId: randomUUID(),
        sourceLineId: randomUUID(),
        requestId: randomUUID(),
        createdById: ownerUserId,
      },
    });

    const received: DomainEvent[] = [];
    const handlerId = `phase317-consume-${randomUUID()}`;
    eventBus.subscribe(
      DOMAIN_EVENTS.WAREHOUSE_INVENTORY_RESERVATION_CONSUMED,
      handlerId,
      async (event) => {
        received.push(event);
      },
    );

    await requestContext.run(
      {
        requestId: randomUUID(),
        userId: ownerUserId,
        companyMemberId: ownerMemberId,
        companyId: pishtehId,
      },
      async () =>
        reservations.consume(
          { companyId: pishtehId, companyMemberId: ownerMemberId },
          reservation.id,
          2,
        ),
    );

    expect(received).toHaveLength(1);
    expect(received[0]?.payload).toEqual(
      expect.objectContaining({
        companyId: pishtehId,
        reservationId: reservation.id,
        consumedQuantity: 2,
        remainingQuantity: 3,
      }),
    );

    const audit = await database.client.auditLog.findFirst({
      where: {
        companyId: pishtehId,
        entityId: reservation.id,
        action: AUDIT_ACTIONS.INVENTORY_RESERVATION_CONSUMED,
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toBeTruthy();
    expect(audit?.actorUserId).toBeTruthy();

    const movementCount = await database.client.inventoryMovement.count({
      where: {
        companyId: pishtehId,
        // consume must not create movements
        notes: { contains: reservation.id },
      },
    });
    expect(movementCount).toBe(0);

    await database.client.inventoryReservation.delete({ where: { id: reservation.id } });
  });

  it('keeps audit list tenant-isolated for warehouse entity filter', async () => {
    const token = await login(ownerEmail);
    const transfer = await database.client.stockTransfer.findFirst({
      where: { companyId: pishtehId },
    });
    if (!transfer) return;

    const a = await request(app.getHttpServer())
      .get('/api/v1/audit-logs')
      .query({ entityType: 'STOCK_TRANSFER', entityId: transfer.id })
      .set(auth(token, pishtehId))
      .expect(200);

    const b = await request(app.getHttpServer())
      .get('/api/v1/audit-logs')
      .query({ entityType: 'STOCK_TRANSFER', entityId: transfer.id })
      .set(auth(token, demoBId))
      .expect(200);

    expect(b.body.data.every((row: { entityId: string }) => row.entityId !== transfer.id)).toBe(
      true,
    );
    expect(Array.isArray(a.body.data)).toBe(true);
  });
});
