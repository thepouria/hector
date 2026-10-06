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
import { withGtinCheckDigit } from '../src/modules/catalog/barcode-checksum.util';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';

describe('Catalog Barcodes (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;

  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;

  let pishtehId: string;
  let demoBId: string;
  let demoBSkuId: string;
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
    demoBSkuId = (
      await database.client.sku.findFirstOrThrow({
        where: { companyId: demoBId, code: 'MIR-SERUM-01' },
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

  async function createProduct(name: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/catalog/products')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ name, code: `BC-P-${Date.now()}-${Math.floor(Math.random() * 999)}` })
      .expect(201);
    return res.body.data.id as string;
  }

  async function createSku(productId: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/catalog/products/${productId}/skus`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ code: `BC-SKU-${Date.now()}-${Math.floor(Math.random() * 999)}` })
      .expect(201);
    return res.body.data.id as string;
  }

  async function createLimitedUser(
    keys: string[],
  ): Promise<{ email: string; cleanup: () => Promise<void> }> {
    const email = `bc-limited-${Date.now()}@hector.local`;
    const user = await database.client.user.create({
      data: {
        email,
        passwordHash: ownerPasswordHash,
        firstName: 'BC',
        lastName: 'Limited',
        status: UserStatus.ACTIVE,
      },
    });
    const role = await database.client.role.create({
      data: { companyId: pishtehId, key: `BC_LIM_${Date.now()}`, name: 'BC Limited', isSystem: false },
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

  it('denies unauthenticated barcode endpoints', async () => {
    await request(app.getHttpServer()).post('/api/v1/catalog/barcodes/resolve').send({ value: 'x' }).expect(401);
  });

  it('enforces catalog.read vs catalog.manage', async () => {
    const reader = await createLimitedUser([PERMISSIONS.CATALOG_READ]);
    const readerToken = await login(reader.email);
    const productId = await createProduct('BC Perm Product');
    const skuId = await createSku(productId);

    await request(app.getHttpServer())
      .get(`/api/v1/catalog/skus/${skuId}/barcodes`)
      .set('Authorization', `Bearer ${readerToken}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/catalog/skus/${skuId}/barcodes`)
      .set('Authorization', `Bearer ${readerToken}`)
      .set('X-Company-Id', pishtehId)
      .send({ value: 'x', type: 'OTHER' })
      .expect(403);

    await reader.cleanup();
  });

  it('creates EAN13, sets primary, generates INTERNAL, archives with promotion', async () => {
    const productId = await createProduct('BC Lifecycle Product');
    const skuId = await createSku(productId);
    // 12-digit body must be unique across company (incl. prior e2e runs).
    const body12 = `6261${String(Date.now()).slice(-8)}`;
    const ean = withGtinCheckDigit(body12);

    const created = await request(app.getHttpServer())
      .post(`/api/v1/catalog/skus/${skuId}/barcodes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ value: ean, type: 'EAN13' })
      .expect(201);

    expect(created.body.data.isPrimary).toBe(true);
    expect(created.body.data.type).toBe('EAN13');

    const internal = await request(app.getHttpServer())
      .post(`/api/v1/catalog/skus/${skuId}/barcodes/generate-internal`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(201);

    expect(internal.body.data.type).toBe('INTERNAL');
    expect(internal.body.data.isPrimary).toBe(false);
    expect(internal.body.data.value).toMatch(/^HCT-[0-9A-F]{16}$/);

    await request(app.getHttpServer())
      .post(`/api/v1/catalog/skus/${skuId}/barcodes/generate-internal`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(409);

    await request(app.getHttpServer())
      .post(`/api/v1/catalog/barcodes/${internal.body.data.id}/set-primary`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(201);

    const afterPrimary = await request(app.getHttpServer())
      .get(`/api/v1/catalog/skus/${skuId}/barcodes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);

    const primary = afterPrimary.body.data.filter((b: { isPrimary: boolean }) => b.isPrimary);
    expect(primary).toHaveLength(1);
    expect(primary[0].id).toBe(internal.body.data.id);

    await request(app.getHttpServer())
      .post(`/api/v1/catalog/barcodes/${internal.body.data.id}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(201);

    const afterArchive = await request(app.getHttpServer())
      .get(`/api/v1/catalog/skus/${skuId}/barcodes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);

    const activePrimary = afterArchive.body.data.find(
      (b: { isPrimary: boolean; archivedAt: string | null }) =>
        b.isPrimary && b.archivedAt === null,
    );
    expect(activePrimary?.id).toBe(created.body.data.id);

    await request(app.getHttpServer())
      .post('/api/v1/catalog/barcodes/resolve')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ value: internal.body.data.value })
      .expect(409);

    // Archived value cannot be reused on another SKU
    const otherSku = await createSku(await createProduct('BC Reuse Product'));
    const reuse = await request(app.getHttpServer())
      .post(`/api/v1/catalog/skus/${otherSku}/barcodes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ value: internal.body.data.value, type: 'INTERNAL' })
      .expect(409);
    expect(reuse.body.error.code).toBe('BARCODE_ALREADY_EXISTS');

    const audit = await database.client.auditLog.findMany({
      where: {
        companyId: pishtehId,
        entityType: 'BARCODE',
        action: { in: ['BARCODE_CREATED', 'BARCODE_INTERNAL_GENERATED', 'BARCODE_PRIMARY_CHANGED', 'BARCODE_ARCHIVED'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    expect(audit.length).toBeGreaterThanOrEqual(3);
  });

  it('rejects invalid checksum and foreign SKU', async () => {
    const skuId = await createSku(await createProduct('BC Invalid Product'));
    const bad = await request(app.getHttpServer())
      .post(`/api/v1/catalog/skus/${skuId}/barcodes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ value: '4006381333932', type: 'EAN13' })
      .expect(400);
    expect(bad.body.error.code).toBe('BARCODE_INVALID_CHECKSUM');

    await request(app.getHttpServer())
      .post(`/api/v1/catalog/skus/${demoBSkuId}/barcodes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ value: 'X', type: 'OTHER' })
      .expect(404);
  });

  it('resolves seeded barcode and returns SKU status without inventing stock', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/catalog/barcodes/resolve')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ value: '6261000000016' })
      .expect(200);

    expect(res.body.data.sku.code).toBe('FAN-SL-01');
    expect(res.body.data.product.code).toBe('FAN-SL');
    expect(res.body.data.sku.status).toBe('ACTIVE');
    expect(res.body.data).not.toHaveProperty('inventory');
    expect(res.body.data).not.toHaveProperty('stock');
  });

  it('isolates resolve by company for shared barcode values', async () => {
    const shared = '6261000000016';
    const a = await request(app.getHttpServer())
      .post('/api/v1/catalog/barcodes/resolve')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ value: shared })
      .expect(200);
    const b = await request(app.getHttpServer())
      .post('/api/v1/catalog/barcodes/resolve')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', demoBId)
      .send({ value: shared })
      .expect(200);
    expect(a.body.data.sku.id).not.toBe(b.body.data.sku.id);
  });
});
