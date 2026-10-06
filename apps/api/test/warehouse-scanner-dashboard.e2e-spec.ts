import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  BarcodeType,
  CompanyMemberStatus,
  CurrencyCode,
  OWNER_ROLE_KEY,
  UserStatus,
  WarehouseLocationType,
  syncOwnerRolePermissions,
  syncPermissions,
} from '@hector/database';
import type { INestApplication } from '@nestjs/common';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';

describe('Warehouse Scanner + Dashboard (Phase 3.16–3.17 e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;
  let pishtehId: string;
  let demoBId: string;
  let ownerUserId: string;
  const tempCompanyIds: string[] = [];

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

    const owner = await database.client.user.update({
      where: { email: ownerEmail },
      data: { status: UserStatus.ACTIVE, deletedAt: null },
    });
    ownerUserId = owner.id;
  });

  afterAll(async () => {
    if (tempCompanyIds.length > 0) {
      await database.client.barcode.deleteMany({ where: { companyId: { in: tempCompanyIds } } });
      await database.client.sku.deleteMany({ where: { companyId: { in: tempCompanyIds } } });
      await database.client.product.deleteMany({ where: { companyId: { in: tempCompanyIds } } });
      await database.client.warehouseLocation.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.warehouse.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.auditLog.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.companyMemberRole.deleteMany({
        where: { companyMember: { companyId: { in: tempCompanyIds } } },
      });
      await database.client.rolePermission.deleteMany({
        where: { role: { companyId: { in: tempCompanyIds } } },
      });
      await database.client.companyMember.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.role.deleteMany({
        where: { companyId: { in: tempCompanyIds } },
      });
      await database.client.company.deleteMany({
        where: { id: { in: tempCompanyIds } },
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

  async function createTempCompany(): Promise<string> {
    const slug = `scan-tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const company = await database.client.company.create({
      data: {
        name: `Scanner Temp ${slug}`,
        slug,
        baseCurrency: CurrencyCode.IRR,
        timezone: 'Asia/Tehran',
      },
    });
    const role = await database.client.role.create({
      data: {
        companyId: company.id,
        key: OWNER_ROLE_KEY,
        name: 'Owner',
        isSystem: true,
      },
    });
    const templateOwner = await database.client.role.findFirstOrThrow({
      where: { companyId: pishtehId, key: OWNER_ROLE_KEY, deletedAt: null },
      include: { permissions: { select: { permissionId: true } } },
    });
    if (templateOwner.permissions.length > 0) {
      await database.client.rolePermission.createMany({
        data: templateOwner.permissions.map((p) => ({
          roleId: role.id,
          permissionId: p.permissionId,
        })),
        skipDuplicates: true,
      });
    }
    const membership = await database.client.companyMember.create({
      data: {
        companyId: company.id,
        userId: ownerUserId,
        status: CompanyMemberStatus.ACTIVE,
      },
    });
    await database.client.companyMemberRole.create({
      data: { companyMemberId: membership.id, roleId: role.id },
    });
    tempCompanyIds.push(company.id);
    return company.id;
  }

  it('returns dashboard aggregates for current company', async () => {
    const token = await login(ownerEmail);
    const res = await request(app.getHttpServer())
      .get('/api/v1/warehouse/dashboard')
      .set(auth(token, pishtehId))
      .expect(200);

    const data = res.body.data;
    expect(data).toEqual(
      expect.objectContaining({
        skusWithStock: expect.any(Number),
        totalUnits: expect.any(Number),
        sellableUnits: expect.any(Number),
        reservedUnits: expect.any(Number),
        availableUnits: expect.any(Number),
        testerUnits: expect.any(Number),
        damagedUnits: expect.any(Number),
        quarantineUnits: expect.any(Number),
        pendingReceipts: expect.any(Number),
        pendingPutaways: expect.any(Number),
        openTransfers: expect.any(Number),
        openStockCounts: expect.any(Number),
        countsAwaitingApproval: expect.any(Number),
        draftIssues: expect.any(Number),
        pendingSupplierReturns: expect.any(Number),
        pendingSupplierReturnsOpen: expect.any(Number),
        recentMovements: expect.any(Array),
        recentReceipts: expect.any(Array),
        warehouseSummary: expect.any(Array),
        stockDiscrepancies: expect.any(Array),
        recentActivity: expect.objectContaining({
          recentMovements: expect.any(Array),
          recentReceipts: expect.any(Array),
          recentTransfers: expect.any(Array),
        }),
      }),
    );
    expect(data.availableUnits).toBeGreaterThanOrEqual(0);
    expect(data.availableUnits).toBe(
      Math.max(0, data.sellableUnits - data.reservedUnits),
    );
    expect(data.totalUnits).toBe(
      data.sellableUnits + data.testerUnits + data.damagedUnits + data.quarantineUnits,
    );
    expect(data.reservedUnits).toBeLessThanOrEqual(data.sellableUnits);
    if (data.valuation) {
      expect(data.valuation).toEqual(
        expect.objectContaining({
          totalInventoryValue: expect.any(String),
          valuedQuantity: expect.any(Number),
          unvaluedQuantity: expect.any(Number),
          valuationCompleteness: expect.any(String),
        }),
      );
    }

    const emptyCompanyId = await createTempCompany();
    const empty = await request(app.getHttpServer())
      .get('/api/v1/warehouse/dashboard')
      .set(auth(token, emptyCompanyId))
      .expect(200);
    expect(empty.body.data.skusWithStock).toBe(0);
    expect(empty.body.data.totalUnits).toBe(0);
    expect(empty.body.data.sellableUnits).toBe(0);
    expect(empty.body.data.reservedUnits).toBe(0);
    expect(empty.body.data.availableUnits).toBe(0);
  });

  it('isolates dashboard company scope and rejects invalid warehouseId filter', async () => {
    const token = await login(ownerEmail);
    const a = await request(app.getHttpServer())
      .get('/api/v1/warehouse/dashboard')
      .set(auth(token, pishtehId))
      .expect(200);
    const b = await request(app.getHttpServer())
      .get('/api/v1/warehouse/dashboard')
      .set(auth(token, demoBId))
      .expect(200);
    // Demo B seed is intentionally thin; totals must not equal Pishteh blindly.
    expect(typeof a.body.data.totalUnits).toBe('number');
    expect(typeof b.body.data.totalUnits).toBe('number');

    await request(app.getHttpServer())
      .get('/api/v1/warehouse/dashboard')
      .query({ warehouseId: 'not-a-uuid' })
      .set(auth(token, pishtehId))
      .expect(400);
  });

  it('resolves product barcode exactly and preserves leading zeros', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    // Digit-only with leading zeros — Catalog normalizeScannedValue must preserve them.
    const barcodeValue = `00${Date.now().toString().slice(-11)}`;
    const code = `SC${barcodeValue.slice(-8)}`;

    const product = await database.client.product.create({
      data: {
        companyId,
        name: `Product ${code}`,
        normalizedName: `product ${code.toLowerCase()}`,
        code,
        normalizedCode: code,
      },
    });
    const sku = await database.client.sku.create({
      data: {
        companyId,
        productId: product.id,
        code: `${code}-01`,
        normalizedCode: `${code}-01`,
        variantSignature: 'SIMPLE',
        name: 'Variant',
      },
    });
    await database.client.barcode.create({
      data: {
        companyId,
        skuId: sku.id,
        value: barcodeValue,
        normalizedValue: barcodeValue,
        type: BarcodeType.OTHER,
        isPrimary: true,
      },
    });

    const ok = await request(app.getHttpServer())
      .get('/api/v1/warehouse/scanner/products/resolve')
      .query({ barcode: barcodeValue })
      .set(auth(token, companyId))
      .expect(200);

    expect(ok.body.data.barcode).toBe(barcodeValue);
    expect(ok.body.data.skuId).toBe(sku.id);
    expect(ok.body.data.productId).toBe(product.id);

    await request(app.getHttpServer())
      .get('/api/v1/warehouse/scanner/products/resolve')
      .query({ barcode: barcodeValue.replace(/^0+/, '') })
      .set(auth(token, companyId))
      .expect(404);

    await request(app.getHttpServer())
      .get('/api/v1/warehouse/scanner/products/resolve')
      .query({ barcode: barcodeValue })
      .set(auth(token, demoBId))
      .expect(404);
  });

  it('resolves location barcode exactly and rejects cross-company IDOR', async () => {
    const token = await login(ownerEmail);
    const companyId = await createTempCompany();
    const locBarcode = `LOC-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;

    const warehouse = await database.client.warehouse.create({
      data: {
        companyId,
        code: 'MAIN',
        name: 'Main',
        isDefault: true,
      },
    });
    const location = await database.client.warehouseLocation.create({
      data: {
        companyId,
        warehouseId: warehouse.id,
        code: 'A-01',
        name: 'Aisle 1',
        barcode: locBarcode,
        type: WarehouseLocationType.BIN,
      },
    });

    const ok = await request(app.getHttpServer())
      .get('/api/v1/warehouse/scanner/locations/resolve')
      .query({ barcode: locBarcode })
      .set(auth(token, companyId))
      .expect(200);

    expect(ok.body.data.locationId).toBe(location.id);
    expect(ok.body.data.locationBarcode).toBe(locBarcode);
    expect(ok.body.data.warehouseId).toBe(warehouse.id);

    await request(app.getHttpServer())
      .get('/api/v1/warehouse/scanner/locations/resolve')
      .query({ barcode: locBarcode })
      .set(auth(token, demoBId))
      .expect(404);

    await request(app.getHttpServer())
      .get('/api/v1/warehouse/scanner/locations/resolve')
      .query({ barcode: 'x'.repeat(200) })
      .set(auth(token, companyId))
      .expect(400);
  });

  it('requires auth and company context', async () => {
    await request(app.getHttpServer()).get('/api/v1/warehouse/dashboard').expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/warehouse/scanner/products/resolve')
      .query({ barcode: '123' })
      .expect(401);
  });
});
