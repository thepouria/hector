import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  PERMISSIONS,
  UserStatus,
  syncOwnerRolePermissions,
} from '@hector/database';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { PasswordHasher } from '../src/modules/auth/password/password-hasher.service';
import { AUDIT_ACTIONS } from '../src/modules/audit/audit.constants';
import { AuditService } from '../src/modules/audit/audit.service';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';

describe('Audit (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let passwordHasher: PasswordHasher;
  let auditService: AuditService;

  const password = E2E_PASSWORD;
  const ownerEmail = 'pouria@hector.local';
  const warehouseEmail = 'hossein@hector.local';
  let pishtehId: string;

  beforeAll(async () => {
    app = await createE2eApp();
    database = app.get(DatabaseService);
    passwordHasher = app.get(PasswordHasher);
    auditService = app.get(AuditService);
    await syncOwnerRolePermissions(database.client);

    const company = await database.client.company.findUniqueOrThrow({
      where: { slug: 'pishteh' },
    });
    pishtehId = company.id;

    await database.client.user.update({
      where: { email: ownerEmail },
      data: { status: UserStatus.ACTIVE, deletedAt: null },
    });
    await database.client.user.update({
      where: { email: warehouseEmail },
      data: { status: UserStatus.ACTIVE, deletedAt: null },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return res.body.data.accessToken as string;
  }

  it('records role lifecycle audits and enforces audit.read', async () => {
    const ownerToken = await login(ownerEmail);
    const requestId = randomUUID();

    const permissions = await request(app.getHttpServer())
      .get('/api/v1/permissions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);

    const memberRead = (permissions.body.data as Array<{ id: string; key: string }>).find(
      (permission) => permission.key === PERMISSIONS.MEMBER_READ,
    );
    const roleRead = (permissions.body.data as Array<{ id: string; key: string }>).find(
      (permission) => permission.key === PERMISSIONS.ROLE_READ,
    );
    expect(memberRead && roleRead).toBeTruthy();

    const roleKey = `SALES_${randomUUID().slice(0, 8).toUpperCase()}`;
    const created = await request(app.getHttpServer())
      .post('/api/v1/roles')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .set('X-Request-Id', requestId)
      .send({
        name: 'Sales Manager',
        key: roleKey,
        description: 'Sales',
        permissionIds: [memberRead!.id],
      })
      .expect(201);

    const roleId = created.body.data.id as string;

    await request(app.getHttpServer())
      .put(`/api/v1/roles/${roleId}/permissions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .send({ permissionIds: [memberRead!.id, roleRead!.id] })
      .expect(200);

    const managerEmail = `sales-${randomUUID().slice(0, 8)}@hector.local`;
    await database.client.user.create({
      data: {
        email: managerEmail,
        firstName: 'Sales',
        lastName: 'User',
        passwordHash: await passwordHasher.hash(password),
        status: UserStatus.ACTIVE,
      },
    });

    const member = await request(app.getHttpServer())
      .post('/api/v1/members')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .send({ email: managerEmail, roleIds: [roleId] })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/roles/${roleId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .send({ description: 'Updated sales role' })
      .expect(200);

    const logs = await request(app.getHttpServer())
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .query({ entityId: roleId, pageSize: 50 })
      .expect(200);

    const actions = (logs.body.data as Array<{ action: string }>).map((row) => row.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        AUDIT_ACTIONS.ROLE_CREATED,
        AUDIT_ACTIONS.ROLE_PERMISSIONS_CHANGED,
        AUDIT_ACTIONS.ROLE_UPDATED,
      ]),
    );

    const memberLogs = await request(app.getHttpServer())
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .query({ entityId: member.body.data.id, action: AUDIT_ACTIONS.MEMBER_CREATED })
      .expect(200);
    expect(memberLogs.body.data.length).toBeGreaterThanOrEqual(1);

    const createdAudit = (logs.body.data as Array<{ id: string; action: string; requestId: string | null }>).find(
      (row) => row.action === AUDIT_ACTIONS.ROLE_CREATED,
    );
    expect(createdAudit?.requestId).toBe(requestId);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/audit-logs/${createdAudit!.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);
    expect(detail.body.data.after.key).toBe(roleKey);
    expect(detail.body.data.before).toBeNull();

    const warehouseToken = await login(warehouseEmail);
    await request(app.getHttpServer())
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${warehouseToken}`)
      .set('X-Company-Id', pishtehId)
      .expect(403);
  });

  it('suppresses no-op company updates and rolls back when audit insert fails', async () => {
    const ownerToken = await login(ownerEmail);

    const beforeCount = await database.client.auditLog.count({
      where: { companyId: pishtehId, action: AUDIT_ACTIONS.COMPANY_UPDATED },
    });

    await request(app.getHttpServer())
      .patch(`/api/v1/companies/${pishtehId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: 'Pishteh', timezone: 'Asia/Tehran' })
      .expect(200);

    const afterNoopCount = await database.client.auditLog.count({
      where: { companyId: pishtehId, action: AUDIT_ACTIONS.COMPANY_UPDATED },
    });
    expect(afterNoopCount).toBe(beforeCount);

    const companyBefore = await database.client.company.findUniqueOrThrow({
      where: { id: pishtehId },
    });

    const spy = jest
      .spyOn(auditService, 'record')
      .mockRejectedValue(new Error('simulated audit failure'));

    await request(app.getHttpServer())
      .patch(`/api/v1/companies/${pishtehId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: `Pishteh-Fail-${randomUUID().slice(0, 4)}` })
      .expect(500);

    spy.mockRestore();

    const companyAfter = await database.client.company.findUniqueOrThrow({
      where: { id: pishtehId },
    });
    expect(companyAfter.name).toBe(companyBefore.name);

    await request(app.getHttpServer())
      .patch(`/api/v1/companies/${pishtehId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: 'Pishteh', timezone: 'Asia/Tehran' })
      .expect(200);
  });

  it('isolates audit logs across companies', async () => {
    const ownerToken = await login(ownerEmail);
    const foreign = await database.client.company.findFirst({
      where: { slug: 'hector-test-co-b' },
    });
    if (!foreign) {
      return;
    }

    const foreignAudit = await database.client.auditLog.create({
      data: {
        companyId: foreign.id,
        action: 'TEST_FOREIGN',
        entityType: 'COMPANY',
        entityId: foreign.id,
        before: null,
        after: { note: 'foreign' },
      },
    });

    await request(app.getHttpServer())
      .get(`/api/v1/audit-logs/${foreignAudit.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .expect(404);

    const listed = await request(app.getHttpServer())
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .query({ action: 'TEST_FOREIGN' })
      .expect(200);

    expect(listed.body.data).toHaveLength(0);
  });
});
