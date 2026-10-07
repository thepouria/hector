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

describe('Purchase Order Types (e2e)', () => {
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
        number: `SEED-TYPE-IDOR-${Date.now()}`,
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
      purchaseType: string | null;
      paymentTermType: string | null;
      netDays: number | null;
      dueDate: string | null;
      dueStatus: string;
      termBasis: string | null;
      paymentTermsNote: string | null;
      total: string;
      obligationAmount: string | null;
      obligationCurrency: string | null;
      referenceFxRate: string | null;
      referenceFxBaseCurrency: string | null;
      referenceFxQuoteCurrency: string | null;
      referenceFxRateAt: string | null;
      referenceLocalValuation: string | null;
      referenceLocalValuationCurrency: string | null;
      settlementBasis: string | null;
      currency: string;
    };
  }

  async function makeUser(permissionKeys: string[]) {
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const role = await database.client.role.create({
      data: {
        companyId: pishtehId,
        key: `po-type-role-${stamp}`,
        name: `PO Type ${stamp}`,
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
        email: `po-type-${stamp}@hector.local`,
        firstName: 'PO',
        lastName: 'Type',
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

  it('creates, approves, and orders a CASH PO without payments/ledger/stock side effects', async () => {
    const token = await login(ownerEmail);
    const h = auth(token);
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const handlerId = `po-type-cash-${Date.now()}`;
    eventBus.subscribe(DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_APPROVED, handlerId, (event) => {
      events.push({ type: event.type, payload: event.payload as Record<string, unknown> });
    });

    const po = await createPo(token, {
      supplierId: tehranSupplierId,
      currency: 'IRR',
      purchaseType: 'CASH',
      items: [{ skuId: mascaraSkuId, quantity: 1000, unitPrice: '5850000' }],
    });
    expect(po.purchaseType).toBe('CASH');
    expect(po.netDays).toBeNull();
    expect(po.obligationAmount).toBeNull();
    expect(po.total).toBe('5850000000');

    await request(app.getHttpServer()).post(`${BASE}/${po.id}/approve`).set(h).expect(201);
    const ordered = await request(app.getHttpServer())
      .post(`${BASE}/${po.id}/mark-ordered`)
      .set(h)
      .expect(201);
    expect(ordered.body.data.purchaseType).toBe('CASH');
    expect(ordered.body.data.paymentTermType).toBe('IMMEDIATE');

    await settle();
    const approvedEvents = events.filter((e) => e.payload.purchaseOrderId === po.id);
    expect(approvedEvents).toHaveLength(1);
    expect(approvedEvents[0]?.payload).toMatchObject({
      purchaseOrderId: po.id,
      purchaseType: 'CASH',
    });
  });

  it('computes TERM_CREDIT due date from ORDER_DATE + netDays', async () => {
    const token = await login(ownerEmail);
    const h = auth(token);
    const po = await createPo(token, {
      supplierId: tehranSupplierId,
      currency: 'IRR',
      purchaseType: 'TERM_CREDIT',
      paymentTermType: 'NET_DAYS',
      netDays: 10,
      orderDate: '2026-10-03T11:00:00.000Z',
      items: [{ skuId: mascaraSkuId, quantity: 1000, unitPrice: '6000000' }],
    });
    expect(po.termBasis).toBe('ORDER_DATE');
    expect(po.dueDate?.startsWith('2026-10-13')).toBe(true);
    expect(po.total).toBe('6000000000');

    const approved = await request(app.getHttpServer())
      .post(`${BASE}/${po.id}/approve`)
      .set(h)
      .expect(201);
    expect(approved.body.data.dueDate.startsWith('2026-10-13')).toBe(true);
  });

  it('persists FX_CREDIT foreign obligation and reference FX pair exactly', async () => {
    const token = await login(ownerEmail);
    const h = auth(token);
    const events: Array<Record<string, unknown>> = [];
    const handlerId = `po-type-fx-${Date.now()}`;
    eventBus.subscribe(DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_APPROVED, handlerId, (event) => {
      events.push(event.payload as Record<string, unknown>);
    });

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
    expect(po.total).toBe('1000');
    expect(po.referenceFxRate).toBe('2050000');

    const approved = await request(app.getHttpServer())
      .post(`${BASE}/${po.id}/approve`)
      .set(h)
      .expect(201);
    expect(approved.body.data.obligationAmount).toBe('1000');
    expect(approved.body.data.obligationCurrency).toBe('USD');
    expect(approved.body.data.referenceFxRate).toBe('2050000');
    expect(approved.body.data.referenceFxBaseCurrency).toBe('USD');
    expect(approved.body.data.referenceFxQuoteCurrency).toBe('IRR');
    expect(approved.body.data.dueDate.startsWith('2026-11-02')).toBe(true);

    await settle();
    expect(events.find((e) => e.purchaseOrderId === po.id)).toMatchObject({
      purchaseType: 'FX_CREDIT',
      obligationAmount: '1000',
      obligationCurrency: 'USD',
    });
  });

  it('preserves decimal FX obligation 842.75 and large reference FX rates', async () => {
    const token = await login(ownerEmail);
    const h = auth(token);
    const po = await createPo(token, {
      supplierId: tehranSupplierId,
      currency: 'USD',
      purchaseType: 'FX_CREDIT',
      paymentTermType: 'NET_DAYS',
      netDays: 30,
      referenceFxRate: '2500000000',
      referenceFxBaseCurrency: 'USD',
      referenceFxQuoteCurrency: 'IRR',
      items: [{ skuId: mascaraSkuId, quantity: 1, unitPrice: '842.75' }],
    });
    const approved = await request(app.getHttpServer())
      .post(`${BASE}/${po.id}/approve`)
      .set(h)
      .expect(201);
    expect(approved.body.data.obligationAmount).toBe('842.75');
    expect(approved.body.data.referenceFxRate).toBe('2500000000');
  });

  it('rejects CASH with FX/term fields and TERM/FX invalid states on approve', async () => {
    const token = await login(ownerEmail);
    const h = auth(token);

    await request(app.getHttpServer())
      .post(BASE)
      .set(h)
      .send({
        supplierId: tehranSupplierId,
        currency: 'IRR',
        purchaseType: 'CASH',
        netDays: 30,
        items: [{ skuId: mascaraSkuId, quantity: 1, unitPrice: '1000' }],
      })
      .expect(400);

    const termZero = await createPo(token, {
      supplierId: tehranSupplierId,
      currency: 'IRR',
      purchaseType: 'TERM_CREDIT',
      items: [{ skuId: mascaraSkuId, quantity: 1, unitPrice: '1000' }],
    });
    const termFail = await request(app.getHttpServer())
      .post(`${BASE}/${termZero.id}/approve`)
      .set(h)
      .expect(400);
    expect(termFail.body.error.code).toBe('PURCHASE_ORDER_TERMS_INCOMPLETE');

    await request(app.getHttpServer())
      .patch(`${BASE}/${termZero.id}`)
      .set(h)
      .send({ netDays: 0, expectedVersion: termZero.version })
      .expect(400);

    const fxMissing = await createPo(token, {
      supplierId: tehranSupplierId,
      currency: 'USD',
      purchaseType: 'FX_CREDIT',
      paymentTermType: 'NET_DAYS',
      netDays: 30,
      items: [{ skuId: mascaraSkuId, quantity: 1, unitPrice: '10' }],
    });
    const fxFail = await request(app.getHttpServer())
      .post(`${BASE}/${fxMissing.id}/approve`)
      .set(h)
      .expect(400);
    expect(fxFail.body.error.code).toBe('PURCHASE_ORDER_TERMS_INCOMPLETE');

    await request(app.getHttpServer())
      .post(BASE)
      .set(h)
      .send({
        supplierId: tehranSupplierId,
        currency: 'USD',
        purchaseType: 'FX_CREDIT',
        netDays: 30,
        referenceFxRate: '0',
        referenceFxBaseCurrency: 'USD',
        referenceFxQuoteCurrency: 'IRR',
        items: [{ skuId: mascaraSkuId, quantity: 1, unitPrice: '10' }],
      })
      .expect(400);

    await request(app.getHttpServer())
      .post(BASE)
      .set(h)
      .send({
        supplierId: tehranSupplierId,
        currency: 'USD',
        purchaseType: 'FX_CREDIT',
        netDays: 30,
        referenceFxRate: '2050000',
        referenceFxBaseCurrency: 'USD',
        // missing quote → ambiguous pair
        items: [{ skuId: mascaraSkuId, quantity: 1, unitPrice: '10' }],
      })
      .expect(400);
  });

  it('clears stale terms when Draft purchase type changes', async () => {
    const token = await login(ownerEmail);
    const h = auth(token);
    const termPo = await createPo(token, {
      supplierId: tehranSupplierId,
      currency: 'IRR',
      purchaseType: 'TERM_CREDIT',
      paymentTermType: 'NET_DAYS',
      netDays: 10,
      orderDate: '2026-10-03T11:00:00.000Z',
      items: [{ skuId: mascaraSkuId, quantity: 1, unitPrice: '1000000' }],
    });
    expect(termPo.netDays).toBe(10);

    const cash = await request(app.getHttpServer())
      .patch(`${BASE}/${termPo.id}`)
      .set(h)
      .send({ purchaseType: 'CASH', expectedVersion: termPo.version })
      .expect(200);
    expect(cash.body.data.purchaseType).toBe('CASH');
    expect(cash.body.data.netDays).toBeNull();
    expect(cash.body.data.dueDate).toBeNull();

    const fxPo = await createPo(token, {
      supplierId: tehranSupplierId,
      currency: 'USD',
      purchaseType: 'FX_CREDIT',
      paymentTermType: 'NET_DAYS',
      netDays: 30,
      referenceFxRate: '2050000',
      referenceFxBaseCurrency: 'USD',
      referenceFxQuoteCurrency: 'IRR',
      items: [{ skuId: mascaraSkuId, quantity: 1, unitPrice: '1000.25' }],
    });
    expect(fxPo.referenceFxRate).toBe('2050000');

    const clearedFx = await request(app.getHttpServer())
      .patch(`${BASE}/${fxPo.id}`)
      .set(h)
      .send({ purchaseType: 'CASH', expectedVersion: fxPo.version })
      .expect(200);
    expect(clearedFx.body.data.purchaseType).toBe('CASH');
    expect(clearedFx.body.data.obligationAmount).toBeNull();
    expect(clearedFx.body.data.referenceFxRate).toBeNull();
    expect(clearedFx.body.data.netDays).toBeNull();
  });

  it('rejects confirmed commercial-term mutations', async () => {
    const token = await login(ownerEmail);
    const h = auth(token);
    const po = await createPo(token, {
      supplierId: tehranSupplierId,
      currency: 'USD',
      purchaseType: 'FX_CREDIT',
      paymentTermType: 'NET_DAYS',
      netDays: 30,
      referenceFxRate: '2050000',
      referenceFxBaseCurrency: 'USD',
      referenceFxQuoteCurrency: 'IRR',
      items: [{ skuId: mascaraSkuId, quantity: 1, unitPrice: '1000' }],
    });
    await request(app.getHttpServer()).post(`${BASE}/${po.id}/approve`).set(h).expect(201);
    await request(app.getHttpServer()).post(`${BASE}/${po.id}/mark-ordered`).set(h).expect(201);
    const ordered = await request(app.getHttpServer()).get(`${BASE}/${po.id}`).set(h).expect(200);
    const version = ordered.body.data.version as number;

    for (const body of [
      { purchaseType: 'CASH', expectedVersion: version },
      { purchaseType: 'TERM_CREDIT', expectedVersion: version },
      { netDays: 45, expectedVersion: version },
      { obligationAmount: '900', expectedVersion: version },
      { referenceFxRate: '2200000', expectedVersion: version },
    ]) {
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/${po.id}`)
        .set(h)
        .send(body)
        .expect(409);
      expect(res.body.error.code).toBe('PURCHASE_ORDER_NOT_EDITABLE');
    }
  });

  it('keeps Offer terms independent when Draft PO terms are renegotiated', async () => {
    const token = await login(ownerEmail);
    const h = auth(token);
    const offer = await database.client.supplierOffer.create({
      data: {
        companyId: pishtehId,
        supplierId: tehranSupplierId,
        skuId: mascaraSkuId,
        unitPrice: '6000000',
        currency: CurrencyCode.IRR,
        purchaseType: PurchaseCommercialType.TERM_CREDIT,
        paymentTermType: 'NET_DAYS' as const,
        netDays: 30,
        quotedAt: new Date(),
        createdById: ownerId,
        notes: `SEED:TYPE-QUOTE-${Date.now()}`,
      },
    });

    const po = await createPo(token, {
      supplierId: tehranSupplierId,
      currency: 'IRR',
      purchaseType: 'TERM_CREDIT',
      paymentTermType: 'NET_DAYS',
      netDays: 30,
      items: [
        {
          skuId: mascaraSkuId,
          quantity: 1,
          unitPrice: '6000000',
          supplierOfferId: offer.id,
        },
      ],
    });

    await request(app.getHttpServer())
      .patch(`${BASE}/${po.id}`)
      .set(h)
      .send({ netDays: 20, expectedVersion: po.version })
      .expect(200);
    const detail = await request(app.getHttpServer()).get(`${BASE}/${po.id}`).set(h).expect(200);
    const itemId = detail.body.data.items[0].id as string;
    await request(app.getHttpServer())
      .patch(`${BASE}/${po.id}/items/${itemId}`)
      .set(h)
      .send({ unitPrice: '5900000' })
      .expect(200);

    const unchangedOffer = await database.client.supplierOffer.findUniqueOrThrow({
      where: { id: offer.id },
    });
    expect(unchangedOffer.netDays).toBe(30);
    expect(unchangedOffer.unitPrice.toString()).toBe('6000000');

    const finalPo = await request(app.getHttpServer()).get(`${BASE}/${po.id}`).set(h).expect(200);
    expect(finalPo.body.data.netDays).toBe(20);
    expect(finalPo.body.data.items[0].unitPrice).toBe('5900000');
  });

  it('enforces company isolation, mass-assignment, RBAC, audit, and confirm concurrency', async () => {
    const token = await login(ownerEmail);
    const h = auth(token);

    await request(app.getHttpServer())
      .patch(`${BASE}/${demoBPoId}`)
      .set(h)
      .send({ purchaseType: 'TERM_CREDIT', netDays: 10 })
      .expect(404);

    // Mass-assignment of system fields is rejected by ValidationPipe (forbidNonWhitelisted).
    await request(app.getHttpServer())
      .post(BASE)
      .set(h)
      .send({
        supplierId: tehranSupplierId,
        currency: 'IRR',
        purchaseType: 'CASH',
        status: 'ORDERED',
        companyId: demoBId,
        confirmedAt: new Date().toISOString(),
        createdById: demoBId,
        items: [{ skuId: mascaraSkuId, quantity: 1, unitPrice: '1000' }],
      })
      .expect(400);

    const created = await createPo(token, {
      supplierId: tehranSupplierId,
      currency: 'IRR',
      purchaseType: 'CASH',
      items: [{ skuId: mascaraSkuId, quantity: 1, unitPrice: '1000' }],
    });
    expect(created.status).toBe('DRAFT');

    const reader = await makeUser([PERMISSIONS.PURCHASING_READ]);
    await request(app.getHttpServer())
      .patch(`${BASE}/${created.id}`)
      .set(auth(reader))
      .send({ purchaseType: 'TERM_CREDIT', netDays: 10 })
      .expect(403);

    const manager = await makeUser([
      PERMISSIONS.PURCHASING_READ,
      PERMISSIONS.PURCHASING_MANAGE,
      PERMISSIONS.PURCHASING_CREATE,
    ]);
    await request(app.getHttpServer())
      .patch(`${BASE}/${created.id}`)
      .set(auth(manager))
      .send({
        purchaseType: 'TERM_CREDIT',
        paymentTermType: 'NET_DAYS',
        netDays: 15,
        expectedVersion: created.version,
      })
      .expect(200);

    await settle();
    const audits = await database.client.auditLog.findMany({
      where: {
        companyId: pishtehId,
        entityId: created.id,
        action: 'PURCHASE_ORDER_UPDATED',
      },
      orderBy: { createdAt: 'desc' },
      take: 3,
    });
    expect(
      audits.some((row) => {
        const after = row.after as { purchaseType?: string } | null;
        return after?.purchaseType === 'TERM_CREDIT';
      }),
    ).toBe(true);

    const fx = await createPo(token, {
      supplierId: tehranSupplierId,
      currency: 'USD',
      purchaseType: 'FX_CREDIT',
      paymentTermType: 'NET_DAYS',
      netDays: 30,
      referenceFxRate: '2050000',
      referenceFxBaseCurrency: 'USD',
      referenceFxQuoteCurrency: 'IRR',
      items: [{ skuId: mascaraSkuId, quantity: 1, unitPrice: '100' }],
    });
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        request(app.getHttpServer()).post(`${BASE}/${fx.id}/approve`).set(h),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    const approvedAudits = await database.client.auditLog.findMany({
      where: {
        companyId: pishtehId,
        entityId: fx.id,
        action: 'PURCHASE_ORDER_APPROVED',
      },
    });
    expect(approvedAudits).toHaveLength(1);
  });

  it('exposes derived FX referenceLocalValuation and settlementBasis (Phase 2.6)', async () => {
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
      referenceFxRateAt: '2026-10-02T14:00:00.000Z',
      items: [{ skuId: mascaraSkuId, quantity: 1000, unitPrice: '1.00' }],
    });
    expect(po.referenceFxRateAt?.startsWith('2026-10-02')).toBe(true);
    expect(po.referenceLocalValuation).toBe('2050000000');
    expect(po.referenceLocalValuationCurrency).toBe('IRR');
    expect(po.settlementBasis).toBe('FOREIGN_OBLIGATION');

    const approved = await request(app.getHttpServer())
      .post(`${BASE}/${po.id}/approve`)
      .set(h)
      .expect(201);
    expect(approved.body.data.referenceLocalValuation).toBe('2050000000');
    expect(approved.body.data.obligationAmount).toBe('1000');
    expect(approved.body.data.referenceFxRate).toBe('2050000');

    // Hypothetical later market rate must not be writable after confirm.
    await request(app.getHttpServer())
      .post(`${BASE}/${po.id}/mark-ordered`)
      .set(h)
      .expect(201);
    const ordered = await request(app.getHttpServer()).get(`${BASE}/${po.id}`).set(h).expect(200);
    await request(app.getHttpServer())
      .patch(`${BASE}/${po.id}`)
      .set(h)
      .send({
        referenceFxRate: '2350000',
        expectedVersion: ordered.body.data.version,
      })
      .expect(409);
    expect(ordered.body.data.obligationAmount).toBe('1000');
    expect(ordered.body.data.referenceFxRate).toBe('2050000');
  });

  it('filters purchase orders by purchaseType=FX_CREDIT', async () => {
    const token = await login(ownerEmail);
    const h = auth(token);
    const fx = await createPo(token, {
      supplierId: tehranSupplierId,
      currency: 'USD',
      purchaseType: 'FX_CREDIT',
      paymentTermType: 'NET_DAYS',
      netDays: 30,
      referenceFxRate: '2050000',
      referenceFxBaseCurrency: 'USD',
      referenceFxQuoteCurrency: 'IRR',
      items: [{ skuId: mascaraSkuId, quantity: 1, unitPrice: '50' }],
    });
    const listed = await request(app.getHttpServer())
      .get(`${BASE}?purchaseType=FX_CREDIT&pageSize=100`)
      .set(h)
      .expect(200);
    expect(listed.body.data.some((row: { id: string }) => row.id === fx.id)).toBe(true);
    expect(
      listed.body.data.every((row: { purchaseType: string }) => row.purchaseType === 'FX_CREDIT'),
    ).toBe(true);
  });

  it('rejects FX_CREDIT with mismatched reference base currency', async () => {
    const token = await login(ownerEmail);
    await request(app.getHttpServer())
      .post(BASE)
      .set(auth(token))
      .send({
        supplierId: tehranSupplierId,
        currency: 'USD',
        purchaseType: 'FX_CREDIT',
        paymentTermType: 'NET_DAYS',
        netDays: 30,
        referenceFxRate: '2050000',
        referenceFxBaseCurrency: 'EUR',
        referenceFxQuoteCurrency: 'IRR',
        items: [{ skuId: mascaraSkuId, quantity: 1, unitPrice: '10' }],
      })
      .expect(400);
  });

  // ---------------------------------------------------------------------------
  // Phase 2.7 — Credit Terms + Due Dates
  // ---------------------------------------------------------------------------

  it('CASH uses IMMEDIATE terms with no due date / NO_DUE_DATE', async () => {
    const token = await login(ownerEmail);
    const po = await createPo(token, {
      supplierId: tehranSupplierId,
      currency: 'IRR',
      purchaseType: 'CASH',
      items: [{ skuId: mascaraSkuId, quantity: 1, unitPrice: '1000' }],
    });
    const detail = await request(app.getHttpServer())
      .get(`${BASE}/${po.id}`)
      .set(auth(token))
      .expect(200);
    expect(detail.body.data.paymentTermType).toBe('IMMEDIATE');
    expect(detail.body.data.netDays).toBeNull();
    expect(detail.body.data.termBasis).toBeNull();
    expect(detail.body.data.dueDate).toBeNull();
    expect(detail.body.data.dueStatus).toBe('NO_DUE_DATE');
  });

  it('TERM_CREDIT 30-day NET_DAYS computes due date and rejects client dueDate override', async () => {
    const token = await login(ownerEmail);
    const h = auth(token);
    const po = await createPo(token, {
      supplierId: tehranSupplierId,
      currency: 'IRR',
      purchaseType: 'TERM_CREDIT',
      paymentTermType: 'NET_DAYS',
      netDays: 30,
      orderDate: '2026-10-03T09:00:00.000Z',
      items: [{ skuId: mascaraSkuId, quantity: 1, unitPrice: '1000000' }],
    });
    expect(po.dueDate?.startsWith('2026-11-02')).toBe(true);

    await request(app.getHttpServer())
      .post(BASE)
      .set(h)
      .send({
        supplierId: tehranSupplierId,
        currency: 'IRR',
        purchaseType: 'TERM_CREDIT',
        paymentTermType: 'NET_DAYS',
        netDays: 10,
        dueDate: '2026-12-01',
        orderDate: '2026-10-03T09:00:00.000Z',
        items: [{ skuId: mascaraSkuId, quantity: 1, unitPrice: '1000' }],
      })
      .expect(400);
  });

  it('FIXED_DATE persists explicit due date without fake netDays', async () => {
    const token = await login(ownerEmail);
    const h = auth(token);
    const po = await createPo(token, {
      supplierId: tehranSupplierId,
      currency: 'IRR',
      purchaseType: 'TERM_CREDIT',
      paymentTermType: 'FIXED_DATE',
      dueDate: '2026-11-15',
      orderDate: '2026-10-03T10:00:00.000Z',
      paymentTermsNote: 'تسویه تا ۲۵ آبان',
      items: [{ skuId: mascaraSkuId, quantity: 1, unitPrice: '2000000' }],
    });
    expect(po.paymentTermType).toBe('FIXED_DATE');
    expect(po.netDays).toBeNull();
    expect(po.termBasis).toBeNull();
    expect(po.dueDate?.startsWith('2026-11-15')).toBe(true);
    expect(po.paymentTermsNote).toBe('تسویه تا ۲۵ آبان');

    await request(app.getHttpServer())
      .post(BASE)
      .set(h)
      .send({
        supplierId: tehranSupplierId,
        currency: 'IRR',
        purchaseType: 'TERM_CREDIT',
        paymentTermType: 'FIXED_DATE',
        dueDate: '2026-11-15',
        netDays: 30,
        orderDate: '2026-10-03T10:00:00.000Z',
        items: [{ skuId: mascaraSkuId, quantity: 1, unitPrice: '1000' }],
      })
      .expect(400);

    await request(app.getHttpServer())
      .post(BASE)
      .set(h)
      .send({
        supplierId: tehranSupplierId,
        currency: 'IRR',
        purchaseType: 'TERM_CREDIT',
        paymentTermType: 'FIXED_DATE',
        dueDate: '2026-10-01',
        orderDate: '2026-10-03T10:00:00.000Z',
        items: [{ skuId: mascaraSkuId, quantity: 1, unitPrice: '1000' }],
      })
      .expect(400);
  });

  it('Draft term / orderDate changes recalculate NET_DAYS dueDate; NET↔FIXED switches cleanly', async () => {
    const token = await login(ownerEmail);
    const h = auth(token);
    const po = await createPo(token, {
      supplierId: tehranSupplierId,
      currency: 'IRR',
      purchaseType: 'TERM_CREDIT',
      paymentTermType: 'NET_DAYS',
      netDays: 10,
      orderDate: '2026-10-03T11:00:00.000Z',
      items: [{ skuId: mascaraSkuId, quantity: 1, unitPrice: '1000' }],
    });
    expect(po.dueDate?.startsWith('2026-10-13')).toBe(true);

    const to30 = await request(app.getHttpServer())
      .patch(`${BASE}/${po.id}`)
      .set(h)
      .send({ netDays: 30, expectedVersion: po.version })
      .expect(200);
    expect(to30.body.data.netDays).toBe(30);
    expect(to30.body.data.dueDate.startsWith('2026-11-02')).toBe(true);

    const moved = await request(app.getHttpServer())
      .patch(`${BASE}/${po.id}`)
      .set(h)
      .send({
        orderDate: '2026-10-05T11:00:00.000Z',
        expectedVersion: to30.body.data.version,
      })
      .expect(200);
    expect(moved.body.data.dueDate.startsWith('2026-11-04')).toBe(true);

    const toFixed = await request(app.getHttpServer())
      .patch(`${BASE}/${po.id}`)
      .set(h)
      .send({
        paymentTermType: 'FIXED_DATE',
        dueDate: '2026-12-01',
        expectedVersion: moved.body.data.version,
      })
      .expect(200);
    expect(toFixed.body.data.paymentTermType).toBe('FIXED_DATE');
    expect(toFixed.body.data.netDays).toBeNull();
    expect(toFixed.body.data.termBasis).toBeNull();
    expect(toFixed.body.data.dueDate.startsWith('2026-12-01')).toBe(true);

    const backNet = await request(app.getHttpServer())
      .patch(`${BASE}/${po.id}`)
      .set(h)
      .send({
        paymentTermType: 'NET_DAYS',
        netDays: 15,
        expectedVersion: toFixed.body.data.version,
      })
      .expect(200);
    expect(backNet.body.data.paymentTermType).toBe('NET_DAYS');
    expect(backNet.body.data.netDays).toBe(15);
    expect(backNet.body.data.dueDate.startsWith('2026-10-20')).toBe(true);
  });

  it('rejects invalid netDays and confirmed due-date / term mutations', async () => {
    const token = await login(ownerEmail);
    const h = auth(token);
    const draft = await createPo(token, {
      supplierId: tehranSupplierId,
      currency: 'IRR',
      purchaseType: 'TERM_CREDIT',
      paymentTermType: 'NET_DAYS',
      netDays: 10,
      orderDate: '2026-10-03T11:00:00.000Z',
      items: [{ skuId: mascaraSkuId, quantity: 1, unitPrice: '1000' }],
    });

    for (const netDays of [0, -10, 1.5]) {
      await request(app.getHttpServer())
        .patch(`${BASE}/${draft.id}`)
        .set(h)
        .send({ netDays, expectedVersion: draft.version })
        .expect(400);
    }

    await request(app.getHttpServer()).post(`${BASE}/${draft.id}/approve`).set(h).expect(201);
    await request(app.getHttpServer()).post(`${BASE}/${draft.id}/mark-ordered`).set(h).expect(201);
    const ordered = await request(app.getHttpServer()).get(`${BASE}/${draft.id}`).set(h).expect(200);
    const version = ordered.body.data.version as number;

    await request(app.getHttpServer())
      .patch(`${BASE}/${draft.id}`)
      .set(h)
      .send({ netDays: 60, expectedVersion: version })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`${BASE}/${draft.id}`)
      .set(h)
      .send({
        paymentTermType: 'FIXED_DATE',
        dueDate: '2026-12-02',
        expectedVersion: version,
      })
      .expect(409);
  });

  it('filters by dueFrom/dueTo/dueStatus/paymentTermType with company isolation', async () => {
    const token = await login(ownerEmail);
    const h = auth(token);

    const cash = await createPo(token, {
      supplierId: tehranSupplierId,
      currency: 'IRR',
      purchaseType: 'CASH',
      items: [{ skuId: mascaraSkuId, quantity: 1, unitPrice: '1000' }],
    });
    const overdue = await createPo(token, {
      supplierId: tehranSupplierId,
      currency: 'IRR',
      purchaseType: 'TERM_CREDIT',
      paymentTermType: 'NET_DAYS',
      netDays: 10,
      orderDate: '2020-01-01T12:00:00.000Z',
      items: [{ skuId: mascaraSkuId, quantity: 1, unitPrice: '1000' }],
    });
    const upcoming = await createPo(token, {
      supplierId: tehranSupplierId,
      currency: 'IRR',
      purchaseType: 'TERM_CREDIT',
      paymentTermType: 'FIXED_DATE',
      dueDate: '2099-06-15',
      orderDate: '2026-10-03T12:00:00.000Z',
      items: [{ skuId: mascaraSkuId, quantity: 1, unitPrice: '1000' }],
    });

    const none = await request(app.getHttpServer())
      .get(`${BASE}?dueStatus=NO_DUE_DATE&pageSize=100`)
      .set(h)
      .expect(200);
    expect(none.body.data.some((row: { id: string }) => row.id === cash.id)).toBe(true);
    expect(none.body.data.every((row: { dueDate: string | null }) => row.dueDate === null)).toBe(
      true,
    );

    const overdueList = await request(app.getHttpServer())
      .get(`${BASE}?dueStatus=OVERDUE&pageSize=100`)
      .set(h)
      .expect(200);
    expect(overdueList.body.data.some((row: { id: string }) => row.id === overdue.id)).toBe(true);
    expect(
      overdueList.body.data.every((row: { dueStatus: string }) => row.dueStatus === 'OVERDUE'),
    ).toBe(true);

    const range = await request(app.getHttpServer())
      .get(`${BASE}?dueFrom=2099-06-01&dueTo=2099-06-30&pageSize=100`)
      .set(h)
      .expect(200);
    expect(range.body.data.some((row: { id: string }) => row.id === upcoming.id)).toBe(true);

    const fixedOnly = await request(app.getHttpServer())
      .get(`${BASE}?paymentTermType=FIXED_DATE&pageSize=100`)
      .set(h)
      .expect(200);
    expect(fixedOnly.body.data.some((row: { id: string }) => row.id === upcoming.id)).toBe(true);
    expect(
      fixedOnly.body.data.every(
        (row: { paymentTermType: string }) => row.paymentTermType === 'FIXED_DATE',
      ),
    ).toBe(true);

    await request(app.getHttpServer())
      .get(`${BASE}?dueStatus=OVERDUE&pageSize=100`)
      .set(auth(token, demoBId))
      .expect(200)
      .then((res) => {
        expect(res.body.data.some((row: { id: string }) => row.id === overdue.id)).toBe(false);
      });
  });

  it('audits payment term changes and keeps confirm events free of Finance side effects', async () => {
    const token = await login(ownerEmail);
    const h = auth(token);
    const events: Array<Record<string, unknown>> = [];
    const handlerId = `po-credit-${Date.now()}`;
    eventBus.subscribe(DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_ORDERED, handlerId, (event) => {
      events.push(event.payload as Record<string, unknown>);
    });

    const po = await createPo(token, {
      supplierId: tehranSupplierId,
      currency: 'IRR',
      purchaseType: 'TERM_CREDIT',
      paymentTermType: 'NET_DAYS',
      netDays: 10,
      orderDate: '2026-10-03T11:00:00.000Z',
      items: [{ skuId: mascaraSkuId, quantity: 1, unitPrice: '5000000' }],
    });
    await request(app.getHttpServer())
      .patch(`${BASE}/${po.id}`)
      .set(h)
      .send({
        netDays: 30,
        paymentTermsNote: 'طبق توافق تلفنی',
        expectedVersion: po.version,
      })
      .expect(200);

    await settle();
    const audits = await database.client.auditLog.findMany({
      where: {
        companyId: pishtehId,
        entityId: po.id,
        action: 'PURCHASE_ORDER_UPDATED',
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    expect(
      audits.some((row) => {
        const after = row.after as {
          netDays?: number;
          dueDate?: string;
          paymentTermsNote?: string;
        } | null;
        return (
          after?.netDays === 30 &&
          after?.dueDate?.startsWith('2026-11-02') === true &&
          after?.paymentTermsNote === 'طبق توافق تلفنی'
        );
      }),
    ).toBe(true);

    await request(app.getHttpServer()).post(`${BASE}/${po.id}/approve`).set(h).expect(201);
    await request(app.getHttpServer()).post(`${BASE}/${po.id}/mark-ordered`).set(h).expect(201);
    await settle();
    const orderedEvent = events.find((e) => e.purchaseOrderId === po.id);
    expect(orderedEvent).toMatchObject({
      purchaseOrderId: po.id,
      purchaseType: 'TERM_CREDIT',
      paymentTermType: 'NET_DAYS',
      netDays: 30,
    });
    expect(typeof orderedEvent?.dueDate).toBe('string');
    expect((orderedEvent?.dueDate as string).startsWith('2026-11-02')).toBe(true);
  });
});
