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

describe('Catalog Audit + Events (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let eventBus: DomainEventBus;

  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;
  const sink: DomainEvent[] = [];

  let pishtehId: string;
  let demoBId: string;
  let fanomaBrandId: string;
  let lipstickCategoryId: string;
  let sunscreenCategoryId: string;
  let ownerUserId: string;
  let token: string;

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
    fanomaBrandId = (
      await database.client.brand.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'FAN' },
      })
    ).id;
    lipstickCategoryId = (
      await database.client.category.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'LIPSTICK' },
      })
    ).id;
    sunscreenCategoryId = (
      await database.client.category.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'SUNSCREEN' },
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
      DOMAIN_EVENTS.CATALOG_PRODUCT_CREATED,
      DOMAIN_EVENTS.CATALOG_PRODUCT_UPDATED,
      DOMAIN_EVENTS.CATALOG_PRODUCT_ARCHIVED,
      DOMAIN_EVENTS.CATALOG_BARCODE_CREATED,
      DOMAIN_EVENTS.CATALOG_BARCODE_PRIMARY_CHANGED,
      DOMAIN_EVENTS.CATALOG_BULK_OPERATION_COMPLETED,
    ]) {
      eventBus.subscribe(type, `catalog-audit-e2e-${type}`, async (event) => {
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

  async function createProduct(name: string, categoryId?: string) {
    const code = `AUD-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/catalog/products')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({
        name,
        code,
        brandId: fanomaBrandId,
        categoryId: categoryId ?? lipstickCategoryId,
      })
      .expect(201);
    return res.body.data as { id: string; name: string; code: string; brandId: string };
  }

  async function createSku(productId: string) {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/catalog/products/${productId}/skus`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ code: `SKU-${Date.now().toString(36).slice(-8)}` })
      .expect(201);
    return res.body.data.id as string;
  }

  it('records product create audit + event with actor and company', async () => {
    const product = await createProduct(`Audit Product ${Date.now()}`);

    const audit = await database.client.auditLog.findFirstOrThrow({
      where: {
        companyId: pishtehId,
        entityType: 'PRODUCT',
        entityId: product.id,
        action: 'PRODUCT_CREATED',
      },
    });
    expect(audit.actorUserId).toBe(ownerUserId);
    expect(audit.requestId).toBeTruthy();

    const createdEvents = sink.filter(
      (e) => e.type === DOMAIN_EVENTS.CATALOG_PRODUCT_CREATED,
    );
    expect(createdEvents.length).toBe(1);
    expect(createdEvents[0]?.payload).toMatchObject({
      companyId: pishtehId,
      productId: product.id,
    });
    expect(createdEvents[0]?.correlationId).toBeTruthy();
  });

  it('suppresses audit and event on true product no-op update', async () => {
    const product = await createProduct(`Noop Product ${Date.now()}`);
    sink.length = 0;

    const beforeCount = await database.client.auditLog.count({
      where: { companyId: pishtehId, entityType: 'PRODUCT', entityId: product.id },
    });

    await request(app.getHttpServer())
      .patch(`/api/v1/catalog/products/${product.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({
        name: product.name,
        brandId: product.brandId,
        categoryId: lipstickCategoryId,
      })
      .expect(200);

    const afterCount = await database.client.auditLog.count({
      where: { companyId: pishtehId, entityType: 'PRODUCT', entityId: product.id },
    });
    expect(afterCount).toBe(beforeCount);
    expect(sink.filter((e) => e.type === DOMAIN_EVENTS.CATALOG_PRODUCT_UPDATED)).toHaveLength(0);
  });

  it('stamps bulkOperationId on entity audit and events', async () => {
    const product = await createProduct(`Bulk Corr ${Date.now()}`, sunscreenCategoryId);
    sink.length = 0;

    const res = await request(app.getHttpServer())
      .post('/api/v1/catalog/bulk/execute')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({
        operation: 'PRODUCT_CHANGE_CATEGORY',
        selection: { mode: 'IDS', ids: [product.id] },
        payload: { categoryId: lipstickCategoryId },
      })
      .expect(201);

    const operationId = res.body.data.operationId as string;
    expect(res.body.data.succeeded).toBeGreaterThanOrEqual(1);

    const entityAudit = await database.client.auditLog.findFirst({
      where: {
        companyId: pishtehId,
        entityType: 'PRODUCT',
        entityId: product.id,
        action: 'PRODUCT_UPDATED',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(entityAudit).toBeTruthy();
    const metadata = entityAudit!.metadata as Record<string, unknown>;
    expect(metadata.bulkOperationId).toBe(operationId);

    const parentAudit = await database.client.auditLog.findFirstOrThrow({
      where: {
        companyId: pishtehId,
        entityType: 'BULK_OPERATION',
        entityId: operationId,
        action: 'CATALOG_BULK_EXECUTED',
      },
    });
    expect(parentAudit.after).toMatchObject({
      matched: 1,
      succeeded: expect.any(Number),
    });

    const bulkEvents = sink.filter(
      (e) => e.type === DOMAIN_EVENTS.CATALOG_BULK_OPERATION_COMPLETED,
    );
    expect(bulkEvents.length).toBe(1);
    expect(bulkEvents[0]?.payload).toMatchObject({
      companyId: pishtehId,
      operationId,
    });

    const productUpdated = sink.filter(
      (e) =>
        e.type === DOMAIN_EVENTS.CATALOG_PRODUCT_UPDATED &&
        (e.payload as { productId?: string }).productId === product.id,
    );
    expect(productUpdated.length).toBeGreaterThanOrEqual(1);
    expect(productUpdated[0]?.bulkOperationId).toBe(operationId);
  });

  it('records demoted barcode metadata when creating a new primary', async () => {
    const product = await createProduct(`BC Demote ${Date.now()}`);
    const skuId = await createSku(product.id);

    const first = await request(app.getHttpServer())
      .post(`/api/v1/catalog/skus/${skuId}/barcodes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ value: `DEM1-${Date.now()}`, type: 'OTHER', isPrimary: true })
      .expect(201);

    const second = await request(app.getHttpServer())
      .post(`/api/v1/catalog/skus/${skuId}/barcodes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ value: `DEM2-${Date.now()}`, type: 'OTHER', isPrimary: true })
      .expect(201);

    const audit = await database.client.auditLog.findFirstOrThrow({
      where: {
        companyId: pishtehId,
        entityType: 'BARCODE',
        entityId: second.body.data.id,
        action: 'BARCODE_CREATED',
      },
    });
    const metadata = audit.metadata as Record<string, unknown>;
    expect(metadata.demotedBarcodeIds).toEqual(expect.arrayContaining([first.body.data.id]));
    expect(metadata.becamePrimary).toBe(true);

    const createdEvents = sink.filter(
      (e) =>
        e.type === DOMAIN_EVENTS.CATALOG_BARCODE_CREATED &&
        (e.payload as { barcodeId?: string }).barcodeId === second.body.data.id,
    );
    expect(createdEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('isolates audit reads across companies', async () => {
    const product = await createProduct(`Iso Audit ${Date.now()}`);

    const own = await request(app.getHttpServer())
      .get('/api/v1/audit-logs')
      .query({ entityType: 'PRODUCT', entityId: product.id })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);
    expect(own.body.data.length).toBeGreaterThan(0);
    expect(own.body.data[0].bulkOperationId === null || typeof own.body.data[0].bulkOperationId === 'string').toBe(
      true,
    );
    expect(own.body.data[0]).toHaveProperty('before');
    expect(own.body.data[0]).toHaveProperty('after');

    const foreign = await request(app.getHttpServer())
      .get('/api/v1/audit-logs')
      .query({ entityType: 'PRODUCT', entityId: product.id })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', demoBId)
      .expect(200);
    expect(foreign.body.data).toEqual([]);
  });
});
