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

const BASE = '/api/v1/purchasing/purchase-orders';

describe('Purchase Order Costs (e2e)', () => {
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
  let mascaraSkuId: string;
  let demoBSupplierId: string;
  let demoBPoId: string;

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
    mascaraSkuId = (
      await db.sku.findFirstOrThrow({ where: { companyId: pishtehId, code: 'ESS-MASCARA-01' } })
    ).id;
    demoBSupplierId = (
      await db.supplier.findFirstOrThrow({ where: { companyId: demoBId, code: 'DEMO-SUP-B' } })
    ).id;
    const owner = await db.user.update({
      where: { email: ownerEmail },
      data: { status: UserStatus.ACTIVE, deletedAt: null },
    });
    ownerId = owner.id;
    ownerPasswordHash = owner.passwordHash;

    const foreign = await db.purchaseOrder.create({
      data: {
        companyId: demoBId,
        number: `SEED-COST-IDOR-${Date.now()}`,
        supplierId: demoBSupplierId,
        currency: CurrencyCode.IRR,
        purchaseType: PurchaseCommercialType.CASH,
        orderDate: new Date(),
        subtotal: 1000000,
        total: 1000000,
        createdById: ownerId,
      },
    });
    demoBPoId = foreign.id;
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
    return { Authorization: `Bearer ${token}`, 'X-Company-Id': companyId };
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

  async function createPo(token: string, body: Record<string, unknown>) {
    const res = await request(app.getHttpServer())
      .post(BASE)
      .set(auth(token))
      .send(body)
      .expect(201);
    return res.body.data as {
      id: string;
      version: number;
      status: string;
      total: string;
      currency: string;
      obligationAmount: string | null;
      referenceFxRate: string | null;
      netDays: number | null;
      dueDate: string | null;
      paymentTermType: string | null;
      items: Array<{ id: string; unitPrice: string }>;
    };
  }

  async function makeUser(permissionKeys: string[]) {
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const role = await database.client.role.create({
      data: {
        companyId: pishtehId,
        key: `po-cost-role-${stamp}`,
        name: `PO Cost ${stamp}`,
        isSystem: false,
      },
    });
    for (const key of permissionKeys) {
      const permission = await database.client.permission.findUniqueOrThrow({ where: { key } });
      await database.client.rolePermission.create({
        data: { roleId: role.id, permissionId: permission.id },
      });
    }
    const user = await database.client.user.create({
      data: {
        email: `po-cost-${stamp}@hector.local`,
        firstName: 'PO',
        lastName: 'Cost',
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

  it('adds multiple Draft costs and derives same-currency totals', async () => {
    const token = await login(ownerEmail);
    const h = auth(token);
    const po = await createPo(token, {
      supplierId: tehranSupplierId,
      currency: 'IRR',
      purchaseType: 'TERM_CREDIT',
      paymentTermType: 'NET_DAYS',
      netDays: 10,
      items: [{ skuId: mascaraSkuId, quantity: 100, unitPrice: '5000000' }],
    });
    // 100 × 5,000,000 = 500,000,000 IRR merchandise

    for (const body of [
      { type: 'COURIER', amount: '20000000', currency: 'IRR', payeeName: 'اسنپ' },
      { type: 'PURCHASE_FEE', amount: '10000000', currency: 'IRR' },
      { type: 'FREIGHT', amount: '30000000', currency: 'IRR', description: 'باربری' },
    ]) {
      await request(app.getHttpServer())
        .post(`${BASE}/${po.id}/costs`)
        .set(h)
        .send(body)
        .expect(201);
    }

    const listed = await request(app.getHttpServer())
      .get(`${BASE}/${po.id}/costs`)
      .set(h)
      .expect(200);
    expect(listed.body.data).toHaveLength(3);
    expect(listed.body.summary.purchaseCostTotalsByCurrency).toEqual([
      { currency: 'IRR', amount: '60000000' },
    ]);
    expect(listed.body.summary.referenceAcquisitionTotal).toEqual({
      currency: 'IRR',
      amount: '560000000',
    });

    const detail = await request(app.getHttpServer()).get(`${BASE}/${po.id}`).set(h).expect(200);
    expect(detail.body.data.purchaseCostTotalsByCurrency).toEqual([
      { currency: 'IRR', amount: '60000000' },
    ]);
    expect(detail.body.data.items[0].unitPrice).toBe('5000000');
  });

  it('rejects OTHER without description and invalid amounts', async () => {
    const token = await login(ownerEmail);
    const h = auth(token);
    const po = await createPo(token, {
      supplierId: tehranSupplierId,
      currency: 'IRR',
      purchaseType: 'CASH',
      items: [{ skuId: mascaraSkuId, quantity: 1, unitPrice: '1000' }],
    });

    await request(app.getHttpServer())
      .post(`${BASE}/${po.id}/costs`)
      .set(h)
      .send({ type: 'OTHER', amount: '20000000', currency: 'IRR' })
      .expect(400);

    await request(app.getHttpServer())
      .post(`${BASE}/${po.id}/costs`)
      .set(h)
      .send({ type: 'OTHER', amount: '20000000', currency: 'IRR', description: 'هزینه بارگیری' })
      .expect(201);

    for (const amount of ['0', '-10']) {
      await request(app.getHttpServer())
        .post(`${BASE}/${po.id}/costs`)
        .set(h)
        .send({ type: 'COURIER', amount, currency: 'IRR' })
        .expect(400);
    }
  });

  it('allows costs after confirm, blocks silent edit, voids with reason', async () => {
    const token = await login(ownerEmail);
    const h = auth(token);
    const events: Array<Record<string, unknown>> = [];
    const handlerId = `po-cost-${Date.now()}`;
    eventBus.subscribe(DOMAIN_EVENTS.PURCHASING_PURCHASE_COST_ADDED, handlerId, (event) => {
      events.push(event.payload as Record<string, unknown>);
    });
    eventBus.subscribe(DOMAIN_EVENTS.PURCHASING_PURCHASE_COST_VOIDED, `${handlerId}-v`, (event) => {
      events.push(event.payload as Record<string, unknown>);
    });

    const po = await createPo(token, {
      supplierId: tehranSupplierId,
      currency: 'IRR',
      purchaseType: 'TERM_CREDIT',
      paymentTermType: 'NET_DAYS',
      netDays: 10,
      items: [{ skuId: mascaraSkuId, quantity: 1, unitPrice: '1000000' }],
    });
    const draftCost = await request(app.getHttpServer())
      .post(`${BASE}/${po.id}/costs`)
      .set(h)
      .send({ type: 'COURIER', amount: '8000000', currency: 'IRR' })
      .expect(201);
    const draftCostId = draftCost.body.data.id as string;

    await request(app.getHttpServer()).post(`${BASE}/${po.id}/approve`).set(h).expect(201);
    await request(app.getHttpServer()).post(`${BASE}/${po.id}/mark-ordered`).set(h).expect(201);

    await request(app.getHttpServer())
      .patch(`${BASE}/${po.id}/costs/${draftCostId}`)
      .set(h)
      .send({ amount: '12000000' })
      .expect(409);

    const later = await request(app.getHttpServer())
      .post(`${BASE}/${po.id}/costs`)
      .set(h)
      .send({ type: 'FREIGHT', amount: '20000000', currency: 'IRR', description: 'باربری بعد از تأیید' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`${BASE}/${po.id}/costs/${later.body.data.id}/void`)
      .set(h)
      .send({})
      .expect(400);

    const voided = await request(app.getHttpServer())
      .post(`${BASE}/${po.id}/costs/${later.body.data.id}/void`)
      .set(h)
      .send({ reason: 'ثبت مبلغ اشتباه' })
      .expect(201);
    expect(voided.body.data.status).toBe('VOIDED');
    expect(voided.body.data.voidReason).toBe('ثبت مبلغ اشتباه');

    const listed = await request(app.getHttpServer())
      .get(`${BASE}/${po.id}/costs`)
      .set(h)
      .expect(200);
    expect(listed.body.summary.purchaseCostTotalsByCurrency).toEqual([
      { currency: 'IRR', amount: '8000000' },
    ]);
    expect(listed.body.data.some((row: { status: string }) => row.status === 'VOIDED')).toBe(true);

    await settle();
    expect(events.some((e) => e.purchaseCostId === later.body.data.id && e.status === 'VOIDED')).toBe(
      true,
    );

    const audits = await database.client.auditLog.findMany({
      where: {
        companyId: pishtehId,
        entityId: later.body.data.id,
        action: { in: ['PURCHASE_COST_CREATED', 'PURCHASE_COST_VOIDED'] },
      },
    });
    expect(audits.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps FX liability and credit terms unchanged when adding mixed-currency costs', async () => {
    const token = await login(ownerEmail);
    const h = auth(token);
    const po = await createPo(token, {
      supplierId: tehranSupplierId,
      currency: 'USD',
      purchaseType: 'FX_CREDIT',
      paymentTermType: 'NET_DAYS',
      netDays: 30,
      orderDate: '2026-10-03T08:00:00.000Z',
      referenceFxRate: '2050000',
      referenceFxBaseCurrency: 'USD',
      referenceFxQuoteCurrency: 'IRR',
      items: [{ skuId: mascaraSkuId, quantity: 1000, unitPrice: '1.00' }],
    });
    await request(app.getHttpServer()).post(`${BASE}/${po.id}/approve`).set(h).expect(201);
    await request(app.getHttpServer()).post(`${BASE}/${po.id}/mark-ordered`).set(h).expect(201);

    await request(app.getHttpServer())
      .post(`${BASE}/${po.id}/costs`)
      .set(h)
      .send({ type: 'COURIER', amount: '20000000', currency: 'IRR' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${BASE}/${po.id}/costs`)
      .set(h)
      .send({ type: 'PURCHASE_FEE', amount: '10', currency: 'USD' })
      .expect(201);

    const detail = await request(app.getHttpServer()).get(`${BASE}/${po.id}`).set(h).expect(200);
    expect(detail.body.data.obligationAmount).toBe('1000');
    expect(detail.body.data.referenceFxRate).toBe('2050000');
    expect(detail.body.data.netDays).toBe(30);
    expect(detail.body.data.dueDate.startsWith('2026-11-02')).toBe(true);
    expect(detail.body.data.purchaseCostTotalsByCurrency).toEqual([
      { currency: 'IRR', amount: '20000000' },
      { currency: 'USD', amount: '10' },
    ]);
    expect(detail.body.data.referenceAcquisitionTotal).toBeNull();
    expect(detail.body.data.items[0].unitPrice).toBe('1');
  });

  it('enforces company isolation, mass-assignment, RBAC, concurrency, and no Finance/Warehouse side effects', async () => {
    const token = await login(ownerEmail);
    const h = auth(token);
    const po = await createPo(token, {
      supplierId: tehranSupplierId,
      currency: 'IRR',
      purchaseType: 'CASH',
      items: [{ skuId: mascaraSkuId, quantity: 1, unitPrice: '1000' }],
    });

    await request(app.getHttpServer())
      .get(`${BASE}/${demoBPoId}/costs`)
      .set(h)
      .expect(404);
    await request(app.getHttpServer())
      .post(`${BASE}/${demoBPoId}/costs`)
      .set(h)
      .send({ type: 'COURIER', amount: '1000', currency: 'IRR' })
      .expect(404);

    await request(app.getHttpServer())
      .post(`${BASE}/${po.id}/costs`)
      .set(h)
      .send({
        type: 'COURIER',
        amount: '1000',
        currency: 'IRR',
        companyId: demoBId,
        status: 'VOIDED',
        createdById: demoBId,
        voidedById: demoBId,
      })
      .expect(400);

    const reader = await makeUser([PERMISSIONS.PURCHASING_READ]);
    await request(app.getHttpServer())
      .post(`${BASE}/${po.id}/costs`)
      .set(auth(reader))
      .send({ type: 'COURIER', amount: '1000', currency: 'IRR' })
      .expect(403);

    const results = await Promise.all(
      [1, 2, 3].map((n) =>
        request(app.getHttpServer())
          .post(`${BASE}/${po.id}/costs`)
          .set(h)
          .send({ type: 'COURIER', amount: String(1000 * n), currency: 'IRR', reference: `C-${n}-${Date.now()}` }),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);

    const costId = results[0]!.body.data.id as string;
    await request(app.getHttpServer()).post(`${BASE}/${po.id}/approve`).set(h).expect(201);
    await request(app.getHttpServer()).post(`${BASE}/${po.id}/mark-ordered`).set(h).expect(201);

    const voids = await Promise.all(
      [1, 2, 3].map(() =>
        request(app.getHttpServer())
          .post(`${BASE}/${po.id}/costs/${costId}/void`)
          .set(h)
          .send({ reason: 'concurrent void' }),
      ),
    );
    expect(voids.map((r) => r.status).sort()).toEqual([201, 409, 409]);

    const voidAudits = await database.client.auditLog.findMany({
      where: { companyId: pishtehId, entityId: costId, action: 'PURCHASE_COST_VOIDED' },
    });
    expect(voidAudits).toHaveLength(1);

    expect((database.client as { payment?: unknown }).payment).toBeUndefined();
    expect((database.client as { stockLedgerEntry?: unknown }).stockLedgerEntry).toBeUndefined();
  });
});
