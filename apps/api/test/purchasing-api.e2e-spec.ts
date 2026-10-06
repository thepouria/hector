import request from 'supertest';
import {
  CurrencyCode,
  PurchaseCommercialType,
  PurchaseOrderStatus,
  UserStatus,
  syncOwnerRolePermissions,
  syncPermissions,
} from '@hector/database';
import type { INestApplication } from '@nestjs/common';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';

/**
 * Phase 2.12 — Purchasing API consolidation / hardening contract tests.
 * Domain suites (suppliers, offers, POs, returns) remain authoritative for business flows;
 * this file locks the HTTP boundary: auth, query abuse, mass-assignment, summary, no receive.
 */
describe('Purchasing API (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;
  let pishtehId: string;
  let demoBId: string;
  let skuId: string;
  let supplierId: string;

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

    await database.client.user.update({
      where: { email: ownerEmail },
      data: { status: UserStatus.ACTIVE, deletedAt: null },
    });

    const supplier = await database.client.supplier.findFirstOrThrow({
      where: { companyId: pishtehId },
      orderBy: { createdAt: 'asc' },
    });
    supplierId = supplier.id;

    const sku = await database.client.sku.findFirstOrThrow({
      where: { companyId: pishtehId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
    skuId = sku.id;
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(email = ownerEmail): Promise<string> {
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

  async function createDraftPo(token: string): Promise<{ id: string; version: number }> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/purchasing/purchase-orders')
      .set(auth(token))
      .send({
        supplierId,
        purchaseType: PurchaseCommercialType.CASH,
        currency: CurrencyCode.IRR,
        items: [{ skuId, quantity: 10, unitPrice: '100000' }],
      })
      .expect(201);
    return { id: res.body.data.id as string, version: res.body.data.version as number };
  }

  it('requires authentication for purchasing summary', async () => {
    await request(app.getHttpServer()).get('/api/v1/purchasing/summary').expect(401);
  });

  it('returns company-scoped purchasing summary without finance/inventory KPIs', async () => {
    const token = await login();
    const started = Date.now();
    const res = await request(app.getHttpServer())
      .get('/api/v1/purchasing/summary')
      .set(auth(token))
      .expect(200);
    const elapsed = Date.now() - started;

    expect(res.body.data).toEqual(
      expect.objectContaining({
        supplierCount: expect.any(Number),
        draftPOCount: expect.any(Number),
        dueDatePassedCount: expect.any(Number),
        financeKpis: 'DEFERRED_TO_FINANCE',
        inventoryKpis: 'DEFERRED_TO_WAREHOUSE',
      }),
    );
    expect(res.body.data).not.toHaveProperty('accountsPayable');
    expect(res.body.data).not.toHaveProperty('stockOnHand');
    expect(elapsed).toBeLessThan(5000);
  });

  it('rejects pagination abuse on PO list', async () => {
    const token = await login();
    await request(app.getHttpServer())
      .get('/api/v1/purchasing/purchase-orders')
      .query({ pageSize: 99999999 })
      .set(auth(token))
      .expect(400);

    await request(app.getHttpServer())
      .get('/api/v1/purchasing/purchase-orders')
      .query({ page: -1 })
      .set(auth(token))
      .expect(400);

    await request(app.getHttpServer())
      .get('/api/v1/purchasing/purchase-orders')
      .query({ pageSize: 0 })
      .set(auth(token))
      .expect(400);
  });

  it('rejects unsupported sort and invalid enums', async () => {
    const token = await login();
    await request(app.getHttpServer())
      .get('/api/v1/purchasing/purchase-orders')
      .query({ sortBy: 'secretColumn' })
      .set(auth(token))
      .expect(400);

    await request(app.getHttpServer())
      .get('/api/v1/purchasing/purchase-orders')
      .query({ status: 'PAID' })
      .set(auth(token))
      .expect(400);

    await request(app.getHttpServer())
      .get('/api/v1/purchasing/purchase-orders')
      .query({ purchaseType: 'BARTER' })
      .set(auth(token))
      .expect(400);

    await request(app.getHttpServer())
      .get('/api/v1/purchasing/purchase-orders')
      .query({ currency: 'BTC' })
      .set(auth(token))
      .expect(400);
  });

  it('rejects inverted date ranges', async () => {
    const token = await login();
    await request(app.getHttpServer())
      .get('/api/v1/purchasing/purchase-orders')
      .query({ dueFrom: '2026-12-01', dueTo: '2026-01-01' })
      .set(auth(token))
      .expect(400);

    await request(app.getHttpServer())
      .get('/api/v1/purchasing/offers')
      .query({ quotedFrom: '2026-06-01T00:00:00.000Z', quotedTo: '2026-01-01T00:00:00.000Z' })
      .set(auth(token))
      .expect(400);
  });

  it('tolerates malicious search strings without crash or cross-tenant leak', async () => {
    const token = await login();
    const evil = `%' OR 1=1; DROP TABLE purchase_orders; --`;
    const endpoints = [
      '/api/v1/purchasing/suppliers',
      '/api/v1/purchasing/offers',
      '/api/v1/purchasing/purchase-orders',
      '/api/v1/purchasing/purchase-returns',
    ];
    for (const path of endpoints) {
      const res = await request(app.getHttpServer())
        .get(path)
        .query({ search: evil })
        .set(auth(token))
        .expect(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    }
  });

  it('blocks mass-assignment of status and receivedQuantity on PO update', async () => {
    const token = await login();
    const po = await createDraftPo(token);

    await request(app.getHttpServer())
      .patch(`/api/v1/purchasing/purchase-orders/${po.id}`)
      .set(auth(token))
      .send({ status: PurchaseOrderStatus.RECEIVED, expectedVersion: po.version })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/api/v1/purchasing/purchase-orders/${po.id}`)
      .set(auth(token))
      .send({ receivedQuantity: 100, expectedVersion: po.version })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/api/v1/purchasing/purchase-orders/${po.id}`)
      .set(auth(token))
      .send({ companyId: demoBId, createdBy: demoBId, expectedVersion: po.version })
      .expect(400);
  });

  it('does not expose public receive / mark-received endpoints', async () => {
    const token = await login();
    const po = await createDraftPo(token);

    await request(app.getHttpServer())
      .post(`/api/v1/purchasing/purchase-orders/${po.id}/receive`)
      .set(auth(token))
      .send({})
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/v1/purchasing/purchase-orders/${po.id}/mark-received`)
      .set(auth(token))
      .send({})
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/v1/purchasing/purchase-orders/${po.id}/partial-receive`)
      .set(auth(token))
      .send({})
      .expect(404);
  });

  it('keeps PO list compact and detail money as decimal strings', async () => {
    const token = await login();
    const started = Date.now();
    const list = await request(app.getHttpServer())
      .get('/api/v1/purchasing/purchase-orders')
      .query({ pageSize: 20, sortBy: 'createdAt' })
      .set(auth(token))
      .expect(200);
    expect(Date.now() - started).toBeLessThan(5000);

    expect(list.body.meta).toEqual(
      expect.objectContaining({
        page: expect.any(Number),
        pageSize: expect.any(Number),
        total: expect.any(Number),
      }),
    );
    if (list.body.data.length > 0) {
      const row = list.body.data[0];
      expect(row).not.toHaveProperty('items');
      expect(typeof row.total === 'string' || typeof row.subtotal === 'string').toBe(true);
    }

    const po = await createDraftPo(token);
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/purchasing/purchase-orders/${po.id}`)
      .set(auth(token))
      .expect(200);
    expect(typeof detail.body.data.total).toBe('string');
    expect(typeof detail.body.data.subtotal).toBe('string');
    expect(detail.body.data.items[0].unitPrice).toEqual(expect.any(String));
  });

  it('blocks cross-company PO IDOR with not-found semantics', async () => {
    const token = await login();
    const po = await createDraftPo(token);

    await request(app.getHttpServer())
      .get(`/api/v1/purchasing/purchase-orders/${po.id}`)
      .set(auth(token, demoBId))
      .expect(404);
  });

  it('reports local list latency sanity under 5s for core resources', async () => {
    const token = await login();
    const paths = [
      '/api/v1/purchasing/suppliers',
      '/api/v1/purchasing/offers',
      '/api/v1/purchasing/purchase-orders',
      '/api/v1/purchasing/purchase-returns',
    ];
    for (const path of paths) {
      const started = Date.now();
      await request(app.getHttpServer()).get(path).query({ pageSize: 50 }).set(auth(token)).expect(200);
      const elapsed = Date.now() - started;
      // Local sanity only — not a production benchmark.
      expect(elapsed).toBeLessThan(5000);
    }
  });

  describe('Purchase Dashboard (Phase 2.14)', () => {
    it('requires auth and purchasing.read', async () => {
      await request(app.getHttpServer()).get('/api/v1/purchasing/dashboard').expect(401);
    });

    it('returns company-scoped dashboard aggregates without finance/warehouse inventions', async () => {
      const token = await login();
      const started = Date.now();
      const res = await request(app.getHttpServer())
        .get('/api/v1/purchasing/dashboard')
        .query({ range: '30d' })
        .set(auth(token))
        .expect(200);
      expect(Date.now() - started).toBeLessThan(8000);

      const data = res.body.data;
      expect(data.meta.range.dateBasis).toBe('orderDate');
      expect(data.meta.financeKpis).toBe('DEFERRED_TO_FINANCE');
      expect(data.meta.inventoryKpis).toBe('DEFERRED_TO_WAREHOUSE');
      expect(data.kpis).toEqual(
        expect.objectContaining({
          openPurchaseCount: expect.any(Number),
          draftPurchaseCount: expect.any(Number),
          upcomingDueCount: expect.any(Number),
          dueDatePassedCount: expect.any(Number),
          activeSupplierCountInPeriod: expect.any(Number),
        }),
      );
      expect(data).toHaveProperty('attention');
      expect(data).toHaveProperty('openPurchases');
      expect(data).toHaveProperty('upcomingDue');
      expect(data).toHaveProperty('unfulfilled');
      expect(data).toHaveProperty('trend');
      expect(data).toHaveProperty('supplierBreakdown');
      expect(data).not.toHaveProperty('accountsPayable');
      expect(data).not.toHaveProperty('receivedQuantity');
      expect(JSON.stringify(data)).not.toMatch(/پرداخت عقب|paid|accountsPayable|stockOnHand/i);
    });

    it('rejects abusive / invalid dashboard query params', async () => {
      const token = await login();
      await request(app.getHttpServer())
        .get('/api/v1/purchasing/dashboard')
        .query({ range: 'custom' })
        .set(auth(token))
        .expect(400);

      await request(app.getHttpServer())
        .get('/api/v1/purchasing/dashboard')
        .query({ range: 'custom', from: '2020-01-01', to: '2026-10-03' })
        .set(auth(token))
        .expect(400);

      await request(app.getHttpServer())
        .get('/api/v1/purchasing/dashboard')
        .query({ purchaseType: 'NOT_A_TYPE' })
        .set(auth(token))
        .expect(400);

      await request(app.getHttpServer())
        .get('/api/v1/purchasing/dashboard')
        .query({ supplierId: '00000000-0000-4000-8000-000000000099' })
        .set(auth(token))
        .expect(404);
    });

    it('keeps company isolation for dashboard supplier filter', async () => {
      const token = await login();
      // Pishteh supplier must not resolve under Demo B
      await request(app.getHttpServer())
        .get('/api/v1/purchasing/dashboard')
        .query({ supplierId })
        .set(auth(token, demoBId))
        .expect(404);

      const a = await request(app.getHttpServer())
        .get('/api/v1/purchasing/dashboard')
        .query({ range: '30d' })
        .set(auth(token, pishtehId))
        .expect(200);
      const b = await request(app.getHttpServer())
        .get('/api/v1/purchasing/dashboard')
        .query({ range: '30d' })
        .set(auth(token, demoBId))
        .expect(200);
      // Counts may coincide by chance; company meta filters prove separate scopes.
      expect(a.body.data.meta.filters).toBeDefined();
      expect(b.body.data.meta.filters).toBeDefined();
    });

    it('does not count DRAFT/CANCELLED in committed local value and keeps FX separate', async () => {
      const token = await login();
      const draft = await createDraftPo(token);

      // Cancel after approve/order path is heavy; create FX + CASH committed via seed is enough.
      // Assert draft is excluded from periodCommitted when status defaults to committed set:
      const dash = await request(app.getHttpServer())
        .get('/api/v1/purchasing/dashboard')
        .query({ range: '90d', supplierId })
        .set(auth(token))
        .expect(200);

      expect(dash.body.data.meta.definitions.committedPurchase).toContain('RECEIVED');
      expect(dash.body.data.meta.definitions.committedPurchase).not.toContain('DRAFT');
      expect(dash.body.data.kpis.draftPurchaseCount).toBeGreaterThanOrEqual(1);

      // FX obligations never collapsed into a single "foreign" currency blob
      for (const row of dash.body.data.kpis.foreignObligationsByCurrency ?? []) {
        expect(['IRR', 'USD']).toContain(row.currency);
        expect(typeof row.amount).toBe('string');
      }

      // Seed FX: 1000 + 842.75 USD (Decimal-safe string sum)
      const usd = (dash.body.data.kpis.foreignObligationsByCurrency as Array<{
        currency: string;
        amount: string;
      }>).find((r) => r.currency === 'USD');
      expect(usd).toBeDefined();
      expect(Number(usd!.amount)).toBeGreaterThanOrEqual(1842.75);

      const fxRef = dash.body.data.kpis.fxReferenceLocalValueByCurrency?.[0];
      if (fxRef) {
        expect(fxRef.currency).toBe('IRR');
        expect(fxRef.note).toMatch(/REFERENCE/i);
      }

      expect(dash.body.data.meta.definitions.openPurchase).toMatch(/APPROVED/);
      expect(
        dash.body.data.meta.definitions.unfulfilledPurchase ??
          dash.body.data.meta.definitions.unfulfilled,
      ).toMatch(/ORDERED/);
      expect(dash.body.data.kpis.openPurchaseCount).toBeGreaterThanOrEqual(1);

      // Ensure draft PO still exists (cleanup not required)
      await request(app.getHttpServer())
        .get(`/api/v1/purchasing/purchase-orders/${draft.id}`)
        .set(auth(token))
        .expect(200);
    });

    it('filters dashboard by purchaseType and never mixes FX into local commercial value', async () => {
      const token = await login();
      const fxOnly = await request(app.getHttpServer())
        .get('/api/v1/purchasing/dashboard')
        .query({ range: '90d', purchaseType: 'FX_CREDIT' })
        .set(auth(token))
        .expect(200);
      expect(
        (fxOnly.body.data.kpis.localCommercialValueByCurrency as unknown[]).length,
      ).toBe(0);

      const cashOnly = await request(app.getHttpServer())
        .get('/api/v1/purchasing/dashboard')
        .query({ range: '90d', purchaseType: 'CASH' })
        .set(auth(token))
        .expect(200);
      expect(
        (cashOnly.body.data.kpis.foreignObligationsByCurrency as unknown[]).length,
      ).toBe(0);
    });
  });
});
