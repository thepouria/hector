import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { type INestApplication } from '@nestjs/common';
import {
  CompanyMemberStatus,
  CompanyStatus,
  CurrencyCode,
  PERMISSIONS,
  UserStatus,
  syncOwnerRolePermissions,
} from '@hector/database';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { PasswordHasher } from '../src/modules/auth/password/password-hasher.service';
import { createE2eApp, E2E_PASSWORD, extractRefreshCookie } from './helpers/e2e-app';

/**
 * Phase 0.11 security regression matrix (HTTP-level, bypasses frontend).
 * Requires PostgreSQL + `pnpm db:seed`.
 */
describe('Security regression (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let passwordHasher: PasswordHasher;

  const ownerEmail = 'pouria@hector.local';
  const warehouseEmail = 'hossein@hector.local';
  const password = E2E_PASSWORD;

  let companyAId: string;
  let companyBId: string;
  let companyAOwnerRoleId: string;
  let companyBMemberId: string;
  let companyBRoleId: string;
  let companyBAuditId: string | null = null;
  let limitedUserEmail: string;
  let limitedUserId: string;
  let limitedMemberId: string;

  beforeAll(async () => {
    app = await createE2eApp();
    database = app.get(DatabaseService);
    passwordHasher = app.get(PasswordHasher);

    await syncOwnerRolePermissions(database.client);

    const companyA = await database.client.company.findUniqueOrThrow({
      where: { slug: 'pishteh' },
    });
    companyAId = companyA.id;

    const ownerRole = await database.client.role.findUniqueOrThrow({
      where: { companyId_key: { companyId: companyAId, key: 'OWNER' } },
    });
    companyAOwnerRoleId = ownerRole.id;

    const companyB = await database.client.company.upsert({
      where: { slug: 'hector-security-co-b' },
      update: {
        name: 'Hector Security Co B',
        status: CompanyStatus.ACTIVE,
        deletedAt: null,
      },
      create: {
        name: 'Hector Security Co B',
        slug: 'hector-security-co-b',
        timezone: 'UTC',
        baseCurrency: CurrencyCode.USD,
        status: CompanyStatus.ACTIVE,
      },
    });
    companyBId = companyB.id;

    const ownerBRole = await database.client.role.upsert({
      where: { companyId_key: { companyId: companyBId, key: 'OWNER' } },
      update: { name: 'Owner', isSystem: true, deletedAt: null },
      create: {
        companyId: companyBId,
        key: 'OWNER',
        name: 'Owner',
        isSystem: true,
      },
    });
    companyBRoleId = ownerBRole.id;
    await syncOwnerRolePermissions(database.client);

    const outsiderEmail = `sec-outsider-${randomUUID().slice(0, 8)}@hector.local`;
    const hash = await passwordHasher.hash(password);
    const outsider = await database.client.user.upsert({
      where: { email: outsiderEmail },
      update: {
        status: UserStatus.ACTIVE,
        deletedAt: null,
        passwordHash: hash,
      },
      create: {
        email: outsiderEmail,
        firstName: 'Sec',
        lastName: 'Outsider',
        passwordHash: hash,
        status: UserStatus.ACTIVE,
      },
    });

    const memberB = await database.client.companyMember.upsert({
      where: {
        companyId_userId: { companyId: companyBId, userId: outsider.id },
      },
      update: { status: CompanyMemberStatus.ACTIVE },
      create: {
        companyId: companyBId,
        userId: outsider.id,
        status: CompanyMemberStatus.ACTIVE,
      },
    });
    companyBMemberId = memberB.id;

    await database.client.companyMemberRole.upsert({
      where: {
        companyMemberId_roleId: {
          companyMemberId: memberB.id,
          roleId: ownerBRole.id,
        },
      },
      update: {},
      create: {
        companyMemberId: memberB.id,
        roleId: ownerBRole.id,
      },
    });

    // Ensure there is at least one Company B audit row for IDOR tests.
    const outsiderToken = await login(outsiderEmail);
    await request(app.getHttpServer())
      .patch(`/api/v1/companies/${companyBId}`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .set('X-Company-Id', companyBId)
      .send({ name: 'Hector Security Co B' })
      .expect(200);

    const auditB = await database.client.auditLog.findFirst({
      where: { companyId: companyBId },
      orderBy: { createdAt: 'desc' },
    });
    companyBAuditId = auditB?.id ?? null;

    limitedUserEmail = `sec-limited-${randomUUID().slice(0, 8)}@hector.local`;
    const limitedHash = await passwordHasher.hash(password);
    const limitedUser = await database.client.user.create({
      data: {
        email: limitedUserEmail,
        firstName: 'Limited',
        lastName: 'User',
        passwordHash: limitedHash,
        status: UserStatus.ACTIVE,
      },
    });
    limitedUserId = limitedUser.id;

    const memberRead = await database.client.permission.findUniqueOrThrow({
      where: { key: PERMISSIONS.MEMBER_READ },
    });
    const roleRead = await database.client.permission.findUniqueOrThrow({
      where: { key: PERMISSIONS.ROLE_READ },
    });
    const roleCreate = await database.client.permission.findUniqueOrThrow({
      where: { key: PERMISSIONS.ROLE_CREATE },
    });
    const rolePermUpdate = await database.client.permission.findUniqueOrThrow({
      where: { key: PERMISSIONS.ROLE_PERMISSIONS_UPDATE },
    });
    const permissionRead = await database.client.permission.findUniqueOrThrow({
      where: { key: PERMISSIONS.PERMISSION_READ },
    });

    const limitedRole = await database.client.role.create({
      data: {
        companyId: companyAId,
        key: `LIMITED_${randomUUID().slice(0, 6).toUpperCase()}`,
        name: 'Security Limited',
        isSystem: false,
      },
    });

    for (const permission of [memberRead, roleRead, roleCreate, rolePermUpdate, permissionRead]) {
      await database.client.rolePermission.create({
        data: { roleId: limitedRole.id, permissionId: permission.id },
      });
    }

    const limitedMember = await database.client.companyMember.create({
      data: {
        companyId: companyAId,
        userId: limitedUserId,
        status: CompanyMemberStatus.ACTIVE,
      },
    });
    limitedMemberId = limitedMember.id;
    await database.client.companyMemberRole.create({
      data: { companyMemberId: limitedMember.id, roleId: limitedRole.id },
    });

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

  // --- Matrix items ---

  it('1. should reject unauthenticated access to protected API', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/companies')
      .expect(401);
  });

  it('2. should deny authenticated users without required permission', async () => {
    const token = await login(warehouseEmail);
    await request(app.getHttpServer())
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', companyAId)
      .expect(403);
  });

  it('3. should allow actions when the correct permission is present', async () => {
    const token = await login(ownerEmail);
    await request(app.getHttpServer())
      .get('/api/v1/members')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', companyAId)
      .expect(200);
  });

  it('4. should allow Company A member to access Company A resources when permitted', async () => {
    const token = await login(ownerEmail);
    const res = await request(app.getHttpServer())
      .get(`/api/v1/companies/${companyAId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', companyAId)
      .expect(200);
    expect(res.body.data.id).toBe(companyAId);
  });

  it('5. should deny Company A member accessing Company B via X-Company-Id', async () => {
    const token = await login(ownerEmail);
    await request(app.getHttpServer())
      .get('/api/v1/members')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', companyBId)
      .expect(404);
  });

  it('5b. should reject reading a member belonging to another company', async () => {
    const token = await login(ownerEmail);
    await request(app.getHttpServer())
      .get(`/api/v1/members/${companyBMemberId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', companyAId)
      .expect(404);
  });

  it('5c. should reject reading a role belonging to another company', async () => {
    const token = await login(ownerEmail);
    await request(app.getHttpServer())
      .get(`/api/v1/roles/${companyBRoleId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', companyAId)
      .expect(404);
  });

  it('5d. should reject reading an audit entry belonging to another company', async () => {
    if (!companyBAuditId) {
      return;
    }
    const token = await login(ownerEmail);
    await request(app.getHttpServer())
      .get(`/api/v1/audit-logs/${companyBAuditId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', companyAId)
      .expect(404);
  });

  it('5e. should reject mutating a Company B resource under Company A context', async () => {
    const token = await login(ownerEmail);
    await request(app.getHttpServer())
      .patch(`/api/v1/roles/${companyBRoleId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', companyAId)
      .send({ name: 'Hijacked' })
      .expect(404);
  });

  it('6. should deny suspended membership for company-scoped requests', async () => {
    await database.client.companyMember.update({
      where: { id: limitedMemberId },
      data: { status: CompanyMemberStatus.SUSPENDED },
    });

    const token = await login(limitedUserEmail);
    const res = await request(app.getHttpServer())
      .get('/api/v1/members')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', companyAId);

    expect([403]).toContain(res.status);
    expect(res.body.error.code).toBe('MEMBERSHIP_SUSPENDED');

    await database.client.companyMember.update({
      where: { id: limitedMemberId },
      data: { status: CompanyMemberStatus.ACTIVE },
    });
  });

  it('7. should deny removed membership for company-scoped requests', async () => {
    await database.client.companyMember.update({
      where: { id: limitedMemberId },
      data: { status: CompanyMemberStatus.REMOVED },
    });

    const token = await login(limitedUserEmail);
    const res = await request(app.getHttpServer())
      .get('/api/v1/members')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', companyAId);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MEMBERSHIP_REMOVED');

    await database.client.companyMember.update({
      where: { id: limitedMemberId },
      data: { status: CompanyMemberStatus.ACTIVE },
    });
  });

  it('8/9. should deny expired and revoked sessions', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password })
      .expect(200);

    const accessToken = loginRes.body.data.accessToken as string;
    const sessions = await request(app.getHttpServer())
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const current = (sessions.body.data as Array<{ id: string; current: boolean }>).find(
      (session) => session.current,
    );
    expect(current).toBeDefined();

    await database.client.session.update({
      where: { id: current!.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);

    const login2 = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password })
      .expect(200);
    const token2 = login2.body.data.accessToken as string;
    const sessions2 = await request(app.getHttpServer())
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${token2}`)
      .expect(200);
    const current2 = (sessions2.body.data as Array<{ id: string; current: boolean }>).find(
      (session) => session.current,
    )!;

    await database.client.session.update({
      where: { id: current2.id },
      data: { revokedAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) },
    });

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token2}`)
      .expect(401);
  });

  it('10. should deny forbidden permission escalation via crafted API request', async () => {
    const token = await login(limitedUserEmail);
    const catalog = await request(app.getHttpServer())
      .get('/api/v1/permissions')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', companyAId)
      .expect(200);

    const auditPermission = (
      catalog.body.data as Array<{ id: string; key: string }>
    ).find((permission) => permission.key === PERMISSIONS.AUDIT_READ);
    expect(auditPermission).toBeDefined();

    const create = await request(app.getHttpServer())
      .post('/api/v1/roles')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', companyAId)
      .send({
        name: 'Escalation Attempt',
        key: `ESC_${randomUUID().slice(0, 6).toUpperCase()}`,
        permissionIds: [auditPermission!.id],
      });

    expect(create.status).toBe(403);
    expect(create.body.error.code).toBe('ROLE_PERMISSION_ESCALATION');
  });

  it('11. should reject unknown permission assignment', async () => {
    const token = await login(ownerEmail);
    const res = await request(app.getHttpServer())
      .post('/api/v1/roles')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', companyAId)
      .send({
        name: 'Bad Perms',
        key: `BAD_${randomUUID().slice(0, 6).toUpperCase()}`,
        permissionIds: [randomUUID()],
      });

    expect([400, 404]).toContain(res.status);
  });

  it('12. should deny removing the last active owner', async () => {
    const owners = await database.client.companyMember.findMany({
      where: {
        companyId: companyAId,
        status: CompanyMemberStatus.ACTIVE,
        roles: { some: { role: { key: 'OWNER' } } },
      },
      include: { user: true },
    });

    // Ensure only one active owner for this assertion by suspending others temporarily.
    const keep = owners.find((member) => member.user.email === ownerEmail) ?? owners[0];
    const others = owners.filter((member) => member.id !== keep.id);
    for (const other of others) {
      await database.client.companyMember.update({
        where: { id: other.id },
        data: { status: CompanyMemberStatus.SUSPENDED },
      });
    }

    const token = await login(keep.user.email);
    const res = await request(app.getHttpServer())
      .delete(`/api/v1/members/${keep.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', companyAId);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LAST_OWNER_REQUIRED');

    for (const other of others) {
      await database.client.companyMember.update({
        where: { id: other.id },
        data: { status: CompanyMemberStatus.ACTIVE },
      });
    }
  });

  it('12b. should keep at least one owner under concurrent last-owner removals', async () => {
    // Create a temporary second owner on Company B, then race-remove both.
    const emailA = `race-a-${randomUUID().slice(0, 6)}@hector.local`;
    const emailB = `race-b-${randomUUID().slice(0, 6)}@hector.local`;
    const hash = await passwordHasher.hash(password);

    const userA = await database.client.user.create({
      data: {
        email: emailA,
        firstName: 'Race',
        lastName: 'A',
        passwordHash: hash,
        status: UserStatus.ACTIVE,
      },
    });
    const userB = await database.client.user.create({
      data: {
        email: emailB,
        firstName: 'Race',
        lastName: 'B',
        passwordHash: hash,
        status: UserStatus.ACTIVE,
      },
    });

    const memberA = await database.client.companyMember.create({
      data: {
        companyId: companyBId,
        userId: userA.id,
        status: CompanyMemberStatus.ACTIVE,
      },
    });
    const memberB = await database.client.companyMember.create({
      data: {
        companyId: companyBId,
        userId: userB.id,
        status: CompanyMemberStatus.ACTIVE,
      },
    });

    await database.client.companyMemberRole.create({
      data: { companyMemberId: memberA.id, roleId: companyBRoleId },
    });
    await database.client.companyMemberRole.create({
      data: { companyMemberId: memberB.id, roleId: companyBRoleId },
    });

    // Remove any other active owners on Company B for a clean race.
    const allOwners = await database.client.companyMember.findMany({
      where: {
        companyId: companyBId,
        status: CompanyMemberStatus.ACTIVE,
        roles: { some: { role: { key: 'OWNER' } } },
      },
    });
    for (const member of allOwners) {
      if (member.id !== memberA.id && member.id !== memberB.id) {
        await database.client.companyMember.update({
          where: { id: member.id },
          data: { status: CompanyMemberStatus.SUSPENDED },
        });
      }
    }

    const tokenA = await login(emailA);
    const tokenB = await login(emailB);

    const [resA, resB] = await Promise.all([
      request(app.getHttpServer())
        .delete(`/api/v1/members/${memberA.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Company-Id', companyBId),
      request(app.getHttpServer())
        .delete(`/api/v1/members/${memberB.id}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .set('X-Company-Id', companyBId),
    ]);

    const statuses = [resA.status, resB.status].sort();
    // One may succeed; the other must fail with LAST_OWNER_REQUIRED (or both fail).
    expect(statuses.filter((status) => status === 200).length).toBeLessThanOrEqual(1);
    expect(statuses.some((status) => status === 409 || status === 200)).toBe(true);

    const remainingOwners = await database.client.companyMember.count({
      where: {
        companyId: companyBId,
        status: CompanyMemberStatus.ACTIVE,
        roles: { some: { role: { key: 'OWNER' } } },
      },
    });
    expect(remainingOwners).toBeGreaterThanOrEqual(1);
  });

  it('13. should reject forbidden system-role mutations', async () => {
    const token = await login(ownerEmail);
    const del = await request(app.getHttpServer())
      .delete(`/api/v1/roles/${companyAOwnerRoleId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', companyAId);

    expect(del.status).toBe(403);
    expect(del.body.error.code).toBe('ROLE_SYSTEM_PROTECTED');
  });

  it('14. should return controlled 4xx for invalid input', async () => {
    const token = await login(ownerEmail);
    await request(app.getHttpServer())
      .get('/api/v1/members/not-a-uuid')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', companyAId)
      .expect(400);

    await request(app.getHttpServer())
      .get('/api/v1/members?page=-1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', companyAId)
      .expect(400);

    await request(app.getHttpServer())
      .get('/api/v1/members?pageSize=1000000')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', companyAId)
      .expect(400);
  });

  it('15. should reject extra privileged DTO fields (mass assignment)', async () => {
    const token = await login(ownerEmail);
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/companies/${companyAId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', companyAId)
      .send({
        name: 'Pishteh',
        isSuperAdmin: true,
        baseCurrency: 'EUR',
      });

    expect(res.status).toBe(400);
  });

  it('16/17. should audit successful mutations and skip misleading success audits on failure', async () => {
    const token = await login(ownerEmail);
    const beforeCount = await database.client.auditLog.count({
      where: { companyId: companyAId, action: 'ROLE_CREATED' },
    });

    const created = await request(app.getHttpServer())
      .post('/api/v1/roles')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', companyAId)
      .send({
        name: 'Audited Role',
        key: `AUD_${randomUUID().slice(0, 6).toUpperCase()}`,
        permissionIds: [],
      })
      .expect(201);

    const afterSuccess = await database.client.auditLog.count({
      where: { companyId: companyAId, action: 'ROLE_CREATED' },
    });
    expect(afterSuccess).toBe(beforeCount + 1);

    const failBefore = await database.client.auditLog.count({
      where: { companyId: companyAId, action: 'ROLE_DELETED' },
    });

    await request(app.getHttpServer())
      .delete(`/api/v1/roles/${companyAOwnerRoleId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', companyAId)
      .expect(403);

    const failAfter = await database.client.auditLog.count({
      where: { companyId: companyAId, action: 'ROLE_DELETED' },
    });
    expect(failAfter).toBe(failBefore);

    // cleanup created role
    await request(app.getHttpServer())
      .delete(`/api/v1/roles/${created.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', companyAId)
      .expect(200);
  });

  it('20. should invalidate session after logout', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password })
      .expect(200);

    const accessToken = loginRes.body.data.accessToken as string;
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
  });

  it('should reject cookie-auth refresh from an untrusted Origin', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password })
      .expect(200);

    const cookie = extractRefreshCookie(loginRes.headers['set-cookie']);
    expect(cookie).toBeDefined();

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie!)
      .set('Origin', 'https://evil.example')
      .expect(403);
  });

  it('should allow cookie-auth refresh from a trusted Origin', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password })
      .expect(200);

    const cookie = extractRefreshCookie(loginRes.headers['set-cookie']);
    const trusted = (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(',')[0]!.trim();

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie!)
      .set('Origin', trusted)
      .expect(200);
  });

  it('should revoke session on refresh-token reuse after rotation', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password })
      .expect(200);

    const firstCookie = extractRefreshCookie(loginRes.headers['set-cookie'])!;
    const accessToken = loginRes.body.data.accessToken as string;

    const refresh = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', firstCookie)
      .expect(200);

    const nextCookie = extractRefreshCookie(refresh.headers['set-cookie']);
    expect(nextCookie).toBeDefined();

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', firstCookie)
      .expect(401);

    // Previous access token should fail after session revoke on reuse.
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
  });

  it('should require company context for company-scoped endpoints', async () => {
    const token = await login(ownerEmail);
    await request(app.getHttpServer())
      .get('/api/v1/members')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('should not return passwordHash in user/session responses', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password })
      .expect(200);

    expect(loginRes.body.data.user.passwordHash).toBeUndefined();
    expect(JSON.stringify(loginRes.body)).not.toMatch(/passwordHash/i);
    expect(JSON.stringify(loginRes.body)).not.toMatch(/refreshTokenHash/i);

    const sessions = await request(app.getHttpServer())
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${loginRes.body.data.accessToken}`)
      .expect(200);

    expect(JSON.stringify(sessions.body)).not.toMatch(/refreshTokenHash/i);
    expect(JSON.stringify(sessions.body)).not.toMatch(/password/i);
  });

  it('should set Cache-Control: no-store on API responses', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(String(res.headers['cache-control'] ?? '')).toContain('no-store');
  });

  it('should use a safe generic error for invalid credentials', async () => {
    const unknown = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'does-not-exist@hector.local', password })
      .expect(401);

    const wrong = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password: 'WrongPassword1' })
      .expect(401);

    expect(unknown.body.error.message).toBe(wrong.body.error.message);
    expect(unknown.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('finance accounts: deny warehouse operator and cross-tenant IDOR', async () => {
    const warehouseToken = await login(warehouseEmail);
    await request(app.getHttpServer())
      .get('/api/v1/finance/accounts')
      .set('Authorization', `Bearer ${warehouseToken}`)
      .set('X-Company-Id', companyAId)
      .expect(403);

    const ownerToken = await login(ownerEmail);
    const created = await request(app.getHttpServer())
      .post('/api/v1/finance/accounts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', companyAId)
      .send({
        code: `SEC-${randomUUID().slice(0, 8).toUpperCase()}`,
        name: 'Security Account',
        type: 'CASH',
        currency: 'IRR',
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/finance/accounts/${created.body.data.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', companyBId)
      .expect(404);

    await database.client.financialAccountMovement.deleteMany({
      where: { accountId: created.body.data.id },
    });
    await database.client.financialAccount.delete({
      where: { id: created.body.data.id },
    });
  });

  it('finance capital/loans: deny warehouse operator and cross-tenant IDOR', async () => {
    const warehouseToken = await login(warehouseEmail);
    await request(app.getHttpServer())
      .get('/api/v1/finance/capital-contributions')
      .set('Authorization', `Bearer ${warehouseToken}`)
      .set('X-Company-Id', companyAId)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/finance/loans')
      .set('Authorization', `Bearer ${warehouseToken}`)
      .set('X-Company-Id', companyAId)
      .expect(403);

    const ownerToken = await login(ownerEmail);
    const accounts = await request(app.getHttpServer())
      .get('/api/v1/finance/accounts?pageSize=5')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', companyAId)
      .expect(200);
    const irrAccount = accounts.body.data.find(
      (a: { currency: string; status: string }) =>
        a.currency === 'IRR' && a.status === 'ACTIVE',
    );
    expect(irrAccount).toBeTruthy();

    const capital = await request(app.getHttpServer())
      .post('/api/v1/finance/capital-contributions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', companyAId)
      .send({
        fundingType: 'PARTNER_EQUITY',
        contributorType: 'PARTNER',
        contributorName: 'Security Partner',
        accountId: irrAccount.id,
        amount: '1000',
        postImmediately: true,
        requestId: randomUUID(),
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/finance/capital-contributions/${capital.body.data.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', companyBId)
      .expect(404);

    const loan = await request(app.getHttpServer())
      .post('/api/v1/finance/loans')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', companyAId)
      .send({
        lenderType: 'EXTERNAL_PERSON',
        lenderName: 'Security Lender',
        currency: 'IRR',
        contractedPrincipal: '5000',
        firstDisbursement: { accountId: irrAccount.id, amount: '1000' },
        postImmediately: true,
        requestId: randomUUID(),
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/finance/loans/${loan.body.data.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', companyBId)
      .expect(404);
  });

  it('finance FX: deny warehouse operator and cross-tenant IDOR', async () => {
    const warehouseToken = await login(warehouseEmail);
    await request(app.getHttpServer())
      .get('/api/v1/finance/fx/rates')
      .set('Authorization', `Bearer ${warehouseToken}`)
      .set('X-Company-Id', companyAId)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/finance/fx/positions')
      .set('Authorization', `Bearer ${warehouseToken}`)
      .set('X-Company-Id', companyAId)
      .expect(403);

    const ownerToken = await login(ownerEmail);
    const rate = await request(app.getHttpServer())
      .post('/api/v1/finance/fx/rates')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', companyAId)
      .send({
        baseCurrency: 'USD',
        quoteCurrency: 'IRR',
        rate: '255000',
        rateType: 'REFERENCE',
        sourceReference: `SEC-FX-${randomUUID().slice(0, 8)}`,
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/finance/fx/rates/${rate.body.data.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', companyBId)
      .expect(404);

    await database.client.fxRate.delete({ where: { id: rate.body.data.id } });
  });

  it('finance payments/receipts: deny warehouse operator and cross-tenant IDOR', async () => {
    const warehouseToken = await login(warehouseEmail);
    await request(app.getHttpServer())
      .get('/api/v1/finance/payments')
      .set('Authorization', `Bearer ${warehouseToken}`)
      .set('X-Company-Id', companyAId)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/finance/receipts')
      .set('Authorization', `Bearer ${warehouseToken}`)
      .set('X-Company-Id', companyAId)
      .expect(403);

    const ownerToken = await login(ownerEmail);
    const accounts = await request(app.getHttpServer())
      .get('/api/v1/finance/accounts?pageSize=5&status=ACTIVE')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', companyAId)
      .expect(200);
    const accountId = accounts.body.data[0]?.id as string | undefined;
    if (!accountId) return;

    const payment = await request(app.getHttpServer())
      .post('/api/v1/finance/payments')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', companyAId)
      .send({
        accountId,
        amount: '1000',
        purposeType: 'OTHER',
        requestId: randomUUID(),
        postImmediately: false,
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/finance/payments/${payment.body.data.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', companyBId)
      .expect(404);
  });
});
