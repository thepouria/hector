import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  CompanyMemberStatus,
  CompanyStatus,
  CurrencyCode,
  UserStatus,
  syncOwnerRolePermissions,
} from '@hector/database';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { PasswordHasher } from '../src/modules/auth/password/password-hasher.service';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';

describe('Companies + Membership (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let passwordHasher: PasswordHasher;

  const password = E2E_PASSWORD;
  const ownerEmail = 'pouria@hector.local';
  const warehouseEmail = 'hossein@hector.local';

  let pishtehId: string;
  let warehouseRoleId: string;
  let secondCompanyId: string;
  let secondCompanyOwnerRoleId: string;
  let outsiderUserId: string;
  let outsiderEmail: string;

  beforeAll(async () => {
    app = await createE2eApp();
    database = app.get(DatabaseService);
    passwordHasher = app.get(PasswordHasher);

    const pishteh = await database.client.company.findUniqueOrThrow({
      where: { slug: 'pishteh' },
    });
    pishtehId = pishteh.id;

    const warehouseRole = await database.client.role.findUniqueOrThrow({
      where: { companyId_key: { companyId: pishtehId, key: 'WAREHOUSE_OPERATOR' } },
    });
    warehouseRoleId = warehouseRole.id;

    const second = await database.client.company.upsert({
      where: { slug: 'hector-test-co-b' },
      update: {
        name: 'Hector Test Co B',
        status: CompanyStatus.ACTIVE,
        deletedAt: null,
        timezone: 'UTC',
        baseCurrency: CurrencyCode.USD,
      },
      create: {
        name: 'Hector Test Co B',
        slug: 'hector-test-co-b',
        timezone: 'UTC',
        baseCurrency: CurrencyCode.USD,
        status: CompanyStatus.ACTIVE,
      },
    });
    secondCompanyId = second.id;

    const secondOwnerRole = await database.client.role.upsert({
      where: {
        companyId_key: { companyId: secondCompanyId, key: 'OWNER' },
      },
      update: { name: 'Owner', deletedAt: null, isSystem: true },
      create: {
        companyId: secondCompanyId,
        key: 'OWNER',
        name: 'Owner',
        isSystem: true,
      },
    });
    secondCompanyOwnerRoleId = secondOwnerRole.id;
    await syncOwnerRolePermissions(database.client);

    outsiderEmail = `outsider-${randomUUID().slice(0, 8)}@hector.local`;
    const outsiderHash = await passwordHasher.hash(password);
    const outsider = await database.client.user.upsert({
      where: { email: outsiderEmail },
      update: {
        status: UserStatus.ACTIVE,
        deletedAt: null,
        passwordHash: outsiderHash,
        firstName: 'Out',
        lastName: 'Sider',
      },
      create: {
        email: outsiderEmail,
        firstName: 'Out',
        lastName: 'Sider',
        passwordHash: outsiderHash,
        status: UserStatus.ACTIVE,
      },
    });
    outsiderUserId = outsider.id;

    await database.client.companyMember.upsert({
      where: {
        companyId_userId: {
          companyId: secondCompanyId,
          userId: outsiderUserId,
        },
      },
      update: { status: CompanyMemberStatus.ACTIVE },
      create: {
        companyId: secondCompanyId,
        userId: outsiderUserId,
        status: CompanyMemberStatus.ACTIVE,
      },
    });

    const outsiderMembership = await database.client.companyMember.findUniqueOrThrow({
      where: {
        companyId_userId: {
          companyId: secondCompanyId,
          userId: outsiderUserId,
        },
      },
    });

    await database.client.companyMemberRole.upsert({
      where: {
        companyMemberId_roleId: {
          companyMemberId: outsiderMembership.id,
          roleId: secondCompanyOwnerRoleId,
        },
      },
      update: {},
      create: {
        companyMemberId: outsiderMembership.id,
        roleId: secondCompanyOwnerRoleId,
      },
    });

    // Ensure Pouria also has ACTIVE membership on second company for switching tests.
    const pouria = await database.client.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    await database.client.companyMember.upsert({
      where: {
        companyId_userId: { companyId: secondCompanyId, userId: pouria.id },
      },
      update: { status: CompanyMemberStatus.ACTIVE },
      create: {
        companyId: secondCompanyId,
        userId: pouria.id,
        status: CompanyMemberStatus.ACTIVE,
      },
    });
    const pouriaSecond = await database.client.companyMember.findUniqueOrThrow({
      where: {
        companyId_userId: { companyId: secondCompanyId, userId: pouria.id },
      },
    });
    await database.client.companyMemberRole.upsert({
      where: {
        companyMemberId_roleId: {
          companyMemberId: pouriaSecond.id,
          roleId: secondCompanyOwnerRoleId,
        },
      },
      update: {},
      create: {
        companyMemberId: pouriaSecond.id,
        roleId: secondCompanyOwnerRoleId,
      },
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

  const tokenCache = new Map<string, string>();

  async function login(email: string): Promise<string> {
    const cached = tokenCache.get(email);
    if (cached) {
      return cached;
    }

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    const token = res.body.data.accessToken as string;
    tokenCache.set(email, token);
    return token;
  }

  it('lists only companies the user belongs to', async () => {
    const token = await login(ownerEmail);
    const res = await request(app.getHttpServer())
      .get('/api/v1/companies')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const slugs = (res.body.data as Array<{ slug: string }>).map((c) => c.slug);
    expect(slugs).toEqual(expect.arrayContaining(['pishteh', 'hector-test-co-b']));

    const outsiderToken = await login(outsiderEmail);
    const outsiderCompanies = await request(app.getHttpServer())
      .get('/api/v1/companies')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(200);

    const outsiderSlugs = (outsiderCompanies.body.data as Array<{ slug: string }>).map(
      (c) => c.slug,
    );
    expect(outsiderSlugs).toContain('hector-test-co-b');
    expect(outsiderSlugs).not.toContain('pishteh');
  });

  it('establishes company context and rejects missing/invalid membership', async () => {
    const token = await login(ownerEmail);

    await request(app.getHttpServer())
      .get('/api/v1/members')
      .set('Authorization', `Bearer ${token}`)
      .expect(400)
      .expect((res) => {
        expect(res.body.error.code).toBe('COMPANY_CONTEXT_REQUIRED');
      });

    await request(app.getHttpServer())
      .get('/api/v1/members')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', randomUUID())
      .expect(404)
      .expect((res) => {
        expect(res.body.error.code).toBe('COMPANY_NOT_FOUND');
      });

    const members = await request(app.getHttpServer())
      .get('/api/v1/members')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);

    expect(Array.isArray(members.body.data)).toBe(true);
    expect(members.body.meta.page).toBe(1);
  });

  it('switches company context with the same access token', async () => {
    const token = await login(ownerEmail);

    const a = await request(app.getHttpServer())
      .get(`/api/v1/companies/${pishtehId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);
    expect(a.body.data.slug).toBe('pishteh');

    const b = await request(app.getHttpServer())
      .get(`/api/v1/companies/${secondCompanyId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', secondCompanyId)
      .expect(200);
    expect(b.body.data.slug).toBe('hector-test-co-b');

    const membersA = await request(app.getHttpServer())
      .get('/api/v1/members')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);

    const membersB = await request(app.getHttpServer())
      .get('/api/v1/members')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', secondCompanyId)
      .expect(200);

    expect(membersA.body.data).not.toEqual(membersB.body.data);
  });

  it('enforces cross-company isolation', async () => {
    const outsiderToken = await login(outsiderEmail);

    await request(app.getHttpServer())
      .get(`/api/v1/companies/${pishtehId}`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .set('X-Company-Id', pishtehId)
      .expect(404);

    await request(app.getHttpServer())
      .get('/api/v1/members')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .set('X-Company-Id', pishtehId)
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/api/v1/companies/${pishtehId}`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: 'Hacked' })
      .expect(404);
  });

  it('allows OWNER membership lifecycle and blocks non-owners', async () => {
    const ownerToken = await login(ownerEmail);
    const warehouseToken = await login(warehouseEmail);

    const inviteEmail = `invitee-${randomUUID().slice(0, 8)}@hector.local`;
    const inviteHash = await passwordHasher.hash(password);
    await database.client.user.create({
      data: {
        email: inviteEmail,
        firstName: 'Invite',
        lastName: 'Ee',
        passwordHash: inviteHash,
        status: UserStatus.ACTIVE,
      },
    });

    await request(app.getHttpServer())
      .post('/api/v1/members')
      .set('Authorization', `Bearer ${warehouseToken}`)
      .set('X-Company-Id', pishtehId)
      .send({ email: inviteEmail, roleIds: [warehouseRoleId] })
      .expect(403)
      .expect((res) => {
        expect(res.body.error.code).toBe('FORBIDDEN');
      });

    const created = await request(app.getHttpServer())
      .post('/api/v1/members')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .send({ email: inviteEmail, roleIds: [warehouseRoleId] })
      .expect(201);

    const memberId = created.body.data.id as string;
    expect(created.body.data.user.email).toBe(inviteEmail);
    expect(created.body.data.user.passwordHash).toBeUndefined();
    expect(created.body.data.roles[0].key).toBe('WAREHOUSE_OPERATOR');

    await request(app.getHttpServer())
      .post('/api/v1/members')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .send({ email: inviteEmail, roleIds: [warehouseRoleId] })
      .expect(409);

    await request(app.getHttpServer())
      .patch(`/api/v1/members/${memberId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .send({ status: 'SUSPENDED' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/v1/members/${memberId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .send({ status: 'ACTIVE' })
      .expect(200);

    // Cross-company role rejected
    await request(app.getHttpServer())
      .put(`/api/v1/members/${memberId}/roles`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .send({ roleIds: [secondCompanyOwnerRoleId] })
      .expect(400)
      .expect((res) => {
        expect(res.body.error.code).toBe('INVALID_COMPANY_ROLE');
      });

    const removed = await request(app.getHttpServer())
      .delete(`/api/v1/members/${memberId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);
    expect(removed.body.data.status).toBe('REMOVED');

    const originalJoinedAt = removed.body.data.joinedAt as string;

    const reactivated = await request(app.getHttpServer())
      .post('/api/v1/members')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .send({ email: inviteEmail, roleIds: [warehouseRoleId] })
      .expect(201);

    expect(reactivated.body.data.id).toBe(memberId);
    expect(reactivated.body.data.status).toBe('ACTIVE');
    expect(reactivated.body.data.joinedAt).toBe(originalJoinedAt);

    // Membership removal does not kill global auth
    const inviteToken = await login(inviteEmail);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${inviteToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/api/v1/members/${memberId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/members')
      .set('Authorization', `Bearer ${inviteToken}`)
      .set('X-Company-Id', pishtehId)
      .expect(403)
      .expect((res) => {
        expect(res.body.error.code).toBe('MEMBERSHIP_REMOVED');
      });

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${inviteToken}`)
      .expect(200);
  });

  it('protects the last active OWNER', async () => {
    const slug = `last-owner-${randomUUID().slice(0, 8)}`;
    const company = await database.client.company.create({
      data: {
        name: 'Last Owner Co',
        slug,
        timezone: 'UTC',
        baseCurrency: CurrencyCode.IRR,
        status: CompanyStatus.ACTIVE,
      },
    });

    const role = await database.client.role.create({
      data: {
        companyId: company.id,
        key: 'OWNER',
        name: 'Owner',
        isSystem: true,
      },
    });

    const soloEmail = `solo-${randomUUID().slice(0, 8)}@hector.local`;
    const hash = await passwordHasher.hash(password);
    const solo = await database.client.user.create({
      data: {
        email: soloEmail,
        firstName: 'Solo',
        lastName: 'Owner',
        passwordHash: hash,
        status: UserStatus.ACTIVE,
      },
    });

    const membership = await database.client.companyMember.create({
      data: {
        companyId: company.id,
        userId: solo.id,
        status: CompanyMemberStatus.ACTIVE,
      },
    });
    await database.client.companyMemberRole.create({
      data: {
        companyMemberId: membership.id,
        roleId: role.id,
      },
    });
    await syncOwnerRolePermissions(database.client);

    const token = await login(soloEmail);

    await request(app.getHttpServer())
      .delete(`/api/v1/members/${membership.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', company.id)
      .expect(409)
      .expect((res) => {
        expect(res.body.error.code).toBe('LAST_OWNER_REQUIRED');
      });

    await request(app.getHttpServer())
      .patch(`/api/v1/members/${membership.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', company.id)
      .send({ status: 'SUSPENDED' })
      .expect(409)
      .expect((res) => {
        expect(res.body.error.code).toBe('LAST_OWNER_REQUIRED');
      });

    // Add second owner, then first may be removed
    const secondEmail = `coowner-${randomUUID().slice(0, 8)}@hector.local`;
    const secondHash = await passwordHasher.hash(password);
    await database.client.user.create({
      data: {
        email: secondEmail,
        firstName: 'Co',
        lastName: 'Owner',
        passwordHash: secondHash,
        status: UserStatus.ACTIVE,
      },
    });

    const secondMember = await request(app.getHttpServer())
      .post('/api/v1/members')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', company.id)
      .send({ email: secondEmail, roleIds: [role.id] })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/v1/members/${secondMember.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', company.id)
      .expect(200);
  });

  it('allows OWNER to update company name/timezone and rejects invalid timezone / baseCurrency', async () => {
    const token = await login(ownerEmail);

    await request(app.getHttpServer())
      .patch(`/api/v1/companies/${pishtehId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ timezone: 'Not/AZone' })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/api/v1/companies/${pishtehId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ baseCurrency: 'USD' })
      .expect(400);

    const warehouseToken = await login(warehouseEmail);
    await request(app.getHttpServer())
      .patch(`/api/v1/companies/${pishtehId}`)
      .set('Authorization', `Bearer ${warehouseToken}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: 'Nope' })
      .expect(403);

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/companies/${pishtehId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: 'Pishteh', timezone: 'Asia/Tehran' })
      .expect(200);

    expect(updated.body.data.name).toBe('Pishteh');
    expect(updated.body.data.timezone).toBe('Asia/Tehran');
    expect(updated.body.data.baseCurrency).toBe('IRR');
  });

  it('rejects suspended membership and suspended company context', async () => {
    const token = await login(ownerEmail);
    const pouria = await database.client.user.findUniqueOrThrow({ where: { email: ownerEmail } });

    const membership = await database.client.companyMember.findUniqueOrThrow({
      where: {
        companyId_userId: { companyId: secondCompanyId, userId: pouria.id },
      },
    });

    await database.client.companyMember.update({
      where: { id: membership.id },
      data: { status: CompanyMemberStatus.SUSPENDED },
    });

    await request(app.getHttpServer())
      .get('/api/v1/members')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', secondCompanyId)
      .expect(403)
      .expect((res) => {
        expect(res.body.error.code).toBe('MEMBERSHIP_SUSPENDED');
      });

    await database.client.companyMember.update({
      where: { id: membership.id },
      data: { status: CompanyMemberStatus.ACTIVE },
    });

    await database.client.company.update({
      where: { id: secondCompanyId },
      data: { status: CompanyStatus.SUSPENDED },
    });

    await request(app.getHttpServer())
      .get('/api/v1/members')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', secondCompanyId)
      .expect(403)
      .expect((res) => {
        expect(res.body.error.code).toBe('COMPANY_UNAVAILABLE');
      });

    const listed = await request(app.getHttpServer())
      .get('/api/v1/companies')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const slugs = (listed.body.data as Array<{ slug: string }>).map((c) => c.slug);
    expect(slugs).not.toContain('hector-test-co-b');

    await database.client.company.update({
      where: { id: secondCompanyId },
      data: { status: CompanyStatus.ACTIVE },
    });
  });
});
