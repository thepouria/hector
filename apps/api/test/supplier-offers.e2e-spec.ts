import request from 'supertest';
import {
  CompanyMemberStatus,
  CurrencyCode,
  PERMISSIONS,
  PurchaseCommercialType,
  UserStatus,
  syncOwnerRolePermissions,
  syncPermissions,
} from '@hector/database';
import type { INestApplication } from '@nestjs/common';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { DOMAIN_EVENTS, DomainEventBus } from '../src/infrastructure/events';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';
import { createPartyLinkedSupplier } from './helpers/party-linked-supplier';

describe('Supplier Offers (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let eventBus: DomainEventBus;
  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;
  let pishtehId: string;
  let demoBId: string;
  let tehranSupplierId: string;
  let cosmeticsSupplierId: string;
  let mascaraSkuId: string;
  let demoBOfferId: string;
  let demoBSupplierId: string;
  let demoBSkuId: string;
  let ownerPasswordHash: string;
  let tehranContactId: string;

  beforeAll(async () => {
    app = await createE2eApp();
    database = app.get(DatabaseService);
    eventBus = app.get(DomainEventBus);
    await syncPermissions(database.client);
    await syncOwnerRolePermissions(database.client);

    pishtehId = (
      await database.client.company.findUniqueOrThrow({ where: { slug: 'pishteh' } })
    ).id;
    demoBId = (
      await database.client.company.findUniqueOrThrow({ where: { slug: 'hector-demo-b' } })
    ).id;
    tehranSupplierId = (
      await database.client.supplier.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'TEH-BEAUTY' },
      })
    ).id;
    cosmeticsSupplierId = (
      await database.client.supplier.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'TEH-COSMETICS' },
      })
    ).id;
    mascaraSkuId = (
      await database.client.sku.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'ESS-MASCARA-01' },
      })
    ).id;
    tehranContactId = (
      await database.client.supplierContact.findFirstOrThrow({
        where: { companyId: pishtehId, supplierId: tehranSupplierId, archivedAt: null },
      })
    ).id;
    demoBSupplierId = (
      await database.client.supplier.findFirstOrThrow({
        where: { companyId: demoBId, code: 'DEMO-SUP-B' },
      })
    ).id;
    demoBSkuId = (
      await database.client.sku.findFirstOrThrow({
        where: { companyId: demoBId, code: 'MIR-SERUM-01' },
      })
    ).id;
    demoBOfferId = (
      await database.client.supplierOffer.findFirstOrThrow({
        where: { companyId: demoBId },
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

  function auth(token: string, companyId = pishtehId) {
    return {
      Authorization: `Bearer ${token}`,
      'X-Company-Id': companyId,
    };
  }

  it('creates cash / term / USD quotes and preserves history', async () => {
    const token = await login(ownerEmail);
    const stamp = Date.now();

    const cash = await request(app.getHttpServer())
      .post('/api/v1/purchasing/offers')
      .set(auth(token))
      .send({
        supplierId: tehranSupplierId,
        skuId: mascaraSkuId,
        unitPrice: '5850000',
        currency: CurrencyCode.IRR,
        purchaseType: PurchaseCommercialType.CASH,
        quotedAt: new Date(stamp).toISOString(),
        supplierContactId: tehranContactId,
      })
      .expect(201);
    expect(cash.body.data.unitPrice).toBe('5850000');
    expect(cash.body.data.currency).toBe('IRR');

    const term = await request(app.getHttpServer())
      .post('/api/v1/purchasing/offers')
      .set(auth(token))
      .send({
        supplierId: cosmeticsSupplierId,
        skuId: mascaraSkuId,
        unitPrice: '6000000',
        currency: CurrencyCode.IRR,
        purchaseType: PurchaseCommercialType.TERM_CREDIT,
        paymentTermType: 'NET_DAYS',
        netDays: 30,
        quotedAt: new Date(stamp + 1000).toISOString(),
      })
      .expect(201);
    expect(term.body.data.netDays).toBe(30);

    const usd = await request(app.getHttpServer())
      .post('/api/v1/purchasing/offers')
      .set(auth(token))
      .send({
        supplierId: tehranSupplierId,
        skuId: mascaraSkuId,
        unitPrice: '1.25',
        currency: CurrencyCode.USD,
        purchaseType: PurchaseCommercialType.FX_CREDIT,
        quotedAt: new Date(stamp + 2000).toISOString(),
        referenceFxRate: '2050000',
        referenceFxBaseCurrency: CurrencyCode.USD,
        referenceFxQuoteCurrency: CurrencyCode.IRR,
      })
      .expect(201);
    expect(usd.body.data.unitPrice).toBe('1.25');

    const history = await request(app.getHttpServer())
      .get('/api/v1/purchasing/offers')
      .query({ supplierId: tehranSupplierId, skuId: mascaraSkuId, pageSize: 50 })
      .set(auth(token))
      .expect(200);
    expect(history.body.data.length).toBeGreaterThanOrEqual(2);
  });

  it('uses quotedAt for latest, not insertion order', async () => {
    const token = await login(ownerEmail);
    const supplier = await createPartyLinkedSupplier(database.client, {
      companyId: pishtehId,
      name: `Latest ${Date.now()}`,
      status: 'ACTIVE',
    });

    await request(app.getHttpServer())
      .post('/api/v1/purchasing/offers')
      .set(auth(token))
      .send({
        supplierId: supplier.id,
        skuId: mascaraSkuId,
        unitPrice: '5000000',
        currency: 'IRR',
        purchaseType: 'CASH',
        quotedAt: '2026-10-03T12:00:00.000Z',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/purchasing/offers')
      .set(auth(token))
      .send({
        supplierId: supplier.id,
        skuId: mascaraSkuId,
        unitPrice: '4900000',
        currency: 'IRR',
        purchaseType: 'CASH',
        quotedAt: '2026-10-01T12:00:00.000Z',
      })
      .expect(201);

    const latest = await request(app.getHttpServer())
      .get('/api/v1/purchasing/offers/latest')
      .query({ supplierId: supplier.id, skuId: mascaraSkuId })
      .set(auth(token))
      .expect(200);
    expect(latest.body.data.unitPrice).toBe('5000000');
  });

  it('validates validity, zero/negative price, and optional no-expiry', async () => {
    const token = await login(ownerEmail);
    await request(app.getHttpServer())
      .post('/api/v1/purchasing/offers')
      .set(auth(token))
      .send({
        supplierId: tehranSupplierId,
        skuId: mascaraSkuId,
        unitPrice: '1000000',
        currency: 'IRR',
        quotedAt: '2026-10-03T10:00:00.000Z',
        validUntil: '2026-10-02T10:00:00.000Z',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/purchasing/offers')
      .set(auth(token))
      .send({
        supplierId: tehranSupplierId,
        skuId: mascaraSkuId,
        unitPrice: '0',
        currency: 'IRR',
        quotedAt: new Date().toISOString(),
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/purchasing/offers')
      .set(auth(token))
      .send({
        supplierId: tehranSupplierId,
        skuId: mascaraSkuId,
        unitPrice: '-10',
        currency: 'IRR',
        quotedAt: new Date().toISOString(),
      })
      .expect(400);

    const ok = await request(app.getHttpServer())
      .post('/api/v1/purchasing/offers')
      .set(auth(token))
      .send({
        supplierId: tehranSupplierId,
        skuId: mascaraSkuId,
        unitPrice: '1000000',
        currency: 'IRR',
        quotedAt: '2026-10-03T10:00:00.000Z',
        minimumQuantity: 1000,
        availableQuantity: 0,
      })
      .expect(201);
    expect(ok.body.data.validUntil).toBeNull();
    expect(ok.body.data.expiryState).toBe('NO_EXPIRY');
    expect(ok.body.data.availableQuantity).toBe(0);
  });

  it('blocks cross-company supplier/sku/contact and offer IDOR', async () => {
    const token = await login(ownerEmail);
    await request(app.getHttpServer())
      .post('/api/v1/purchasing/offers')
      .set(auth(token, pishtehId))
      .send({
        supplierId: demoBSupplierId,
        skuId: mascaraSkuId,
        unitPrice: '1000000',
        currency: 'IRR',
        quotedAt: new Date().toISOString(),
      })
      .expect(404);

    await request(app.getHttpServer())
      .post('/api/v1/purchasing/offers')
      .set(auth(token, pishtehId))
      .send({
        supplierId: tehranSupplierId,
        skuId: demoBSkuId,
        unitPrice: '1000000',
        currency: 'IRR',
        quotedAt: new Date().toISOString(),
      })
      .expect(404);

    const demoContact = await database.client.supplierContact.create({
      data: {
        companyId: demoBId,
        supplierId: demoBSupplierId,
        name: 'Foreign Contact',
      },
    });
    await request(app.getHttpServer())
      .post('/api/v1/purchasing/offers')
      .set(auth(token, pishtehId))
      .send({
        supplierId: tehranSupplierId,
        skuId: mascaraSkuId,
        unitPrice: '1000000',
        currency: 'IRR',
        quotedAt: new Date().toISOString(),
        supplierContactId: demoContact.id,
      })
      .expect(400);

    await request(app.getHttpServer())
      .get(`/api/v1/purchasing/offers/${demoBOfferId}`)
      .set(auth(token, pishtehId))
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/purchasing/offers/${demoBOfferId}/archive`)
      .set(auth(token, pishtehId))
      .expect(404);
  });

  it('rejects archived supplier for new offers; history remains readable', async () => {
    const token = await login(ownerEmail);
    const supplier = await createPartyLinkedSupplier(database.client, {
      companyId: pishtehId,
      name: `ArchOffer ${Date.now()}`,
      status: 'ACTIVE',
    });
    const created = await request(app.getHttpServer())
      .post('/api/v1/purchasing/offers')
      .set(auth(token))
      .send({
        supplierId: supplier.id,
        skuId: mascaraSkuId,
        unitPrice: '1110000',
        currency: 'IRR',
        quotedAt: new Date().toISOString(),
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/purchasing/suppliers/${supplier.id}/archive`)
      .set(auth(token))
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/purchasing/offers')
      .set(auth(token))
      .send({
        supplierId: supplier.id,
        skuId: mascaraSkuId,
        unitPrice: '1120000',
        currency: 'IRR',
        quotedAt: new Date().toISOString(),
      })
      .expect(409);

    await request(app.getHttpServer())
      .get(`/api/v1/purchasing/offers/${created.body.data.id}`)
      .set(auth(token))
      .expect(200);
  });

  it('supports Persian search, injection-safe search, and mass-assignment rejection', async () => {
    const token = await login(ownerEmail);
    const listed = await request(app.getHttpServer())
      .get('/api/v1/purchasing/offers')
      .query({ search: 'ریمل', pageSize: 20 })
      .set(auth(token))
      .expect(200);
    expect(Array.isArray(listed.body.data)).toBe(true);

    await request(app.getHttpServer())
      .get('/api/v1/purchasing/offers')
      .query({ search: `'"%_`, pageSize: 5 })
      .set(auth(token))
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/purchasing/offers')
      .set(auth(token))
      .send({
        supplierId: tehranSupplierId,
        skuId: mascaraSkuId,
        unitPrice: '1000000',
        currency: 'IRR',
        quotedAt: new Date().toISOString(),
        companyId: demoBId,
        createdById: demoBId,
        archivedAt: new Date().toISOString(),
      })
      .expect(400);
  });

  it('enforces RBAC, audit, events, and no ghost audit on failure', async () => {
    const token = await login(ownerEmail);
    const received: string[] = [];
    const handlerId = `offer-e2e-${Date.now()}`;
    eventBus.subscribe(DOMAIN_EVENTS.PURCHASING_SUPPLIER_OFFER_CREATED, handlerId, (event) => {
      received.push(event.type);
    });

    const created = await request(app.getHttpServer())
      .post('/api/v1/purchasing/offers')
      .set(auth(token))
      .send({
        supplierId: tehranSupplierId,
        skuId: mascaraSkuId,
        unitPrice: '2220000',
        currency: 'IRR',
        quotedAt: new Date().toISOString(),
      })
      .expect(201);
    await new Promise((r) => setTimeout(r, 40));
    expect(received).toContain(DOMAIN_EVENTS.PURCHASING_SUPPLIER_OFFER_CREATED);

    const audit = await database.client.auditLog.findFirst({
      where: {
        companyId: pishtehId,
        entityType: 'SUPPLIER_OFFER',
        entityId: created.body.data.id,
        action: 'SUPPLIER_OFFER_CREATED',
      },
    });
    expect(audit).toBeTruthy();

    const beforeCount = await database.client.auditLog.count({
      where: { companyId: pishtehId, action: 'SUPPLIER_OFFER_CREATED' },
    });
    await request(app.getHttpServer())
      .post('/api/v1/purchasing/offers')
      .set(auth(token))
      .send({
        supplierId: tehranSupplierId,
        skuId: mascaraSkuId,
        unitPrice: '0',
        currency: 'IRR',
        quotedAt: new Date().toISOString(),
      })
      .expect(400);
    const afterCount = await database.client.auditLog.count({
      where: { companyId: pishtehId, action: 'SUPPLIER_OFFER_CREATED' },
    });
    expect(afterCount).toBe(beforeCount);

    const limited = await database.client.role.create({
      data: {
        companyId: pishtehId,
        key: `offer-ro-${Date.now()}`,
        name: 'Offer RO',
        isSystem: false,
      },
    });
    const readPerm = await database.client.permission.findUniqueOrThrow({
      where: { key: PERMISSIONS.PURCHASING_READ },
    });
    await database.client.rolePermission.create({
      data: { roleId: limited.id, permissionId: readPerm.id },
    });
    const user = await database.client.user.create({
      data: {
        email: `offer-ro-${Date.now()}@hector.local`,
        firstName: 'RO',
        lastName: 'Offer',
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
    const roToken = await login(user.email);
    await request(app.getHttpServer())
      .get('/api/v1/purchasing/offers')
      .set(auth(roToken))
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/purchasing/offers')
      .set(auth(roToken))
      .send({
        supplierId: tehranSupplierId,
        skuId: mascaraSkuId,
        unitPrice: '1000000',
        currency: 'IRR',
        quotedAt: new Date().toISOString(),
      })
      .expect(403);
  });

  it('compares latest offers per supplier for a SKU', async () => {
    const token = await login(ownerEmail);
    const res = await request(app.getHttpServer())
      .get('/api/v1/purchasing/offers/compare')
      .query({ skuId: mascaraSkuId })
      .set(auth(token))
      .expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const supplierIds = res.body.data.map((row: { supplierId: string }) => row.supplierId);
    expect(new Set(supplierIds).size).toBe(supplierIds.length);
  });
});
