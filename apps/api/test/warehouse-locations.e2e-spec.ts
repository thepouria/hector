import request from 'supertest';
import {
  CompanyMemberStatus,
  CurrencyCode,
  OWNER_ROLE_KEY,
  UserStatus,
  syncOwnerRolePermissions,
  syncPermissions,
} from '@hector/database';
import type { INestApplication } from '@nestjs/common';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { DOMAIN_EVENTS, DomainEventBus } from '../src/infrastructure/events';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';

describe('Warehouse Locations (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let eventBus: DomainEventBus;
  const ownerEmail = 'pouria@hector.local';
  const warehouseOperatorEmail = 'hossein@hector.local';
  const password = E2E_PASSWORD;
  let pishtehId: string;
  let demoBId: string;
  let demoBWarehouseId: string;
  let demoBLocationBarcode: string | null = null;
  let ownerUserId: string;
  const tempCompanyIds: string[] = [];

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
    const demoBWarehouse = await database.client.warehouse.findFirstOrThrow({
      where: { companyId: demoBId, code: 'MAIN' },
    });
    demoBWarehouseId = demoBWarehouse.id;

    const demoLoc = await database.client.warehouseLocation.findFirst({
      where: { companyId: demoBId, warehouseId: demoBWarehouseId },
    });
    if (demoLoc) {
      demoBLocationBarcode = demoLoc.barcode;
    } else {
      const created = await database.client.warehouseLocation.create({
        data: {
          companyId: demoBId,
          warehouseId: demoBWarehouseId,
          parentId: null,
          type: 'SHELF',
          code: 'S-IDOR',
          name: 'Demo B Shelf',
          barcode: 'LOC-DEMOBIDOR01',
          status: 'ACTIVE',
          sortOrder: 0,
        },
      });
      demoBLocationBarcode = created.barcode;
    }

    const owner = await database.client.user.update({
      where: { email: ownerEmail },
      data: { status: UserStatus.ACTIVE, deletedAt: null },
    });
    ownerUserId = owner.id;
  });

  afterAll(async () => {
    if (tempCompanyIds.length > 0) {
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

  async function createTempCompany(): Promise<string> {
    const slug = `loc-tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const company = await database.client.company.create({
      data: {
        name: `Location Temp ${slug}`,
        slug,
        baseCurrency: CurrencyCode.IRR,
        timezone: 'Asia/Tehran',
      },
    });
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
    tempCompanyIds.push(company.id);
    return company.id;
  }

  async function createWarehouse(
    token: string,
    companyId: string,
    code = 'MAIN',
    name = 'اصلی',
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set(auth(token, companyId))
      .send({ code, name })
      .expect(201);
    return res.body.data.id as string;
  }

  it('creates root SHELF under warehouse with generated LOC- barcode', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const warehouseId = await createWarehouse(token, companyId);

    const created = await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${warehouseId}/locations`)
      .set(auth(token, companyId))
      .send({ type: 'SHELF', code: '  s01 ', name: 'قفسه ریمل', notes: null })
      .expect(201);

    expect(created.body.data.code).toBe('S01');
    expect(created.body.data.name).toBe('قفسه ریمل');
    expect(created.body.data.parentId).toBeNull();
    expect(created.body.data.companyId).toBe(companyId);
    expect(created.body.data.warehouseId).toBe(warehouseId);
    expect(created.body.data.barcode).toMatch(/^LOC-[0-9A-F]+$/);
    expect(created.body.data.status).toBe('ACTIVE');
  });

  it('supports full hierarchy and skipped levels', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const warehouseId = await createWarehouse(token, companyId);

    const zone = await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${warehouseId}/locations`)
      .set(auth(token, companyId))
      .send({ type: 'ZONE', code: 'Z1' })
      .expect(201);
    const aisle = await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${warehouseId}/locations`)
      .set(auth(token, companyId))
      .send({ type: 'AISLE', code: 'A01', parentId: zone.body.data.id })
      .expect(201);
    const rack = await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${warehouseId}/locations`)
      .set(auth(token, companyId))
      .send({ type: 'RACK', code: 'R01', parentId: aisle.body.data.id })
      .expect(201);
    const shelf = await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${warehouseId}/locations`)
      .set(auth(token, companyId))
      .send({ type: 'SHELF', code: 'S01', parentId: rack.body.data.id })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${warehouseId}/locations`)
      .set(auth(token, companyId))
      .send({ type: 'BIN', code: 'B01', parentId: shelf.body.data.id })
      .expect(201);

    // Skipped: ZONE → SHELF → BIN
    const zone2 = await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${warehouseId}/locations`)
      .set(auth(token, companyId))
      .send({ type: 'ZONE', code: 'Z2' })
      .expect(201);
    const shelf2 = await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${warehouseId}/locations`)
      .set(auth(token, companyId))
      .send({ type: 'SHELF', code: 'S99', parentId: zone2.body.data.id })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${warehouseId}/locations`)
      .set(auth(token, companyId))
      .send({ type: 'BIN', code: 'B99', parentId: shelf2.body.data.id })
      .expect(201);

    const tree = await request(app.getHttpServer())
      .get(`/api/v1/warehouses/${warehouseId}/locations?view=tree`)
      .set(auth(token, companyId))
      .expect(200);
    expect(Array.isArray(tree.body.data)).toBe(true);
    expect(tree.body.data.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects self-parent, cycles, cross-warehouse parent, and type inversion', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const whA = await createWarehouse(token, companyId, 'A', 'انبار A');
    const whB = await createWarehouse(token, companyId, 'B', 'انبار B');

    const a = await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${whA}/locations`)
      .set(auth(token, companyId))
      .send({ type: 'ZONE', code: 'A' })
      .expect(201);
    const b = await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${whA}/locations`)
      .set(auth(token, companyId))
      .send({ type: 'RACK', code: 'B', parentId: a.body.data.id })
      .expect(201);
    const c = await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${whA}/locations`)
      .set(auth(token, companyId))
      .send({ type: 'SHELF', code: 'C', parentId: b.body.data.id })
      .expect(201);
    const other = await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${whB}/locations`)
      .set(auth(token, companyId))
      .send({ type: 'SHELF', code: 'X' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/warehouses/${whA}/locations/${a.body.data.id}`)
      .set(auth(token, companyId))
      .send({ parentId: a.body.data.id })
      .expect(409);

    const cycle = await request(app.getHttpServer())
      .patch(`/api/v1/warehouses/${whA}/locations/${a.body.data.id}`)
      .set(auth(token, companyId))
      .send({ parentId: c.body.data.id })
      .expect(409);
    expect(cycle.body.error.code).toBe('WAREHOUSE_LOCATION_CYCLE');

    const cross = await request(app.getHttpServer())
      .patch(`/api/v1/warehouses/${whA}/locations/${c.body.data.id}`)
      .set(auth(token, companyId))
      .send({ parentId: other.body.data.id })
      .expect(409);
    expect(cross.body.error.code).toBe('WAREHOUSE_LOCATION_INVALID_PARENT');

    const bin = await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${whA}/locations`)
      .set(auth(token, companyId))
      .send({ type: 'BIN', code: 'BIN1' })
      .expect(201);
    const invert = await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${whA}/locations`)
      .set(auth(token, companyId))
      .send({ type: 'ZONE', code: 'ZBAD', parentId: bin.body.data.id })
      .expect(409);
    expect(invert.body.error.code).toBe('WAREHOUSE_LOCATION_TYPE_INVERSION');
  });

  it('enforces warehouse-scoped code uniqueness and allows same code in another warehouse', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const whA = await createWarehouse(token, companyId, 'A', 'A');
    const whB = await createWarehouse(token, companyId, 'B', 'B');

    await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${whA}/locations`)
      .set(auth(token, companyId))
      .send({ type: 'SHELF', code: 'S01' })
      .expect(201);
    const dup = await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${whA}/locations`)
      .set(auth(token, companyId))
      .send({ type: 'SHELF', code: 's01' })
      .expect(409);
    expect(dup.body.error.code).toBe('WAREHOUSE_LOCATION_CODE_ALREADY_EXISTS');

    await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${whB}/locations`)
      .set(auth(token, companyId))
      .send({ type: 'SHELF', code: 'S01' })
      .expect(201);
  });

  it('keeps barcode stable across name/code/parent changes and resolves exactly', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const warehouseId = await createWarehouse(token, companyId);
    const parent = await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${warehouseId}/locations`)
      .set(auth(token, companyId))
      .send({ type: 'RACK', code: 'R1' })
      .expect(201);
    const shelf = await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${warehouseId}/locations`)
      .set(auth(token, companyId))
      .send({ type: 'SHELF', code: 'S1', name: 'Old' })
      .expect(201);
    const barcode = shelf.body.data.barcode as string;

    const renamed = await request(app.getHttpServer())
      .patch(`/api/v1/warehouses/${warehouseId}/locations/${shelf.body.data.id}`)
      .set(auth(token, companyId))
      .send({ name: 'New', code: 'S2', parentId: parent.body.data.id })
      .expect(200);
    expect(renamed.body.data.barcode).toBe(barcode);
    expect(renamed.body.data.code).toBe('S2');
    expect(renamed.body.data.parentId).toBe(parent.body.data.id);

    const resolved = await request(app.getHttpServer())
      .post('/api/v1/warehouse-locations/resolve-barcode')
      .set(auth(token, companyId))
      .send({ value: `  ${barcode}  ` })
      .expect(200);
    expect(resolved.body.data.id).toBe(shelf.body.data.id);
    expect(resolved.body.data.status).toBe('ACTIVE');

    await request(app.getHttpServer())
      .post('/api/v1/warehouse-locations/resolve-barcode')
      .set(auth(token, companyId))
      .send({ value: 'LOC-UNKNOWN999' })
      .expect(404);
  });

  it('resolves inactive locations and blocks warehouse deactivation with ACTIVE locations', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const warehouseId = await createWarehouse(token, companyId);
    const shelf = await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${warehouseId}/locations`)
      .set(auth(token, companyId))
      .send({ type: 'SHELF', code: 'S1' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${warehouseId}/deactivate`)
      .set(auth(token, companyId))
      .send({})
      .expect(409);

    await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${warehouseId}/locations/${shelf.body.data.id}/deactivate`)
      .set(auth(token, companyId))
      .expect(201);

    const resolved = await request(app.getHttpServer())
      .post('/api/v1/warehouse-locations/resolve-barcode')
      .set(auth(token, companyId))
      .send({ value: shelf.body.data.barcode })
      .expect(200);
    expect(resolved.body.data.status).toBe('INACTIVE');

    await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${warehouseId}/deactivate`)
      .set(auth(token, companyId))
      .send({})
      .expect(201);
  });

  it('blocks deactivating parent with ACTIVE descendants', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const warehouseId = await createWarehouse(token, companyId);
    const zone = await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${warehouseId}/locations`)
      .set(auth(token, companyId))
      .send({ type: 'ZONE', code: 'Z1' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${warehouseId}/locations`)
      .set(auth(token, companyId))
      .send({ type: 'SHELF', code: 'S1', parentId: zone.body.data.id })
      .expect(201);

    const blocked = await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${warehouseId}/locations/${zone.body.data.id}/deactivate`)
      .set(auth(token, companyId))
      .expect(409);
    expect(blocked.body.error.code).toBe('WAREHOUSE_LOCATION_ACTIVE_DESCENDANTS');
  });

  it('rejects mass assignment of companyId/warehouseId/barcode/id', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const warehouseId = await createWarehouse(token, companyId);

    await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${warehouseId}/locations`)
      .set(auth(token, companyId))
      .send({
        type: 'SHELF',
        code: 'MASS',
        companyId: demoBId,
        warehouseId: demoBWarehouseId,
        barcode: 'LOC-HACKED',
        id: '00000000-0000-4000-8000-000000000099',
        createdBy: 'other',
      })
      .expect(400);
  });

  it('enforces tenant isolation for location routes and barcode resolve (IDOR → 404)', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const warehouseId = await createWarehouse(token, companyId);
    const shelf = await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${warehouseId}/locations`)
      .set(auth(token, companyId))
      .send({ type: 'SHELF', code: 'S1' })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/warehouses/${demoBWarehouseId}/locations`)
      .set(auth(token, companyId))
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/warehouses/${warehouseId}/locations/${shelf.body.data.id}`)
      .set(auth(token, demoBId))
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/warehouses/${warehouseId}/locations/${shelf.body.data.id}`)
      .set(auth(token, demoBId))
      .send({ name: 'hack' })
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${warehouseId}/locations/${shelf.body.data.id}/deactivate`)
      .set(auth(token, demoBId))
      .expect(404);

    expect(demoBLocationBarcode).toBeTruthy();
    await request(app.getHttpServer())
      .post('/api/v1/warehouse-locations/resolve-barcode')
      .set(auth(token, companyId))
      .send({ value: demoBLocationBarcode })
      .expect(404);
  });

  it('enforces RBAC: read-only can list/resolve but not mutate', async () => {
    const operatorToken = await login(warehouseOperatorEmail);
    const main = await database.client.warehouse.findFirstOrThrow({
      where: { companyId: pishtehId, code: 'MAIN' },
    });

    await request(app.getHttpServer())
      .get(`/api/v1/warehouses/${main.id}/locations`)
      .set(auth(operatorToken))
      .expect(200);

    const seeded = await database.client.warehouseLocation.findFirstOrThrow({
      where: { companyId: pishtehId, warehouseId: main.id, code: 'S01' },
    });
    await request(app.getHttpServer())
      .post('/api/v1/warehouse-locations/resolve-barcode')
      .set(auth(operatorToken))
      .send({ value: seeded.barcode })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${main.id}/locations`)
      .set(auth(operatorToken))
      .send({ type: 'SHELF', code: 'NOPE' })
      .expect(403);
  });

  it('writes audit and domain events for create/update/move/activate/deactivate (not resolve)', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const warehouseId = await createWarehouse(token, companyId);
    const received: string[] = [];
    const handlerId = `loc-e2e-${Date.now()}`;
    for (const type of [
      DOMAIN_EVENTS.WAREHOUSE_LOCATION_CREATED,
      DOMAIN_EVENTS.WAREHOUSE_LOCATION_UPDATED,
      DOMAIN_EVENTS.WAREHOUSE_LOCATION_MOVED,
      DOMAIN_EVENTS.WAREHOUSE_LOCATION_ACTIVATED,
      DOMAIN_EVENTS.WAREHOUSE_LOCATION_DEACTIVATED,
    ]) {
      eventBus.subscribe(type, `${handlerId}-${type}`, (event) => {
        received.push(event.type);
      });
    }

    const rack = await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${warehouseId}/locations`)
      .set(auth(token, companyId))
      .send({ type: 'RACK', code: 'R1' })
      .expect(201);
    const shelf = await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${warehouseId}/locations`)
      .set(auth(token, companyId))
      .send({ type: 'SHELF', code: 'S1' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/warehouses/${warehouseId}/locations/${shelf.body.data.id}`)
      .set(auth(token, companyId))
      .send({ name: 'Moved Shelf', parentId: rack.body.data.id })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${warehouseId}/locations/${shelf.body.data.id}/deactivate`)
      .set(auth(token, companyId))
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${warehouseId}/locations/${shelf.body.data.id}/activate`)
      .set(auth(token, companyId))
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/warehouse-locations/resolve-barcode')
      .set(auth(token, companyId))
      .send({ value: shelf.body.data.barcode })
      .expect(200);

    expect(received).toContain(DOMAIN_EVENTS.WAREHOUSE_LOCATION_CREATED);
    expect(received).toContain(DOMAIN_EVENTS.WAREHOUSE_LOCATION_UPDATED);
    expect(received).toContain(DOMAIN_EVENTS.WAREHOUSE_LOCATION_MOVED);
    expect(received).toContain(DOMAIN_EVENTS.WAREHOUSE_LOCATION_DEACTIVATED);
    expect(received).toContain(DOMAIN_EVENTS.WAREHOUSE_LOCATION_ACTIVATED);

    const moveAudit = await database.client.auditLog.findFirst({
      where: {
        companyId,
        entityType: 'WAREHOUSE_LOCATION',
        entityId: shelf.body.data.id,
        action: 'WAREHOUSE_LOCATION_MOVED',
      },
    });
    expect(moveAudit).toBeTruthy();
    expect(moveAudit?.actorUserId).toBe(ownerUserId);
    const after = moveAudit?.after as { newParentId?: string } | null;
    expect(after?.newParentId).toBe(rack.body.data.id);
  });

  it('handles concurrent duplicate code creation with at most one success', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const warehouseId = await createWarehouse(token, companyId);

    const results = await Promise.allSettled([
      request(app.getHttpServer())
        .post(`/api/v1/warehouses/${warehouseId}/locations`)
        .set(auth(token, companyId))
        .send({ type: 'SHELF', code: 'S01' }),
      request(app.getHttpServer())
        .post(`/api/v1/warehouses/${warehouseId}/locations`)
        .set(auth(token, companyId))
        .send({ type: 'SHELF', code: 's01' }),
    ]);

    const statuses = results.map((r) =>
      r.status === 'fulfilled' ? r.value.status : 0,
    );
    expect(statuses.filter((s) => s === 201).length).toBe(1);
    expect(statuses.filter((s) => s === 409 || s === 400).length).toBeGreaterThanOrEqual(1);
  });

  it('prevents concurrent parent moves from creating a cycle', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const warehouseId = await createWarehouse(token, companyId);

    const a = await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${warehouseId}/locations`)
      .set(auth(token, companyId))
      .send({ type: 'ZONE', code: 'A' })
      .expect(201);
    const b = await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${warehouseId}/locations`)
      .set(auth(token, companyId))
      .send({ type: 'RACK', code: 'B', parentId: a.body.data.id })
      .expect(201);
    const c = await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${warehouseId}/locations`)
      .set(auth(token, companyId))
      .send({ type: 'SHELF', code: 'C', parentId: b.body.data.id })
      .expect(201);

    const results = await Promise.allSettled([
      request(app.getHttpServer())
        .patch(`/api/v1/warehouses/${warehouseId}/locations/${a.body.data.id}`)
        .set(auth(token, companyId))
        .send({ parentId: c.body.data.id }),
      request(app.getHttpServer())
        .patch(`/api/v1/warehouses/${warehouseId}/locations/${c.body.data.id}`)
        .set(auth(token, companyId))
        .send({ parentId: a.body.data.id }),
    ]);

    const statuses = results.map((r) =>
      r.status === 'fulfilled' ? r.value.status : 0,
    );

    // At least one must fail cycle validation; final graph must remain acyclic.
    const successCount = statuses.filter((s) => s === 200).length;
    const failCount = statuses.filter((s) => s === 409).length;
    expect(successCount + failCount).toBe(2);
    expect(failCount).toBeGreaterThanOrEqual(1);

    const rows = await database.client.warehouseLocation.findMany({
      where: { companyId, warehouseId },
      select: { id: true, parentId: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const row of rows) {
      const seen = new Set<string>();
      let cur: string | null = row.id;
      while (cur) {
        expect(seen.has(cur)).toBe(false);
        seen.add(cur);
        cur = byId.get(cur)?.parentId ?? null;
      }
    }
  });

  it('lists 1000 locations and builds tree / resolves barcode within sanity bounds', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const warehouseId = await createWarehouse(token, companyId);

    const rows = Array.from({ length: 1000 }, (_, i) => ({
      companyId,
      warehouseId,
      parentId: null as string | null,
      type: 'SHELF' as const,
      code: `S${String(i + 1).padStart(4, '0')}`,
      name: i % 10 === 0 ? `Shelf ${i + 1}` : null,
      barcode: `LOC-PERF${String(i + 1).padStart(8, '0')}`,
      status: 'ACTIVE' as const,
      sortOrder: i,
    }));
    // createMany in chunks
    for (let i = 0; i < rows.length; i += 200) {
      await database.client.warehouseLocation.createMany({
        data: rows.slice(i, i + 200),
      });
    }

    const listStarted = Date.now();
    const list = await request(app.getHttpServer())
      .get(`/api/v1/warehouses/${warehouseId}/locations?pageSize=100&page=1`)
      .set(auth(token, companyId))
      .expect(200);
    const listMs = Date.now() - listStarted;
    expect(list.body.meta.total).toBe(1000);
    expect(listMs).toBeLessThan(10_000);

    const treeStarted = Date.now();
    const tree = await request(app.getHttpServer())
      .get(`/api/v1/warehouses/${warehouseId}/locations?view=tree`)
      .set(auth(token, companyId))
      .expect(200);
    const treeMs = Date.now() - treeStarted;
    expect(tree.body.data.length).toBe(1000);
    expect(treeMs).toBeLessThan(15_000);

    const search = await request(app.getHttpServer())
      .get(`/api/v1/warehouses/${warehouseId}/locations?search=S0500`)
      .set(auth(token, companyId))
      .expect(200);
    expect(search.body.data.some((l: { code: string }) => l.code === 'S0500')).toBe(true);

    const resolveStarted = Date.now();
    const resolved = await request(app.getHttpServer())
      .post('/api/v1/warehouse-locations/resolve-barcode')
      .set(auth(token, companyId))
      .send({ value: 'LOC-PERF00000500' })
      .expect(200);
    expect(resolved.body.data.code).toBe('S0500');
    expect(Date.now() - resolveStarted).toBeLessThan(5_000);
  }, 120_000);
});
