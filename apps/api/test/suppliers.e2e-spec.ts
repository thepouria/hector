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
import { DOMAIN_EVENTS, DomainEventBus } from '../src/infrastructure/events';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';

describe('Supplier Master (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let eventBus: DomainEventBus;
  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;
  let pishtehId: string;
  let demoBId: string;
  let demoBSupplierId: string;
  let ownerPasswordHash: string;

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
    demoBSupplierId = (
      await database.client.supplier.findFirstOrThrow({
        where: { companyId: demoBId },
      })
    ).id;

    const owner = await database.client.user.update({
      where: { email: ownerEmail },
      data: { status: UserStatus.ACTIVE, deletedAt: null },
    });
    ownerPasswordHash = owner.passwordHash;
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

  it('denies unauthenticated supplier access', async () => {
    await request(app.getHttpServer()).get('/api/v1/purchasing/suppliers').expect(401);
  });

  it('creates supplier with name only', async () => {
    const token = await login(ownerEmail);
    const res = await request(app.getHttpServer())
      .post('/api/v1/purchasing/suppliers')
      .set(auth(token))
      .send({ name: `Minimal ${Date.now()}` })
      .expect(201);

    expect(res.body.data.name).toBeTruthy();
    expect(res.body.data.status).toBe('ACTIVE');
    expect(res.body.data.phone).toBeNull();
    expect(res.body.data.email).toBeNull();
  });

  it('supports Persian supplier names and search', async () => {
    const token = await login(ownerEmail);
    const name = `پخش آرایشی ${Date.now()}`;
    const created = await request(app.getHttpServer())
      .post('/api/v1/purchasing/suppliers')
      .set(auth(token))
      .send({ name })
      .expect(201);

    const listed = await request(app.getHttpServer())
      .get('/api/v1/purchasing/suppliers')
      .query({ search: 'پخش آرایشی', pageSize: 50 })
      .set(auth(token))
      .expect(200);

    expect(listed.body.data.some((row: { id: string }) => row.id === created.body.data.id)).toBe(
      true,
    );
  });

  it('allows duplicate supplier names across and within company', async () => {
    const token = await login(ownerEmail);
    const name = `پخش احمدی ${Date.now()}`;
    await request(app.getHttpServer())
      .post('/api/v1/purchasing/suppliers')
      .set(auth(token))
      .send({ name })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/purchasing/suppliers')
      .set(auth(token))
      .send({ name })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/purchasing/suppliers')
      .set(auth(token, demoBId))
      .send({ name })
      .expect(201);
  });

  it('blocks cross-company supplier IDOR with 404', async () => {
    const token = await login(ownerEmail);
    await request(app.getHttpServer())
      .get(`/api/v1/purchasing/suppliers/${demoBSupplierId}`)
      .set(auth(token, pishtehId))
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/api/v1/purchasing/suppliers/${demoBSupplierId}`)
      .set(auth(token, pishtehId))
      .send({ name: 'Hacked' })
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/v1/purchasing/suppliers/${demoBSupplierId}/archive`)
      .set(auth(token, pishtehId))
      .expect(404);
  });

  it('rejects mass assignment of companyId/status/createdAt', async () => {
    const token = await login(ownerEmail);
    // forbidNonWhitelisted rejects unknown system fields at the DTO boundary.
    await request(app.getHttpServer())
      .post('/api/v1/purchasing/suppliers')
      .set(auth(token))
      .send({
        name: `Mass ${Date.now()}`,
        companyId: demoBId,
        status: 'ARCHIVED',
        createdAt: '2000-01-01T00:00:00.000Z',
      })
      .expect(400);

    const created = await request(app.getHttpServer())
      .post('/api/v1/purchasing/suppliers')
      .set(auth(token))
      .send({ name: `MassOk ${Date.now()}` })
      .expect(201);
    expect(created.body.data.companyId).toBe(pishtehId);
    expect(created.body.data.status).toBe('ACTIVE');
  });

  it('enforces status lifecycle transitions', async () => {
    const token = await login(ownerEmail);
    const created = await request(app.getHttpServer())
      .post('/api/v1/purchasing/suppliers')
      .set(auth(token))
      .send({ name: `Lifecycle ${Date.now()}` })
      .expect(201);
    const id = created.body.data.id as string;

    await request(app.getHttpServer())
      .post(`/api/v1/purchasing/suppliers/${id}/deactivate`)
      .set(auth(token))
      .expect(201)
      .expect((r) => expect(r.body.data.status).toBe('INACTIVE'));

    await request(app.getHttpServer())
      .post(`/api/v1/purchasing/suppliers/${id}/activate`)
      .set(auth(token))
      .expect(201)
      .expect((r) => expect(r.body.data.status).toBe('ACTIVE'));

    await request(app.getHttpServer())
      .post(`/api/v1/purchasing/suppliers/${id}/archive`)
      .set(auth(token))
      .expect(201)
      .expect((r) => expect(r.body.data.status).toBe('ARCHIVED'));

    const archived = await database.client.supplier.findUniqueOrThrow({ where: { id } });
    expect(archived.archivedAt).not.toBeNull();

    const defaultList = await request(app.getHttpServer())
      .get('/api/v1/purchasing/suppliers')
      .query({ search: archived.name, pageSize: 50 })
      .set(auth(token))
      .expect(200);
    expect(defaultList.body.data.some((row: { id: string }) => row.id === id)).toBe(false);

    const archivedList = await request(app.getHttpServer())
      .get('/api/v1/purchasing/suppliers')
      .query({ status: 'ARCHIVED', search: archived.name, pageSize: 50 })
      .set(auth(token))
      .expect(200);
    expect(archivedList.body.data.some((row: { id: string }) => row.id === id)).toBe(true);

    await request(app.getHttpServer())
      .post(`/api/v1/purchasing/suppliers/${id}/deactivate`)
      .set(auth(token))
      .expect(409);
  });

  it('manages contacts, primary invariant, and leading-zero phone', async () => {
    const token = await login(ownerEmail);
    const created = await request(app.getHttpServer())
      .post('/api/v1/purchasing/suppliers')
      .set(auth(token))
      .send({ name: `Contacts ${Date.now()}` })
      .expect(201);
    const supplierId = created.body.data.id as string;

    const c1 = await request(app.getHttpServer())
      .post(`/api/v1/purchasing/suppliers/${supplierId}/contacts`)
      .set(auth(token))
      .send({ name: 'آقای رضایی', mobile: '09121234567', role: 'فروش' })
      .expect(201);

    expect(c1.body.data.isPrimary).toBe(true);
    expect(c1.body.data.mobile).toBe('09121234567');

    const c2 = await request(app.getHttpServer())
      .post(`/api/v1/purchasing/suppliers/${supplierId}/contacts`)
      .set(auth(token))
      .send({ name: 'خانم محمدی', phone: '02112345678', role: 'حسابداری' })
      .expect(201);
    expect(c2.body.data.isPrimary).toBe(false);

    await request(app.getHttpServer())
      .post(`/api/v1/purchasing/suppliers/${supplierId}/contacts/${c2.body.data.id}/set-primary`)
      .set(auth(token))
      .expect(201)
      .expect((r) => expect(r.body.data.isPrimary).toBe(true));

    const primaries = await database.client.supplierContact.count({
      where: {
        supplierId,
        isPrimary: true,
        archivedAt: null,
      },
    });
    expect(primaries).toBe(1);

    await request(app.getHttpServer())
      .post(`/api/v1/purchasing/suppliers/${supplierId}/contacts/${c1.body.data.id}/archive`)
      .set(auth(token))
      .expect(201);

    const list = await request(app.getHttpServer())
      .get(`/api/v1/purchasing/suppliers/${supplierId}/contacts`)
      .set(auth(token))
      .expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].id).toBe(c2.body.data.id);
  });

  it('creates notes with author attribution and company isolation', async () => {
    const token = await login(ownerEmail);
    const created = await request(app.getHttpServer())
      .post('/api/v1/purchasing/suppliers')
      .set(auth(token))
      .send({ name: `Notes ${Date.now()}` })
      .expect(201);
    const supplierId = created.body.data.id as string;

    const note = await request(app.getHttpServer())
      .post(`/api/v1/purchasing/suppliers/${supplierId}/notes`)
      .set(auth(token))
      .send({ body: 'برای اسنس با احمد تماس می‌گیره' })
      .expect(201);

    expect(note.body.data.body).toContain('اسنس');
    expect(note.body.data.author.displayName).toBeTruthy();

    await request(app.getHttpServer())
      .get(`/api/v1/purchasing/suppliers/${supplierId}/notes`)
      .set(auth(token, demoBId))
      .expect(404);
  });

  it('searches by code/phone/contact and rejects injection/long input', async () => {
    const token = await login(ownerEmail);
    const stamp = Date.now();
    const created = await request(app.getHttpServer())
      .post('/api/v1/purchasing/suppliers')
      .set(auth(token))
      .send({ name: `Searchable ${stamp}`, code: `SRC-${stamp}`, phone: '09125551234' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/purchasing/suppliers/${created.body.data.id}/contacts`)
      .set(auth(token))
      .send({ name: `ContactSearch ${stamp}`, mobile: '09126667788' })
      .expect(201);

    for (const search of [`SRC-${stamp}`, '09125551234', `ContactSearch ${stamp}`, '09126667788']) {
      const res = await request(app.getHttpServer())
        .get('/api/v1/purchasing/suppliers')
        .query({ search, pageSize: 20 })
        .set(auth(token))
        .expect(200);
      expect(res.body.data.some((row: { id: string }) => row.id === created.body.data.id)).toBe(
        true,
      );
    }

    await request(app.getHttpServer())
      .get('/api/v1/purchasing/suppliers')
      .query({ search: `'"%_`, pageSize: 5 })
      .set(auth(token))
      .expect(200);

    // Over-length search is rejected by DTO max length (no crash / injection).
    await request(app.getHttpServer())
      .get('/api/v1/purchasing/suppliers')
      .query({ search: 'x'.repeat(300), pageSize: 5 })
      .set(auth(token))
      .expect(400);
  });

  it('paginates and bounds page size', async () => {
    const token = await login(ownerEmail);
    await request(app.getHttpServer())
      .get('/api/v1/purchasing/suppliers')
      .query({ page: 1, pageSize: 2 })
      .set(auth(token))
      .expect(200)
      .expect((r) => {
        expect(r.body.meta.pageSize).toBe(2);
        expect(r.body.data.length).toBeLessThanOrEqual(2);
      });

    await request(app.getHttpServer())
      .get('/api/v1/purchasing/suppliers')
      .query({ pageSize: 1000000 })
      .set(auth(token))
      .expect(400);
  });

  it('enforces purchasing.read vs create/manage RBAC', async () => {
    const limited = await database.client.role.create({
      data: {
        companyId: pishtehId,
        key: `pur-ro-${Date.now()}`,
        name: 'Purchasing RO',
        isSystem: false,
      },
    });
    const purchasingRead = await database.client.permission.findUniqueOrThrow({
      where: { key: PERMISSIONS.PURCHASING_READ },
    });
    await database.client.rolePermission.create({
      data: { roleId: limited.id, permissionId: purchasingRead.id },
    });
    const user = await database.client.user.create({
      data: {
        email: `pur-ro-${Date.now()}@hector.local`,
        firstName: 'RO',
        lastName: 'Purchasing',
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
      .get('/api/v1/purchasing/suppliers')
      .set(auth(token))
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/purchasing/suppliers')
      .set(auth(token))
      .send({ name: 'Should Fail' })
      .expect(403);
  });

  it('writes audit and domain events; no-op update skips event', async () => {
    const token = await login(ownerEmail);
    const received: string[] = [];
    const handlerId = `supplier-e2e-${Date.now()}`;
    eventBus.subscribe(DOMAIN_EVENTS.PURCHASING_SUPPLIER_CREATED, handlerId, (event) => {
      received.push(event.type);
    });
    eventBus.subscribe(DOMAIN_EVENTS.PURCHASING_SUPPLIER_UPDATED, `${handlerId}-u`, (event) => {
      received.push(event.type);
    });

    const created = await request(app.getHttpServer())
      .post('/api/v1/purchasing/suppliers')
      .set(auth(token))
      .send({ name: `Audit ${Date.now()}`, phone: '09121112233' })
      .expect(201);
    const id = created.body.data.id as string;

    await new Promise((r) => setTimeout(r, 50));
    expect(received).toContain(DOMAIN_EVENTS.PURCHASING_SUPPLIER_CREATED);

    const audit = await database.client.auditLog.findFirst({
      where: { companyId: pishtehId, entityType: 'SUPPLIER', entityId: id, action: 'SUPPLIER_CREATED' },
    });
    expect(audit).toBeTruthy();

    received.length = 0;
    await request(app.getHttpServer())
      .patch(`/api/v1/purchasing/suppliers/${id}`)
      .set(auth(token))
      .send({ phone: '09121112233' })
      .expect(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(received).not.toContain(DOMAIN_EVENTS.PURCHASING_SUPPLIER_UPDATED);
  });

  it('rolls back ghost audit/event when mutation fails uniqueness', async () => {
    const token = await login(ownerEmail);
    const code = `UNIQ-${Date.now()}`;
    await request(app.getHttpServer())
      .post('/api/v1/purchasing/suppliers')
      .set(auth(token))
      .send({ name: `Code A ${Date.now()}`, code })
      .expect(201);

    const beforeCount = await database.client.auditLog.count({
      where: { companyId: pishtehId, action: 'SUPPLIER_CREATED' },
    });

    await request(app.getHttpServer())
      .post('/api/v1/purchasing/suppliers')
      .set(auth(token))
      .send({ name: `Code B ${Date.now()}`, code })
      .expect(409);

    const afterCount = await database.client.auditLog.count({
      where: { companyId: pishtehId, action: 'SUPPLIER_CREATED' },
    });
    expect(afterCount).toBe(beforeCount);
  });
});
