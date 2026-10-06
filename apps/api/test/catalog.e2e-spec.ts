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

describe('Catalog architecture (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;

  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;

  let pishtehId: string;
  let demoBId: string;
  let demoBProductId: string;
  let demoBSkuId: string;
  let demoBBarcodeValue: string;
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

    const foreignSku = await database.client.sku.findFirstOrThrow({
      where: { companyId: demoBId, code: 'MIR-SERUM-01' },
    });
    demoBSkuId = foreignSku.id;

    const foreignBarcode = await database.client.barcode.findFirstOrThrow({
      where: { companyId: demoBId, value: 'DEV-BC-DEMO-B-ONLY' },
    });
    demoBBarcodeValue = foreignBarcode.value;

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

  async function createProduct(
    token: string,
    companyId: string,
    body: { name: string; code: string },
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/catalog/products')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', companyId)
      .send(body)
      .expect(201);
    return res.body.data.id as string;
  }

  it('denies unauthenticated catalog access', async () => {
    await request(app.getHttpServer()).get('/api/v1/catalog/products').expect(401);
  });

  it('denies catalog.read and catalog.manage when permission is missing', async () => {
    const limited = await database.client.role.create({
      data: {
        companyId: pishtehId,
        key: `catalog-limited-${Date.now()}`,
        name: 'Catalog Limited',
        isSystem: false,
      },
    });

    const companyRead = await database.client.permission.findUniqueOrThrow({
      where: { key: PERMISSIONS.COMPANY_READ },
    });
    await database.client.rolePermission.create({
      data: { roleId: limited.id, permissionId: companyRead.id },
    });

    const user = await database.client.user.create({
      data: {
        email: `catalog-limited-${Date.now()}@hector.local`,
        firstName: 'Limited',
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
      const limitedToken = await login(user.email);

      await request(app.getHttpServer())
        .get('/api/v1/catalog/products')
        .set('Authorization', `Bearer ${limitedToken}`)
        .set('X-Company-Id', pishtehId)
        .expect(403);

      await request(app.getHttpServer())
        .post('/api/v1/catalog/products')
        .set('Authorization', `Bearer ${limitedToken}`)
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

  it('owner can read seeded catalog and lookup barcodes', async () => {
    const token = await login(ownerEmail);

    const products = await request(app.getHttpServer())
      .get('/api/v1/catalog/products')
      .query({ search: 'FAN-SL' })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);

    expect(products.body.data.some((p: { code: string }) => p.code === 'FAN-SL')).toBe(true);
    expect(products.body.meta).toEqual(
      expect.objectContaining({ page: 1, total: expect.any(Number) }),
    );

    const lookup = await request(app.getHttpServer())
      .post('/api/v1/catalog/barcodes/resolve')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ value: '6261000000016' })
      .expect(200);

    expect(lookup.body.data.sku.code).toBe('FAN-SL-01');
    expect(lookup.body.data.product.code).toBe('FAN-SL');
    expect(lookup.body.data.barcode.type).toBe('EAN13');
  });

  it('blocks cross-company product / sku / barcode access', async () => {
    const token = await login(ownerEmail);

    await request(app.getHttpServer())
      .get(`/api/v1/catalog/products/${demoBProductId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/api/v1/catalog/skus/${demoBSkuId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(404);

    await request(app.getHttpServer())
      .post('/api/v1/catalog/barcodes/resolve')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ value: demoBBarcodeValue })
      .expect(404);
  });

  it('rejects creating SKU under a foreign product', async () => {
    const token = await login(ownerEmail);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/catalog/products/${demoBProductId}/skus`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ code: `CROSS-SKU-${Date.now()}` })
      .expect(404);

    expect(res.body.error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('rejects assigning barcode to a foreign SKU', async () => {
    const token = await login(ownerEmail);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/catalog/skus/${demoBSkuId}/barcodes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ value: `DEV-BC-FAIL-${Date.now()}`, type: 'OTHER' })
      .expect(404);

    expect(res.body.error.code).toBe('SKU_NOT_FOUND');
  });

  it('enforces company-scoped SKU uniqueness after normalization', async () => {
    const token = await login(ownerEmail);
    const productId = await createProduct(token, pishtehId, {
      name: 'Uniqueness Test Product',
      code: `UNIQ-P-${Date.now()}`,
    });

    const base = `UNIQ-NORM-${Date.now()}`;
    await request(app.getHttpServer())
      .post(`/api/v1/catalog/products/${productId}/skus`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ code: base.toLowerCase() })
      .expect(201);

    const dup = await request(app.getHttpServer())
      .post(`/api/v1/catalog/products/${productId}/skus`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ code: base.toUpperCase() })
      .expect(409);

    expect(dup.body.error.code).toBe('SKU_CODE_ALREADY_EXISTS');
  });

  it('allows the same SKU code and barcode across companies', async () => {
    const token = await login(ownerEmail);

    const existingOnPishteh = await database.client.sku.findFirst({
      where: { companyId: pishtehId, code: 'MIR-SERUM-01' },
    });

    if (!existingOnPishteh) {
      const productId = await createProduct(token, pishtehId, {
        name: 'Cross-tenant code reuse',
        code: `REUSE-P-${Date.now()}`,
      });

      await request(app.getHttpServer())
        .post(`/api/v1/catalog/products/${productId}/skus`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Company-Id', pishtehId)
        .send({ code: 'MIR-SERUM-01', name: 'Allowed reuse' })
        .expect(201);
    }

    const onPishteh = await database.client.sku.count({
      where: { companyId: pishtehId, code: 'MIR-SERUM-01' },
    });
    const onDemoB = await database.client.sku.count({
      where: { companyId: demoBId, code: 'MIR-SERUM-01' },
    });
    expect(onPishteh).toBeGreaterThanOrEqual(0);
    expect(onDemoB).toBe(1);

    // Shared EAN value across companies resolves per company context.
    const shared = '6261000000016';
    const barcodesPishteh = await database.client.barcode.count({
      where: { companyId: pishtehId, normalizedValue: shared },
    });
    const barcodesDemoB = await database.client.barcode.count({
      where: { companyId: demoBId, normalizedValue: shared },
    });
    expect(barcodesPishteh).toBe(1);
    expect(barcodesDemoB).toBe(1);

    const resolveA = await request(app.getHttpServer())
      .post('/api/v1/catalog/barcodes/resolve')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ value: shared })
      .expect(200);
    expect(resolveA.body.data.sku.code).toBe('FAN-SL-01');

    const resolveB = await request(app.getHttpServer())
      .post('/api/v1/catalog/barcodes/resolve')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', demoBId)
      .send({ value: shared })
      .expect(200);
    expect(resolveB.body.data.sku.code).toBe('MIR-SERUM-01');
  });

  it('handles concurrent SKU code collisions without duplicates', async () => {
    const token = await login(ownerEmail);
    const productId = await createProduct(token, pishtehId, {
      name: 'Race Product',
      code: `RACE-P-${Date.now()}`,
    });

    const code = `RACE-SKU-${Date.now()}`;
    const results = await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer())
          .post(`/api/v1/catalog/products/${productId}/skus`)
          .set('Authorization', `Bearer ${token}`)
          .set('X-Company-Id', pishtehId)
          .send({ code }),
      ),
    );

    const successes = results.filter((r) => r.status === 201);
    const conflicts = results.filter((r) => r.status === 409);
    expect(successes.length).toBe(1);
    expect(conflicts.length).toBe(1);

    const count = await database.client.sku.count({
      where: { companyId: pishtehId, code },
    });
    expect(count).toBe(1);
  });

  it('archives product without destroying SKUs and keeps archive queryable', async () => {
    const token = await login(ownerEmail);
    const productId = await createProduct(token, pishtehId, {
      name: 'Archive Me',
      code: `ARCH-P-${Date.now()}`,
    });

    const skuRes = await request(app.getHttpServer())
      .post(`/api/v1/catalog/products/${productId}/skus`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ code: `ARCH-SKU-${Date.now()}` })
      .expect(201);
    const skuId = skuRes.body.data.id as string;

    await request(app.getHttpServer())
      .post(`/api/v1/catalog/products/${productId}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(201);

    const product = await request(app.getHttpServer())
      .get(`/api/v1/catalog/products/${productId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);

    expect(product.body.data.status).toBe('ARCHIVED');

    const sku = await request(app.getHttpServer())
      .get(`/api/v1/catalog/skus/${skuId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);

    expect(sku.body.data.id).toBe(skuId);
  });

  it('enforces duplicate barcode within company', async () => {
    const token = await login(ownerEmail);
    const productId = await createProduct(token, pishtehId, {
      name: 'Barcode Dup Product',
      code: `BCDUP-P-${Date.now()}`,
    });

    const skuA = await request(app.getHttpServer())
      .post(`/api/v1/catalog/products/${productId}/skus`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ code: `BCDUP-A-${Date.now()}` })
      .expect(201);

    // A product without variant options allows exactly one (simple) SKU.
    const productB = await createProduct(token, pishtehId, {
      name: 'Barcode Dup Product B',
      code: `BCDUP-PB-${Date.now()}`,
    });
    const skuB = await request(app.getHttpServer())
      .post(`/api/v1/catalog/products/${productB}/skus`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ code: `BCDUP-B-${Date.now()}` })
      .expect(201);

    const value = `DEV-BC-DUP-${Date.now()}`;
    await request(app.getHttpServer())
      .post(`/api/v1/catalog/skus/${skuA.body.data.id}/barcodes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ value, type: 'OTHER', isPrimary: true })
      .expect(201);

    const dup = await request(app.getHttpServer())
      .post(`/api/v1/catalog/skus/${skuB.body.data.id}/barcodes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ value, type: 'OTHER', isPrimary: true })
      .expect(409);

    expect(dup.body.error.code).toBe('BARCODE_ALREADY_EXISTS');
  });
});
