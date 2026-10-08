import request from 'supertest';
import {
  CatalogLifecycleStatus,
  CompanyMemberStatus,
  PERMISSIONS,
  UserStatus,
  syncOwnerRolePermissions,
  syncPermissions,
} from '@hector/database';
import type { INestApplication } from '@nestjs/common';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';

describe('Catalog Product Core (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;

  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;

  let pishtehId: string;
  let demoBId: string;
  let demoBProductId: string;
  let demoBBrandId: string;
  let demoBCategoryId: string;
  let fanomaBrandId: string;
  let solidLipstickCategoryId: string;
  let makeupCategoryId: string;
  let ownerPasswordHash: string;

  beforeAll(async () => {
    app = await createE2eApp();
    database = app.get(DatabaseService);

    await syncPermissions(database.client);
    await syncOwnerRolePermissions(database.client);

    const pishteh = await database.client.company.findUniqueOrThrow({
      where: { slug: 'pishteh' },
    });
    pishtehId = pishteh.id;

    const demoB = await database.client.company.findUniqueOrThrow({
      where: { slug: 'hector-demo-b' },
    });
    demoBId = demoB.id;

    const foreignProduct = await database.client.product.findFirstOrThrow({
      where: { companyId: demoBId, code: 'MIR-SERUM' },
    });
    demoBProductId = foreignProduct.id;
    demoBBrandId = foreignProduct.brandId!;
    demoBCategoryId = foreignProduct.categoryId!;

    const fanoma = await database.client.brand.findFirstOrThrow({
      where: { companyId: pishtehId, code: 'FAN' },
    });
    fanomaBrandId = fanoma.id;

    const solid = await database.client.category.findFirstOrThrow({
      where: { companyId: pishtehId, code: 'LIPSTICK' },
    });
    solidLipstickCategoryId = solid.id;

    const makeup = await database.client.category.findFirstOrThrow({
      where: { companyId: pishtehId, code: 'MAKEUP' },
    });
    makeupCategoryId = makeup.id;

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

  it('denies unauthenticated product endpoints', async () => {
    await request(app.getHttpServer()).get('/api/v1/catalog/products').expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/catalog/products')
      .send({ name: 'X' })
      .expect(401);
  });

  it('enforces catalog.read vs catalog.manage for products', async () => {
    const readRole = await database.client.role.create({
      data: {
        companyId: pishtehId,
        key: `product-read-${Date.now()}`,
        name: 'Product Read',
        isSystem: false,
      },
    });
    const companyRead = await database.client.permission.findUniqueOrThrow({
      where: { key: PERMISSIONS.COMPANY_READ },
    });
    const catalogRead = await database.client.permission.findUniqueOrThrow({
      where: { key: PERMISSIONS.CATALOG_READ },
    });
    await database.client.rolePermission.createMany({
      data: [
        { roleId: readRole.id, permissionId: companyRead.id },
        { roleId: readRole.id, permissionId: catalogRead.id },
      ],
    });

    const user = await database.client.user.create({
      data: {
        email: `product-read-${Date.now()}@hector.local`,
        firstName: 'Read',
        lastName: 'Only',
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
      data: { companyMemberId: membership.id, roleId: readRole.id },
    });

    let productId: string | undefined;
    try {
      const token = await login(user.email);

      await request(app.getHttpServer())
        .get('/api/v1/catalog/products')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Company-Id', pishtehId)
        .expect(200);

      // Dedicated product — do not depend on seeded FAN-SL (other suites may archive it).
      const ownerToken = await login(ownerEmail);
      const owned = await request(app.getHttpServer())
        .post('/api/v1/catalog/products')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Company-Id', pishtehId)
        .send({
          name: `RBAC Product ${Date.now()}`,
          code: `RBAC-${Date.now().toString(36).toUpperCase()}`,
        })
        .expect(201);
      productId = owned.body.data.id as string;

      await request(app.getHttpServer())
        .get(`/api/v1/catalog/products/${productId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Company-Id', pishtehId)
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/v1/catalog/products')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Company-Id', pishtehId)
        .send({ name: 'Forbidden Create' })
        .expect(403);

      await request(app.getHttpServer())
        .patch(`/api/v1/catalog/products/${productId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Company-Id', pishtehId)
        .send({ name: 'Forbidden' })
        .expect(403);

      await request(app.getHttpServer())
        .post(`/api/v1/catalog/products/${productId}/archive`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Company-Id', pishtehId)
        .expect(403);

      await request(app.getHttpServer())
        .post(`/api/v1/catalog/products/${productId}/activate`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Company-Id', pishtehId)
        .expect(403);

      await request(app.getHttpServer())
        .post(`/api/v1/catalog/products/${productId}/deactivate`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Company-Id', pishtehId)
        .expect(403);
    } finally {
      if (productId) {
        await database.client.product
          .update({
            where: { id: productId },
            data: { status: CatalogLifecycleStatus.ARCHIVED, archivedAt: new Date() },
          })
          .catch(() => undefined);
      }
      await database.client.companyMemberRole.deleteMany({
        where: { companyMemberId: membership.id },
      });
      await database.client.companyMember.delete({ where: { id: membership.id } });
      await database.client.rolePermission.deleteMany({ where: { roleId: readRole.id } });
      await database.client.role.delete({ where: { id: readRole.id } });
      await database.client.user.delete({ where: { id: user.id } });
    }
  });

  it('creates / updates / searches / filters / paginates products', async () => {
    const token = await login(ownerEmail);
    const suffix = Date.now();

    const created = await request(app.getHttpServer())
      .post('/api/v1/catalog/products')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({
        name: `  محصول تست ${suffix}  `,
        code: `tst-core-${suffix}`,
        description: 'plain text',
        brandId: fanomaBrandId,
        categoryId: solidLipstickCategoryId,
      })
      .expect(201);

    expect(created.body.data.name).toBe(`محصول تست ${suffix}`);
    expect(created.body.data.code).toBe(`TST-CORE-${suffix}`);
    expect(created.body.data.brand.id).toBe(fanomaBrandId);
    expect(created.body.data.category.id).toBe(solidLipstickCategoryId);

    const withoutRelations = await request(app.getHttpServer())
      .post('/api/v1/catalog/products')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: `بدون برند ${suffix}` })
      .expect(201);
    expect(withoutRelations.body.data.brandId).toBeNull();
    expect(withoutRelations.body.data.categoryId).toBeNull();

    await request(app.getHttpServer())
      .patch(`/api/v1/catalog/products/${created.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({
        name: `محصول ویرایش ${suffix}`,
        code: `TST-CORE-EDIT-${suffix}`,
        brandId: null,
        categoryId: null,
        description: null,
      })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.brandId).toBeNull();
        expect(res.body.data.categoryId).toBeNull();
        expect(res.body.data.description).toBeNull();
        expect(res.body.data.code).toBe(`TST-CORE-EDIT-${suffix}`);
      });

    const search = await request(app.getHttpServer())
      .get('/api/v1/catalog/products')
      .query({ search: `TST-CORE-EDIT-${suffix}` })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);
    expect(search.body.data.some((p: { id: string }) => p.id === created.body.data.id)).toBe(
      true,
    );
    expect(search.body.meta).toEqual(
      expect.objectContaining({ page: 1, pageSize: expect.any(Number), total: expect.any(Number) }),
    );

    const byBrand = await request(app.getHttpServer())
      .get('/api/v1/catalog/products')
      .query({ brandId: fanomaBrandId, status: 'ACTIVE' })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);
    expect(byBrand.body.data.every((p: { brandId: string | null }) => p.brandId === fanomaBrandId)).toBe(
      true,
    );

    const byCategory = await request(app.getHttpServer())
      .get('/api/v1/catalog/products')
      .query({ categoryId: solidLipstickCategoryId })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);
    expect(
      byCategory.body.data.every(
        (p: { categoryId: string | null }) => p.categoryId === solidLipstickCategoryId,
      ),
    ).toBe(true);

    const page = await request(app.getHttpServer())
      .get('/api/v1/catalog/products')
      .query({ page: 1, pageSize: 2, sortBy: 'createdAt', sortOrder: 'desc' })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);
    expect(page.body.data.length).toBeLessThanOrEqual(2);
    expect(page.body.meta.pageSize).toBe(2);
  });

  it('rejects duplicate product codes after normalization within company', async () => {
    const token = await login(ownerEmail);
    const code = `dup-code-${Date.now()}`;

    await request(app.getHttpServer())
      .post('/api/v1/catalog/products')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: 'Dup A', code: code.toLowerCase() })
      .expect(201);

    const dup = await request(app.getHttpServer())
      .post('/api/v1/catalog/products')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: 'Dup B', code: code.toUpperCase() })
      .expect(409);
    expect(dup.body.error.code).toBe('PRODUCT_CODE_ALREADY_EXISTS');

    // Same code allowed on other company
    await request(app.getHttpServer())
      .post('/api/v1/catalog/products')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', demoBId)
      .send({ name: 'Dup Other Co', code: code.toUpperCase() })
      .expect(201);
  });

  it('blocks foreign brand/category and product IDOR', async () => {
    const token = await login(ownerEmail);

    await request(app.getHttpServer())
      .get(`/api/v1/catalog/products/${demoBProductId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/api/v1/catalog/products/${demoBProductId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: 'Steal' })
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/v1/catalog/products/${demoBProductId}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(404);

    const foreignBrand = await request(app.getHttpServer())
      .post('/api/v1/catalog/products')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: 'Foreign Brand Product', brandId: demoBBrandId })
      .expect(404);
    expect(foreignBrand.body.error.code).toBe('PRODUCT_BRAND_NOT_FOUND');

    const foreignCategory = await request(app.getHttpServer())
      .post('/api/v1/catalog/products')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: 'Foreign Category Product', categoryId: demoBCategoryId })
      .expect(404);
    expect(foreignCategory.body.error.code).toBe('PRODUCT_CATEGORY_NOT_FOUND');
  });

  it('rejects archived brand/category and inactive ancestor category assignment', async () => {
    const token = await login(ownerEmail);
    const stamp = Date.now();

    const brandRes = await request(app.getHttpServer())
      .post('/api/v1/catalog/brands')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: `ArchBrand ${stamp}`, code: `ARCHB-${stamp}` })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/catalog/brands/${brandRes.body.data.id}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(201);

    const archivedBrandAssign = await request(app.getHttpServer())
      .post('/api/v1/catalog/products')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: `P ArchBrand ${stamp}`, brandId: brandRes.body.data.id })
      .expect(409);
    expect(archivedBrandAssign.body.error.code).toBe('PRODUCT_BRAND_NOT_ASSIGNABLE');

    const catRes = await request(app.getHttpServer())
      .post('/api/v1/catalog/categories')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: `ArchCat ${stamp}`, parentId: makeupCategoryId, code: `ARCHC-${stamp}` })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/catalog/categories/${catRes.body.data.id}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(201);

    const archivedCatAssign = await request(app.getHttpServer())
      .post('/api/v1/catalog/products')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: `P ArchCat ${stamp}`, categoryId: catRes.body.data.id })
      .expect(409);
    expect(archivedCatAssign.body.error.code).toBe('PRODUCT_CATEGORY_NOT_ASSIGNABLE');

    // Ancestor archived: create child under makeup, archive makeup temporarily — use dedicated branch
    const parent = await request(app.getHttpServer())
      .post('/api/v1/catalog/categories')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: `ParentArch ${stamp}`, code: `PARCH-${stamp}` })
      .expect(201);
    const child = await request(app.getHttpServer())
      .post('/api/v1/catalog/categories')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: `ChildActive ${stamp}`, parentId: parent.body.data.id, code: `CARCH-${stamp}` })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/catalog/categories/${parent.body.data.id}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(201);

    const ancestorBlocked = await request(app.getHttpServer())
      .post('/api/v1/catalog/products')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: `P Ancestor ${stamp}`, categoryId: child.body.data.id })
      .expect(409);
    expect(ancestorBlocked.body.error.code).toBe('PRODUCT_CATEGORY_NOT_ASSIGNABLE');
  });

  it('lifecycle deactivate / activate / archive with audit and events; activation blocked on bad brand', async () => {
    const token = await login(ownerEmail);
    const stamp = Date.now();

    const brandRes = await request(app.getHttpServer())
      .post('/api/v1/catalog/brands')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: `LifeBrand ${stamp}`, code: `LIFEB-${stamp}` })
      .expect(201);

    const productRes = await request(app.getHttpServer())
      .post('/api/v1/catalog/products')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({
        name: `Life Product ${stamp}`,
        code: `LIFE-P-${stamp}`,
        brandId: brandRes.body.data.id,
        categoryId: solidLipstickCategoryId,
      })
      .expect(201);
    const productId = productRes.body.data.id as string;

    await request(app.getHttpServer())
      .post(`/api/v1/catalog/products/${productId}/deactivate`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(201)
      .expect((res) => {
        expect(res.body.data.status).toBe('INACTIVE');
      });

    await request(app.getHttpServer())
      .post(`/api/v1/catalog/products/${productId}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(201)
      .expect((res) => {
        expect(res.body.data.status).toBe('ACTIVE');
      });

    // Archive brand then try activate after deactivate → blocked
    await request(app.getHttpServer())
      .post(`/api/v1/catalog/products/${productId}/deactivate`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/catalog/brands/${brandRes.body.data.id}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(201);

    const blocked = await request(app.getHttpServer())
      .post(`/api/v1/catalog/products/${productId}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(409);
    expect(blocked.body.error.code).toBe('PRODUCT_ACTIVATION_BLOCKED');

    // Clear brand then activate
    await request(app.getHttpServer())
      .patch(`/api/v1/catalog/products/${productId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ brandId: null })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/catalog/products/${productId}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/catalog/products/${productId}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(201);

    const archived = await database.client.product.findFirstOrThrow({
      where: { id: productId, companyId: pishtehId },
    });
    expect(archived.status).toBe(CatalogLifecycleStatus.ARCHIVED);
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.categoryId).toBe(solidLipstickCategoryId);

    const audits = await database.client.auditLog.findMany({
      where: {
        companyId: pishtehId,
        entityType: 'PRODUCT',
        entityId: productId,
      },
      orderBy: { createdAt: 'asc' },
    });
    const actions = audits.map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'PRODUCT_CREATED',
        'PRODUCT_DEACTIVATED',
        'PRODUCT_ACTIVATED',
        'PRODUCT_UPDATED',
        'PRODUCT_ARCHIVED',
      ]),
    );
  });
});
