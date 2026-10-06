import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  CompanyMemberStatus,
  PERMISSIONS,
  UserStatus,
  syncOwnerRolePermissions,
} from '@hector/database';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { PasswordHasher } from '../src/modules/auth/password/password-hasher.service';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';

describe('RBAC (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let passwordHasher: PasswordHasher;

  const password = E2E_PASSWORD;
  const ownerEmail = 'pouria@hector.local';
  let pishtehId: string;
  let ownerRoleId: string;

  beforeAll(async () => {
    app = await createE2eApp();
    database = app.get(DatabaseService);
    passwordHasher = app.get(PasswordHasher);

    await syncOwnerRolePermissions(database.client);

    const company = await database.client.company.findUniqueOrThrow({
      where: { slug: 'pishteh' },
    });
    pishtehId = company.id;

    const ownerRole = await database.client.role.findUniqueOrThrow({
      where: { companyId_key: { companyId: pishtehId, key: 'OWNER' } },
    });
    ownerRoleId = ownerRole.id;

    await database.client.user.update({
      where: { email: ownerEmail },
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

  it('runs the operations-manager authorization scenario without re-login', async () => {
    const ownerToken = await login(ownerEmail);

    const authz = await request(app.getHttpServer())
      .get('/api/v1/me/authorization')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);

    expect(authz.body.data.permissions).toEqual(
      expect.arrayContaining([
        PERMISSIONS.COMPANY_UPDATE,
        PERMISSIONS.MEMBER_READ,
        PERMISSIONS.ROLE_CREATE,
        PERMISSIONS.ROLE_ASSIGN,
        PERMISSIONS.ROLE_PERMISSIONS_UPDATE,
      ]),
    );
    expect(authz.body.data.roles.some((role: { key: string }) => role.key === 'OWNER')).toBe(
      true,
    );

    const catalog = await request(app.getHttpServer())
      .get('/api/v1/permissions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);

    const memberRead = (catalog.body.data as Array<{ id: string; key: string }>).find(
      (permission) => permission.key === PERMISSIONS.MEMBER_READ,
    );
    const roleRead = (catalog.body.data as Array<{ id: string; key: string }>).find(
      (permission) => permission.key === PERMISSIONS.ROLE_READ,
    );
    const companyUpdate = (catalog.body.data as Array<{ id: string; key: string }>).find(
      (permission) => permission.key === PERMISSIONS.COMPANY_UPDATE,
    );
    expect(memberRead).toBeDefined();
    expect(roleRead).toBeDefined();
    expect(companyUpdate).toBeDefined();

    const roleKey = `OPS_${randomUUID().slice(0, 8).toUpperCase()}`;
    const createdRole = await request(app.getHttpServer())
      .post('/api/v1/roles')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .send({
        name: 'Operations Manager',
        key: roleKey,
        description: 'Limited ops role',
        permissionIds: [memberRead!.id, roleRead!.id],
      })
      .expect(201);

    const roleId = createdRole.body.data.id as string;
    expect(createdRole.body.data.isSystem).toBe(false);
    expect(createdRole.body.data.permissions.map((p: { key: string }) => p.key).sort()).toEqual(
      [PERMISSIONS.MEMBER_READ, PERMISSIONS.ROLE_READ].sort(),
    );

    const managerEmail = `ops-${randomUUID().slice(0, 8)}@hector.local`;
    await database.client.user.create({
      data: {
        email: managerEmail,
        firstName: 'Ops',
        lastName: 'Manager',
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

    const managerToken = await login(managerEmail);

    await request(app.getHttpServer())
      .get('/api/v1/members')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/v1/companies/${pishtehId}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: 'Should Fail' })
      .expect(403);

    // Immediate grant — no new JWT
    await request(app.getHttpServer())
      .put(`/api/v1/roles/${roleId}/permissions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .send({ permissionIds: [memberRead!.id, roleRead!.id, companyUpdate!.id] })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/v1/companies/${pishtehId}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: 'Pishteh', timezone: 'Asia/Tehran' })
      .expect(200);

    // System OWNER protected
    await request(app.getHttpServer())
      .delete(`/api/v1/roles/${ownerRoleId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .expect(403)
      .expect((res) => {
        expect(res.body.error.code).toBe('ROLE_SYSTEM_PROTECTED');
      });

    await request(app.getHttpServer())
      .put(`/api/v1/roles/${ownerRoleId}/permissions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .send({ permissionIds: [memberRead!.id] })
      .expect(403);

    // Non-owner with role.assign still cannot assign OWNER
    const roleAssignPerm = (catalog.body.data as Array<{ id: string; key: string }>).find(
      (permission) => permission.key === PERMISSIONS.ROLE_ASSIGN,
    );
    expect(roleAssignPerm).toBeDefined();

    await request(app.getHttpServer())
      .put(`/api/v1/roles/${roleId}/permissions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .send({
        permissionIds: [memberRead!.id, roleRead!.id, companyUpdate!.id, roleAssignPerm!.id],
      })
      .expect(200);

    await request(app.getHttpServer())
      .put(`/api/v1/members/${member.body.data.id}/roles`)
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Company-Id', pishtehId)
      .send({ roleIds: [ownerRoleId] })
      .expect(403)
      .expect((res) => {
        expect(res.body.error.code).toBe('OWNER_REQUIRED');
      });

    // Cleanup custom role: remove assignment then delete
    await request(app.getHttpServer())
      .put(`/api/v1/members/${member.body.data.id}/roles`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .send({ roleIds: [roleId] })
      .expect(200);

    await database.client.companyMember.update({
      where: { id: member.body.data.id },
      data: { status: CompanyMemberStatus.REMOVED },
    });
    await database.client.companyMemberRole.deleteMany({
      where: { companyMemberId: member.body.data.id },
    });

    await request(app.getHttpServer())
      .delete(`/api/v1/roles/${roleId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);
  });

  it('rejects cross-company role access', async () => {
    const ownerToken = await login(ownerEmail);
    const foreignCompany = await database.client.company.findFirst({
      where: { slug: 'hector-test-co-b' },
    });
    if (!foreignCompany) {
      return;
    }

    const foreignRole = await database.client.role.findFirst({
      where: { companyId: foreignCompany.id, key: 'OWNER', deletedAt: null },
    });
    if (!foreignRole) {
      return;
    }

    await request(app.getHttpServer())
      .get(`/api/v1/roles/${foreignRole.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .expect(404);

    const pouria = await database.client.user.findUniqueOrThrow({
      where: { email: ownerEmail },
    });
    const pouriaMembership = await database.client.companyMember.findUniqueOrThrow({
      where: {
        companyId_userId: { companyId: pishtehId, userId: pouria.id },
      },
    });

    await request(app.getHttpServer())
      .put(`/api/v1/members/${pouriaMembership.id}/roles`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .send({ roleIds: [foreignRole.id] })
      .expect(400);
  });
});
