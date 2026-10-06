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
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';

describe('Brand + Category management (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;
  let pishtehId: string;
  let demoBId: string;
  let demoBBrandId: string;
  let demoBCategoryId: string;
  let ownerPasswordHash: string;

  beforeAll(async () => {
    app = await createE2eApp();
    database = app.get(DatabaseService);
    await syncPermissions(database.client);
    await syncOwnerRolePermissions(database.client);

    pishtehId = (
      await database.client.company.findUniqueOrThrow({ where: { slug: 'pishteh' } })
    ).id;
    demoBId = (
      await database.client.company.findUniqueOrThrow({ where: { slug: 'hector-demo-b' } })
    ).id;
    demoBBrandId = (
      await database.client.brand.findFirstOrThrow({
        where: { companyId: demoBId },
      })
    ).id;
    demoBCategoryId = (
      await database.client.category.findFirstOrThrow({
        where: { companyId: demoBId, parentId: null },
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
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return res.body.data.accessToken as string;
  }

  it('denies unauthenticated brand/category access', async () => {
    await request(app.getHttpServer()).get('/api/v1/catalog/brands').expect(401);
    await request(app.getHttpServer()).get('/api/v1/catalog/categories/tree').expect(401);
  });

  it('enforces catalog.read vs catalog.manage', async () => {
    const limited = await database.client.role.create({
      data: {
        companyId: pishtehId,
        key: `cat-ro-${Date.now()}`,
        name: 'Catalog RO',
        isSystem: false,
      },
    });
    const catalogRead = await database.client.permission.findUniqueOrThrow({
      where: { key: PERMISSIONS.CATALOG_READ },
    });
    await database.client.rolePermission.create({
      data: { roleId: limited.id, permissionId: catalogRead.id },
    });
    const user = await database.client.user.create({
      data: {
        email: `cat-ro-${Date.now()}@hector.local`,
        firstName: 'RO',
        lastName: 'Catalog',
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

    try {
      const token = await login(user.email);
      await request(app.getHttpServer())
        .get('/api/v1/catalog/brands')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Company-Id', pishtehId)
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/v1/catalog/brands')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Company-Id', pishtehId)
        .send({ name: 'Should Fail' })
        .expect(403);
    } finally {
      await database.client.companyMemberRole.deleteMany({
        where: { companyMemberId: membership.id },
      });
      await database.client.companyMember.delete({ where: { id: membership.id } });
      await database.client.rolePermission.deleteMany({ where: { roleId: limited.id } });
      await database.client.role.delete({ where: { id: limited.id } });
      await database.client.user.delete({ where: { id: user.id } });
    }
  });

  it('blocks cross-company brand and category access', async () => {
    const token = await login(ownerEmail);
    await request(app.getHttpServer())
      .get(`/api/v1/catalog/brands/${demoBBrandId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/catalog/categories/${demoBCategoryId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(404);
  });

  it('rejects foreign parent and duplicate normalized names', async () => {
    const token = await login(ownerEmail);
    const suffix = Date.now();

    await request(app.getHttpServer())
      .post('/api/v1/catalog/categories')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: `Root-${suffix}`, parentId: demoBCategoryId })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/catalog/brands')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: `Brand Dup ${suffix}` })
      .expect(201);

    const dup = await request(app.getHttpServer())
      .post('/api/v1/catalog/brands')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: ` brand dup ${suffix} ` })
      .expect(409);
    expect(dup.body.error.code).toBe('BRAND_NAME_ALREADY_EXISTS');
  });

  it('supports category tree create/move/cycle rejection and archive', async () => {
    const token = await login(ownerEmail);
    const suffix = Date.now();

    const root = await request(app.getHttpServer())
      .post('/api/v1/catalog/categories')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: `TreeRoot-${suffix}`, code: `TR-${suffix}` })
      .expect(201);

    const child = await request(app.getHttpServer())
      .post('/api/v1/catalog/categories')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: `TreeChild-${suffix}`, parentId: root.body.data.id })
      .expect(201);

    const grand = await request(app.getHttpServer())
      .post('/api/v1/catalog/categories')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: `TreeGrand-${suffix}`, parentId: child.body.data.id })
      .expect(201);

    const tree = await request(app.getHttpServer())
      .get('/api/v1/catalog/categories/tree')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);
    expect(Array.isArray(tree.body.data)).toBe(true);

    await request(app.getHttpServer())
      .post(`/api/v1/catalog/categories/${root.body.data.id}/move`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ parentId: grand.body.data.id })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/api/v1/catalog/categories/${child.body.data.id}/move`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ parentId: child.body.data.id })
      .expect(400);

    // Same name under different parents allowed
    await request(app.getHttpServer())
      .post('/api/v1/catalog/categories')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: `SharedName-${suffix}`, parentId: root.body.data.id })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/catalog/categories')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: `SharedName-${suffix}`, parentId: child.body.data.id })
      .expect(201);

    // Sibling duplicate rejected
    const sibDup = await request(app.getHttpServer())
      .post('/api/v1/catalog/categories')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: ` sharedname-${suffix} `, parentId: root.body.data.id })
      .expect(409);
    expect(sibDup.body.error.code).toBe('CATEGORY_NAME_ALREADY_EXISTS');

    // Root duplicate
    const rootDup = await request(app.getHttpServer())
      .post('/api/v1/catalog/categories')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: ` treeroot-${suffix} ` })
      .expect(409);
    expect(rootDup.body.error.code).toBe('CATEGORY_NAME_ALREADY_EXISTS');

    await request(app.getHttpServer())
      .post(`/api/v1/catalog/categories/${child.body.data.id}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(201);

    const archived = await request(app.getHttpServer())
      .get(`/api/v1/catalog/categories/${child.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);
    expect(archived.body.data.status).toBe('ARCHIVED');
    expect(archived.body.data.path).toContain('TreeRoot');
  });

  it('allows same brand name across companies and audits brand archive', async () => {
    const token = await login(ownerEmail);
    const name = `CrossBrand ${Date.now()}`;

    await request(app.getHttpServer())
      .post('/api/v1/catalog/brands')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ name })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/catalog/brands')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', demoBId)
      .send({ name })
      .expect(201);

    const created = await database.client.brand.findFirstOrThrow({
      where: { companyId: pishtehId, name },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/catalog/brands/${created.id}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(201);

    const audit = await database.client.auditLog.findFirst({
      where: {
        companyId: pishtehId,
        entityType: 'BRAND',
        entityId: created.id,
        action: 'BRAND_ARCHIVED',
      },
    });
    expect(audit).toBeTruthy();
  });

  it('handles concurrent duplicate root category creation', async () => {
    const token = await login(ownerEmail);
    const name = `RaceRoot ${Date.now()}`;
    const results = await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer())
          .post('/api/v1/catalog/categories')
          .set('Authorization', `Bearer ${token}`)
          .set('X-Company-Id', pishtehId)
          .send({ name }),
      ),
    );
    const ok = results.filter((r) => r.status === 201);
    const conflict = results.filter((r) => r.status === 409);
    expect(ok.length).toBe(1);
    expect(conflict.length).toBe(1);
  });
});
