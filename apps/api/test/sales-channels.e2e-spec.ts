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

describe('Sales Channels (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let eventBus: DomainEventBus;
  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;
  let pishtehId: string;
  let demoBId: string;
  let demoBChannelId: string;
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
    demoBChannelId = (
      await database.client.salesChannel.findFirstOrThrow({
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

  it('denies unauthenticated channel access', async () => {
    await request(app.getHttpServer()).get('/api/v1/sales/channels').expect(401);
  });

  it('lists seeded channel codes for Pishteh', async () => {
    const token = await login(ownerEmail);
    const listed = await request(app.getHttpServer())
      .get('/api/v1/sales/channels')
      .query({ pageSize: 50 })
      .set(auth(token))
      .expect(200);

    const codes = listed.body.data.map((row: { code: string }) => row.code);
    for (const code of ['WEBSITE', 'KHANOUMI', 'DIGIKALA', 'SNAPP_SHOP', 'WHOLESALE', 'MANUAL']) {
      expect(codes).toContain(code);
    }
  });

  it('creates, reads, updates, and changes status', async () => {
    const token = await login(ownerEmail);
    const code = `CH-${Date.now()}`;
    const created = await request(app.getHttpServer())
      .post('/api/v1/sales/channels')
      .set(auth(token))
      .send({ code, name: 'Test Channel', type: 'OTHER', notes: 'n1' })
      .expect(201);

    expect(created.body.data.code).toBe(code);
    expect(created.body.data.status).toBe('ACTIVE');
    const id = created.body.data.id as string;

    await request(app.getHttpServer())
      .get(`/api/v1/sales/channels/${id}`)
      .set(auth(token))
      .expect(200)
      .expect((r) => expect(r.body.data.name).toBe('Test Channel'));

    await request(app.getHttpServer())
      .patch(`/api/v1/sales/channels/${id}`)
      .set(auth(token))
      .send({ name: 'Updated Channel' })
      .expect(200)
      .expect((r) => expect(r.body.data.name).toBe('Updated Channel'));

    await request(app.getHttpServer())
      .post(`/api/v1/sales/channels/${id}/deactivate`)
      .set(auth(token))
      .expect(201)
      .expect((r) => expect(r.body.data.status).toBe('INACTIVE'));

    await request(app.getHttpServer())
      .post(`/api/v1/sales/channels/${id}/activate`)
      .set(auth(token))
      .expect(201)
      .expect((r) => expect(r.body.data.status).toBe('ACTIVE'));
  });

  it('enforces company-scoped code uniqueness; allows same code across companies', async () => {
    const token = await login(ownerEmail);
    const code = `UNIQ-${Date.now()}`;
    await request(app.getHttpServer())
      .post('/api/v1/sales/channels')
      .set(auth(token))
      .send({ code, name: 'A', type: 'MANUAL' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/sales/channels')
      .set(auth(token))
      .send({ code: code.toLowerCase(), name: 'Dup', type: 'MANUAL' })
      .expect(409);

    await request(app.getHttpServer())
      .post('/api/v1/sales/channels')
      .set(auth(token, demoBId))
      .send({ code, name: 'B', type: 'MANUAL' })
      .expect(201);
  });

  it('blocks cross-company channel IDOR with 404', async () => {
    const token = await login(ownerEmail);
    await request(app.getHttpServer())
      .get(`/api/v1/sales/channels/${demoBChannelId}`)
      .set(auth(token, pishtehId))
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/api/v1/sales/channels/${demoBChannelId}`)
      .set(auth(token, pishtehId))
      .send({ name: 'Hacked' })
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/v1/sales/channels/${demoBChannelId}/deactivate`)
      .set(auth(token, pishtehId))
      .expect(404);
  });

  it('rejects mass assignment of companyId/status', async () => {
    const token = await login(ownerEmail);
    await request(app.getHttpServer())
      .post('/api/v1/sales/channels')
      .set(auth(token))
      .send({
        code: `MASS-${Date.now()}`,
        name: 'Mass',
        type: 'MANUAL',
        companyId: demoBId,
        status: 'INACTIVE',
      })
      .expect(400);

    const created = await request(app.getHttpServer())
      .post('/api/v1/sales/channels')
      .set(auth(token))
      .send({ code: `MASSOK-${Date.now()}`, name: 'MassOk', type: 'MANUAL' })
      .expect(201);
    expect(created.body.data.companyId).toBe(pishtehId);
    expect(created.body.data.status).toBe('ACTIVE');
  });

  it('supports search and type/status filters', async () => {
    const token = await login(ownerEmail);
    const listed = await request(app.getHttpServer())
      .get('/api/v1/sales/channels')
      .query({ search: 'Khanoumi', type: 'MARKETPLACE', status: 'ACTIVE', pageSize: 50 })
      .set(auth(token))
      .expect(200);

    expect(listed.body.data.some((row: { code: string }) => row.code === 'KHANOUMI')).toBe(true);
  });

  it('enforces sales.channels.read vs manage RBAC', async () => {
    const limited = await database.client.role.create({
      data: {
        companyId: pishtehId,
        key: `sales-ch-ro-${Date.now()}`,
        name: 'Sales Channels RO',
        isSystem: false,
      },
    });
    const readPerm = await database.client.permission.findUniqueOrThrow({
      where: { key: PERMISSIONS.SALES_CHANNELS_READ },
    });
    await database.client.rolePermission.create({
      data: { roleId: limited.id, permissionId: readPerm.id },
    });
    const user = await database.client.user.create({
      data: {
        email: `sales-ch-ro-${Date.now()}@hector.local`,
        firstName: 'RO',
        lastName: 'Channels',
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
      .get('/api/v1/sales/channels')
      .set(auth(token))
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/sales/channels')
      .set(auth(token))
      .send({ code: `RBAC-${Date.now()}`, name: 'Fail', type: 'MANUAL' })
      .expect(403);
  });

  it('writes audit and domain events', async () => {
    const token = await login(ownerEmail);
    const received: string[] = [];
    const handlerId = `channel-e2e-${Date.now()}`;
    eventBus.subscribe(DOMAIN_EVENTS.SALES_CHANNEL_CREATED, handlerId, (event) => {
      received.push(event.type);
    });

    const created = await request(app.getHttpServer())
      .post('/api/v1/sales/channels')
      .set(auth(token))
      .send({ code: `AUD-${Date.now()}`, name: 'Audit Channel', type: 'OTHER' })
      .expect(201);
    const id = created.body.data.id as string;

    await new Promise((r) => setTimeout(r, 50));
    expect(received).toContain(DOMAIN_EVENTS.SALES_CHANNEL_CREATED);

    const audit = await database.client.auditLog.findFirst({
      where: {
        companyId: pishtehId,
        entityType: 'SALES_CHANNEL',
        entityId: id,
        action: 'SALES_CHANNEL_CREATED',
      },
    });
    expect(audit).toBeTruthy();
  });
});
