import request from 'supertest';
import {
  CompanyMemberStatus,
  UserStatus,
  syncOwnerRolePermissions,
  syncPermissions,
} from '@hector/database';
import type { INestApplication } from '@nestjs/common';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';

/**
 * Phase 1.12 gap-fill QA: mass assignment, barcode exactness, search injection,
 * concurrent primary barcode integrity, category-change attribute retention.
 */
describe('Catalog Phase 1.12 Final QA (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;

  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;

  let pishtehId: string;
  let demoBId: string;
  let fanomaBrandId: string;
  let lipstickCategoryId: string;
  let sunscreenCategoryId: string;
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
    fanomaBrandId = (
      await database.client.brand.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'FAN' },
      })
    ).id;
    lipstickCategoryId = (
      await database.client.category.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'LIPSTICK' },
      })
    ).id;
    sunscreenCategoryId = (
      await database.client.category.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'SUNSCREEN' },
      })
    ).id;

    await database.client.user.update({
      where: { email: ownerEmail },
      data: { status: UserStatus.ACTIVE },
    });
    await database.client.companyMember.updateMany({
      where: { userId: (await database.client.user.findUniqueOrThrow({ where: { email: ownerEmail } })).id },
      data: { status: CompanyMemberStatus.ACTIVE },
    });

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password })
      .expect(200);
    token = login.body.data.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  async function createProduct(name: string, categoryId = lipstickCategoryId) {
    const code = `QA12-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/catalog/products')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ name, code, brandId: fanomaBrandId, categoryId })
      .expect(201);
    return res.body.data as { id: string; code: string; name: string };
  }

  async function createSku(productId: string) {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/catalog/products/${productId}/skus`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ code: `QSKU-${Date.now().toString(36).slice(-8)}` })
      .expect(201);
    return res.body.data.id as string;
  }

  it('rejects mass-assignment of companyId / archivedAt / normalized fields on product create', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/catalog/products')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({
        name: `Mass Assign ${Date.now()}`,
        code: `MASS-${Date.now().toString(36).slice(-6)}`,
        brandId: fanomaBrandId,
        companyId: demoBId,
        archivedAt: new Date().toISOString(),
        normalizedName: 'hacked',
        status: 'ARCHIVED',
      })
      .expect(400);
    expect(res.body.error?.code ?? res.body.statusCode).toBeTruthy();
  });

  it('preserves leading-zero OTHER barcode and rejects prefix ambiguity on resolve', async () => {
    const product = await createProduct('Leading Zero Product');
    const skuId = await createSku(product.id);
    const value = `00123-${Date.now().toString().slice(-6)}`;

    const created = await request(app.getHttpServer())
      .post(`/api/v1/catalog/skus/${skuId}/barcodes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ value, type: 'OTHER', isPrimary: true })
      .expect(201);
    expect(created.body.data.value).toBe(value);

    await request(app.getHttpServer())
      .post('/api/v1/catalog/barcodes/resolve')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ value })
      .expect(200);

    // Prefix / suffix must not resolve.
    await request(app.getHttpServer())
      .post('/api/v1/catalog/barcodes/resolve')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ value: value.slice(1) })
      .expect(404);

    await request(app.getHttpServer())
      .post('/api/v1/catalog/barcodes/resolve')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ value: `${value}9` })
      .expect(404);
  });

  it('survives malicious search/filter inputs without 500', async () => {
    for (const search of [`'`, `"`, `%`, `_`, `'; DROP TABLE products;--`, 'ا'.repeat(200)]) {
      const res = await request(app.getHttpServer())
        .get('/api/v1/catalog/products')
        .query({ search, pageSize: 5 })
        .set('Authorization', `Bearer ${token}`)
        .set('X-Company-Id', pishtehId);
      expect(res.status).toBeLessThan(500);
      expect([200, 400]).toContain(res.status);
    }
  });

  it('enforces at most one active primary barcode under concurrent set-primary', async () => {
    const product = await createProduct('Primary Race Product');
    const skuId = await createSku(product.id);

    const a = await request(app.getHttpServer())
      .post(`/api/v1/catalog/skus/${skuId}/barcodes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ value: `PR-A-${Date.now()}`, type: 'OTHER', isPrimary: true })
      .expect(201);
    const b = await request(app.getHttpServer())
      .post(`/api/v1/catalog/skus/${skuId}/barcodes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ value: `PR-B-${Date.now()}`, type: 'OTHER', isPrimary: false })
      .expect(201);

    const results = await Promise.allSettled([
      request(app.getHttpServer())
        .post(`/api/v1/catalog/barcodes/${a.body.data.id}/set-primary`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Company-Id', pishtehId),
      request(app.getHttpServer())
        .post(`/api/v1/catalog/barcodes/${b.body.data.id}/set-primary`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Company-Id', pishtehId),
      request(app.getHttpServer())
        .post(`/api/v1/catalog/barcodes/${a.body.data.id}/set-primary`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Company-Id', pishtehId),
      request(app.getHttpServer())
        .post(`/api/v1/catalog/barcodes/${b.body.data.id}/set-primary`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Company-Id', pishtehId),
    ]);

    for (const result of results) {
      expect(result.status).toBe('fulfilled');
      if (result.status === 'fulfilled') {
        expect([200, 201, 409]).toContain(result.value.status);
      }
    }

    const primaries = await database.client.barcode.count({
      where: { skuId, companyId: pishtehId, isPrimary: true, archivedAt: null },
    });
    expect(primaries).toBe(1);
  });

  it('keeps product attributes when category changes', async () => {
    const product = await createProduct('Attr Keep Product', sunscreenCategoryId);
    const spf = await database.client.attributeDefinition.findFirstOrThrow({
      where: { companyId: pishtehId, code: 'spf' },
    });

    await request(app.getHttpServer())
      .put(`/api/v1/catalog/products/${product.id}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ attributes: [{ attributeId: spf.id, numberValue: 50 }] })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/v1/catalog/products/${product.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ categoryId: lipstickCategoryId })
      .expect(200);

    const attrs = await request(app.getHttpServer())
      .get(`/api/v1/catalog/products/${product.id}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);
    expect(attrs.body.data).toHaveLength(1);
    expect(Number(attrs.body.data[0].numberValue)).toBe(50);
  });

  it('searches seeded Persian product names', async () => {
    const persian = await request(app.getHttpServer())
      .get('/api/v1/catalog/products')
      .query({ search: 'رژ لب جامد فانوما', pageSize: 20 })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);
    expect(
      persian.body.data.some(
        (p: { code: string | null; name: string }) =>
          p.code === 'FAN-SL' || p.name.includes('فانوما'),
      ),
    ).toBe(true);

    const byCode = await request(app.getHttpServer())
      .get('/api/v1/catalog/products')
      .query({ search: 'FAN-SL', pageSize: 5 })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);
    expect(byCode.body.data.some((p: { code: string | null }) => p.code === 'FAN-SL')).toBe(true);
  });

  it('allows overlapping SKU codes across companies', async () => {
    const sharedCode = `SHARE-${Date.now().toString(36).slice(-6)}`;
    const productA = await createProduct('Share Code A');
    await request(app.getHttpServer())
      .post(`/api/v1/catalog/products/${productA.id}/skus`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ code: sharedCode })
      .expect(201);

    const productB = await database.client.product.findFirstOrThrow({
      where: { companyId: demoBId },
    });
    // Direct DB insert for company B to avoid needing demo-B manage permissions edge cases —
    // uniqueness is company-scoped at DB level.
    await database.client.sku.create({
      data: {
        companyId: demoBId,
        productId: productB.id,
        code: sharedCode.toUpperCase(),
        normalizedCode: sharedCode.toUpperCase(),
        name: sharedCode,
        variantSignature: `qa-share-${sharedCode}`,
      },
    });

    const count = await database.client.sku.count({
      where: { normalizedCode: sharedCode.toUpperCase() },
    });
    expect(count).toBeGreaterThanOrEqual(2);
  });
});
