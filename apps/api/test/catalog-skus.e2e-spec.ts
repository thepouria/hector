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

describe('Catalog SKU / Variant (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;

  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;

  let pishtehId: string;
  let demoBId: string;
  let demoBProductId: string;
  let demoBSkuId: string;
  let demoBOptionId: string;
  let demoBValueId: string;
  let ownerPasswordHash: string;
  let token: string;

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

    const foreignProduct = await database.client.product.findFirstOrThrow({
      where: { companyId: demoBId, code: 'MIR-LIP' },
    });
    demoBProductId = foreignProduct.id;
    const foreignOption = await database.client.variantOption.findFirstOrThrow({
      where: { companyId: demoBId, productId: demoBProductId },
    });
    demoBOptionId = foreignOption.id;
    demoBValueId = (
      await database.client.variantOptionValue.findFirstOrThrow({
        where: { companyId: demoBId, optionId: demoBOptionId },
      })
    ).id;
    demoBSkuId = (
      await database.client.sku.findFirstOrThrow({
        where: { companyId: demoBId, productId: demoBProductId },
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

  function api(method: 'get' | 'post' | 'patch', path: string, bearer = token) {
    return request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${bearer}`)
      .set('X-Company-Id', pishtehId);
  }

  async function createProduct(label: string): Promise<string> {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const res = await api('post', '/catalog/products')
      .send({ name: `${label} ${stamp}`, code: `P${stamp}` })
      .expect(201);
    return res.body.data.id as string;
  }

  /** Product with option رنگ and values; returns ids. */
  async function createVariantProduct(values: string[]) {
    const productId = await createProduct('Variant Product');
    const optionRes = await api('post', `/catalog/products/${productId}/variant-options`)
      .send({ name: 'رنگ' })
      .expect(201);
    const optionId = optionRes.body.data.id as string;
    const valuesRes = await api('post', `/catalog/variant-options/${optionId}/values`)
      .send({ values })
      .expect(201);
    const valueIds = new Map<string, string>(
      (valuesRes.body.data.values as Array<{ id: string; value: string }>).map((v) => [
        v.value,
        v.id,
      ]),
    );
    return { productId, optionId, valueIds };
  }

  let codeCounter = 0;
  function uniqueCode(prefix: string): string {
    codeCounter += 1;
    return `${prefix}${Date.now()}${codeCounter}`;
  }

  it('denies unauthenticated SKU and variant endpoints', async () => {
    const productId = demoBProductId;
    await request(app.getHttpServer()).get('/api/v1/catalog/skus').expect(401);
    await request(app.getHttpServer())
      .post(`/api/v1/catalog/products/${productId}/skus`)
      .send({ code: 'X' })
      .expect(401);
    await request(app.getHttpServer())
      .get(`/api/v1/catalog/products/${productId}/variant-options`)
      .expect(401);
  });

  it('enforces catalog.read vs catalog.manage on SKU and variant endpoints', async () => {
    const readRole = await database.client.role.create({
      data: {
        companyId: pishtehId,
        key: `sku-read-${Date.now()}`,
        name: 'SKU Read',
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
        email: `sku-read-${Date.now()}@hector.local`,
        firstName: 'Read',
        lastName: 'Only',
        passwordHash: ownerPasswordHash,
        status: UserStatus.ACTIVE,
      },
    });
    const membership = await database.client.companyMember.create({
      data: { companyId: pishtehId, userId: user.id, status: CompanyMemberStatus.ACTIVE },
    });
    await database.client.companyMemberRole.create({
      data: { companyMemberId: membership.id, roleId: readRole.id },
    });

    try {
      const { productId, optionId, valueIds } = await createVariantProduct(['01']);
      const skuRes = await api('post', `/catalog/products/${productId}/skus`)
        .send({ code: uniqueCode('RBAC'), optionValueIds: [valueIds.get('01')] })
        .expect(201);
      const skuId = skuRes.body.data.id as string;
      const valueId = valueIds.get('01')!;

      const reader = await login(user.email);
      await api('get', '/catalog/skus', reader).expect(200);
      await api('get', `/catalog/skus/${skuId}`, reader).expect(200);
      await api('get', `/catalog/products/${productId}/skus`, reader).expect(200);
      await api('get', `/catalog/products/${productId}/variant-options`, reader).expect(200);

      await api('post', `/catalog/products/${productId}/skus`, reader)
        .send({ code: uniqueCode('DENY') })
        .expect(403);
      await api('post', `/catalog/products/${productId}/skus/bulk`, reader)
        .send({ items: [{ code: uniqueCode('DENY') }] })
        .expect(403);
      await api('patch', `/catalog/skus/${skuId}`, reader).send({ name: 'x' }).expect(403);
      await api('post', `/catalog/skus/${skuId}/deactivate`, reader).expect(403);
      await api('post', `/catalog/skus/${skuId}/activate`, reader).expect(403);
      await api('post', `/catalog/skus/${skuId}/archive`, reader).expect(403);
      await api('post', `/catalog/products/${productId}/variant-options`, reader)
        .send({ name: 'Size' })
        .expect(403);
      await api('patch', `/catalog/variant-options/${optionId}`, reader)
        .send({ name: 'Size' })
        .expect(403);
      await api('post', `/catalog/variant-options/${optionId}/values`, reader)
        .send({ values: ['02'] })
        .expect(403);
      await api('patch', `/catalog/variant-option-values/${valueId}`, reader)
        .send({ value: 'zz' })
        .expect(403);
      await api('post', `/catalog/variant-option-values/${valueId}/deactivate`, reader).expect(403);
      await api('post', `/catalog/variant-option-values/${valueId}/activate`, reader).expect(403);
    } finally {
      await database.client.companyMemberRole.deleteMany({
        where: { companyMemberId: membership.id },
      });
      await database.client.companyMember.delete({ where: { id: membership.id } });
      await database.client.rolePermission.deleteMany({ where: { roleId: readRole.id } });
      await database.client.role.delete({ where: { id: readRole.id } });
      await database.client.user.delete({ where: { id: user.id } });
    }
  });

  it('creates a simple SKU and rejects a second one', async () => {
    const productId = await createProduct('Simple Product');
    const code = uniqueCode('simple.');

    const res = await api('post', `/catalog/products/${productId}/skus`)
      .send({ code, name: '  Simple   SKU ' })
      .expect(201);

    expect(res.body.data.code).toBe(code.toUpperCase());
    expect(res.body.data.normalizedCode).toBe(code.toUpperCase());
    expect(res.body.data.name).toBe('Simple SKU');
    expect(res.body.data.variantSignature).toBe('SIMPLE');
    expect(res.body.data.variantValues).toEqual([]);
    expect(res.body.data.status).toBe('ACTIVE');
    expect(res.body.data.product.id).toBe(productId);

    const second = await api('post', `/catalog/products/${productId}/skus`)
      .send({ code: uniqueCode('SIMPLE2') })
      .expect(409);
    expect(second.body.error.code).toBe('SKU_SIMPLE_LIMIT');

    // Client-supplied option values on a product without options are rejected.
    const bad = await api('post', `/catalog/products/${await createProduct('Simple B')}/skus`)
      .send({ code: uniqueCode('SIMPLEX'), optionValueIds: [demoBValueId] })
      .expect(400);
    expect(bad.body.error.code).toBe('SKU_VARIANT_VALUE_NOT_FOUND');
  });

  it('manages variant options/values and creates variant SKUs with duplicate protection', async () => {
    const { productId, optionId, valueIds } = await createVariantProduct([
      '01',
      '02',
      ' 03 ',
      '01',
    ]);
    // Duplicates collapse after normalization; trimmed.
    expect([...valueIds.keys()].sort()).toEqual(['01', '02', '03']);

    // Duplicate option name (normalized) rejected.
    const dupOption = await api('post', `/catalog/products/${productId}/variant-options`)
      .send({ name: ' رنگ ' })
      .expect(409);
    expect(dupOption.body.error.code).toBe('VARIANT_OPTION_NAME_EXISTS');

    // Existing label rejected.
    const dupValue = await api('post', `/catalog/variant-options/${optionId}/values`)
      .send({ values: ['02'] })
      .expect(409);
    expect(dupValue.body.error.code).toBe('VARIANT_VALUE_EXISTS');

    const v01 = valueIds.get('01')!;
    const v02 = valueIds.get('02')!;
    const v03 = valueIds.get('03')!;
    const code = uniqueCode('VAR');

    const created = await api('post', `/catalog/products/${productId}/skus`)
      .send({ code, name: 'رنگ 01', optionValueIds: [v01] })
      .expect(201);
    expect(created.body.data.variantSignature).toBe(`${optionId}:${v01}`);
    expect(created.body.data.variantValues).toEqual([
      expect.objectContaining({
        optionId,
        optionName: 'رنگ',
        optionValueId: v01,
        value: '01',
        isActive: true,
      }),
    ]);

    // Duplicate code (any casing) → 409
    const dupCode = await api('post', `/catalog/products/${productId}/skus`)
      .send({ code: code.toLowerCase(), optionValueIds: [v02] })
      .expect(409);
    expect(dupCode.body.error.code).toBe('SKU_CODE_ALREADY_EXISTS');

    // Duplicate combination → 409
    const dupCombo = await api('post', `/catalog/products/${productId}/skus`)
      .send({ code: uniqueCode('VARB'), optionValueIds: [v01] })
      .expect(409);
    expect(dupCombo.body.error.code).toBe('SKU_VARIANT_ALREADY_EXISTS');

    // Missing selection → 400
    const incomplete = await api('post', `/catalog/products/${productId}/skus`)
      .send({ code: uniqueCode('VARC') })
      .expect(400);
    expect(incomplete.body.error.code).toBe('SKU_VARIANT_INCOMPLETE');

    // Two values for one option → 400
    const multi = await api('post', `/catalog/products/${productId}/skus`)
      .send({ code: uniqueCode('VARD'), optionValueIds: [v02, v03] })
      .expect(400);
    expect(multi.body.error.code).toBe('SKU_VARIANT_DUPLICATE_OPTION');

    // Value from another product → 400
    const other = await createVariantProduct(['A']);
    const cross = await api('post', `/catalog/products/${productId}/skus`)
      .send({ code: uniqueCode('VARE'), optionValueIds: [other.valueIds.get('A')] })
      .expect(400);
    expect(cross.body.error.code).toBe('SKU_VARIANT_VALUE_NOT_FOUND');

    // Adding another option after SKUs exist is blocked.
    const blocked = await api('post', `/catalog/products/${productId}/variant-options`)
      .send({ name: 'Size' })
      .expect(409);
    expect(blocked.body.error.code).toBe('VARIANT_OPTION_ADD_BLOCKED');

    // Inactive values cannot be newly assigned, but existing links survive deactivation.
    await api('post', `/catalog/variant-option-values/${v02}/deactivate`).expect(201);
    const inactive = await api('post', `/catalog/products/${productId}/skus`)
      .send({ code: uniqueCode('VARF'), optionValueIds: [v02] })
      .expect(409);
    expect(inactive.body.error.code).toBe('SKU_VARIANT_VALUE_INACTIVE');

    await api('post', `/catalog/variant-option-values/${v01}/deactivate`).expect(201);
    const still = await api('get', `/catalog/skus/${created.body.data.id}`).expect(200);
    expect(still.body.data.variantValues[0].isActive).toBe(false);
    expect(still.body.data.variantValues[0].optionValueId).toBe(v01);

    // Reactivate and use.
    await api('post', `/catalog/variant-option-values/${v02}/activate`).expect(201);
    await api('post', `/catalog/variant-option-values/${v01}/activate`).expect(201);
    await api('post', `/catalog/products/${productId}/skus`)
      .send({ code: uniqueCode('VARG'), optionValueIds: [v02] })
      .expect(201);

    const options = await api('get', `/catalog/products/${productId}/variant-options`).expect(200);
    expect(options.body.data).toHaveLength(1);
    expect(options.body.data[0].values.map((v: { value: string }) => v.value)).toEqual([
      '01',
      '02',
      '03',
    ]);
    expect(options.body.data[0].values[0].skuCount).toBe(1);

    // Rename / reorder
    await api('patch', `/catalog/variant-options/${optionId}`)
      .send({ name: 'Shade', position: 2 })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.name).toBe('Shade');
        expect(res.body.data.position).toBe(2);
      });
    await api('patch', `/catalog/variant-option-values/${v03}`)
      .send({ value: 'سه', position: 9 })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.value).toBe('سه');
        expect(res.body.data.position).toBe(9);
      });
    const clash = await api('patch', `/catalog/variant-option-values/${v03}`)
      .send({ value: '01' })
      .expect(409);
    expect(clash.body.error.code).toBe('VARIANT_VALUE_EXISTS');
  });

  it('updates SKU code/name/option values, recomputing signature, with audit metadata', async () => {
    const { productId, optionId, valueIds } = await createVariantProduct(['A', 'B']);
    const a = valueIds.get('A')!;
    const b = valueIds.get('B')!;
    const created = await api('post', `/catalog/products/${productId}/skus`)
      .send({ code: uniqueCode('UPD'), optionValueIds: [a] })
      .expect(201);
    const skuId = created.body.data.id as string;
    const other = await api('post', `/catalog/products/${productId}/skus`)
      .send({ code: uniqueCode('UPDO'), optionValueIds: [b] })
      .expect(201);

    // Moving onto an occupied combination fails.
    const clash = await api('patch', `/catalog/skus/${skuId}`)
      .send({ optionValueIds: [b] })
      .expect(409);
    expect(clash.body.error.code).toBe('SKU_VARIANT_ALREADY_EXISTS');

    // Archive the other SKU: its combination remains reserved.
    await api('post', `/catalog/skus/${other.body.data.id}/archive`).expect(201);
    const stillClash = await api('patch', `/catalog/skus/${skuId}`)
      .send({ optionValueIds: [b] })
      .expect(409);
    expect(stillClash.body.error.code).toBe('SKU_VARIANT_ALREADY_EXISTS');

    // Free the combination by adding a value C and moving there.
    const valuesRes = await api('post', `/catalog/variant-options/${optionId}/values`)
      .send({ values: ['C'] })
      .expect(201);
    const c = (valuesRes.body.data.values as Array<{ id: string; value: string }>).find(
      (v) => v.value === 'C',
    )!.id;

    const newCode = uniqueCode('UPDN');
    const updated = await api('patch', `/catalog/skus/${skuId}`)
      .send({ code: newCode, name: 'Renamed', optionValueIds: [c] })
      .expect(200);
    expect(updated.body.data.code).toBe(newCode);
    expect(updated.body.data.name).toBe('Renamed');
    expect(updated.body.data.variantSignature).toBe(`${optionId}:${c}`);
    expect(updated.body.data.variantValues[0].optionValueId).toBe(c);

    // Name null clears; empty payload rejected.
    await api('patch', `/catalog/skus/${skuId}`)
      .send({ name: null })
      .expect(200)
      .expect((res) => expect(res.body.data.name).toBeNull());
    await api('patch', `/catalog/skus/${skuId}`).send({}).expect(400);

    const audit = await database.client.auditLog.findMany({
      where: { companyId: pishtehId, entityType: 'SKU', entityId: skuId, action: 'SKU_UPDATED' },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit.length).toBeGreaterThanOrEqual(2);
    const withOptions = audit.find((entry) => {
      const metadata = entry.metadata as Record<string, unknown> | null;
      return metadata && 'newOptionValueIds' in metadata;
    });
    expect(withOptions).toBeDefined();
    const metadata = withOptions!.metadata as Record<string, unknown>;
    expect(metadata.oldOptionValueIds).toEqual([a]);
    expect(metadata.newOptionValueIds).toEqual([c]);
    expect(metadata.oldCode).toBeDefined();
  });

  it('isolates companies for products, SKUs, options and values', async () => {
    await api('get', `/catalog/products/${demoBProductId}/skus`).expect(404);
    await api('post', `/catalog/products/${demoBProductId}/skus`)
      .send({ code: uniqueCode('XCO') })
      .expect(404);
    await api('post', `/catalog/products/${demoBProductId}/skus/bulk`)
      .send({ items: [{ code: uniqueCode('XCO') }] })
      .expect(404);
    await api('get', `/catalog/products/${demoBProductId}/variant-options`).expect(404);
    await api('post', `/catalog/products/${demoBProductId}/variant-options`)
      .send({ name: 'Hijack' })
      .expect(404);
    await api('get', `/catalog/skus/${demoBSkuId}`).expect(404);
    await api('patch', `/catalog/skus/${demoBSkuId}`).send({ name: 'x' }).expect(404);
    await api('post', `/catalog/skus/${demoBSkuId}/archive`).expect(404);
    await api('patch', `/catalog/variant-options/${demoBOptionId}`).send({ name: 'x' }).expect(404);
    await api('post', `/catalog/variant-options/${demoBOptionId}/values`)
      .send({ values: ['x'] })
      .expect(404);
    await api('patch', `/catalog/variant-option-values/${demoBValueId}`)
      .send({ value: 'x' })
      .expect(404);
    await api('post', `/catalog/variant-option-values/${demoBValueId}/deactivate`).expect(404);

    // Foreign value id inside our product's SKU request.
    const { productId } = await createVariantProduct(['01']);
    const cross = await api('post', `/catalog/products/${productId}/skus`)
      .send({ code: uniqueCode('XCV'), optionValueIds: [demoBValueId] })
      .expect(400);
    expect(cross.body.error.code).toBe('SKU_VARIANT_VALUE_NOT_FOUND');

    // Global list never leaks foreign SKUs.
    const list = await api('get', '/catalog/skus').query({ pageSize: 100, search: 'MIR-LIP' }).expect(200);
    expect(list.body.data).toEqual([]);
  });

  it('bulk create is all-or-nothing', async () => {
    const { productId, optionId, valueIds } = await createVariantProduct(['01', '02', '03', '04']);
    const ids = ['01', '02', '03', '04'].map((v) => valueIds.get(v)!);
    const prefix = uniqueCode('BULK');

    // Pre-existing SKU holding code BULK-3.
    const holder = await createVariantProduct(['01']);
    await api('post', `/catalog/products/${holder.productId}/skus`)
      .send({ code: `${prefix}-3`, optionValueIds: [holder.valueIds.get('01')] })
      .expect(201);

    // Code conflict on the 3rd item → nothing is created.
    const conflict = await api('post', `/catalog/products/${productId}/skus/bulk`)
      .send({
        items: ids.slice(0, 3).map((id, i) => ({
          code: `${prefix}-${i + 1}`,
          name: `رنگ ${i + 1}`,
          optionValueIds: [id],
        })),
      })
      .expect(409);
    expect(conflict.body.error.code).toBe('SKU_CODE_ALREADY_EXISTS');
    expect(await database.client.sku.count({ where: { productId } })).toBe(0);

    // Duplicate codes inside request.
    const dupCode = await api('post', `/catalog/products/${productId}/skus/bulk`)
      .send({
        items: [
          { code: `${prefix}-A`, optionValueIds: [ids[0]] },
          { code: `${prefix}-a`, optionValueIds: [ids[1]] },
        ],
      })
      .expect(400);
    expect(dupCode.body.error.code).toBe('BULK_SKU_DUPLICATE_IN_REQUEST');

    // Duplicate combination inside request.
    const dupCombo = await api('post', `/catalog/products/${productId}/skus/bulk`)
      .send({
        items: [
          { code: `${prefix}-B1`, optionValueIds: [ids[0]] },
          { code: `${prefix}-B2`, optionValueIds: [ids[0]] },
        ],
      })
      .expect(400);
    expect(dupCombo.body.error.code).toBe('BULK_SKU_DUPLICATE_IN_REQUEST');

    // Invalid selection in the middle.
    const incomplete = await api('post', `/catalog/products/${productId}/skus/bulk`)
      .send({
        items: [
          { code: `${prefix}-C1`, optionValueIds: [ids[0]] },
          { code: `${prefix}-C2` },
        ],
      })
      .expect(400);
    expect(incomplete.body.error.code).toBe('SKU_VARIANT_INCOMPLETE');
    expect(incomplete.body.error.details).toEqual({ index: 1 });
    expect(await database.client.sku.count({ where: { productId } })).toBe(0);

    // Batch size limit.
    const tooMany = await api('post', `/catalog/products/${productId}/skus/bulk`)
      .send({ items: Array.from({ length: 251 }, (_, i) => ({ code: `${prefix}-L${i}` })) })
      .expect(400);
    expect(tooMany.body.error.code).toBe('BULK_SKU_LIMIT_EXCEEDED');

    // Valid batch.
    const ok = await api('post', `/catalog/products/${productId}/skus/bulk`)
      .send({
        items: ids.map((id, i) => ({
          code: `${prefix}-OK${i + 1}`,
          name: `رنگ 0${i + 1}`,
          optionValueIds: [id],
        })),
      })
      .expect(201);
    expect(ok.body.data).toHaveLength(4);
    expect(ok.body.meta.created).toBe(4);
    expect(await database.client.sku.count({ where: { productId } })).toBe(4);
    expect(
      await database.client.skuOptionValue.count({ where: { companyId: pishtehId, optionId } }),
    ).toBe(4);

    const audits = await database.client.auditLog.count({
      where: {
        companyId: pishtehId,
        action: 'SKU_CREATED',
        entityId: { in: ok.body.data.map((s: { id: string }) => s.id) },
      },
    });
    expect(audits).toBe(4);

    // Re-running the same batch conflicts and creates nothing more.
    await api('post', `/catalog/products/${productId}/skus/bulk`)
      .send({
        items: [{ code: `${prefix}-NEW`, optionValueIds: [ids[0]] }],
      })
      .expect(409);
    expect(await database.client.sku.count({ where: { productId } })).toBe(4);
  });

  it('keeps archived SKU code and combination reserved; lifecycle rules', async () => {
    const { productId, valueIds } = await createVariantProduct(['01']);
    const v01 = valueIds.get('01')!;
    const code = uniqueCode('ARCH');

    const created = await api('post', `/catalog/products/${productId}/skus`)
      .send({ code, optionValueIds: [v01] })
      .expect(201);
    const skuId = created.body.data.id as string;

    await api('post', `/catalog/skus/${skuId}/deactivate`)
      .expect(201)
      .expect((res) => expect(res.body.data.status).toBe('INACTIVE'));
    await api('post', `/catalog/skus/${skuId}/activate`)
      .expect(201)
      .expect((res) => expect(res.body.data.status).toBe('ACTIVE'));

    await api('post', `/catalog/skus/${skuId}/archive`)
      .expect(201)
      .expect((res) => {
        expect(res.body.data.status).toBe('ARCHIVED');
        expect(res.body.data.archivedAt).not.toBeNull();
      });

    // Still readable and listed with status filter.
    const archivedList = await api('get', `/catalog/products/${productId}/skus`)
      .query({ status: 'ARCHIVED' })
      .expect(200);
    expect(archivedList.body.data.map((s: { id: string }) => s.id)).toEqual([skuId]);

    // Code reserved (same company, any product) & combination reserved.
    const otherProduct = await createProduct('Other');
    const codeReuse = await api('post', `/catalog/products/${otherProduct}/skus`)
      .send({ code })
      .expect(409);
    expect(codeReuse.body.error.code).toBe('SKU_CODE_ALREADY_EXISTS');
    const comboReuse = await api('post', `/catalog/products/${productId}/skus`)
      .send({ code: uniqueCode('ARCHB'), optionValueIds: [v01] })
      .expect(409);
    expect(comboReuse.body.error.code).toBe('SKU_VARIANT_ALREADY_EXISTS');

    // Archived SKUs cannot be modified/activated/deactivated; archive is idempotent.
    await api('patch', `/catalog/skus/${skuId}`).send({ name: 'x' }).expect(409);
    const activate = await api('post', `/catalog/skus/${skuId}/activate`).expect(409);
    expect(activate.body.error.code).toBe('SKU_ALREADY_ARCHIVED');
    await api('post', `/catalog/skus/${skuId}/deactivate`).expect(409);
    await api('post', `/catalog/skus/${skuId}/archive`).expect(201);

    const row = await database.client.sku.findFirstOrThrow({ where: { id: skuId } });
    expect(row.code).toBe(code.toUpperCase());
  });

  it('requires an ACTIVE product to create or activate SKUs', async () => {
    const productId = await createProduct('Lifecycle Product');
    const skuRes = await api('post', `/catalog/products/${productId}/skus`)
      .send({ code: uniqueCode('LIFE') })
      .expect(201);
    const skuId = skuRes.body.data.id as string;

    await api('post', `/catalog/skus/${skuId}/deactivate`).expect(201);
    await api('post', `/catalog/products/${productId}/deactivate`).expect(201);

    const blockedCreate = await api('post', `/catalog/products/${productId}/skus`)
      .send({ code: uniqueCode('LIFEB') })
      .expect(409);
    expect(blockedCreate.body.error.code).toBe('PRODUCT_NOT_ACTIVE');

    const blockedBulk = await api('post', `/catalog/products/${productId}/skus/bulk`)
      .send({ items: [{ code: uniqueCode('LIFEC') }] })
      .expect(409);
    expect(blockedBulk.body.error.code).toBe('PRODUCT_NOT_ACTIVE');

    const blockedActivate = await api('post', `/catalog/skus/${skuId}/activate`).expect(409);
    expect(blockedActivate.body.error.code).toBe('SKU_ACTIVATION_BLOCKED');

    await api('post', `/catalog/products/${productId}/activate`).expect(201);
    await api('post', `/catalog/skus/${skuId}/activate`).expect(201);
  });

  it('lists SKUs with pagination, search, status, product filter and sorting', async () => {
    const { productId, valueIds } = await createVariantProduct(['01', '02', '03']);
    const prefix = uniqueCode('LST');
    await api('post', `/catalog/products/${productId}/skus/bulk`)
      .send({
        items: ['01', '02', '03'].map((v) => ({
          code: `${prefix}-${v}`,
          name: `رنگ ${v}`,
          optionValueIds: [valueIds.get(v)],
        })),
      })
      .expect(201);

    const page = await api('get', '/catalog/skus')
      .query({ productId, pageSize: 2, page: 1, sortBy: 'code', sortOrder: 'desc' })
      .expect(200);
    expect(page.body.meta).toEqual({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
    expect(page.body.data.map((s: { code: string }) => s.code)).toEqual([
      `${prefix}-03`.toUpperCase(),
      `${prefix}-02`.toUpperCase(),
    ]);
    expect(page.body.data[0].product.id).toBe(productId);
    expect(page.body.data[0].variantValues).toHaveLength(1);

    const search = await api('get', `/catalog/products/${productId}/skus`)
      .query({ search: `${prefix.toLowerCase()}-02` })
      .expect(200);
    expect(search.body.data).toHaveLength(1);

    const byName = await api('get', '/catalog/skus').query({ productId, search: 'رنگ 03' }).expect(200);
    expect(byName.body.data).toHaveLength(1);

    const inactive = await api('get', '/catalog/skus')
      .query({ productId, status: 'INACTIVE' })
      .expect(200);
    expect(inactive.body.data).toEqual([]);

    await api('get', '/catalog/skus').query({ sortBy: 'bogus' }).expect(400);
  });

  it('serializes concurrent creation of the same variant combination', async () => {
    const { productId, valueIds } = await createVariantProduct(['01']);
    const v = valueIds.get('01')!;
    const results = await Promise.all(
      [1, 2, 3].map((i) =>
        api('post', `/catalog/products/${productId}/skus`).send({
          code: uniqueCode(`RACE${i}-`),
          optionValueIds: [v],
        }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    expect(await database.client.sku.count({ where: { productId } })).toBe(1);
  });

  it('records audit entries for SKU and variant mutations', async () => {
    const { productId, optionId, valueIds } = await createVariantProduct(['01', '02']);
    const v01 = valueIds.get('01')!;
    const created = await api('post', `/catalog/products/${productId}/skus`)
      .send({ code: uniqueCode('AUD'), optionValueIds: [v01] })
      .expect(201);
    const skuId = created.body.data.id as string;

    await api('post', `/catalog/variant-option-values/${valueIds.get('02')}/deactivate`).expect(201);
    await api('post', `/catalog/variant-option-values/${valueIds.get('02')}/activate`).expect(201);
    await api('patch', `/catalog/variant-options/${optionId}`).send({ position: 3 }).expect(200);
    await api('patch', `/catalog/variant-option-values/${v01}`).send({ position: 5 }).expect(200);
    await api('post', `/catalog/skus/${skuId}/deactivate`).expect(201);
    await api('post', `/catalog/skus/${skuId}/activate`).expect(201);
    await api('post', `/catalog/skus/${skuId}/archive`).expect(201);

    const skuActions = (
      await database.client.auditLog.findMany({
        where: { companyId: pishtehId, entityType: 'SKU', entityId: skuId },
      })
    ).map((a) => a.action);
    expect(skuActions).toEqual(
      expect.arrayContaining(['SKU_CREATED', 'SKU_DEACTIVATED', 'SKU_ACTIVATED', 'SKU_ARCHIVED']),
    );

    const optionActions = (
      await database.client.auditLog.findMany({
        where: { companyId: pishtehId, entityType: 'VARIANT_OPTION', entityId: optionId },
      })
    ).map((a) => a.action);
    expect(optionActions).toEqual(
      expect.arrayContaining(['VARIANT_OPTION_CREATED', 'VARIANT_OPTION_UPDATED']),
    );

    const valueActions = (
      await database.client.auditLog.findMany({
        where: {
          companyId: pishtehId,
          entityType: 'VARIANT_OPTION_VALUE',
          entityId: { in: [...valueIds.values()] },
        },
      })
    ).map((a) => a.action);
    expect(valueActions).toEqual(
      expect.arrayContaining([
        'VARIANT_VALUE_CREATED',
        'VARIANT_VALUE_UPDATED',
        'VARIANT_VALUE_DEACTIVATED',
        'VARIANT_VALUE_ACTIVATED',
      ]),
    );
  });
});
