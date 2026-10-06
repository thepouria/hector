import request from 'supertest';
import {
  BarcodeType,
  CompanyMemberStatus,
  CurrencyCode,
  PaymentTermType,
  PurchaseCommercialType,
  PurchaseOrderStatus,
  UserStatus,
  syncOwnerRolePermissions,
  syncPermissions,
} from '@hector/database';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { allocateAllItemsToBatches } from './helpers/batch-allocation';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';
import { cleanupPayablesForGoodsReceipts } from './helpers/payable-cleanup';

describe('Goods Receipt Scanner Receiving (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;
  let pishtehId: string;
  let demoBId: string;
  let mainWarehouseId: string;
  const createdReceiptIds: string[] = [];
  const createdBarcodeIds: string[] = [];

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
    mainWarehouseId = (
      await database.client.warehouse.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'MAIN' },
      })
    ).id;
    await database.client.user.update({
      where: { email: ownerEmail },
      data: { status: UserStatus.ACTIVE, deletedAt: null },
    });

    const opRole = await database.client.role.findFirstOrThrow({
      where: { companyId: pishtehId, key: 'WAREHOUSE_OPERATOR', deletedAt: null },
    });
    const receiptPerms = await database.client.permission.findMany({
      where: {
        key: {
          in: [
            'warehouse.receipt.read',
            'warehouse.receipt.manage',
            'warehouse.receipt.post',
            'warehouse.read',
          ],
        },
      },
    });
    for (const permission of receiptPerms) {
      await database.client.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId: opRole.id, permissionId: permission.id },
        },
        update: {},
        create: { roleId: opRole.id, permissionId: permission.id },
      });
    }
  });

  afterAll(async () => {
    if (createdBarcodeIds.length > 0) {
      await database.client.barcode.deleteMany({ where: { id: { in: createdBarcodeIds } } });
    }
    if (createdReceiptIds.length > 0) {
      await cleanupPayablesForGoodsReceipts(database, createdReceiptIds);
      await database.client.goodsReceiptScanRequest.deleteMany({
        where: { goodsReceiptId: { in: createdReceiptIds } },
      });
      await database.client.goodsReceiptItem.deleteMany({
        where: { goodsReceiptId: { in: createdReceiptIds } },
      });
      await database.client.goodsReceipt.deleteMany({
        where: { id: { in: createdReceiptIds } },
      });
    }
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

  /** Match Catalog `normalizeScannedValue` for OTHER/alphanumeric barcodes. */
  function scannerNormalized(value: string): string {
    // eslint-disable-next-line no-control-regex -- mirror Catalog scanner control strip
    const stripped = value.replace(/[\u0000-\u001F\u007F]/g, '').trim();
    const compact = stripped.replace(/\s+/g, '');
    if (/^\d+$/.test(compact)) return compact;
    if (/^[A-Za-z0-9._-]+$/.test(stripped)) return stripped.toUpperCase();
    return stripped;
  }

  async function ensureBarcode(skuId: string, value: string): Promise<string> {
    const normalizedValue = scannerNormalized(value);
    const existing = await database.client.barcode.findFirst({
      where: { companyId: pishtehId, normalizedValue },
    });
    if (existing) {
      if (existing.skuId !== skuId || existing.archivedAt) {
        await database.client.barcode.update({
          where: { id: existing.id },
          data: {
            skuId,
            value,
            normalizedValue,
            archivedAt: null,
            type: BarcodeType.OTHER,
            isPrimary: false,
          },
        });
      }
      return existing.id;
    }
    const created = await database.client.barcode.create({
      data: {
        companyId: pishtehId,
        skuId,
        value,
        normalizedValue,
        type: BarcodeType.OTHER,
        isPrimary: false,
      },
    });
    createdBarcodeIds.push(created.id);
    return created.id;
  }

  async function createOrderedPo(
    token: string,
    quantity: number,
    skuId?: string,
  ): Promise<{ poId: string; itemId: string; skuId: string }> {
    const supplier = await database.client.supplier.findFirstOrThrow({
      where: { companyId: pishtehId, status: 'ACTIVE' },
    });
    const sku = skuId
      ? await database.client.sku.findFirstOrThrow({ where: { id: skuId, companyId: pishtehId } })
      : await database.client.sku.findFirstOrThrow({
          where: { companyId: pishtehId, code: 'ESS-MASCARA-01' },
        });
    const created = await request(app.getHttpServer())
      .post('/api/v1/purchasing/purchase-orders')
      .set(auth(token))
      .send({
        supplierId: supplier.id,
        currency: CurrencyCode.IRR,
        purchaseType: PurchaseCommercialType.CASH,
        paymentTermType: PaymentTermType.IMMEDIATE,
        orderDate: '2026-10-04T00:00:00.000Z',
        items: [{ skuId: sku.id, quantity, unitPrice: '10000' }],
      })
      .expect(201);
    const poId = created.body.data.id as string;
    const itemId = created.body.data.items[0].id as string;
    await request(app.getHttpServer())
      .post(`/api/v1/purchasing/purchase-orders/${poId}/approve`)
      .set(auth(token))
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/purchasing/purchase-orders/${poId}/mark-ordered`)
      .set(auth(token))
      .send({})
      .expect(201);
    return { poId, itemId, skuId: sku.id };
  }

  async function createDraftGrn(token: string, purchaseOrderId: string) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/goods-receipts')
      .set(auth(token))
      .send({ purchaseOrderId, warehouseId: mainWarehouseId })
      .expect(201);
    createdReceiptIds.push(res.body.data.id);
    return res.body.data as { id: string; status: string };
  }

  it('resolves known barcode and applies unit + quantity scans without duplicate rows', async () => {
    const token = await login(ownerEmail);
    const mascara = await database.client.sku.findFirstOrThrow({
      where: { companyId: pishtehId, code: 'ESS-MASCARA-01' },
    });
    const barcode = '4059729196967';
    await ensureBarcode(mascara.id, barcode);
    const secondary = 'DEV-BC-ESS-MASCARA-01';
    await ensureBarcode(mascara.id, secondary);
    const leadingZero = '0012345678905';
    await ensureBarcode(mascara.id, leadingZero);

    const { poId } = await createOrderedPo(token, 100, mascara.id);
    const draft = await createDraftGrn(token, poId);

    const resolved = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${draft.id}/scan/resolve`)
      .set(auth(token))
      .send({ barcode })
      .expect(201);
    expect(resolved.body.data.status).toBe('MATCHED');
    expect(resolved.body.data.sku.code).toBe('ESS-MASCARA-01');
    expect(resolved.body.data.line.remainingQuantity).toBe(100);
    expect(resolved.body.data.line.availableToAdd).toBe(100);

    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post(`/api/v1/goods-receipts/${draft.id}/scan/apply`)
        .set(auth(token))
        .send({ barcode, quantity: 1, requestId: randomUUID() })
        .expect(201);
    }

    const afterUnits = await request(app.getHttpServer())
      .get(`/api/v1/goods-receipts/${draft.id}`)
      .set(auth(token))
      .expect(200);
    expect(afterUnits.body.data.items).toHaveLength(1);
    expect(afterUnits.body.data.items[0].quantity).toBe(5);

    const qty = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${draft.id}/scan/apply`)
      .set(auth(token))
      .send({ barcode: secondary, quantity: 20, requestId: randomUUID() })
      .expect(201);
    expect(qty.body.data.status).toBe('APPLIED');
    expect(qty.body.data.draftQuantity).toBe(25);
    expect(qty.body.data.receipt.items).toHaveLength(1);

    const leading = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${draft.id}/scan/resolve`)
      .set(auth(token))
      .send({ barcode: leadingZero })
      .expect(201);
    expect(leading.body.data.status).toBe('MATCHED');
    expect(leading.body.data.barcode).toBe(leadingZero);
  });

  it('rejects unknown barcode and wrong SKU without mutation', async () => {
    const token = await login(ownerEmail);
    const mascara = await database.client.sku.findFirstOrThrow({
      where: { companyId: pishtehId, code: 'ESS-MASCARA-01' },
    });
    const otherSku = await database.client.sku.findFirstOrThrow({
      where: { companyId: pishtehId, code: { not: 'ESS-MASCARA-01' }, status: 'ACTIVE' },
    });
    const wrongBarcode = `SCAN-WRONG-${randomUUID().slice(0, 8)}`;
    await ensureBarcode(otherSku.id, wrongBarcode);

    const { poId } = await createOrderedPo(token, 50, mascara.id);
    const draft = await createDraftGrn(token, poId);

    const unknown = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${draft.id}/scan/resolve`)
      .set(auth(token))
      .send({ barcode: '9999999999999' })
      .expect(201);
    expect(unknown.body.data.status).toBe('UNKNOWN_BARCODE');

    const unknownApply = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${draft.id}/scan/apply`)
      .set(auth(token))
      .send({ barcode: '9999999999999', quantity: 1, requestId: randomUUID() });
    expect(unknownApply.status).toBe(404);
    expect(unknownApply.body.error.code).toBe('UNKNOWN_BARCODE');

    const wrong = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${draft.id}/scan/resolve`)
      .set(auth(token))
      .send({ barcode: wrongBarcode })
      .expect(201);
    expect(wrong.body.data.status).toBe('SKU_NOT_IN_PURCHASE_ORDER');

    const wrongApply = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${draft.id}/scan/apply`)
      .set(auth(token))
      .send({ barcode: wrongBarcode, quantity: 1, requestId: randomUUID() });
    expect(wrongApply.status).toBe(409);
    expect(wrongApply.body.error.code).toBe('SKU_NOT_IN_PURCHASE_ORDER');

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/goods-receipts/${draft.id}`)
      .set(auth(token))
      .expect(200);
    expect(detail.body.data.items).toHaveLength(0);
  });

  it(
    'enforces draft capacity, idempotency, and concurrent increments',
    async () => {
    const token = await login(ownerEmail);
    const mascara = await database.client.sku.findFirstOrThrow({
      where: { companyId: pishtehId, code: 'ESS-MASCARA-01' },
    });
    const barcode = `SCAN-CAP-${randomUUID().slice(0, 8)}`;
    await ensureBarcode(mascara.id, barcode);

    const { poId, itemId } = await createOrderedPo(token, 10, mascara.id);
    // Post 5 first → remaining 5
    const first = await createDraftGrn(token, poId);
    await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${first.id}/items`)
      .set(auth(token))
      .send({ purchaseOrderItemId: itemId, quantity: 5 })
      .expect(201);
    await allocateAllItemsToBatches(app, auth(token), first.id);
    await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${first.id}/post`)
      .set(auth(token))
      .send({})
      .expect(201);

    const draft = await createDraftGrn(token, poId);

    const requestId = randomUUID();
    const firstApply = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${draft.id}/scan/apply`)
      .set(auth(token))
      .send({ barcode, quantity: 2, requestId })
      .expect(201);
    expect(firstApply.body.data.draftQuantity).toBe(2);
    expect(firstApply.body.data.replayed).toBe(false);

    const replay = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${draft.id}/scan/apply`)
      .set(auth(token))
      .send({ barcode, quantity: 2, requestId })
      .expect(201);
    expect(replay.body.data.replayed).toBe(true);
    expect(replay.body.data.draftQuantity).toBe(2);

    const secondId = randomUUID();
    await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${draft.id}/scan/apply`)
      .set(auth(token))
      .send({ barcode, quantity: 1, requestId: secondId })
      .expect(201);

    const over = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${draft.id}/scan/apply`)
      .set(auth(token))
      .send({ barcode, quantity: 10, requestId: randomUUID() });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('RECEIVING_QUANTITY_EXCEEDED');
    expect(over.body.error.details.availableToAdd).toBe(2);

    // Cancel the open draft so concurrent race uses clean remaining capacity.
    await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${draft.id}/cancel`)
      .set(auth(token))
      .send({})
      .expect(201);

    // Fresh PO avoids leftover draft contention; keep race small to avoid pool starvation.
    const race = await createOrderedPo(token, 3, mascara.id);
    const concurrentDraft = await createDraftGrn(token, race.poId);
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        request(app.getHttpServer())
          .post(`/api/v1/goods-receipts/${concurrentDraft.id}/scan/apply`)
          .set(auth(token))
          .send({ barcode, quantity: 1, requestId: randomUUID() }),
      ),
    );
    const successes = results.filter((r) => r.status === 201);
    const failures = results.filter((r) => r.status !== 201);
    expect(successes).toHaveLength(3);
    expect(failures).toHaveLength(3);
    for (const f of failures) {
      expect(f.body.error.code).toMatch(
        /RECEIVING_QUANTITY_EXCEEDED|PO_ITEM_ALREADY_FULLY_RECEIVED/,
      );
    }
    const after = await request(app.getHttpServer())
      .get(`/api/v1/goods-receipts/${concurrentDraft.id}`)
      .set(auth(token))
      .expect(200);
    expect(after.body.data.items).toHaveLength(1);
    expect(after.body.data.items[0].quantity).toBe(3);
  });

  it('blocks posted GRN, reader RBAC, and cross-tenant barcode leak', async () => {
    const token = await login(ownerEmail);
    const mascara = await database.client.sku.findFirstOrThrow({
      where: { companyId: pishtehId, code: 'ESS-MASCARA-01' },
    });
    const barcode = `SCAN-SEC-${randomUUID().slice(0, 8)}`;
    await ensureBarcode(mascara.id, barcode);
    const { poId, itemId } = await createOrderedPo(token, 5, mascara.id);
    const draft = await createDraftGrn(token, poId);
    await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${draft.id}/items`)
      .set(auth(token))
      .send({ purchaseOrderItemId: itemId, quantity: 5 })
      .expect(201);
    await allocateAllItemsToBatches(app, auth(token), draft.id);
    await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${draft.id}/post`)
      .set(auth(token))
      .send({})
      .expect(201);

    const postedScan = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${draft.id}/scan/apply`)
      .set(auth(token))
      .send({ barcode, quantity: 1, requestId: randomUUID() });
    expect(postedScan.status).toBe(409);
    expect(postedScan.body.error.code).toMatch(/POSTED_IMMUTABLE|GRN_NOT_DRAFT/);

    // Reader role: strip manage from a temp member if needed — use warehouse operator
    // who has manage; create a reader-only user via role without manage.
    const readerEmail = `scanner-reader-${randomUUID().slice(0, 8)}@hector.local`;
    const readerUser = await database.client.user.create({
      data: {
        email: readerEmail,
        passwordHash: (
          await database.client.user.findUniqueOrThrow({ where: { email: ownerEmail } })
        ).passwordHash,
        firstName: 'Scan',
        lastName: 'Reader',
        status: UserStatus.ACTIVE,
      },
    });
    const readerRole = await database.client.role.create({
      data: {
        companyId: pishtehId,
        key: `SCAN_READER_${randomUUID().slice(0, 6)}`,
        name: 'Scanner Reader Temp',
      },
    });
    const readPerm = await database.client.permission.findFirstOrThrow({
      where: { key: 'warehouse.receipt.read' },
    });
    await database.client.rolePermission.create({
      data: { roleId: readerRole.id, permissionId: readPerm.id },
    });
    const member = await database.client.companyMember.create({
      data: {
        companyId: pishtehId,
        userId: readerUser.id,
        status: CompanyMemberStatus.ACTIVE,
      },
    });
    await database.client.companyMemberRole.create({
      data: { companyMemberId: member.id, roleId: readerRole.id },
    });

    const readerToken = await login(readerEmail);
    const readerDraftPo = await createOrderedPo(token, 3, mascara.id);
    const readerDraft = await createDraftGrn(token, readerDraftPo.poId);
    const forbidden = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${readerDraft.id}/scan/apply`)
      .set(auth(readerToken))
      .send({ barcode, quantity: 1, requestId: randomUUID() });
    expect(forbidden.status).toBe(403);

    // Tenant B barcode must appear unknown to company A
    const demoBarcode = await database.client.barcode.findFirst({
      where: { companyId: demoBId, value: 'DEV-BC-DEMO-B-ONLY' },
    });
    if (demoBarcode) {
      const leak = await request(app.getHttpServer())
        .post(`/api/v1/goods-receipts/${readerDraft.id}/scan/resolve`)
        .set(auth(token))
        .send({ barcode: 'DEV-BC-DEMO-B-ONLY' })
        .expect(201);
      expect(leak.body.data.status).toBe('UNKNOWN_BARCODE');
    }

    // Cleanup temp reader
    await database.client.companyMemberRole.deleteMany({ where: { companyMemberId: member.id } });
    await database.client.companyMember.delete({ where: { id: member.id } });
    await database.client.rolePermission.deleteMany({ where: { roleId: readerRole.id } });
    await database.client.role.delete({ where: { id: readerRole.id } });
    await database.client.user.delete({ where: { id: readerUser.id } });
  });

  it('local sanity: 20 sequential unit scans complete without lost increments', async () => {
    const token = await login(ownerEmail);
    const mascara = await database.client.sku.findFirstOrThrow({
      where: { companyId: pishtehId, code: 'ESS-MASCARA-01' },
    });
    const barcode = `SCAN-PERF-${randomUUID().slice(0, 8)}`;
    await ensureBarcode(mascara.id, barcode);
    const { poId } = await createOrderedPo(token, 50, mascara.id);
    const draft = await createDraftGrn(token, poId);

    // Bounded local sanity (not a production benchmark). Full 100-scan bursts hit
    // the global API rate limiter in the e2e harness (~120 req/min).
    const count = 20;
    const started = Date.now();
    for (let i = 0; i < count; i++) {
      await request(app.getHttpServer())
        .post(`/api/v1/goods-receipts/${draft.id}/scan/apply`)
        .set(auth(token))
        .send({ barcode, quantity: 1, requestId: randomUUID() })
        .expect(201);
    }
    const elapsedMs = Date.now() - started;

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/goods-receipts/${draft.id}`)
      .set(auth(token))
      .expect(200);
    expect(detail.body.data.items).toHaveLength(1);
    expect(detail.body.data.items[0].quantity).toBe(count);
    expect(elapsedMs).toBeLessThan(30_000);
  });

  it('rejects scan when PO item is short-closed / fully received', async () => {
    const token = await login(ownerEmail);
    const shortPo = await database.client.purchaseOrder.findUnique({
      where: { companyId_number: { companyId: pishtehId, number: 'SEED-PO-SHORT-01' } },
      include: { items: true },
    });
    if (!shortPo || shortPo.status !== PurchaseOrderStatus.RECEIVED) {
      return;
    }
    // Cannot create GRN against RECEIVED — assertReceivingAllowed
    const create = await request(app.getHttpServer())
      .post('/api/v1/goods-receipts')
      .set(auth(token))
      .send({
        purchaseOrderId: shortPo.id,
        warehouseId: mainWarehouseId,
      });
    expect(create.status).toBe(409);
  });
});
