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

describe('Catalog Attributes (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;

  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;

  let pishtehId: string;
  let demoBId: string;
  let demoBProductId: string;
  let demoBSkuId: string;
  let demoBSpfAttributeId: string;
  let ownerPasswordHash: string;
  let token: string;

  let seededSunscreenCategoryId: string;
  let seededSunscreenProductId: string;
  let seededPrimerProductId: string;
  let seededSpfAttributeId: string;
  let seededVolumeAttributeId: string;
  let seededSkinTypeAttributeId: string;
  let seededShadeHexAttributeId: string;
  let seededSolidSkuId: string;

  beforeAll(async () => {
    app = await createE2eApp();
    database = app.get(DatabaseService);
    await syncPermissions(database.client);
    await syncOwnerRolePermissions(database.client);

    pishtehId = (await database.client.company.findUniqueOrThrow({ where: { slug: 'pishteh' } }))
      .id;
    demoBId = (
      await database.client.company.findUniqueOrThrow({ where: { slug: 'hector-demo-b' } })
    ).id;

    demoBProductId = (
      await database.client.product.findFirstOrThrow({
        where: { companyId: demoBId, code: 'MIR-SERUM' },
      })
    ).id;
    demoBSkuId = (
      await database.client.sku.findFirstOrThrow({
        where: { companyId: demoBId, code: 'MIR-SERUM-01' },
      })
    ).id;
    demoBSpfAttributeId = (
      await database.client.attributeDefinition.findFirstOrThrow({
        where: { companyId: demoBId, normalizedCode: 'spf' },
      })
    ).id;

    seededSunscreenCategoryId = (
      await database.client.category.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'SUNSCREEN' },
      })
    ).id;
    seededSunscreenProductId = (
      await database.client.product.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'FAN-SUN' },
      })
    ).id;
    seededPrimerProductId = (
      await database.client.product.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'FAN-PRIMER' },
      })
    ).id;
    seededSpfAttributeId = (
      await database.client.attributeDefinition.findFirstOrThrow({
        where: { companyId: pishtehId, normalizedCode: 'spf' },
      })
    ).id;
    seededVolumeAttributeId = (
      await database.client.attributeDefinition.findFirstOrThrow({
        where: { companyId: pishtehId, normalizedCode: 'volume' },
      })
    ).id;
    seededSkinTypeAttributeId = (
      await database.client.attributeDefinition.findFirstOrThrow({
        where: { companyId: pishtehId, normalizedCode: 'skin_type' },
      })
    ).id;
    seededShadeHexAttributeId = (
      await database.client.attributeDefinition.findFirstOrThrow({
        where: { companyId: pishtehId, normalizedCode: 'shade_hex' },
      })
    ).id;
    seededSolidSkuId = (
      await database.client.sku.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'FAN-SL-01' },
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
    const email = `attr-limited-${Date.now()}@hector.local`;
    const user = await database.client.user.create({
      data: {
        email,
        passwordHash: ownerPasswordHash,
        firstName: 'Attr',
        lastName: 'Limited',
        status: UserStatus.ACTIVE,
      },
    });
    const role = await database.client.role.create({
      data: {
        companyId: pishtehId,
        key: `ATTR_LIM_${Date.now()}`,
        name: 'Attr Limited',
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

  async function createProduct(name: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/catalog/products')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ name, code: `ATTR-P-${Date.now()}-${Math.floor(Math.random() * 9999)}` })
      .expect(201);
    return res.body.data.id as string;
  }

  it('denies unauthenticated attribute endpoints', async () => {
    await request(app.getHttpServer()).get('/api/v1/catalog/attributes').expect(401);
    await request(app.getHttpServer())
      .put(`/api/v1/catalog/products/${seededPrimerProductId}/attributes`)
      .send({ attributes: [] })
      .expect(401);
  });

  it('enforces catalog.read vs catalog.manage on attributes', async () => {
    const reader = await createLimitedUser([PERMISSIONS.CATALOG_READ]);
    const readerToken = await login(reader.email);

    await request(app.getHttpServer())
      .get('/api/v1/catalog/attributes')
      .set('Authorization', `Bearer ${readerToken}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/catalog/attributes')
      .set('Authorization', `Bearer ${readerToken}`)
      .set('X-Company-Id', pishtehId)
      .send({
        name: 'Reader Blocked',
        code: `reader_blocked_${Date.now()}`,
        type: 'TEXT',
        scope: 'PRODUCT',
      })
      .expect(403);

    await reader.cleanup();
  });

  it('creates an attribute definition and select options', async () => {
    const code = `e2e_finish_${Date.now()}`;
    const created = await request(app.getHttpServer())
      .post('/api/v1/catalog/attributes')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({
        name: 'E2E Finish',
        code,
        type: 'SINGLE_SELECT',
        scope: 'PRODUCT',
      })
      .expect(201);

    expect(created.body.data.code).toBe(code);
    expect(created.body.data.type).toBe('SINGLE_SELECT');

    const option = await request(app.getHttpServer())
      .post(`/api/v1/catalog/attributes/${created.body.data.id}/options`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ value: 'Matte demo' })
      .expect(201);

    expect(option.body.data.value).toBe('Matte demo');
    expect(option.body.data.isActive).toBe(true);
  });

  it('allows product create without attribute values (regression)', async () => {
    const productId = await createProduct('Attr Regression Product');
    const attrs = await request(app.getHttpServer())
      .get(`/api/v1/catalog/products/${productId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);
    expect(attrs.body.data).toEqual([]);
  });

  it('replaces product attributes partially and clears with an empty array', async () => {
    const productId = await createProduct('Attr Partial Product');

    await request(app.getHttpServer())
      .put(`/api/v1/catalog/products/${productId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({
        attributes: [
          { attributeId: seededSpfAttributeId, numberValue: 30 },
          { attributeId: seededVolumeAttributeId, numberValue: 100 },
        ],
      })
      .expect(200);

    await request(app.getHttpServer())
      .put(`/api/v1/catalog/products/${productId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({
        attributes: [{ attributeId: seededSpfAttributeId, numberValue: 45 }],
      })
      .expect(200);

    const partial = await request(app.getHttpServer())
      .get(`/api/v1/catalog/products/${productId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);

    expect(partial.body.data).toHaveLength(1);
    expect(partial.body.data[0].numberValue).toBe('45');

    await request(app.getHttpServer())
      .put(`/api/v1/catalog/products/${productId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ attributes: [] })
      .expect(200);

    const cleared = await request(app.getHttpServer())
      .get(`/api/v1/catalog/products/${productId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);
    expect(cleared.body.data).toEqual([]);
  });

  it('rejects invalid numbers and treats missing number as clear', async () => {
    const productId = await createProduct('Attr Number Product');

    const invalidNumber = await request(app.getHttpServer())
      .put(`/api/v1/catalog/products/${productId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({
        attributes: [{ attributeId: seededSpfAttributeId, numberValue: 'not-a-number' }],
      })
      .expect(400);
    expect(invalidNumber.body.error.code).toBe('VALIDATION_ERROR');

    await request(app.getHttpServer())
      .put(`/api/v1/catalog/products/${productId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({
        attributes: [
          { attributeId: seededSpfAttributeId, numberValue: 15 },
          { attributeId: seededVolumeAttributeId, numberValue: 50 },
        ],
      })
      .expect(200);

    await request(app.getHttpServer())
      .put(`/api/v1/catalog/products/${productId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({
        attributes: [{ attributeId: seededSpfAttributeId, numberValue: 15 }],
      })
      .expect(200);

    const after = await request(app.getHttpServer())
      .get(`/api/v1/catalog/products/${productId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);
    expect(after.body.data).toHaveLength(1);
    expect(after.body.data[0].attributeId).toBe(seededSpfAttributeId);
  });

  it('persists boolean false distinctly from unspecified and clear removes the row', async () => {
    const productId = await createProduct('Attr Boolean Product');
    const oilFreeId = (
      await database.client.attributeDefinition.findFirstOrThrow({
        where: { companyId: pishtehId, normalizedCode: 'oil_free' },
      })
    ).id;

    await request(app.getHttpServer())
      .put(`/api/v1/catalog/products/${productId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({
        attributes: [{ attributeId: oilFreeId, booleanValue: false }],
      })
      .expect(200);

    const withFalse = await request(app.getHttpServer())
      .get(`/api/v1/catalog/products/${productId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);
    expect(withFalse.body.data[0].booleanValue).toBe(false);

    await request(app.getHttpServer())
      .put(`/api/v1/catalog/products/${productId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ attributes: [{ attributeId: oilFreeId }] })
      .expect(200);

    const cleared = await request(app.getHttpServer())
      .get(`/api/v1/catalog/products/${productId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);
    expect(cleared.body.data).toEqual([]);
  });

  it('validates multi-select option rules', async () => {
    const productId = await createProduct('Attr Multi Product');
    const skinOptions = await database.client.attributeOption.findMany({
      where: { attributeDefinitionId: seededSkinTypeAttributeId },
      orderBy: { position: 'asc' },
    });
    const first = skinOptions[0]!;
    const second = skinOptions[1]!;
    const finishAttr = await database.client.attributeDefinition.findFirstOrThrow({
      where: { companyId: pishtehId, normalizedCode: 'finish' },
    });
    const finishOption = await database.client.attributeOption.findFirstOrThrow({
      where: { attributeDefinitionId: finishAttr.id },
    });

    await request(app.getHttpServer())
      .put(`/api/v1/catalog/products/${productId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({
        attributes: [
          {
            attributeId: seededSkinTypeAttributeId,
            optionIds: [first.id, second.id],
          },
        ],
      })
      .expect(200);

    await request(app.getHttpServer())
      .put(`/api/v1/catalog/products/${productId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({
        attributes: [{ attributeId: seededSkinTypeAttributeId, optionIds: [] }],
      })
      .expect(200);

    const foreignOption = await request(app.getHttpServer())
      .put(`/api/v1/catalog/products/${productId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({
        attributes: [
          {
            attributeId: seededSkinTypeAttributeId,
            optionIds: ['00000000-0000-4000-8000-000000000099'],
          },
        ],
      })
      .expect(404);
    expect(foreignOption.body.error.code).toBe('ATTRIBUTE_OPTION_NOT_FOUND');

    const wrongAttr = await request(app.getHttpServer())
      .put(`/api/v1/catalog/products/${productId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({
        attributes: [
          {
            attributeId: seededSkinTypeAttributeId,
            optionIds: [finishOption.id],
          },
          {
            attributeId: finishAttr.id,
            optionIds: [finishOption.id],
          },
        ],
      })
      .expect(400);
    expect(wrongAttr.body.error.code).toBe('ATTRIBUTE_OPTION_WRONG_ATTRIBUTE');

    const deactivated = await request(app.getHttpServer())
      .post(`/api/v1/catalog/attribute-options/${first.id}/deactivate`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(201);

    expect(deactivated.body.data.isActive).toBe(false);

    const inactiveSelect = await request(app.getHttpServer())
      .put(`/api/v1/catalog/products/${productId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({
        attributes: [
          {
            attributeId: seededSkinTypeAttributeId,
            optionIds: [first.id],
          },
        ],
      })
      .expect(400);
    expect(inactiveSelect.body.error.code).toBe('ATTRIBUTE_OPTION_INACTIVE');

    await request(app.getHttpServer())
      .post(`/api/v1/catalog/attribute-options/${first.id}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(201);
  });

  it('enforces attribute scope between product and SKU targets', async () => {
    const productId = await createProduct('Attr Scope Product');

    const productOnSku = await request(app.getHttpServer())
      .put(`/api/v1/catalog/skus/${seededSolidSkuId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({
        attributes: [{ attributeId: seededSpfAttributeId, numberValue: 10 }],
      })
      .expect(400);
    expect(productOnSku.body.error.code).toBe('ATTRIBUTE_SCOPE_MISMATCH');

    const skuOnProduct = await request(app.getHttpServer())
      .put(`/api/v1/catalog/products/${productId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({
        attributes: [{ attributeId: seededShadeHexAttributeId, textValue: '#FFFFFF' }],
      })
      .expect(400);
    expect(skuOnProduct.body.error.code).toBe('ATTRIBUTE_SCOPE_MISMATCH');
  });

  it('loads category suggested attributes and allows ignoring all suggestions', async () => {
    const suggested = await request(app.getHttpServer())
      .get(`/api/v1/catalog/categories/${seededSunscreenCategoryId}/suggested-attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);

    const codes = suggested.body.data.map((row: { attribute: { code: string } }) => row.attribute.code);
    expect(codes).toEqual(expect.arrayContaining(['spf', 'skin_type', 'volume']));

    await request(app.getHttpServer())
      .put(`/api/v1/catalog/products/${seededSunscreenProductId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ attributes: [] })
      .expect(200);

    const after = await request(app.getHttpServer())
      .get(`/api/v1/catalog/products/${seededSunscreenProductId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);
    expect(after.body.data).toEqual([]);
  });

  it('allows product attributes that are not assigned to the product category', async () => {
    const productId = await createProduct('Attr Extra Product');
    const originId = (
      await database.client.attributeDefinition.findFirstOrThrow({
        where: { companyId: pishtehId, normalizedCode: 'country_of_origin' },
      })
    ).id;

    await request(app.getHttpServer())
      .put(`/api/v1/catalog/products/${productId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({
        attributes: [{ attributeId: originId, textValue: 'Iran' }],
      })
      .expect(200);

    const stored = await request(app.getHttpServer())
      .get(`/api/v1/catalog/products/${productId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);
    expect(stored.body.data[0].textValue).toBe('Iran');
  });

  it('keeps archived attribute values readable but blocks new assignments', async () => {
    const code = `archive_me_${Date.now()}`;
    const attr = await request(app.getHttpServer())
      .post('/api/v1/catalog/attributes')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({
        name: 'Archive Me',
        code,
        type: 'NUMBER',
        scope: 'PRODUCT',
      })
      .expect(201);

    const productId = await createProduct('Attr Archive Product');
    await request(app.getHttpServer())
      .put(`/api/v1/catalog/products/${productId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({
        attributes: [{ attributeId: attr.body.data.id, numberValue: 7 }],
      })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/catalog/attributes/${attr.body.data.id}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(201);

    const readable = await request(app.getHttpServer())
      .get(`/api/v1/catalog/products/${productId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);
    expect(readable.body.data[0].numberValue).toBe('7');

    const blocked = await request(app.getHttpServer())
      .put(`/api/v1/catalog/products/${productId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({
        attributes: [{ attributeId: attr.body.data.id, numberValue: 8 }],
      })
      .expect(400);
    expect(blocked.body.error.code).toBe('ATTRIBUTE_NOT_ACTIVE');
  });

  it('blocks attribute type changes when values or options exist', async () => {
    const withOption = await request(app.getHttpServer())
      .post('/api/v1/catalog/attributes')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({
        name: 'Type Block Select',
        code: `type_block_sel_${Date.now()}`,
        type: 'SINGLE_SELECT',
        scope: 'PRODUCT',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/catalog/attributes/${withOption.body.data.id}/options`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ value: 'Only' })
      .expect(201);

    const blockedByOption = await request(app.getHttpServer())
      .patch(`/api/v1/catalog/attributes/${withOption.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ type: 'TEXT' })
      .expect(400);
    expect(blockedByOption.body.error.code).toBe('ATTRIBUTE_TYPE_CHANGE_BLOCKED');

    const withValue = await request(app.getHttpServer())
      .post('/api/v1/catalog/attributes')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({
        name: 'Type Block Number',
        code: `type_block_num_${Date.now()}`,
        type: 'NUMBER',
        scope: 'PRODUCT',
      })
      .expect(201);

    const productId = await createProduct('Type Block Product');
    await request(app.getHttpServer())
      .put(`/api/v1/catalog/products/${productId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({
        attributes: [{ attributeId: withValue.body.data.id, numberValue: 1 }],
      })
      .expect(200);

    const blockedByValue = await request(app.getHttpServer())
      .patch(`/api/v1/catalog/attributes/${withValue.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ type: 'TEXT' })
      .expect(400);
    expect(blockedByValue.body.error.code).toBe('ATTRIBUTE_TYPE_CHANGE_BLOCKED');
  });

  it('isolates attributes and entity writes by company tenant', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/catalog/attributes/${demoBSpfAttributeId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(404);

    await request(app.getHttpServer())
      .put(`/api/v1/catalog/products/${demoBProductId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ attributes: [] })
      .expect(404);

    await request(app.getHttpServer())
      .put(`/api/v1/catalog/skus/${demoBSkuId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({ attributes: [] })
      .expect(404);
  });

  it('records audit entries for attribute create and product attribute updates', async () => {
    const code = `audit_attr_${Date.now()}`;
    const created = await request(app.getHttpServer())
      .post('/api/v1/catalog/attributes')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({
        name: 'Audit Attr',
        code,
        type: 'TEXT',
        scope: 'PRODUCT',
      })
      .expect(201);

    const productId = await createProduct('Audit Attr Product');
    await request(app.getHttpServer())
      .put(`/api/v1/catalog/products/${productId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .send({
        attributes: [{ attributeId: created.body.data.id, textValue: 'Logged' }],
      })
      .expect(200);

    const audit = await database.client.auditLog.findMany({
      where: {
        companyId: pishtehId,
        OR: [
          {
            entityType: 'ATTRIBUTE_DEFINITION',
            entityId: created.body.data.id,
            action: 'ATTRIBUTE_CREATED',
          },
          {
            entityType: 'PRODUCT_ATTRIBUTES',
            entityId: productId,
            action: 'PRODUCT_ATTRIBUTES_UPDATED',
          },
        ],
      },
    });
    expect(audit.length).toBeGreaterThanOrEqual(2);
  });

  it('exposes seeded primer product with zero attribute values', async () => {
    const attrs = await request(app.getHttpServer())
      .get(`/api/v1/catalog/products/${seededPrimerProductId}/attributes`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);
    expect(attrs.body.data).toEqual([]);
  });
});
