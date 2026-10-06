import { randomUUID } from 'node:crypto';
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

describe('Catalog Bulk Operations (Phase 1.10) (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;

  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;

  let pishtehId: string;
  let demoBId: string;
  let fanomaBrandId: string;
  let sunscreenCategoryId: string;
  let lipstickCategoryId: string;
  let fanSlProductId: string;
  let fanSsProductId: string;
  let spfAttributeId: string;
  let oilFreeAttributeId: string;
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

    fanomaBrandId = (
      await database.client.brand.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'FAN' },
      })
    ).id;
    sunscreenCategoryId = (
      await database.client.category.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'SUNSCREEN' },
      })
    ).id;
    lipstickCategoryId = (
      await database.client.category.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'LIPSTICK' },
      })
    ).id;
    fanSlProductId = (
      await database.client.product.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'FAN-SL' },
      })
    ).id;
    fanSsProductId = (
      await database.client.product.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'FAN-SUN' },
      })
    ).id;
    spfAttributeId = (
      await database.client.attributeDefinition.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'spf' },
      })
    ).id;
    oilFreeAttributeId = (
      await database.client.attributeDefinition.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'oil_free' },
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
      .send({ email, password });
    if (res.status !== 200) {
      throw new Error(
        `login(${email}) expected 200, got ${res.status}: ${JSON.stringify(res.body)}`,
      );
    }
    return res.body.data.accessToken as string;
  }

  async function createLimitedUser(
    keys: string[],
  ): Promise<{ email: string; cleanup: () => Promise<void> }> {
    const suffix = randomUUID().slice(0, 8);
    const email = `catalog-bulk-lim-${suffix}@hector.local`;
    const user = await database.client.user.create({
      data: {
        email,
        passwordHash: ownerPasswordHash,
        firstName: 'Bulk',
        lastName: 'Reader',
        status: UserStatus.ACTIVE,
      },
    });
    const role = await database.client.role.create({
      data: {
        companyId: pishtehId,
        name: `Bulk Lim ${suffix}`,
        key: `bulk_lim_${suffix}`,
        description: 'limited',
      },
    });
    const perms = await database.client.permission.findMany({ where: { key: { in: keys } } });
    for (const perm of perms) {
      await database.client.rolePermission.create({
        data: { roleId: role.id, permissionId: perm.id },
      });
    }
    const member = await database.client.companyMember.create({
      data: {
        companyId: pishtehId,
        userId: user.id,
        status: CompanyMemberStatus.ACTIVE,
      },
    });
    await database.client.companyMemberRole.create({
      data: { companyMemberId: member.id, roleId: role.id },
    });
    return {
      email,
      cleanup: async () => {
        await database.client.companyMemberRole.deleteMany({
          where: { companyMemberId: member.id },
        });
        await database.client.companyMember.delete({ where: { id: member.id } });
        await database.client.rolePermission.deleteMany({ where: { roleId: role.id } });
        await database.client.role.delete({ where: { id: role.id } });
        await database.client.user.delete({ where: { id: user.id } });
      },
    };
  }

  it('rejects unauthenticated execute', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/catalog/bulk/execute')
      .set('x-company-id', pishtehId)
      .send({
        operation: 'PRODUCT_DEACTIVATE',
        selection: { mode: 'IDS', ids: [fanSlProductId] },
      })
      .expect(401);
  });

  it('rejects empty QUERY without selectAll', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/catalog/bulk/preview')
      .set('Authorization', `Bearer ${token}`)
      .set('x-company-id', pishtehId)
      .send({
        operation: 'PRODUCT_DEACTIVATE',
        selection: { mode: 'QUERY', query: {} },
      })
      .expect(400);
    expect(res.body.error.code).toBe('BULK_QUERY_UNSAFE');
  });

  it('allows catalog.read preview and denies execute', async () => {
    const limited = await createLimitedUser([PERMISSIONS.CATALOG_READ]);
    try {
      const readerToken = await login(limited.email);
      await request(app.getHttpServer())
        .post('/api/v1/catalog/bulk/preview')
        .set('Authorization', `Bearer ${readerToken}`)
        .set('x-company-id', pishtehId)
        .send({
          operation: 'PRODUCT_DEACTIVATE',
          selection: { mode: 'IDS', ids: [fanSlProductId] },
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/catalog/bulk/execute')
        .set('Authorization', `Bearer ${readerToken}`)
        .set('x-company-id', pishtehId)
        .send({
          operation: 'PRODUCT_DEACTIVATE',
          selection: { mode: 'IDS', ids: [fanSlProductId] },
        })
        .expect(403);
    } finally {
      await limited.cleanup();
    }
  });

  it('changes category by IDS without removing attributes', async () => {
    const beforeAttrs = await request(app.getHttpServer())
      .get(`/api/v1/catalog/products/${fanSsProductId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-company-id', pishtehId)
      .expect(200);

    const res = await request(app.getHttpServer())
      .post('/api/v1/catalog/bulk/execute')
      .set('Authorization', `Bearer ${token}`)
      .set('x-company-id', pishtehId)
      .send({
        operation: 'PRODUCT_CHANGE_CATEGORY',
        selection: { mode: 'IDS', ids: [fanSsProductId] },
        payload: { categoryId: lipstickCategoryId },
      })
      .expect(201);

    expect(res.body.data.succeeded + res.body.data.skipped).toBeGreaterThanOrEqual(1);

    const product = await request(app.getHttpServer())
      .get(`/api/v1/catalog/products/${fanSsProductId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-company-id', pishtehId)
      .expect(200);
    expect(product.body.data.categoryId).toBe(lipstickCategoryId);

    const afterAttrs = await request(app.getHttpServer())
      .get(`/api/v1/catalog/products/${fanSsProductId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-company-id', pishtehId)
      .expect(200);
    expect(afterAttrs.body.data.length).toBe(beforeAttrs.body.data.length);

    // restore category for other tests
    await request(app.getHttpServer())
      .post('/api/v1/catalog/bulk/execute')
      .set('Authorization', `Bearer ${token}`)
      .set('x-company-id', pishtehId)
      .send({
        operation: 'PRODUCT_CHANGE_CATEGORY',
        selection: { mode: 'IDS', ids: [fanSsProductId] },
        payload: { categoryId: sunscreenCategoryId },
      })
      .expect(201);
  });

  it('QUERY deactivate with search filter + exclusions', async () => {
    const code = `BULK-D-${Date.now().toString().slice(-6)}`;
    const created = await request(app.getHttpServer())
      .post('/api/v1/catalog/products')
      .set('Authorization', `Bearer ${token}`)
      .set('x-company-id', pishtehId)
      .send({
        name: `Bulk Deact ${Date.now()}`,
        code,
        brandId: fanomaBrandId,
      })
      .expect(201);
    const productId = created.body.data.id as string;

    const res = await request(app.getHttpServer())
      .post('/api/v1/catalog/bulk/execute')
      .set('Authorization', `Bearer ${token}`)
      .set('x-company-id', pishtehId)
      .send({
        operation: 'PRODUCT_DEACTIVATE',
        selection: {
          mode: 'QUERY',
          query: { search: code, brandId: fanomaBrandId },
          excludedIds: [fanSlProductId],
        },
      })
      .expect(201);

    expect(res.body.data.matched).toBeGreaterThanOrEqual(1);
    expect(res.body.data.succeeded).toBeGreaterThanOrEqual(1);

    const got = await request(app.getHttpServer())
      .get(`/api/v1/catalog/products/${productId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-company-id', pishtehId)
      .expect(200);
    expect(got.body.data.status).toBe('INACTIVE');

    const fanSl = await request(app.getHttpServer())
      .get(`/api/v1/catalog/products/${fanSlProductId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-company-id', pishtehId)
      .expect(200);
    expect(fanSl.body.data.status).toBe('ACTIVE');
  });

  it('never mutates foreign company product ids', async () => {
    const foreign = await database.client.product.findFirst({
      where: { companyId: demoBId },
      select: { id: true, status: true },
    });
    if (!foreign) return;

    const beforeStatus = foreign.status;
    const beforeFanSl = (
      await database.client.product.findUniqueOrThrow({ where: { id: fanSlProductId } })
    ).status;

    const res = await request(app.getHttpServer())
      .post('/api/v1/catalog/bulk/execute')
      .set('Authorization', `Bearer ${token}`)
      .set('x-company-id', pishtehId)
      .send({
        operation: 'PRODUCT_DEACTIVATE',
        selection: { mode: 'IDS', ids: [foreign.id] },
      });

    // Foreign-only selection resolves to empty → 400 BULK_EMPTY_SELECTION
    expect([400, 201]).toContain(res.status);
    if (res.status === 400) {
      expect(res.body.error.code).toBe('BULK_EMPTY_SELECTION');
    }

    const still = await database.client.product.findUniqueOrThrow({ where: { id: foreign.id } });
    expect(still.status).toBe(beforeStatus);
    const fanSl = await database.client.product.findUniqueOrThrow({ where: { id: fanSlProductId } });
    expect(fanSl.status).toBe(beforeFanSl);
  });

  it('sets and removes product attributes (boolean remove ≠ false)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/catalog/bulk/execute')
      .set('Authorization', `Bearer ${token}`)
      .set('x-company-id', pishtehId)
      .send({
        operation: 'PRODUCT_ATTRIBUTE_SET',
        selection: { mode: 'IDS', ids: [fanSsProductId] },
        payload: { attributeId: spfAttributeId, numberValue: 50 },
      })
      .expect(201);

    let attrs = await request(app.getHttpServer())
      .get(`/api/v1/catalog/products/${fanSsProductId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-company-id', pishtehId)
      .expect(200);
    const spf = attrs.body.data.find((a: { attributeId: string }) => a.attributeId === spfAttributeId);
    expect(spf).toBeTruthy();
    expect(Number(spf.numberValue)).toBe(50);

    await request(app.getHttpServer())
      .post('/api/v1/catalog/bulk/execute')
      .set('Authorization', `Bearer ${token}`)
      .set('x-company-id', pishtehId)
      .send({
        operation: 'PRODUCT_ATTRIBUTE_SET',
        selection: { mode: 'IDS', ids: [fanSsProductId] },
        payload: { attributeId: oilFreeAttributeId, booleanValue: true },
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/catalog/bulk/execute')
      .set('Authorization', `Bearer ${token}`)
      .set('x-company-id', pishtehId)
      .send({
        operation: 'PRODUCT_ATTRIBUTE_REMOVE',
        selection: { mode: 'IDS', ids: [fanSsProductId] },
        payload: { attributeId: oilFreeAttributeId },
      })
      .expect(201);

    attrs = await request(app.getHttpServer())
      .get(`/api/v1/catalog/products/${fanSsProductId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-company-id', pishtehId)
      .expect(200);
    const oil = attrs.body.data.find(
      (a: { attributeId: string }) => a.attributeId === oilFreeAttributeId,
    );
    expect(oil).toBeUndefined();
  });

  it('archives SKU via bulk and keeps historical identity', async () => {
    const product = await request(app.getHttpServer())
      .post('/api/v1/catalog/products')
      .set('Authorization', `Bearer ${token}`)
      .set('x-company-id', pishtehId)
      .send({ name: `Bulk SKU Host ${Date.now()}`, code: `BULK-H-${Date.now().toString().slice(-6)}` })
      .expect(201);
    const sku = await request(app.getHttpServer())
      .post(`/api/v1/catalog/products/${product.body.data.id}/skus`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-company-id', pishtehId)
      .send({ code: `BULK-S-${Date.now().toString().slice(-6)}` })
      .expect(201);
    const skuId = sku.body.data.id as string;
    const codeBefore = sku.body.data.code as string;

    await request(app.getHttpServer())
      .post('/api/v1/catalog/bulk/execute')
      .set('Authorization', `Bearer ${token}`)
      .set('x-company-id', pishtehId)
      .send({
        operation: 'SKU_ARCHIVE',
        selection: { mode: 'IDS', ids: [skuId] },
      })
      .expect(201);

    const after = await request(app.getHttpServer())
      .get(`/api/v1/catalog/skus/${skuId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-company-id', pishtehId)
      .expect(200);
    expect(after.body.data.status).toBe('ARCHIVED');
    expect(after.body.data.code).toBe(codeBefore);
  });
});
