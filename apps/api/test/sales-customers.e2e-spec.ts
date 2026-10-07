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

describe('Sales Customers (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let eventBus: DomainEventBus;
  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;
  let pishtehId: string;
  let demoBId: string;
  let demoBCustomerId: string;
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
    demoBCustomerId = (
      await database.client.customer.findFirstOrThrow({
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

  it('denies unauthenticated customer access', async () => {
    await request(app.getHttpServer()).get('/api/v1/sales/customers').expect(401);
  });

  it('creates minimal BUSINESS customer without optional fields', async () => {
    const token = await login(ownerEmail);
    const res = await request(app.getHttpServer())
      .post('/api/v1/sales/customers')
      .set(auth(token))
      .send({ type: 'BUSINESS', displayName: `فروشگاه ${Date.now()}` })
      .expect(201);

    expect(res.body.data.type).toBe('BUSINESS');
    expect(res.body.data.status).toBe('ACTIVE');
    expect(res.body.data.mobile).toBeNull();
    expect(res.body.data.email).toBeNull();
    expect(res.body.data.nationalId).toBeNull();
    expect(res.body.data.taxId).toBeNull();
    expect(res.body.data.phone).toBeNull();
    expect(res.body.data.notes).toBeNull();
  });

  it('creates INDIVIDUAL and supports Persian search', async () => {
    const token = await login(ownerEmail);
    const displayName = `مشتری عمده ${Date.now()}`;
    const created = await request(app.getHttpServer())
      .post('/api/v1/sales/customers')
      .set(auth(token))
      .send({
        type: 'INDIVIDUAL',
        displayName,
        firstName: 'علی',
        lastName: 'رضایی',
        mobile: '09121110000',
      })
      .expect(201);

    const listed = await request(app.getHttpServer())
      .get('/api/v1/sales/customers')
      .query({ search: 'مشتری عمده', pageSize: 50 })
      .set(auth(token))
      .expect(200);

    expect(listed.body.data.some((row: { id: string }) => row.id === created.body.data.id)).toBe(
      true,
    );

    const byMobile = await request(app.getHttpServer())
      .get('/api/v1/sales/customers')
      .query({ search: '09121110000', pageSize: 50 })
      .set(auth(token))
      .expect(200);
    expect(byMobile.body.data.some((row: { id: string }) => row.id === created.body.data.id)).toBe(
      true,
    );
  });

  it('updates and activates/deactivates customer', async () => {
    const token = await login(ownerEmail);
    const created = await request(app.getHttpServer())
      .post('/api/v1/sales/customers')
      .set(auth(token))
      .send({ type: 'BUSINESS', displayName: `Lifecycle ${Date.now()}` })
      .expect(201);
    const id = created.body.data.id as string;

    await request(app.getHttpServer())
      .patch(`/api/v1/sales/customers/${id}`)
      .set(auth(token))
      .send({ businessName: 'آریا تجارت' })
      .expect(200)
      .expect((r) => expect(r.body.data.businessName).toBe('آریا تجارت'));

    await request(app.getHttpServer())
      .post(`/api/v1/sales/customers/${id}/deactivate`)
      .set(auth(token))
      .expect(201)
      .expect((r) => expect(r.body.data.status).toBe('INACTIVE'));

    await request(app.getHttpServer())
      .post(`/api/v1/sales/customers/${id}/activate`)
      .set(auth(token))
      .expect(201)
      .expect((r) => expect(r.body.data.status).toBe('ACTIVE'));
  });

  it('manages addresses with single default concurrency-safe', async () => {
    const token = await login(ownerEmail);
    const created = await request(app.getHttpServer())
      .post('/api/v1/sales/customers')
      .set(auth(token))
      .send({ type: 'BUSINESS', displayName: `Addr ${Date.now()}` })
      .expect(201);
    const customerId = created.body.data.id as string;

    const a1 = await request(app.getHttpServer())
      .post(`/api/v1/sales/customers/${customerId}/addresses`)
      .set(auth(token))
      .send({ label: 'Shop', city: 'Tehran', addressLine: 'Valiasr' })
      .expect(201);
    expect(a1.body.data.isDefault).toBe(true);

    const a2 = await request(app.getHttpServer())
      .post(`/api/v1/sales/customers/${customerId}/addresses`)
      .set(auth(token))
      .send({ label: 'Warehouse', city: 'Karaj' })
      .expect(201);
    expect(a2.body.data.isDefault).toBe(false);

    await request(app.getHttpServer())
      .post(`/api/v1/sales/customers/${customerId}/addresses/${a2.body.data.id}/set-default`)
      .set(auth(token))
      .expect(201)
      .expect((r) => expect(r.body.data.isDefault).toBe(true));

    const defaults = await database.client.customerAddress.count({
      where: {
        customerId,
        isDefault: true,
        archivedAt: null,
      },
    });
    expect(defaults).toBe(1);

    await request(app.getHttpServer())
      .post(`/api/v1/sales/customers/${customerId}/addresses/${a1.body.data.id}/archive`)
      .set(auth(token))
      .expect(201);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/sales/customers/${customerId}`)
      .set(auth(token))
      .expect(200);
    expect(detail.body.data.addresses).toHaveLength(1);
    expect(detail.body.data.addresses[0].id).toBe(a2.body.data.id);
  });

  it('blocks cross-company customer IDOR with 404', async () => {
    const token = await login(ownerEmail);
    await request(app.getHttpServer())
      .get(`/api/v1/sales/customers/${demoBCustomerId}`)
      .set(auth(token, pishtehId))
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/api/v1/sales/customers/${demoBCustomerId}`)
      .set(auth(token, pishtehId))
      .send({ displayName: 'Hacked' })
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/v1/sales/customers/${demoBCustomerId}/deactivate`)
      .set(auth(token, pishtehId))
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/v1/sales/customers/${demoBCustomerId}/addresses`)
      .set(auth(token, pishtehId))
      .send({ label: 'x' })
      .expect(404);
  });

  it('rejects mass assignment of companyId/status', async () => {
    const token = await login(ownerEmail);
    await request(app.getHttpServer())
      .post('/api/v1/sales/customers')
      .set(auth(token))
      .send({
        type: 'BUSINESS',
        displayName: `Mass ${Date.now()}`,
        companyId: demoBId,
        status: 'INACTIVE',
        createdById: '00000000-0000-0000-0000-000000000000',
      })
      .expect(400);

    const created = await request(app.getHttpServer())
      .post('/api/v1/sales/customers')
      .set(auth(token))
      .send({ type: 'BUSINESS', displayName: `MassOk ${Date.now()}` })
      .expect(201);
    expect(created.body.data.companyId).toBe(pishtehId);
    expect(created.body.data.status).toBe('ACTIVE');
  });

  it('enforces unique customer code within company', async () => {
    const token = await login(ownerEmail);
    const code = `CUS-${Date.now()}`;
    await request(app.getHttpServer())
      .post('/api/v1/sales/customers')
      .set(auth(token))
      .send({ type: 'BUSINESS', displayName: 'A', code })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/sales/customers')
      .set(auth(token))
      .send({ type: 'BUSINESS', displayName: 'B', code })
      .expect(409);
  });

  it('enforces sales.customers.read vs manage RBAC', async () => {
    const limited = await database.client.role.create({
      data: {
        companyId: pishtehId,
        key: `sales-cu-ro-${Date.now()}`,
        name: 'Sales Customers RO',
        isSystem: false,
      },
    });
    const readPerm = await database.client.permission.findUniqueOrThrow({
      where: { key: PERMISSIONS.SALES_CUSTOMERS_READ },
    });
    await database.client.rolePermission.create({
      data: { roleId: limited.id, permissionId: readPerm.id },
    });
    const user = await database.client.user.create({
      data: {
        email: `sales-cu-ro-${Date.now()}@hector.local`,
        firstName: 'RO',
        lastName: 'Customers',
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
      .get('/api/v1/sales/customers')
      .set(auth(token))
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/sales/customers')
      .set(auth(token))
      .send({ type: 'BUSINESS', displayName: 'Should Fail' })
      .expect(403);
  });

  it('writes audit and domain events', async () => {
    const token = await login(ownerEmail);
    const received: string[] = [];
    const handlerId = `customer-e2e-${Date.now()}`;
    eventBus.subscribe(DOMAIN_EVENTS.SALES_CUSTOMER_CREATED, handlerId, (event) => {
      received.push(event.type);
    });

    const created = await request(app.getHttpServer())
      .post('/api/v1/sales/customers')
      .set(auth(token))
      .send({ type: 'BUSINESS', displayName: `Audit ${Date.now()}` })
      .expect(201);
    const id = created.body.data.id as string;

    await new Promise((r) => setTimeout(r, 50));
    expect(received).toContain(DOMAIN_EVENTS.SALES_CUSTOMER_CREATED);

    const audit = await database.client.auditLog.findFirst({
      where: {
        companyId: pishtehId,
        entityType: 'CUSTOMER',
        entityId: id,
        action: 'CUSTOMER_CREATED',
      },
    });
    expect(audit).toBeTruthy();
  });
});
