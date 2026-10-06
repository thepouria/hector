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

describe('Catalog Admin API (Phase 1.7) (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;

  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;

  let pishtehId: string;
  let demoBId: string;
  let fanSlProductId: string;
  let fanPrimerProductId: string;
  let fanSl01SkuId: string;
  let makeupCategoryId: string;
  let lipstickCategoryId: string;
  let ownerPasswordHash: string;
  let token: string;

  beforeAll(async () => {
    app = await createE2eApp();
    database = app.get(DatabaseService);
    await syncPermissions(database.client);
    await syncOwnerRolePermissions(database.client);

    pishtehId = (await database.client.company.findUniqueOrThrow({ where: { slug: 'pishteh' } })).id;
    demoBId = (
      await database.client.company.findUniqueOrThrow({ where: { slug: 'hector-demo-b' } })
    ).id;

    fanSlProductId = (
      await database.client.product.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'FAN-SL' },
      })
    ).id;
    fanPrimerProductId = (
      await database.client.product.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'FAN-PRIMER' },
      })
    ).id;
    fanSl01SkuId = (
      await database.client.sku.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'FAN-SL-01' },
      })
    ).id;

    makeupCategoryId = (
      await database.client.category.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'MAKEUP' },
      })
    ).id;
    lipstickCategoryId = (
      await database.client.category.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'LIPSTICK' },
      })
    ).id;

    const owner = await database.client.user.update({
      where: { email: ownerEmail },
      data: { status: UserStatus.ACTIVE, deletedAt: null },
    });
    ownerPasswordHash = owner.passwordHash;
    token = await login(ownerEmail);
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

  async function createLimitedUser(
    keys: string[],
  ): Promise<{ email: string; cleanup: () => Promise<void> }> {
    const email = `catalog-api-lim-${Date.now()}@hector.local`;
    const user = await database.client.user.create({
      data: {
        email,
        passwordHash: ownerPasswordHash,
        firstName: 'Cat',
        lastName: 'Reader',
        status: UserStatus.ACTIVE,
      },
    });
    const role = await database.client.role.create({
      data: {
        companyId: pishtehId,
        key: `CAT_API_LIM_${Date.now()}`,
        name: 'Catalog API Limited',
        isSystem: false,
      },
    });
    const perms = await database.client.permission.findMany({ where: { key: { in: keys } } });
    for (const p of perms) {
      await database.client.rolePermission.create({
        data: { roleId: role.id, permissionId: p.id },
      });
    }
    const membership = await database.client.companyMember.create({
      data: { companyId: pishtehId, userId: user.id, status: CompanyMemberStatus.ACTIVE },
    });
    await database.client.companyMemberRole.create({
      data: { companyMemberId: membership.id, roleId: role.id },
    });
    return {
      email,
      cleanup: async () => {
        await database.client.companyMemberRole.deleteMany({
          where: { companyMemberId: membership.id },
        });
        await database.client.companyMember.delete({ where: { id: membership.id } });
        await database.client.rolePermission.deleteMany({ where: { roleId: role.id } });
        await database.client.role.delete({ where: { id: role.id } });
        await database.client.user.delete({ where: { id: user.id } });
      },
    };
  }

  it('denies unauthenticated catalog access', async () => {
    await request(app.getHttpServer()).get('/api/v1/catalog/products').expect(401);
    await request(app.getHttpServer()).get('/api/v1/catalog/lookup').expect(401);
    await request(app.getHttpServer()).get('/api/v1/catalog/stats').expect(401);
  });

  it('allows catalog.read GET and denies POST mutations', async () => {
    const reader = await createLimitedUser([PERMISSIONS.CATALOG_READ]);
    const readerToken = await login(reader.email);

    await request(app.getHttpServer())
      .get('/api/v1/catalog/products')
      .set('Authorization', `Bearer ${readerToken}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/catalog/products')
      .set('Authorization', `Bearer ${readerToken}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: 'Denied Product' })
      .expect(403);

    await reader.cleanup();
  });

  it('returns pagination meta.totalPages and rejects invalid pageSize', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/catalog/products')
      .query({ page: 1, pageSize: 5 })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);

    expect(list.body.meta).toEqual(
      expect.objectContaining({
        page: 1,
        pageSize: 5,
        total: expect.any(Number),
        totalPages: expect.any(Number),
      }),
    );
    expect(list.body.meta.totalPages).toBe(
      list.body.meta.total === 0 ? 0 : Math.ceil(list.body.meta.total / list.body.meta.pageSize),
    );

    await request(app.getHttpServer())
      .get('/api/v1/catalog/products')
      .query({ pageSize: 101 })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(400);
  });

  it('finds products by seeded SKU code and barcode search', async () => {
    const bySku = await request(app.getHttpServer())
      .get('/api/v1/catalog/products')
      .query({ search: 'FAN-SL-02' })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);

    expect(bySku.body.data.some((p: { code: string }) => p.code === 'FAN-SL')).toBe(true);

    const byBarcode = await request(app.getHttpServer())
      .get('/api/v1/catalog/products')
      .query({ search: '6261000000016' })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);

    expect(byBarcode.body.data.some((p: { id: string }) => p.id === fanSlProductId)).toBe(true);
  });

  it('supports includeDescendants and hasSku filters when present', async () => {
    const exactParent = await request(app.getHttpServer())
      .get('/api/v1/catalog/products')
      .query({ categoryId: makeupCategoryId, includeDescendants: false, pageSize: 100 })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);

    const withDesc = await request(app.getHttpServer())
      .get('/api/v1/catalog/products')
      .query({ categoryId: makeupCategoryId, pageSize: 100 })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);

    // Default includeDescendants=true → parent represents subtree.
    expect(withDesc.body.data.length).toBeGreaterThanOrEqual(exactParent.body.data.length);
    expect(
      withDesc.body.data.some((p: { categoryId: string | null }) => p.categoryId === lipstickCategoryId),
    ).toBe(true);

    const withSkus = await request(app.getHttpServer())
      .get('/api/v1/catalog/products')
      .query({ hasSku: true, search: 'FAN-SL', pageSize: 20 })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);

    expect(withSkus.body.data.length).toBeGreaterThan(0);
    expect(withSkus.body.data.every((p: { skuCount: number }) => p.skuCount > 0)).toBe(true);
  });

  it('filters products by attribute NUMBER/BOOLEAN and ranks exact barcode in lookup', async () => {
    // Use thresholds that remain valid even if other attribute e2e suites mutate seed SPF samples.
    const spf = await request(app.getHttpServer())
      .get('/api/v1/catalog/products')
      .query({ attrs: 'spf:gte:10', pageSize: 50 })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);
    expect(spf.body.data.length).toBeGreaterThan(0);

    const missingSpf = await request(app.getHttpServer())
      .get('/api/v1/catalog/products')
      .query({ attrs: 'spf:hasValue:false', pageSize: 5 })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);
    expect(Array.isArray(missingSpf.body.data)).toBe(true);

    const invalidOp = await request(app.getHttpServer())
      .get('/api/v1/catalog/products')
      .query({ attrs: 'spf:contains:x', pageSize: 5 })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(400);
    expect(invalidOp.body.error?.details?.code ?? invalidOp.body.message).toBeTruthy();

    const lookup = await request(app.getHttpServer())
      .get('/api/v1/catalog/lookup')
      .query({ search: '6261000000016' })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);
    expect(lookup.body.data[0]?.type).toBe('BARCODE');
    expect(lookup.body.data[0]?.skuId).toBeTruthy();

    const skuLookup = await request(app.getHttpServer())
      .get('/api/v1/catalog/lookup')
      .query({ search: 'FAN-SL-02' })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);
    expect(skuLookup.body.data[0]?.type).toBe('SKU');
    expect(skuLookup.body.data[0]?.label).toBe('FAN-SL-02');
  });

  it('exposes SKU hasBarcode on list when present', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/catalog/skus')
      .query({ search: 'FAN-SL-01', pageSize: 20 })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);

    const row = res.body.data.find((s: { code: string }) => s.code === 'FAN-SL-01');
    expect(row).toBeDefined();
    expect(row.hasBarcode).toBe(true);
    expect(row.primaryBarcode?.value).toBe('6261000000016');

    const filtered = await request(app.getHttpServer())
      .get('/api/v1/catalog/skus')
      .query({ hasBarcode: true, search: 'FAN-SL-01' })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);

    expect(filtered.body.data.some((s: { code: string }) => s.code === 'FAN-SL-01')).toBe(true);
  });

  it('lookup is bounded and tenant-isolated', async () => {
    const pishteh = await request(app.getHttpServer())
      .get('/api/v1/catalog/lookup')
      .query({ search: 'FAN' })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);

    expect(Array.isArray(pishteh.body.data)).toBe(true);
    expect(pishteh.body.data.length).toBeLessThanOrEqual(20);
    expect(pishteh.body.data.every((h: { label: string }) => h.label.length > 0)).toBe(true);

    const demo = await request(app.getHttpServer())
      .get('/api/v1/catalog/lookup')
      .query({ search: 'MIR-SERUM' })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', demoBId)
      .expect(200);

    const demoHits = demo.body.data as Array<{ label: string; type: string }>;
    expect(demoHits.some((h) => h.label.includes('MIR-SERUM'))).toBe(true);
    expect(demoHits.some((h) => h.label.includes('FAN-SL'))).toBe(false);
  });

  it('stats returns catalog counts without inventory fields', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/catalog/stats')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);

    expect(res.body.data).toEqual(
      expect.objectContaining({
        products: expect.any(Number),
        skus: expect.any(Number),
        brands: expect.any(Number),
        categories: expect.any(Number),
        barcodes: expect.any(Number),
        attributes: expect.any(Number),
      }),
    );
    expect(res.body.data).not.toHaveProperty('inventory');
    expect(res.body.data).not.toHaveProperty('stock');
    expect(res.body.data).not.toHaveProperty('warehouse');
  });

  it('returns FAN-PRIMER detail and zero product attributes', async () => {
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/catalog/products/${fanPrimerProductId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);

    expect(detail.body.data.code).toBe('FAN-PRIMER');

    const attrs = await request(app.getHttpServer())
      .get(`/api/v1/catalog/products/${fanPrimerProductId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);

    expect(attrs.body.data).toEqual([]);
  });

  it('returns SKU identity payload when endpoint exists', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/catalog/skus/${fanSl01SkuId}/identity`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);

    expect(res.body.data.skuCode).toBe('FAN-SL-01');
    expect(res.body.data.productCode).toBe('FAN-SL');
    expect(res.body.data.primaryBarcode?.value).toBe('6261000000016');
    expect(res.body.data).not.toHaveProperty('inventory');
  });

  it('product list rows do not embed nested skus arrays', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/catalog/products')
      .query({ pageSize: 20 })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);

    for (const row of res.body.data) {
      expect(row).not.toHaveProperty('skus');
    }
  });
});
