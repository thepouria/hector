import request from 'supertest';
import {
  CatalogLifecycleStatus,
  CompanyMemberStatus,
  CurrencyCode,
  PERMISSIONS,
  PurchasingLifecycleStatus,
  UserStatus,
  syncOwnerRolePermissions,
  syncPermissions,
} from '@hector/database';
import type { INestApplication } from '@nestjs/common';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { DOMAIN_EVENTS, DomainEventBus } from '../src/infrastructure/events';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';
import { createPartyLinkedSupplier } from './helpers/party-linked-supplier';

const BASE = '/api/v1/purchasing/purchase-orders';
const NUMBER_RE = /^PO-\d{4}-\d{6,}$/;

describe('Purchase Orders (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let eventBus: DomainEventBus;
  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;
  let ownerId: string;
  let ownerPasswordHash: string;
  let pishtehId: string;
  let demoBId: string;
  let tehranSupplierId: string;
  let cosmeticsSupplierId: string;
  let tehranContactId: string;
  let mascaraSkuId: string;
  let conc1SkuId: string;
  let conc2SkuId: string;
  let conc3SkuId: string;
  let conc4SkuId: string;
  let archiveSkuId: string;
  let demoBSupplierId: string;
  let demoBSkuId: string;
  let demoBPoId: string;
  let demoBPoItemId: string;
  let demoBOfferId: string;

  beforeAll(async () => {
    app = await createE2eApp();
    database = app.get(DatabaseService);
    eventBus = app.get(DomainEventBus);
    await syncPermissions(database.client);
    await syncOwnerRolePermissions(database.client);

    const db = database.client;
    pishtehId = (await db.company.findUniqueOrThrow({ where: { slug: 'pishteh' } })).id;
    demoBId = (await db.company.findUniqueOrThrow({ where: { slug: 'hector-demo-b' } })).id;
    tehranSupplierId = (
      await db.supplier.findFirstOrThrow({ where: { companyId: pishtehId, code: 'TEH-BEAUTY' } })
    ).id;
    cosmeticsSupplierId = (
      await db.supplier.findFirstOrThrow({ where: { companyId: pishtehId, code: 'TEH-COSMETICS' } })
    ).id;
    tehranContactId = (
      await db.supplierContact.findFirstOrThrow({
        where: { companyId: pishtehId, supplierId: tehranSupplierId, archivedAt: null },
      })
    ).id;
    const sku = async (code: string, companyId = pishtehId) =>
      (await db.sku.findFirstOrThrow({ where: { companyId, code } })).id;
    mascaraSkuId = await sku('ESS-MASCARA-01');
    conc1SkuId = await sku('FAN-CONC-01');
    conc2SkuId = await sku('FAN-CONC-02');
    conc3SkuId = await sku('FAN-CONC-03');
    conc4SkuId = await sku('FAN-CONC-04');
    archiveSkuId = await sku('FAN-LL-12');
    demoBSupplierId = (
      await db.supplier.findFirstOrThrow({ where: { companyId: demoBId, code: 'DEMO-SUP-B' } })
    ).id;
    demoBSkuId = await sku('MIR-SERUM-01', demoBId);
    demoBOfferId = (await db.supplierOffer.findFirstOrThrow({ where: { companyId: demoBId } })).id;

    const owner = await db.user.update({
      where: { email: ownerEmail },
      data: { status: UserStatus.ACTIVE, deletedAt: null },
    });
    ownerId = owner.id;
    ownerPasswordHash = owner.passwordHash;

    // Foreign-company PO for IDOR checks.
    const foreign = await db.purchaseOrder.create({
      data: {
        companyId: demoBId,
        number: `SEED-IDOR-${Date.now()}`,
        supplierId: demoBSupplierId,
        currency: CurrencyCode.IRR,
        orderDate: new Date(),
        subtotal: 1000000,
        total: 1000000,
        createdById: ownerId,
      },
    });
    const foreignItem = await db.purchaseOrderItem.create({
      data: {
        companyId: demoBId,
        purchaseOrderId: foreign.id,
        skuId: demoBSkuId,
        quantity: 1,
        unitPrice: 1000000,
        lineSubtotal: 1000000,
      },
    });
    demoBPoId = foreign.id;
    demoBPoItemId = foreignItem.id;
  });

  afterAll(async () => {
    await database.client.sku.update({
      where: { id: archiveSkuId },
      data: { status: CatalogLifecycleStatus.ACTIVE, archivedAt: null },
    });
    await app.close();
  });

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return res.body.data.accessToken as string;
  }

  function auth(token: string, companyId = pishtehId) {
    return { Authorization: `Bearer ${token}`, 'X-Company-Id': companyId };
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

  type ItemInput = {
    skuId: string;
    quantity: number;
    unitPrice: string;
    supplierOfferId?: string;
    notes?: string;
  };

  function draftBody(overrides: Record<string, unknown> = {}) {
    return {
      supplierId: tehranSupplierId,
      currency: 'IRR',
      purchaseType: 'CASH',
      items: [{ skuId: mascaraSkuId, quantity: 1000, unitPrice: '5850000' }] as ItemInput[],
      ...overrides,
    };
  }

  async function createPo(token: string, overrides: Record<string, unknown> = {}) {
    const res = await request(app.getHttpServer())
      .post(BASE)
      .set(auth(token))
      .send(draftBody(overrides))
      .expect(201);
    return res.body.data as {
      id: string;
      number: string;
      version: number;
      status: string;
      total: string;
      subtotal: string;
      items: Array<{ id: string; skuId: string; lineSubtotal: string; quantity: number }>;
    };
  }

  async function newSupplier(label = 'PO Supplier', status: PurchasingLifecycleStatus = 'ACTIVE') {
    return createPartyLinkedSupplier(database.client, { companyId: pishtehId, name: `${label} ${Date.now()}-${Math.random()}`, status });
  }

  async function newOffer(input: {
    supplierId: string;
    skuId: string;
    unitPrice?: string;
    currency?: CurrencyCode;
    archived?: boolean;
  }) {
    return database.client.supplierOffer.create({
      data: {
        companyId: pishtehId,
        supplierId: input.supplierId,
        skuId: input.skuId,
        unitPrice: input.unitPrice ?? '5850000',
        currency: input.currency ?? CurrencyCode.IRR,
        quotedAt: new Date(),
        createdById: ownerId,
        archivedAt: input.archived ? new Date() : null,
      },
    });
  }

  async function makeUser(permissionKeys: string[]) {
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const role = await database.client.role.create({
      data: { companyId: pishtehId, key: `po-role-${stamp}`, name: `PO ${stamp}`, isSystem: false },
    });
    for (const key of permissionKeys) {
      const permission = await database.client.permission.findUniqueOrThrow({ where: { key } });
      await database.client.rolePermission.create({
        data: { roleId: role.id, permissionId: permission.id },
      });
    }
    const user = await database.client.user.create({
      data: {
        email: `po-${stamp}@hector.local`,
        firstName: 'PO',
        lastName: 'Tester',
        passwordHash: ownerPasswordHash,
        status: UserStatus.ACTIVE,
      },
    });
    const membership = await database.client.companyMember.create({
      data: { companyId: pishtehId, userId: user.id, status: CompanyMemberStatus.ACTIVE },
    });
    await database.client.companyMemberRole.create({
      data: { companyMemberId: membership.id, roleId: role.id },
    });
    return login(user.email);
  }

  // -------------------------------------------------------------------------

  it('creates a DRAFT PO with multiple items and server-computed totals', async () => {
    const token = await login(ownerEmail);
    const res = await request(app.getHttpServer())
      .post(BASE)
      .set(auth(token))
      .send(
        draftBody({
          supplierContactId: tehranContactId,
          notes: '  سفارش آزمایشی  ',
          expectedAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
          items: [
            { skuId: mascaraSkuId, quantity: 1000, unitPrice: '4930000', notes: 'کارتن اول' },
            { skuId: conc1SkuId, quantity: 4440, unitPrice: '5250000' },
          ],
        }),
      )
      .expect(201);

    const po = res.body.data;
    expect(po.number).toMatch(NUMBER_RE);
    expect(po.status).toBe('DRAFT');
    expect(po.version).toBe(1);
    expect(po.currency).toBe('IRR');
    expect(po.itemCount).toBe(2);
    expect(po.notes).toBe('سفارش آزمایشی');
    expect(po.supplierContact.id).toBe(tehranContactId);
    expect(po.supplierNameSnapshot).toBeNull();
    expect(po.items[0].skuCodeSnapshot).toBeNull();
    expect(po.items[0].lineSubtotal).toBe('4930000000');
    expect(po.items[1].lineSubtotal).toBe('23310000000');
    expect(po.subtotal).toBe('28240000000');
    expect(po.total).toBe('28240000000');
    expect(po.createdBy.id).toBe(ownerId);

    const detail = await request(app.getHttpServer())
      .get(`${BASE}/${po.id}`)
      .set(auth(token))
      .expect(200);
    expect(detail.body.data.items).toHaveLength(2);
    expect(detail.body.data.items[0].sku.code).toBe('ESS-MASCARA-01');
    expect(detail.body.data.supplier.code).toBe('TEH-BEAUTY');
  });

  it('rejects invalid quantities, prices, and empty item lists', async () => {
    const token = await login(ownerEmail);
    const bad = async (body: Record<string, unknown>, status = 400) =>
      request(app.getHttpServer()).post(BASE).set(auth(token)).send(body).expect(status);

    const one = (patch: Partial<ItemInput> | Record<string, unknown>) => ({
      items: [{ skuId: mascaraSkuId, quantity: 1, unitPrice: '1000', ...patch }],
    });

    await bad(draftBody({ items: [] }));
    await bad({ supplierId: tehranSupplierId, currency: 'IRR' });
    await bad(draftBody(one({ quantity: 0 })));
    await bad(draftBody(one({ quantity: -3 })));
    await bad(draftBody(one({ quantity: 1.5 })));
    await bad(draftBody(one({ quantity: '5' })));
    await bad(draftBody(one({ quantity: 10_000_001 })));
    await bad(draftBody(one({ unitPrice: '0' })));
    await bad(draftBody(one({ unitPrice: '-10' })));
    await bad(draftBody(one({ unitPrice: 'abc' })));
    await bad(draftBody(one({ unitPrice: 1000 })));
    await bad(draftBody(one({ unitPrice: '1000.5' }))); // IRR whole rials only
    await bad(draftBody({ currency: 'USD', ...one({ unitPrice: '1.1234567' }) }));
    await bad(draftBody({ currency: 'EUR' }));
    await bad(draftBody({ expectedAt: '2020-01-01T00:00:00.000Z', orderDate: '2026-01-01T00:00:00.000Z' }));

    const price = await request(app.getHttpServer())
      .post(BASE)
      .set(auth(token))
      .send(draftBody(one({ unitPrice: '0' })))
      .expect(400);
    expect(price.body.error.code).toBe('PURCHASE_ORDER_INVALID_PRICE');
  });

  it('keeps USD precision exact', async () => {
    const token = await login(ownerEmail);
    const po = await createPo(token, {
      currency: 'USD',
      items: [
        { skuId: mascaraSkuId, quantity: 3, unitPrice: '1.10' },
        { skuId: conc1SkuId, quantity: 7, unitPrice: '0.333333' },
        { skuId: conc2SkuId, quantity: 1, unitPrice: '0.000001' },
      ],
    });
    expect(po.items.map((i) => i.lineSubtotal)).toEqual(['3.3', '2.333331', '0.000001']);
    expect(po.subtotal).toBe('5.633332');
    expect(po.total).toBe('5.633332');
  });

  it('never trusts client-supplied totals, status, number, or ownership fields', async () => {
    const token = await login(ownerEmail);
    for (const extra of [
      { subtotal: '1', total: '1' },
      { status: 'ORDERED' },
      { number: 'PO-1999-000001' },
      { version: 99 },
      { companyId: demoBId },
      { createdById: demoBId },
      { approvedById: ownerId },
      { supplierNameSnapshot: 'Hacked' },
    ]) {
      await request(app.getHttpServer())
        .post(BASE)
        .set(auth(token))
        .send(draftBody(extra))
        .expect(400);
    }
    // Nested line fields
    await request(app.getHttpServer())
      .post(BASE)
      .set(auth(token))
      .send(
        draftBody({
          items: [{ skuId: mascaraSkuId, quantity: 2, unitPrice: '1000', lineSubtotal: '1' }],
        }),
      )
      .expect(400);

    const po = await createPo(token, {
      items: [{ skuId: mascaraSkuId, quantity: 2, unitPrice: '1000' }],
    });
    expect(po.total).toBe('2000');

    for (const extra of [
      { total: '1' },
      { subtotal: '1' },
      { status: 'APPROVED' },
      { number: 'X' },
      { version: 2 },
    ]) {
      await request(app.getHttpServer())
        .patch(`${BASE}/${po.id}`)
        .set(auth(token))
        .send({ notes: 'x', ...extra })
        .expect(400);
    }
    await request(app.getHttpServer())
      .patch(`${BASE}/${po.id}/items/${po.items[0]!.id}`)
      .set(auth(token))
      .send({ lineSubtotal: '1' })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`${BASE}/${po.id}/items/${po.items[0]!.id}`)
      .set(auth(token))
      .send({ skuId: conc1SkuId })
      .expect(400);

    const after = await request(app.getHttpServer()).get(`${BASE}/${po.id}`).set(auth(token));
    expect(after.body.data.total).toBe('2000');
    expect(after.body.data.status).toBe('DRAFT');
  });

  it('blocks cross-company supplier / SKU / contact / offer references (IDOR)', async () => {
    const token = await login(ownerEmail);
    const post = (body: Record<string, unknown>) =>
      request(app.getHttpServer()).post(BASE).set(auth(token)).send(body);

    await post(draftBody({ supplierId: demoBSupplierId })).expect(404);
    await post(
      draftBody({ items: [{ skuId: demoBSkuId, quantity: 1, unitPrice: '1000' }] }),
    ).expect(404);
    await post(
      draftBody({
        items: [
          { skuId: mascaraSkuId, quantity: 1, unitPrice: '1000', supplierOfferId: demoBOfferId },
        ],
      }),
    ).expect(404);

    const foreignContact = await database.client.supplierContact.create({
      data: { companyId: demoBId, supplierId: demoBSupplierId, name: 'Foreign PO contact' },
    });
    await post(draftBody({ supplierContactId: foreignContact.id })).expect(400);

    const own = await createPo(token);
    await request(app.getHttpServer())
      .post(`${BASE}/${own.id}/items`)
      .set(auth(token))
      .send({ skuId: demoBSkuId, quantity: 1, unitPrice: '1000' })
      .expect(404);
    await request(app.getHttpServer())
      .delete(`${BASE}/${own.id}/items/${own.items[0]!.id}`)
      .set(auth(token))
      .expect(200);
    await request(app.getHttpServer())
      .patch(`${BASE}/${own.id}`)
      .set(auth(token))
      .send({ supplierId: demoBSupplierId })
      .expect(404);
  });

  it('blocks PO and item IDOR across companies and across purchase orders', async () => {
    const token = await login(ownerEmail);
    const h = auth(token);
    await request(app.getHttpServer()).get(`${BASE}/${demoBPoId}`).set(h).expect(404);
    await request(app.getHttpServer()).patch(`${BASE}/${demoBPoId}`).set(h).send({ notes: 'x' }).expect(404);
    await request(app.getHttpServer())
      .post(`${BASE}/${demoBPoId}/items`)
      .set(h)
      .send({ skuId: mascaraSkuId, quantity: 1, unitPrice: '1000' })
      .expect(404);
    await request(app.getHttpServer())
      .patch(`${BASE}/${demoBPoId}/items/${demoBPoItemId}`)
      .set(h)
      .send({ quantity: 9 })
      .expect(404);
    await request(app.getHttpServer())
      .delete(`${BASE}/${demoBPoId}/items/${demoBPoItemId}`)
      .set(h)
      .expect(404);
    await request(app.getHttpServer()).post(`${BASE}/${demoBPoId}/approve`).set(h).expect(404);
    await request(app.getHttpServer()).post(`${BASE}/${demoBPoId}/mark-ordered`).set(h).expect(404);
    await request(app.getHttpServer()).post(`${BASE}/${demoBPoId}/cancel`).set(h).expect(404);

    // Item belonging to another PO of the same company is not addressable via this PO.
    const a = await createPo(token);
    const b = await createPo(token);
    await request(app.getHttpServer())
      .patch(`${BASE}/${a.id}/items/${b.items[0]!.id}`)
      .set(h)
      .send({ quantity: 5 })
      .expect(404);
    await request(app.getHttpServer())
      .delete(`${BASE}/${a.id}/items/${b.items[0]!.id}`)
      .set(h)
      .expect(404);

    // The foreign PO is untouched.
    const row = await database.client.purchaseOrder.findUniqueOrThrow({ where: { id: demoBPoId } });
    expect(row.status).toBe('DRAFT');
    expect(row.version).toBe(1);

    // Other-company token cannot see Pishteh POs either.
    await request(app.getHttpServer()).get(`${BASE}/not-a-uuid`).set(h).expect(400);
    const list = await request(app.getHttpServer()).get(BASE).query({ pageSize: 100 }).set(h).expect(200);
    expect(list.body.data.some((row: { id: string }) => row.id === demoBPoId)).toBe(false);
    const demoBList = await request(app.getHttpServer())
      .get(BASE)
      .query({ pageSize: 100 })
      .set(auth(token, demoBId))
      .expect(200);
    expect(demoBList.body.data.every((row: { companyId: string }) => row.companyId === demoBId)).toBe(true);
  });

  it('validates offer links: wrong supplier / SKU / currency / archived rejected, price may differ', async () => {
    const token = await login(ownerEmail);
    const supplier = await newSupplier('Offer link');
    const goodOffer = await newOffer({ supplierId: supplier.id, skuId: mascaraSkuId, unitPrice: '5850000' });
    const otherSupplierOffer = await newOffer({ supplierId: cosmeticsSupplierId, skuId: mascaraSkuId });
    const otherSkuOffer = await newOffer({ supplierId: supplier.id, skuId: conc1SkuId });
    const usdOffer = await newOffer({
      supplierId: supplier.id,
      skuId: mascaraSkuId,
      unitPrice: '1.5',
      currency: CurrencyCode.USD,
    });
    const archivedOffer = await newOffer({ supplierId: supplier.id, skuId: mascaraSkuId, archived: true });

    const withOffer = (supplierOfferId: string, extra: Record<string, unknown> = {}) =>
      draftBody({
        supplierId: supplier.id,
        items: [{ skuId: mascaraSkuId, quantity: 10, unitPrice: '5000000', supplierOfferId }],
        ...extra,
      });

    for (const id of [otherSupplierOffer.id, otherSkuOffer.id, usdOffer.id, archivedOffer.id]) {
      const res = await request(app.getHttpServer())
        .post(BASE)
        .set(auth(token))
        .send(withOffer(id))
        .expect(400);
      expect(res.body.error.code).toBe('PURCHASE_ORDER_OFFER_INVALID');
    }

    // PO price (5,000,000) differs from the quote (5,850,000): allowed.
    const ok = await request(app.getHttpServer())
      .post(BASE)
      .set(auth(token))
      .send(withOffer(goodOffer.id))
      .expect(201);
    expect(ok.body.data.items[0].unitPrice).toBe('5000000');
    expect(ok.body.data.items[0].supplierOffer.unitPrice).toBe('5850000');
    expect(ok.body.data.items[0].supplierOfferId).toBe(goodOffer.id);

    // add / update item offer links are validated the same way.
    const po = ok.body.data;
    await request(app.getHttpServer())
      .post(`${BASE}/${po.id}/items`)
      .set(auth(token))
      .send({ skuId: conc1SkuId, quantity: 1, unitPrice: '100', supplierOfferId: goodOffer.id })
      .expect(400);
    const added = await request(app.getHttpServer())
      .post(`${BASE}/${po.id}/items`)
      .set(auth(token))
      .send({ skuId: conc1SkuId, quantity: 1, unitPrice: '100', supplierOfferId: otherSkuOffer.id })
      .expect(201);
    const addedItem = added.body.data.items.find((i: { skuId: string }) => i.skuId === conc1SkuId);
    await request(app.getHttpServer())
      .patch(`${BASE}/${po.id}/items/${addedItem.id}`)
      .set(auth(token))
      .send({ supplierOfferId: otherSupplierOffer.id })
      .expect(400);
    const cleared = await request(app.getHttpServer())
      .patch(`${BASE}/${po.id}/items/${addedItem.id}`)
      .set(auth(token))
      .send({ supplierOfferId: null })
      .expect(200);
    expect(
      cleared.body.data.items.find((i: { id: string }) => i.id === addedItem.id).supplierOfferId,
    ).toBeNull();
  });

  it('rejects duplicate SKUs on create and add', async () => {
    const token = await login(ownerEmail);
    const dup = await request(app.getHttpServer())
      .post(BASE)
      .set(auth(token))
      .send(
        draftBody({
          items: [
            { skuId: mascaraSkuId, quantity: 1, unitPrice: '1000' },
            { skuId: mascaraSkuId, quantity: 2, unitPrice: '1000' },
          ],
        }),
      )
      .expect(409);
    expect(dup.body.error.code).toBe('PURCHASE_ORDER_DUPLICATE_SKU');

    const po = await createPo(token);
    const again = await request(app.getHttpServer())
      .post(`${BASE}/${po.id}/items`)
      .set(auth(token))
      .send({ skuId: mascaraSkuId, quantity: 1, unitPrice: '1000' })
      .expect(409);
    expect(again.body.error.code).toBe('PURCHASE_ORDER_DUPLICATE_SKU');
  });

  it('edits a DRAFT: header, add / update / remove items, totals always recomputed', async () => {
    const token = await login(ownerEmail);
    const h = auth(token);
    const po = await createPo(token);
    expect(po.total).toBe('5850000000');

    const added = await request(app.getHttpServer())
      .post(`${BASE}/${po.id}/items`)
      .set(h)
      .send({ skuId: conc2SkuId, quantity: 10, unitPrice: '2000000', notes: 'یادداشت' })
      .expect(201);
    expect(added.body.data.total).toBe('5870000000');
    expect(added.body.data.itemCount).toBe(2);
    expect(added.body.data.version).toBe(po.version + 1);
    const conc2Item = added.body.data.items.find((i: { skuId: string }) => i.skuId === conc2SkuId);

    const updated = await request(app.getHttpServer())
      .patch(`${BASE}/${po.id}/items/${conc2Item.id}`)
      .set(h)
      .send({ quantity: 20, unitPrice: '2500000' })
      .expect(200);
    const updatedItem = updated.body.data.items.find((i: { id: string }) => i.id === conc2Item.id);
    expect(updatedItem.lineSubtotal).toBe('50000000');
    expect(updated.body.data.total).toBe('5900000000');

    await request(app.getHttpServer()).patch(`${BASE}/${po.id}/items/${conc2Item.id}`).set(h).send({}).expect(400);
    await request(app.getHttpServer())
      .patch(`${BASE}/${po.id}/items/${conc2Item.id}`)
      .set(h)
      .send({ quantity: 0 })
      .expect(400);

    const removed = await request(app.getHttpServer())
      .delete(`${BASE}/${po.id}/items/${conc2Item.id}`)
      .set(h)
      .expect(200);
    expect(removed.body.data.total).toBe('5850000000');
    expect(removed.body.data.itemCount).toBe(1);

    const expectedAt = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const header = await request(app.getHttpServer())
      .patch(`${BASE}/${po.id}`)
      .set(h)
      .send({ notes: 'ویرایش شد', expectedAt, supplierContactId: tehranContactId })
      .expect(200);
    expect(header.body.data.notes).toBe('ویرایش شد');
    expect(new Date(header.body.data.expectedAt).toISOString()).toBe(expectedAt);
    expect(header.body.data.supplierContact.id).toBe(tehranContactId);

    const cleared = await request(app.getHttpServer())
      .patch(`${BASE}/${po.id}`)
      .set(h)
      .send({ notes: null, expectedAt: null, supplierContactId: null })
      .expect(200);
    expect(cleared.body.data.notes).toBeNull();
    expect(cleared.body.data.expectedAt).toBeNull();
    expect(cleared.body.data.supplierContact).toBeNull();

    await request(app.getHttpServer()).patch(`${BASE}/${po.id}`).set(h).send({}).expect(400);
    await request(app.getHttpServer())
      .patch(`${BASE}/${po.id}`)
      .set(h)
      .send({ expectedAt: '2000-01-01T00:00:00.000Z' })
      .expect(400);
  });

  it('rejects supplier / currency change while items exist, allows it on an emptied draft', async () => {
    const token = await login(ownerEmail);
    const h = auth(token);
    const po = await createPo(token);

    const supplierChange = await request(app.getHttpServer())
      .patch(`${BASE}/${po.id}`)
      .set(h)
      .send({ supplierId: cosmeticsSupplierId })
      .expect(409);
    expect(supplierChange.body.error.code).toBe('PURCHASE_ORDER_PARTY_LOCKED');
    await request(app.getHttpServer()).patch(`${BASE}/${po.id}`).set(h).send({ currency: 'USD' }).expect(409);

    // Same value is a no-op, not a change.
    await request(app.getHttpServer())
      .patch(`${BASE}/${po.id}`)
      .set(h)
      .send({ supplierId: tehranSupplierId, currency: 'IRR', notes: 'ok' })
      .expect(200);

    await request(app.getHttpServer()).delete(`${BASE}/${po.id}/items/${po.items[0]!.id}`).set(h).expect(200);
    const emptied = await request(app.getHttpServer())
      .patch(`${BASE}/${po.id}`)
      .set(h)
      .send({ supplierId: cosmeticsSupplierId, currency: 'USD' })
      .expect(200);
    expect(emptied.body.data.supplier.id).toBe(cosmeticsSupplierId);
    expect(emptied.body.data.currency).toBe('USD');
    expect(emptied.body.data.total).toBe('0');

    // An empty draft cannot be approved.
    const empty = await request(app.getHttpServer()).post(`${BASE}/${po.id}/approve`).set(h).expect(409);
    expect(empty.body.error.code).toBe('PURCHASE_ORDER_EMPTY');

    // Switching supplier clears the previous supplier's contact.
    const withContact = await createPo(token, { supplierContactId: tehranContactId });
    await request(app.getHttpServer())
      .delete(`${BASE}/${withContact.id}/items/${withContact.items[0]!.id}`)
      .set(h)
      .expect(200);
    const switched = await request(app.getHttpServer())
      .patch(`${BASE}/${withContact.id}`)
      .set(h)
      .send({ supplierId: cosmeticsSupplierId })
      .expect(200);
    expect(switched.body.data.supplierContact).toBeNull();
  });

  it('runs DRAFT -> APPROVED -> ORDERED and freezes snapshots only at ORDERED', async () => {
    const token = await login(ownerEmail);
    const h = auth(token);
    const po = await createPo(token, {
      items: [
        { skuId: mascaraSkuId, quantity: 100, unitPrice: '5850000' },
        { skuId: conc3SkuId, quantity: 5, unitPrice: '2000000' },
      ],
    });

    const approved = await request(app.getHttpServer()).post(`${BASE}/${po.id}/approve`).set(h).expect(201);
    expect(approved.body.data.status).toBe('APPROVED');
    expect(approved.body.data.version).toBe(po.version + 1);
    expect(approved.body.data.approvedBy.id).toBe(ownerId);
    expect(approved.body.data.approvedAt).toBeTruthy();
    expect(approved.body.data.supplierNameSnapshot).toBeNull();
    expect(approved.body.data.items.every((i: { skuCodeSnapshot: string | null }) => i.skuCodeSnapshot === null)).toBe(true);

    const ordered = await request(app.getHttpServer()).post(`${BASE}/${po.id}/mark-ordered`).set(h).expect(201);
    const data = ordered.body.data;
    expect(data.status).toBe('ORDERED');
    expect(data.version).toBe(po.version + 2);
    expect(data.orderedBy.id).toBe(ownerId);
    expect(data.orderedAt).toBeTruthy();
    expect(data.supplierNameSnapshot).toBe('پخش تهران');
    expect(data.supplierCodeSnapshot).toBe('TEH-BEAUTY');
    const mascara = data.items.find((i: { skuId: string }) => i.skuId === mascaraSkuId);
    expect(mascara.skuCodeSnapshot).toBe('ESS-MASCARA-01');
    expect(mascara.productNameSnapshot).toContain('Essence');
    expect(mascara.productIdSnapshot).toBe(mascara.sku.product.id);
    expect(data.total).toBe('595000000');
  });

  it('applies edit restrictions on APPROVED, ORDERED and CANCELLED', async () => {
    const token = await login(ownerEmail);
    const h = auth(token);

    const lockedChecks = async (po: { id: string; items: Array<{ id: string }> }, notesAllowed: boolean) => {
      await request(app.getHttpServer())
        .post(`${BASE}/${po.id}/items`)
        .set(h)
        .send({ skuId: conc4SkuId, quantity: 1, unitPrice: '1000' })
        .expect(409);
      await request(app.getHttpServer())
        .patch(`${BASE}/${po.id}/items/${po.items[0]!.id}`)
        .set(h)
        .send({ quantity: 1 })
        .expect(409);
      await request(app.getHttpServer()).delete(`${BASE}/${po.id}/items/${po.items[0]!.id}`).set(h).expect(409);
      for (const patch of [
        { supplierId: cosmeticsSupplierId },
        { currency: 'USD' },
        { supplierContactId: null },
        { orderDate: new Date().toISOString() },
      ]) {
        const res = await request(app.getHttpServer()).patch(`${BASE}/${po.id}`).set(h).send(patch).expect(409);
        expect(res.body.error.code).toBe('PURCHASE_ORDER_NOT_EDITABLE');
      }
      await request(app.getHttpServer())
        .patch(`${BASE}/${po.id}`)
        .set(h)
        .send({ notes: 'metadata only' })
        .expect(notesAllowed ? 200 : 409);
    };

    const approvedPo = await createPo(token);
    await request(app.getHttpServer()).post(`${BASE}/${approvedPo.id}/approve`).set(h).expect(201);
    await lockedChecks(approvedPo, true);
    const meta = await request(app.getHttpServer())
      .patch(`${BASE}/${approvedPo.id}`)
      .set(h)
      .send({ expectedAt: new Date(Date.now() + 86_400_000).toISOString() })
      .expect(200);
    expect(meta.body.data.status).toBe('APPROVED');

    const orderedPo = await createPo(token);
    await request(app.getHttpServer()).post(`${BASE}/${orderedPo.id}/approve`).set(h).expect(201);
    await request(app.getHttpServer()).post(`${BASE}/${orderedPo.id}/mark-ordered`).set(h).expect(201);
    await lockedChecks(orderedPo, true);
    const row = await database.client.purchaseOrder.findUniqueOrThrow({
      where: { id: orderedPo.id },
      include: { items: true },
    });
    expect(row.total.toString()).toBe('5850000000');
    expect(row.items[0]!.quantity).toBe(1000);

    const cancelledPo = await createPo(token);
    await request(app.getHttpServer()).post(`${BASE}/${cancelledPo.id}/cancel`).set(h).send({}).expect(201);
    await lockedChecks(cancelledPo, false);
  });

  it('supports every cancel path and keeps CANCELLED terminal', async () => {
    const token = await login(ownerEmail);
    const h = auth(token);

    const draft = await createPo(token);
    const cancelledDraft = await request(app.getHttpServer())
      .post(`${BASE}/${draft.id}/cancel`)
      .set(h)
      .send({ reason: '  تغییر برنامه خرید  ' })
      .expect(201);
    expect(cancelledDraft.body.data.status).toBe('CANCELLED');
    expect(cancelledDraft.body.data.cancellationReason).toBe('تغییر برنامه خرید');
    expect(cancelledDraft.body.data.cancelledBy.id).toBe(ownerId);
    expect(cancelledDraft.body.data.cancelledAt).toBeTruthy();

    const approved = await createPo(token);
    await request(app.getHttpServer()).post(`${BASE}/${approved.id}/approve`).set(h).expect(201);
    const missingApprovedReason = await request(app.getHttpServer())
      .post(`${BASE}/${approved.id}/cancel`)
      .set(h)
      .send({})
      .expect(400);
    expect(missingApprovedReason.body.error.code).toBe('PURCHASE_ORDER_CANCELLATION_REASON_REQUIRED');
    const cancelledApproved = await request(app.getHttpServer())
      .post(`${BASE}/${approved.id}/cancel`)
      .set(h)
      .send({ reason: 'قیمت تأمین‌کننده قبل از ثبت سفارش تغییر کرد' })
      .expect(201);
    expect(cancelledApproved.body.data.status).toBe('CANCELLED');
    expect(cancelledApproved.body.data.cancellationReason).toBe(
      'قیمت تأمین‌کننده قبل از ثبت سفارش تغییر کرد',
    );

    const ordered = await createPo(token);
    await request(app.getHttpServer()).post(`${BASE}/${ordered.id}/approve`).set(h).expect(201);
    await request(app.getHttpServer()).post(`${BASE}/${ordered.id}/order`).set(h).send({
      supplierOrderReference: 'WA-REF-1',
    }).expect(201);
    const missingOrderedReason = await request(app.getHttpServer())
      .post(`${BASE}/${ordered.id}/cancel`)
      .set(h)
      .send({})
      .expect(400);
    expect(missingOrderedReason.body.error.code).toBe('PURCHASE_ORDER_CANCELLATION_REASON_REQUIRED');
    const cancelledOrdered = await request(app.getHttpServer())
      .post(`${BASE}/${ordered.id}/cancel`)
      .set(h)
      .send({ reason: 'supplier out of stock' })
      .expect(201);
    expect(cancelledOrdered.body.data.status).toBe('CANCELLED');
    // Snapshots + prior lifecycle metadata survive cancellation.
    expect(cancelledOrdered.body.data.supplierNameSnapshot).toBe('پخش تهران');
    expect(cancelledOrdered.body.data.supplierOrderReference).toBe('WA-REF-1');
    expect(cancelledOrdered.body.data.approvedAt).toBeTruthy();
    expect(cancelledOrdered.body.data.orderedAt).toBeTruthy();

    for (const id of [draft.id, approved.id, ordered.id]) {
      for (const action of ['approve', 'mark-ordered', 'order', 'cancel']) {
        const res = await request(app.getHttpServer())
          .post(`${BASE}/${id}/${action}`)
          .set(h)
          .send(action === 'cancel' ? { reason: 'retry' } : {})
          .expect(409);
        expect(res.body.error.code).toBe('PURCHASE_ORDER_INVALID_STATUS_TRANSITION');
      }
    }

    await request(app.getHttpServer())
      .post(`${BASE}/${draft.id}/cancel`)
      .set(h)
      .send({ reason: 'x'.repeat(1001) })
      .expect(400);
  });

  it('rejects invalid transitions and stale versions', async () => {
    const token = await login(ownerEmail);
    const h = auth(token);
    const po = await createPo(token);

    // DRAFT cannot jump to ORDERED.
    const skip = await request(app.getHttpServer()).post(`${BASE}/${po.id}/mark-ordered`).set(h).expect(409);
    expect(skip.body.error.code).toBe('PURCHASE_ORDER_INVALID_STATUS_TRANSITION');

    // Stale version
    const stale = await request(app.getHttpServer())
      .post(`${BASE}/${po.id}/approve`)
      .set(h)
      .send({ expectedVersion: po.version + 5 })
      .expect(409);
    expect(stale.body.error.code).toBe('PURCHASE_ORDER_VERSION_CONFLICT');
    await request(app.getHttpServer())
      .patch(`${BASE}/${po.id}`)
      .set(h)
      .send({ notes: 'x', expectedVersion: po.version + 5 })
      .expect(409);

    await request(app.getHttpServer())
      .post(`${BASE}/${po.id}/approve`)
      .set(h)
      .send({ expectedVersion: po.version })
      .expect(201);
    await request(app.getHttpServer()).post(`${BASE}/${po.id}/approve`).set(h).expect(409);

    await request(app.getHttpServer()).post(`${BASE}/${po.id}/mark-ordered`).set(h).expect(201);
    await request(app.getHttpServer()).post(`${BASE}/${po.id}/mark-ordered`).set(h).expect(409);
    await request(app.getHttpServer()).post(`${BASE}/${po.id}/approve`).set(h).expect(409);

    // Status cannot be PATCHed.
    await request(app.getHttpServer()).patch(`${BASE}/${po.id}`).set(h).send({ status: 'DRAFT' }).expect(400);
  });

  it('lets exactly one concurrent mark-ordered / approve win', async () => {
    const token = await login(ownerEmail);
    const h = auth(token);

    const po = await createPo(token);
    const approves = await Promise.all(
      [1, 2, 3].map(() => request(app.getHttpServer()).post(`${BASE}/${po.id}/approve`).set(h)),
    );
    expect(approves.map((r) => r.status).sort()).toEqual([201, 409, 409]);

    const results = await Promise.all(
      [1, 2, 3].map(() => request(app.getHttpServer()).post(`${BASE}/${po.id}/mark-ordered`).set(h)),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);

    const row = await database.client.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
    expect(row.status).toBe('ORDERED');
    expect(row.version).toBe(3);
    const audits = await database.client.auditLog.count({
      where: { companyId: pishtehId, entityId: po.id, action: 'PURCHASE_ORDER_ORDERED' },
    });
    expect(audits).toBe(1);
  });

  it('allocates unique sequential numbers, including concurrent creates', async () => {
    const token = await login(ownerEmail);
    const h = auth(token);
    const first = await createPo(token);
    const second = await createPo(token);
    const third = await createPo(token);
    const seq = (n: string) => Number(n.split('-')[2]);
    expect(seq(second.number)).toBe(seq(first.number) + 1);
    expect(seq(third.number)).toBe(seq(second.number) + 1);

    const batch = await Promise.all(
      Array.from({ length: 6 }, () => request(app.getHttpServer()).post(BASE).set(h).send(draftBody())),
    );
    expect(batch.every((r) => r.status === 201)).toBe(true);
    const numbers = batch.map((r) => r.body.data.number as string);
    expect(new Set(numbers).size).toBe(numbers.length);
    const sequences = numbers.map(seq).sort((a, b) => a - b);
    expect(sequences[0]).toBe(seq(third.number) + 1);
    expect(sequences[sequences.length - 1]).toBe(seq(third.number) + numbers.length);

    // Year follows the UTC year of orderDate; the sequence itself is company-wide.
    const old = await createPo(token, { orderDate: '2025-06-01T10:00:00.000Z' });
    expect(old.number).toMatch(/^PO-2025-\d{6}$/);
    expect(seq(old.number)).toBe(seq(third.number) + numbers.length + 1);

    const db = await database.client.purchaseOrder.findMany({
      where: { companyId: pishtehId, number: { in: [first.number, second.number, third.number, ...numbers] } },
    });
    expect(db).toHaveLength(3 + numbers.length);

    // DB-level uniqueness (companyId, number).
    await expect(
      database.client.purchaseOrder.create({
        data: {
          companyId: pishtehId,
          number: first.number,
          supplierId: tehranSupplierId,
          currency: CurrencyCode.IRR,
          orderDate: new Date(),
          subtotal: 0,
          total: 0,
          createdById: ownerId,
        },
      }),
    ).rejects.toThrow();

    // Another company has its own counter (and the same number is legal there).
    const demoSeq = await database.client.purchaseOrderSequence.findUnique({ where: { companyId: demoBId } });
    expect(demoSeq).toBeNull();
  });

  it('keeps ORDERED POs readable after supplier / SKU archive and blocks new use', async () => {
    const token = await login(ownerEmail);
    const h = auth(token);
    const supplier = await newSupplier('Archive After Order');

    const po = await createPo(token, {
      supplierId: supplier.id,
      items: [{ skuId: archiveSkuId, quantity: 2, unitPrice: '1000000' }],
    });
    await request(app.getHttpServer()).post(`${BASE}/${po.id}/approve`).set(h).expect(201);
    await request(app.getHttpServer()).post(`${BASE}/${po.id}/mark-ordered`).set(h).expect(201);

    // Draft that will be blocked later.
    const pendingDraft = await createPo(token, {
      supplierId: supplier.id,
      items: [{ skuId: archiveSkuId, quantity: 1, unitPrice: '1000000' }],
    });
    const approvedPending = await createPo(token, {
      supplierId: supplier.id,
      items: [{ skuId: archiveSkuId, quantity: 1, unitPrice: '1000000' }],
    });
    await request(app.getHttpServer()).post(`${BASE}/${approvedPending.id}/approve`).set(h).expect(201);

    await request(app.getHttpServer()).post(`/api/v1/purchasing/suppliers/${supplier.id}/archive`).set(h).expect(201);
    await database.client.sku.update({
      where: { id: archiveSkuId },
      data: { status: CatalogLifecycleStatus.ARCHIVED, archivedAt: new Date() },
    });

    const read = await request(app.getHttpServer()).get(`${BASE}/${po.id}`).set(h).expect(200);
    expect(read.body.data.status).toBe('ORDERED');
    expect(read.body.data.supplier.status).toBe('ARCHIVED');
    expect(read.body.data.supplierNameSnapshot).toBe(supplier.name);
    expect(read.body.data.items[0].skuCodeSnapshot).toBe('FAN-LL-12');
    expect(read.body.data.items[0].sku.status).toBe('ARCHIVED');
    const listed = await request(app.getHttpServer()).get(BASE).query({ supplierId: supplier.id }).set(h).expect(200);
    expect(listed.body.data.length).toBeGreaterThanOrEqual(3);

    // New uses fail.
    const newPo = await request(app.getHttpServer()).post(BASE).set(h).send(draftBody({ supplierId: supplier.id }));
    expect(newPo.status).toBe(409);
    expect(newPo.body.error.code).toBe('PURCHASE_ORDER_SUPPLIER_NOT_ASSIGNABLE');
    const archivedSku = await request(app.getHttpServer())
      .post(BASE)
      .set(h)
      .send(draftBody({ items: [{ skuId: archiveSkuId, quantity: 1, unitPrice: '1000' }] }))
      .expect(409);
    expect(archivedSku.body.error.code).toBe('PURCHASE_ORDER_SKU_NOT_ASSIGNABLE');
    const healthy = await createPo(token);
    await request(app.getHttpServer())
      .post(`${BASE}/${healthy.id}/items`)
      .set(h)
      .send({ skuId: archiveSkuId, quantity: 1, unitPrice: '1000' })
      .expect(409);

    // Archived parties cannot progress an existing draft / approved PO...
    await request(app.getHttpServer()).post(`${BASE}/${pendingDraft.id}/approve`).set(h).expect(409);
    await request(app.getHttpServer()).post(`${BASE}/${approvedPending.id}/mark-ordered`).set(h).expect(409);
    // ...but they can still be cancelled.
    await request(app.getHttpServer()).post(`${BASE}/${pendingDraft.id}/cancel`).set(h).send({}).expect(201);
    await request(app.getHttpServer())
      .post(`${BASE}/${approvedPending.id}/cancel`)
      .set(h)
      .send({ reason: 'supplier archived before order' })
      .expect(201);

    await database.client.sku.update({
      where: { id: archiveSkuId },
      data: { status: CatalogLifecycleStatus.ACTIVE, archivedAt: null },
    });
  });

  it('enforces RBAC per command', async () => {
    const owner = await login(ownerEmail);
    const { READ, CREATE, MANAGE } = {
      READ: PERMISSIONS.PURCHASING_READ,
      CREATE: PERMISSIONS.PURCHASING_CREATE,
      MANAGE: PERMISSIONS.PURCHASING_MANAGE,
    };
    const readOnly = await makeUser([READ]);
    const creator = await makeUser([READ, CREATE]);
    const manager = await makeUser([READ, MANAGE]);
    const approver = await makeUser([READ, PERMISSIONS.PURCHASING_APPROVE]);
    const canceller = await makeUser([READ, PERMISSIONS.PURCHASING_CANCEL]);
    const noPurchasing = await makeUser([PERMISSIONS.CATALOG_READ]);

    // 401 / company context
    await request(app.getHttpServer()).get(BASE).set({ 'X-Company-Id': pishtehId }).expect(401);
    await request(app.getHttpServer()).get(BASE).set({ Authorization: `Bearer ${owner}` }).expect(400);

    await request(app.getHttpServer()).get(BASE).set(auth(noPurchasing)).expect(403);
    await request(app.getHttpServer()).get(BASE).set(auth(readOnly)).expect(200);
    await request(app.getHttpServer()).post(BASE).set(auth(readOnly)).send(draftBody()).expect(403);

    const created = await request(app.getHttpServer()).post(BASE).set(auth(creator)).send(draftBody()).expect(201);
    const id = created.body.data.id as string;
    const itemId = created.body.data.items[0].id as string;
    await request(app.getHttpServer()).get(`${BASE}/${id}`).set(auth(creator)).expect(200);

    // create-only cannot edit, approve, order or cancel
    await request(app.getHttpServer()).patch(`${BASE}/${id}`).set(auth(creator)).send({ notes: 'x' }).expect(403);
    await request(app.getHttpServer())
      .post(`${BASE}/${id}/items`)
      .set(auth(creator))
      .send({ skuId: conc1SkuId, quantity: 1, unitPrice: '1000' })
      .expect(403);
    await request(app.getHttpServer()).post(`${BASE}/${id}/approve`).set(auth(creator)).expect(403);
    await request(app.getHttpServer()).post(`${BASE}/${id}/mark-ordered`).set(auth(creator)).expect(403);
    await request(app.getHttpServer()).post(`${BASE}/${id}/cancel`).set(auth(creator)).expect(403);

    // manage edits drafts and marks ordered, but cannot approve or cancel
    await request(app.getHttpServer()).patch(`${BASE}/${id}`).set(auth(manager)).send({ notes: 'mgr' }).expect(200);
    await request(app.getHttpServer())
      .patch(`${BASE}/${id}/items/${itemId}`)
      .set(auth(manager))
      .send({ quantity: 2 })
      .expect(200);
    await request(app.getHttpServer())
      .post(`${BASE}/${id}/items`)
      .set(auth(manager))
      .send({ skuId: conc1SkuId, quantity: 1, unitPrice: '1000' })
      .expect(201);
    await request(app.getHttpServer()).post(`${BASE}/${id}/approve`).set(auth(manager)).expect(403);
    await request(app.getHttpServer()).post(`${BASE}/${id}/cancel`).set(auth(manager)).expect(403);
    await request(app.getHttpServer()).post(`${BASE}/${id}/mark-ordered`).set(auth(manager)).expect(409); // still DRAFT

    // approver approves but cannot order, edit or cancel
    await request(app.getHttpServer()).patch(`${BASE}/${id}`).set(auth(approver)).send({ notes: 'x' }).expect(403);
    await request(app.getHttpServer()).post(`${BASE}/${id}/approve`).set(auth(approver)).expect(201);
    await request(app.getHttpServer()).post(`${BASE}/${id}/mark-ordered`).set(auth(approver)).expect(403);
    await request(app.getHttpServer()).post(`${BASE}/${id}/cancel`).set(auth(approver)).expect(403);

    await request(app.getHttpServer()).post(`${BASE}/${id}/mark-ordered`).set(auth(manager)).expect(201);
    await request(app.getHttpServer()).post(`${BASE}/${id}/approve`).set(auth(approver)).expect(409);

    // canceller cancels but cannot approve / order / edit
    await request(app.getHttpServer()).post(`${BASE}/${id}/approve`).set(auth(canceller)).expect(403);
    await request(app.getHttpServer()).patch(`${BASE}/${id}`).set(auth(canceller)).send({ notes: 'x' }).expect(403);
    await request(app.getHttpServer())
      .post(`${BASE}/${id}/cancel`)
      .set(auth(canceller))
      .send({ reason: 'by canceller' })
      .expect(201);

    // Owner holds every permission.
    const ownerPo = await createPo(owner);
    await request(app.getHttpServer()).post(`${BASE}/${ownerPo.id}/approve`).set(auth(owner)).expect(201);
  });

  it('supports Persian search, filters, sorting, and is injection-safe', async () => {
    const token = await login(ownerEmail);
    const h = auth(token);
    const supplier = await createPartyLinkedSupplier(database.client, {
      companyId: pishtehId,
      name: `پخش‌کننده جستجو ${Date.now()}`,
      status: PurchasingLifecycleStatus.ACTIVE,
    });
    const po = await createPo(token, {
      supplierId: supplier.id,
      notes: 'سفارش فوری ریمل',
      items: [{ skuId: conc1SkuId, quantity: 3, unitPrice: '1000' }],
    });

    const bySupplier = await request(app.getHttpServer()).get(BASE).query({ search: 'پخش‌کننده جستجو' }).set(h).expect(200);
    expect(bySupplier.body.data.some((r: { id: string }) => r.id === po.id)).toBe(true);
    const byNotes = await request(app.getHttpServer()).get(BASE).query({ search: 'فوری ریمل' }).set(h).expect(200);
    expect(byNotes.body.data.some((r: { id: string }) => r.id === po.id)).toBe(true);
    const byProduct = await request(app.getHttpServer()).get(BASE).query({ search: 'کانسیلر' }).set(h).expect(200);
    expect(byProduct.body.data.some((r: { id: string }) => r.id === po.id)).toBe(true);
    const bySku = await request(app.getHttpServer()).get(BASE).query({ search: 'fan-conc-01' }).set(h).expect(200);
    expect(bySku.body.data.some((r: { id: string }) => r.id === po.id)).toBe(true);
    const byNumber = await request(app.getHttpServer()).get(BASE).query({ search: po.number }).set(h).expect(200);
    expect(byNumber.body.data).toHaveLength(1);
    expect(byNumber.body.data[0].itemCount).toBe(1);
    expect(byNumber.body.data[0].items).toBeUndefined();

    for (const search of [`'"%_`, `'; DROP TABLE purchase_orders; --`, '\\', '%', '_']) {
      await request(app.getHttpServer()).get(BASE).query({ search, pageSize: 5 }).set(h).expect(200);
    }
    const stillThere = await database.client.purchaseOrder.count({ where: { companyId: pishtehId } });
    expect(stillThere).toBeGreaterThan(0);

    const filtered = await request(app.getHttpServer())
      .get(BASE)
      .query({ status: 'DRAFT', supplierId: supplier.id, currency: 'IRR', skuId: conc1SkuId })
      .set(h)
      .expect(200);
    expect(filtered.body.data.map((r: { id: string }) => r.id)).toEqual([po.id]);
    expect(filtered.body.meta.total).toBe(1);

    const none = await request(app.getHttpServer()).get(BASE).query({ supplierId: supplier.id, status: 'ORDERED' }).set(h).expect(200);
    expect(none.body.data).toHaveLength(0);

    const sorted = await request(app.getHttpServer())
      .get(BASE)
      .query({ sortBy: 'total', sortOrder: 'asc', pageSize: 100 })
      .set(h)
      .expect(200);
    const totals = sorted.body.data.map((r: { total: string }) => Number(r.total));
    expect([...totals].sort((a, b) => a - b)).toEqual(totals);

    await request(app.getHttpServer()).get(BASE).query({ sortBy: 'password' }).set(h).expect(400);
    // Receiving statuses are filterable for Phase 3 readiness (no public receive API yet).
    const receivedFilter = await request(app.getHttpServer())
      .get(BASE)
      .query({ status: 'RECEIVED' })
      .set(h)
      .expect(200);
    expect(
      receivedFilter.body.data.every((r: { status: string }) => r.status === 'RECEIVED'),
    ).toBe(true);
    const partialFilter = await request(app.getHttpServer())
      .get(BASE)
      .query({ status: 'PARTIALLY_RECEIVED' })
      .set(h)
      .expect(200);
    expect(
      partialFilter.body.data.every((r: { status: string }) => r.status === 'PARTIALLY_RECEIVED'),
    ).toBe(true);
    await request(app.getHttpServer()).get(BASE).query({ pageSize: 1000 }).set(h).expect(400);
    await request(app.getHttpServer()).get(BASE).query({ unknown: 'x' }).set(h).expect(400);
  });

  it('records audit logs and publishes domain events only after commit', async () => {
    const token = await login(ownerEmail);
    const h = auth(token);
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const handlerId = `po-e2e-${Date.now()}`;
    for (const type of [
      DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_CREATED,
      DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_UPDATED,
      DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_ITEM_ADDED,
      DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_ITEM_UPDATED,
      DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_ITEM_REMOVED,
      DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_APPROVED,
      DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_ORDERED,
      DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_CANCELLED,
    ]) {
      eventBus.subscribe(type, handlerId, (event) => {
        events.push({ type: event.type, payload: event.payload as Record<string, unknown> });
      });
    }

    const failedBefore = await database.client.auditLog.count({
      where: { companyId: pishtehId, action: 'PURCHASE_ORDER_CREATED' },
    });
    await request(app.getHttpServer())
      .post(BASE)
      .set(h)
      .send(draftBody({ items: [{ skuId: mascaraSkuId, quantity: 1, unitPrice: '0' }] }))
      .expect(400);
    await request(app.getHttpServer())
      .post(BASE)
      .set(h)
      .send(draftBody({ supplierId: demoBSupplierId }))
      .expect(404);
    await settle();
    expect(
      await database.client.auditLog.count({
        where: { companyId: pishtehId, action: 'PURCHASE_ORDER_CREATED' },
      }),
    ).toBe(failedBefore);
    expect(events).toHaveLength(0);

    const po = await createPo(token);
    const added = await request(app.getHttpServer())
      .post(`${BASE}/${po.id}/items`)
      .set(h)
      .send({ skuId: conc4SkuId, quantity: 2, unitPrice: '1000' })
      .expect(201);
    const itemId = added.body.data.items.find((i: { skuId: string }) => i.skuId === conc4SkuId).id as string;
    await request(app.getHttpServer()).patch(`${BASE}/${po.id}/items/${itemId}`).set(h).send({ quantity: 3 }).expect(200);
    await request(app.getHttpServer()).delete(`${BASE}/${po.id}/items/${itemId}`).set(h).expect(200);
    await request(app.getHttpServer()).patch(`${BASE}/${po.id}`).set(h).send({ notes: 'audited' }).expect(200);
    // No-op update emits nothing.
    await request(app.getHttpServer()).patch(`${BASE}/${po.id}`).set(h).send({ notes: 'audited' }).expect(200);
    await request(app.getHttpServer()).post(`${BASE}/${po.id}/approve`).set(h).expect(201);
    await request(app.getHttpServer()).post(`${BASE}/${po.id}/mark-ordered`).set(h).expect(201);
    await request(app.getHttpServer()).post(`${BASE}/${po.id}/cancel`).set(h).send({ reason: 'audit' }).expect(201);
    await settle();

    const mine = events.filter((e) => e.payload.purchaseOrderId === po.id).map((e) => e.type);
    expect(mine).toEqual([
      DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_CREATED,
      DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_ITEM_ADDED,
      DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_ITEM_UPDATED,
      DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_ITEM_REMOVED,
      DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_UPDATED,
      DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_APPROVED,
      DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_ORDERED,
      DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_CANCELLED,
    ]);
    const created = events.find(
      (e) => e.type === DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_CREATED && e.payload.purchaseOrderId === po.id,
    )!;
    expect(created.payload).toMatchObject({
      companyId: pishtehId,
      number: po.number,
      supplierId: tehranSupplierId,
      currency: 'IRR',
      total: '5850000000',
      itemCount: 1,
    });
    const ordered = events.find(
      (e) => e.type === DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_ORDERED && e.payload.purchaseOrderId === po.id,
    )!;
    expect(ordered.payload).toMatchObject({ previousStatus: 'APPROVED', status: 'ORDERED' });

    const logs = await database.client.auditLog.findMany({
      where: {
        companyId: pishtehId,
        OR: [
          { entityType: 'PURCHASE_ORDER', entityId: po.id },
          { entityType: 'PURCHASE_ORDER_ITEM', entityId: itemId },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
    expect(logs.map((l) => l.action)).toEqual([
      'PURCHASE_ORDER_CREATED',
      'PURCHASE_ORDER_ITEM_ADDED',
      'PURCHASE_ORDER_ITEM_UPDATED',
      'PURCHASE_ORDER_ITEM_REMOVED',
      'PURCHASE_ORDER_UPDATED',
      'PURCHASE_ORDER_APPROVED',
      'PURCHASE_ORDER_ORDERED',
      'PURCHASE_ORDER_CANCELLED',
    ]);
    const orderedLog = logs.find((l) => l.action === 'PURCHASE_ORDER_ORDERED')!;
    expect((orderedLog.before as Record<string, unknown>).status).toBe('APPROVED');
    expect((orderedLog.after as Record<string, unknown>).status).toBe('ORDERED');
    expect((orderedLog.after as Record<string, unknown>).supplierNameSnapshot).toBe('پخش تهران');
    expect(orderedLog.actorUserId).toBe(ownerId);
    const itemLog = logs.find((l) => l.action === 'PURCHASE_ORDER_ITEM_UPDATED')!;
    expect((itemLog.before as Record<string, unknown>).quantity).toBe(2);
    expect((itemLog.after as Record<string, unknown>).quantity).toBe(3);
  });

  it('exposes the idempotent seed purchase orders', async () => {
    const token = await login(ownerEmail);
    const h = auth(token);
    const list = await request(app.getHttpServer()).get(BASE).query({ search: 'SEED-PO-', pageSize: 100 }).set(h).expect(200);
    const byNumber = new Map<string, { id: string; status: string }>(
      list.body.data.map((r: { number: string; id: string; status: string }) => [r.number, r]),
    );
    expect(byNumber.get('SEED-PO-DRAFT-01')?.status).toBe('DRAFT');
    expect(byNumber.get('SEED-PO-APPROVED-01')?.status).toBe('APPROVED');
    expect(byNumber.get('SEED-PO-ORDERED-01')?.status).toBe('ORDERED');
    expect(byNumber.get('SEED-PO-CANCELLED-01')?.status).toBe('CANCELLED');

    const ordered = byNumber.get('SEED-PO-ORDERED-01')!;
    const detail = await request(app.getHttpServer()).get(`${BASE}/${ordered.id}`).set(h).expect(200);
    expect(detail.body.data.supplier.code).toBe('TEH-BEAUTY');
    expect(detail.body.data.supplierCodeSnapshot).toBe('TEH-BEAUTY');
    expect(detail.body.data.items[0].skuCodeSnapshot).toBe('ESS-MASCARA-01');
    expect(detail.body.data.total).toBe('2900000000');
    expect(detail.body.data.availableActions).toEqual(
      expect.arrayContaining(['CANCEL', 'ADD_COST']),
    );

    const cancelled = byNumber.get('SEED-PO-CANCELLED-01')!;
    const cancelledDetail = await request(app.getHttpServer())
      .get(`${BASE}/${cancelled.id}`)
      .set(h)
      .expect(200);
    expect(cancelledDetail.body.data.cancellationReason).toBe('تأمین‌کننده موجودی نداشت');
    expect(cancelledDetail.body.data.orderedAt).toBeTruthy();
    expect(cancelledDetail.body.data.availableActions).toEqual([]);
  });

  it('blocks mass-assignment of status and forged lifecycle actor fields', async () => {
    const token = await login(ownerEmail);
    const h = auth(token);
    const po = await createPo(token);

    await request(app.getHttpServer())
      .patch(`${BASE}/${po.id}`)
      .set(h)
      .send({ status: 'RECEIVED', approvedById: ownerId, orderedAt: new Date().toISOString() })
      .expect(400);

    await request(app.getHttpServer()).post(`${BASE}/${po.id}/approve`).set(h).expect(201);
    const ordered = await request(app.getHttpServer())
      .post(`${BASE}/${po.id}/order`)
      .set(h)
      .send({ supplierOrderReference: 'REF-MASS' })
      .expect(201);
    expect(ordered.body.data.status).toBe('ORDERED');
    expect(ordered.body.data.supplierOrderReference).toBe('REF-MASS');
    expect(ordered.body.data.orderedBy.id).toBe(ownerId);

    // No public receiving transition endpoints.
    await request(app.getHttpServer()).post(`${BASE}/${po.id}/receive`).set(h).expect(404);
    await request(app.getHttpServer()).post(`${BASE}/${po.id}/mark-received`).set(h).expect(404);
    await request(app.getHttpServer()).post(`${BASE}/${po.id}/partially-receive`).set(h).expect(404);
  });
});
