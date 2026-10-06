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

describe('Warehouse Master (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let eventBus: DomainEventBus;
  const ownerEmail = 'pouria@hector.local';
  const warehouseOperatorEmail = 'hossein@hector.local';
  const password = E2E_PASSWORD;
  let pishtehId: string;
  let demoBId: string;
  let demoBWarehouseId: string;
  let ownerPasswordHash: string;
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
    demoBWarehouseId = (
      await database.client.warehouse.findFirstOrThrow({
        where: { companyId: demoBId, code: 'MAIN' },
      })
    ).id;

    const owner = await database.client.user.update({
      where: { email: ownerEmail },
      data: { status: UserStatus.ACTIVE, deletedAt: null },
    });
    ownerPasswordHash = owner.passwordHash;
    ownerUserId = owner.id;
  });

  afterAll(async () => {
    if (tempCompanyIds.length > 0) {
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
    // Suites that soft-delete / suspend the shared owner can leave login 404/401 mid-file.
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

  async function createTempCompany(): Promise<string> {
    const slug = `wh-tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const company = await database.client.company.create({
      data: {
        name: `Warehouse Temp ${slug}`,
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
    // Copy permissions from an existing OWNER role — avoid full multi-company sync
    // which grows O(companies × permissions) and starves later suites' beforeAll.
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

  it('denies unauthenticated warehouse access', async () => {
    await request(app.getHttpServer()).get('/api/v1/warehouses').expect(401);
  });

  it('creates warehouse with code normalization and Persian name', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const res = await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set(auth(token, companyId))
      .send({
        code: '  thr-01  ',
        name: '  انبار تهران ',
        address: ' تهران، بازار بزرگ ',
        notes: '  تحویل تا ۵ ',
      })
      .expect(201);

    expect(res.body.data.code).toBe('THR-01');
    expect(res.body.data.name).toBe('انبار تهران');
    expect(res.body.data.address).toBe('تهران، بازار بزرگ');
    expect(res.body.data.notes).toBe('تحویل تا ۵');
    expect(res.body.data.status).toBe('ACTIVE');
    expect(res.body.data.isDefault).toBe(true);
    expect(res.body.data.companyId).toBe(companyId);
  });

  it('makes first warehouse default and keeps additional warehouses non-default', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();

    const first = await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set(auth(token, companyId))
      .send({ code: 'MAIN', name: 'انبار اصلی' })
      .expect(201);
    expect(first.body.data.isDefault).toBe(true);

    const second = await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set(auth(token, companyId))
      .send({ code: 'RETURNS', name: 'انبار مرجوعی' })
      .expect(201);
    expect(second.body.data.isDefault).toBe(false);

    const defaults = await database.client.warehouse.count({
      where: { companyId, isDefault: true },
    });
    expect(defaults).toBe(1);
  });

  it('switches default transactionally via set-default', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const a = await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set(auth(token, companyId))
      .send({ code: 'A', name: 'A' })
      .expect(201);
    const b = await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set(auth(token, companyId))
      .send({ code: 'B', name: 'B' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${b.body.data.id}/set-default`)
      .set(auth(token, companyId))
      .expect(201)
      .expect((r) => expect(r.body.data.isDefault).toBe(true));

    const aRow = await database.client.warehouse.findUniqueOrThrow({
      where: { id: a.body.data.id },
    });
    const bRow = await database.client.warehouse.findUniqueOrThrow({
      where: { id: b.body.data.id },
    });
    expect(aRow.isDefault).toBe(false);
    expect(bRow.isDefault).toBe(true);
  });

  it('allows create with isDefault true to replace previous default', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const first = await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set(auth(token, companyId))
      .send({ code: 'OLD', name: 'قدیم' })
      .expect(201);
    const next = await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set(auth(token, companyId))
      .send({ code: 'NEW', name: 'جدید', isDefault: true })
      .expect(201);

    expect(next.body.data.isDefault).toBe(true);
    const old = await database.client.warehouse.findUniqueOrThrow({
      where: { id: first.body.data.id },
    });
    expect(old.isDefault).toBe(false);
  });

  it('enforces company-scoped code uniqueness after normalization', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set(auth(token, companyId))
      .send({ code: 'MAIN', name: 'One' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set(auth(token, companyId))
      .send({ code: 'main', name: 'Two' })
      .expect(409);
  });

  it('allows same warehouse code across companies', async () => {
    const token = await login(ownerEmail);
    const listedA = await request(app.getHttpServer())
      .get('/api/v1/warehouses')
      .query({ search: 'MAIN', pageSize: 50 })
      .set(auth(token, pishtehId))
      .expect(200);
    const listedB = await request(app.getHttpServer())
      .get('/api/v1/warehouses')
      .query({ search: 'MAIN', pageSize: 50 })
      .set(auth(token, demoBId))
      .expect(200);

    expect(listedA.body.data.some((row: { code: string }) => row.code === 'MAIN')).toBe(true);
    expect(listedB.body.data.some((row: { code: string }) => row.code === 'MAIN')).toBe(true);
  });

  it('lists/searches/filters warehouses and supports Persian search', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set(auth(token, companyId))
      .send({ code: 'SRCH', name: 'انبار جستجو', address: 'کرج' })
      .expect(201);

    const byName = await request(app.getHttpServer())
      .get('/api/v1/warehouses')
      .query({ search: 'جستجو', pageSize: 20 })
      .set(auth(token, companyId))
      .expect(200);
    expect(byName.body.data.some((row: { code: string }) => row.code === 'SRCH')).toBe(true);

    const byStatus = await request(app.getHttpServer())
      .get('/api/v1/warehouses')
      .query({ status: 'ACTIVE', isDefault: true })
      .set(auth(token, companyId))
      .expect(200);
    expect(byStatus.body.data.every((row: { isDefault: boolean }) => row.isDefault)).toBe(true);
  });

  it('updates mutable fields and refuses status/default via PATCH', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const created = await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set(auth(token, companyId))
      .send({ code: 'UPD', name: 'قبل' })
      .expect(201);
    const id = created.body.data.id as string;

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/warehouses/${id}`)
      .set(auth(token, companyId))
      .send({ name: 'بعد', code: 'upd-2', address: null, notes: 'یادداشت' })
      .expect(200);
    expect(updated.body.data.name).toBe('بعد');
    expect(updated.body.data.code).toBe('UPD-2');
    expect(updated.body.data.address).toBeNull();
    expect(updated.body.data.notes).toBe('یادداشت');

    await request(app.getHttpServer())
      .patch(`/api/v1/warehouses/${id}`)
      .set(auth(token, companyId))
      .send({ status: 'INACTIVE', isDefault: false, companyId: demoBId })
      .expect(400);
  });

  it('activates/deactivates non-default and requires replacement for default', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const main = await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set(auth(token, companyId))
      .send({ code: 'MAIN', name: 'اصلی' })
      .expect(201);
    const returns = await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set(auth(token, companyId))
      .send({ code: 'RETURNS', name: 'مرجوعی' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${returns.body.data.id}/deactivate`)
      .set(auth(token, companyId))
      .send({})
      .expect(201)
      .expect((r) => expect(r.body.data.status).toBe('INACTIVE'));

    await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${returns.body.data.id}/activate`)
      .set(auth(token, companyId))
      .expect(201)
      .expect((r) => expect(r.body.data.status).toBe('ACTIVE'));

    await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${main.body.data.id}/deactivate`)
      .set(auth(token, companyId))
      .send({})
      .expect(409);

    await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${main.body.data.id}/deactivate`)
      .set(auth(token, companyId))
      .send({ replacementWarehouseId: returns.body.data.id })
      .expect(201)
      .expect((r) => {
        expect(r.body.data.status).toBe('INACTIVE');
        expect(r.body.data.isDefault).toBe(false);
      });

    const replacement = await database.client.warehouse.findUniqueOrThrow({
      where: { id: returns.body.data.id },
    });
    expect(replacement.isDefault).toBe(true);
    expect(replacement.status).toBe('ACTIVE');
  });

  it('allows deactivating sole active default leaving zero defaults', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const sole = await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set(auth(token, companyId))
      .send({ code: 'ONLY', name: 'تنها' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${sole.body.data.id}/deactivate`)
      .set(auth(token, companyId))
      .send({})
      .expect(201);

    const defaults = await database.client.warehouse.count({
      where: { companyId, isDefault: true },
    });
    expect(defaults).toBe(0);
  });

  it('rejects set-default on inactive warehouse', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const main = await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set(auth(token, companyId))
      .send({ code: 'MAIN', name: 'اصلی' })
      .expect(201);
    const other = await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set(auth(token, companyId))
      .send({ code: 'OTHER', name: 'دیگر' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${other.body.data.id}/deactivate`)
      .set(auth(token, companyId))
      .send({})
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${other.body.data.id}/set-default`)
      .set(auth(token, companyId))
      .expect(409);

    // keep main default intact
    const mainRow = await database.client.warehouse.findUniqueOrThrow({
      where: { id: main.body.data.id },
    });
    expect(mainRow.isDefault).toBe(true);
  });

  it('enforces tenant isolation (IDOR → 404) on every mutation route', async () => {
    const token = await login(ownerEmail);

    await request(app.getHttpServer())
      .get(`/api/v1/warehouses/${demoBWarehouseId}`)
      .set(auth(token, pishtehId))
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/warehouses/${demoBWarehouseId}`)
      .set(auth(token, pishtehId))
      .send({ name: 'hack' })
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${demoBWarehouseId}/activate`)
      .set(auth(token, pishtehId))
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${demoBWarehouseId}/deactivate`)
      .set(auth(token, pishtehId))
      .send({})
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${demoBWarehouseId}/set-default`)
      .set(auth(token, pishtehId))
      .expect(404);
  });

  it('rejects mass assignment of ownership/system fields', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set(auth(token, companyId))
      .send({
        code: 'MASS',
        name: 'Mass',
        companyId: demoBId,
        createdBy: 'other-user',
        id: '00000000-0000-4000-8000-000000000099',
        createdAt: '2000-01-01T00:00:00.000Z',
      })
      .expect(400);

    const created = await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set(auth(token, companyId))
      .send({ code: 'MASS2', name: 'Mass Ok', isDefault: true })
      .expect(201);
    expect(created.body.data.companyId).toBe(companyId);
    expect(created.body.data.isDefault).toBe(true);
  });

  it('enforces RBAC: read-only cannot mutate; no permission cannot read', async () => {
    const operatorToken = await login(warehouseOperatorEmail);
    await request(app.getHttpServer())
      .get('/api/v1/warehouses')
      .set(auth(operatorToken))
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set(auth(operatorToken))
      .send({ code: 'NOPE', name: 'Should Fail' })
      .expect(403);

    const limited = await database.client.role.create({
      data: {
        companyId: pishtehId,
        key: `wh-none-${Date.now()}`,
        name: 'No Warehouse',
        isSystem: false,
      },
    });
    const user = await database.client.user.create({
      data: {
        email: `wh-none-${Date.now()}@hector.local`,
        firstName: 'No',
        lastName: 'Wh',
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
    const token = await login(user.email);
    await request(app.getHttpServer())
      .get('/api/v1/warehouses')
      .set(auth(token))
      .expect(403);
  });

  it('writes audit and domain events for create/update/status/default', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const received: string[] = [];
    const handlerId = `wh-e2e-${Date.now()}`;
    for (const type of [
      DOMAIN_EVENTS.WAREHOUSE_CREATED,
      DOMAIN_EVENTS.WAREHOUSE_UPDATED,
      DOMAIN_EVENTS.WAREHOUSE_ACTIVATED,
      DOMAIN_EVENTS.WAREHOUSE_DEACTIVATED,
      DOMAIN_EVENTS.WAREHOUSE_DEFAULT_CHANGED,
    ]) {
      eventBus.subscribe(type, `${handlerId}-${type}`, (event) => {
        received.push(event.type);
      });
    }

    const created = await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set(auth(token, companyId))
      .send({ code: 'AUD', name: 'Audit' })
      .expect(201);
    const id = created.body.data.id as string;
    const second = await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set(auth(token, companyId))
      .send({ code: 'AUD2', name: 'Audit 2' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/warehouses/${id}`)
      .set(auth(token, companyId))
      .send({ name: 'Audit Updated' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${second.body.data.id}/set-default`)
      .set(auth(token, companyId))
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${id}/deactivate`)
      .set(auth(token, companyId))
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${id}/activate`)
      .set(auth(token, companyId))
      .expect(201);

    expect(received).toContain(DOMAIN_EVENTS.WAREHOUSE_CREATED);
    expect(received).toContain(DOMAIN_EVENTS.WAREHOUSE_UPDATED);
    expect(received).toContain(DOMAIN_EVENTS.WAREHOUSE_DEFAULT_CHANGED);
    expect(received).toContain(DOMAIN_EVENTS.WAREHOUSE_DEACTIVATED);
    expect(received).toContain(DOMAIN_EVENTS.WAREHOUSE_ACTIVATED);

    const audit = await database.client.auditLog.findFirst({
      where: {
        companyId,
        entityType: 'WAREHOUSE',
        entityId: id,
        action: 'WAREHOUSE_CREATED',
      },
    });
    expect(audit).toBeTruthy();
    expect(audit?.actorUserId).toBe(ownerUserId);
  });

  it('rolls back ghost audit when duplicate code create fails', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set(auth(token, companyId))
      .send({ code: 'DUP', name: 'First' })
      .expect(201);
    const beforeCount = await database.client.auditLog.count({
      where: { companyId, action: 'WAREHOUSE_CREATED' },
    });
    await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set(auth(token, companyId))
      .send({ code: 'dup', name: 'Ghost' })
      .expect(409);
    const afterCount = await database.client.auditLog.count({
      where: { companyId, action: 'WAREHOUSE_CREATED' },
    });
    expect(afterCount).toBe(beforeCount);
  });

  it('handles concurrent duplicate code races without duplicates', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const code = `RACE-${Date.now()}`;
    const results = await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer())
          .post('/api/v1/warehouses')
          .set(auth(token, companyId))
          .send({ code, name: `Race ${code}` }),
      ),
    );
    const successes = results.filter((r) => r.status === 201);
    const conflicts = results.filter((r) => r.status === 409);
    expect(successes.length).toBe(1);
    expect(conflicts.length).toBe(1);
    const count = await database.client.warehouse.count({ where: { companyId, code } });
    expect(count).toBe(1);
  });

  it('handles concurrent set-default races with at most one default', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const a = await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set(auth(token, companyId))
      .send({ code: 'DA', name: 'A' })
      .expect(201);
    const b = await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set(auth(token, companyId))
      .send({ code: 'DB', name: 'B' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set(auth(token, companyId))
      .send({ code: 'DC', name: 'C' })
      .expect(201);

    const results = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/warehouses/${a.body.data.id}/set-default`)
        .set(auth(token, companyId)),
      request(app.getHttpServer())
        .post(`/api/v1/warehouses/${b.body.data.id}/set-default`)
        .set(auth(token, companyId)),
    ]);

    expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    const defaults = await database.client.warehouse.findMany({
      where: { companyId, isDefault: true },
    });
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.status).toBe('ACTIVE');
  });

  it('handles concurrent first-warehouse creation with valid default invariant', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const results = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/warehouses')
        .set(auth(token, companyId))
        .send({ code: 'FIRST-A', name: 'First A' }),
      request(app.getHttpServer())
        .post('/api/v1/warehouses')
        .set(auth(token, companyId))
        .send({ code: 'FIRST-B', name: 'First B' }),
    ]);

    const successes = results.filter((r) => r.status === 201);
    expect(successes.length).toBe(2);

    const defaults = await database.client.warehouse.findMany({
      where: { companyId, isDefault: true },
    });
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.status).toBe('ACTIVE');

    const active = await database.client.warehouse.count({
      where: { companyId, status: 'ACTIVE' },
    });
    expect(active).toBe(2);
  });

  it('does not expose hard-delete', async () => {
    const token = await login(ownerEmail);
    const main = await database.client.warehouse.findFirstOrThrow({
      where: { companyId: pishtehId, code: 'MAIN' },
    });
    await request(app.getHttpServer())
      .delete(`/api/v1/warehouses/${main.id}`)
      .set(auth(token))
      .expect(404);
  });
});
