import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client';
import {
  AttributeScope,
  AttributeType,
  BarcodeType,
  CatalogLifecycleStatus,
  CompanyMemberStatus,
  CompanyStatus,
  CurrencyCode,
  CapitalContributionStatus,
  CapitalFundingType,
  FinanceCounterpartyType,
  FinancialAccountMovementDirection,
  FinancialAccountMovementType,
  FinancialAccountStatus,
  FinancialAccountType,
  FxRateSourceType,
  FxRateType,
  LoanDisbursementStatus,
  LoanStatus,
  PaymentTermType,
  PurchaseCommercialType,
  PurchaseCostAllocationMethod,
  PurchaseCostStatus,
  PurchaseCostType,
  PurchaseCorrectionStatus,
  PurchaseCorrectionType,
  PurchaseDiscrepancySource,
  PurchaseDiscrepancyStatus,
  PurchaseDiscrepancyType,
  PurchaseOrderStatus,
  PurchaseReturnReason,
  PurchaseReturnResolution,
  PurchaseReturnStatus,
  PurchaseTermBasis,
  PurchasingLifecycleStatus,
  UserStatus,
  WarehouseLocationType,
  WarehouseStatus,
  GoodsReceiptStatus,
  PutawayStatus,
  StockTransferStatus,
  InventoryMovementType,
  InventorySourceType,
  StockClassification,
  StockIssueReason,
  StockIssueStatus,
  InventoryAdjustmentReason,
  InventoryAdjustmentStatus,
  InventoryAdjustmentDirection,
  StockCountType,
  StockCountStatus,
  StockCountLineStatus,
  SupplierReturnExecutionStatus,
  SupplierPayableStatus,
  SupplierPayablePurchaseType,
  SupplierLiabilityMovementDirection,
  SupplierLiabilityMovementType,
  PaymentStatus,
  PaymentPurposeType,
  ReceiptStatus,
  ReceiptSourceType,
} from '../src/generated/prisma/enums';
import {
  OWNER_ROLE_KEY,
  PERMISSIONS,
  PERMISSION_DEFINITIONS,
  WAREHOUSE_OPERATOR_ROLE_KEY,
  syncOwnerRolePermissions,
  syncPermissions,
} from '../src/permissions';
import { rebuildInventoryBalances } from '../src/inventory-reconciliation';
import { ensureSystemTransitPosition } from '../src/system-transit';
import { seedReservationsFifoValuationForPishteh } from './seed-phase-315';

function loadRootEnv(): void {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
    resolve(__dirname, '../../.env'),
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      config({ path, quiet: true });
      return;
    }
  }
}

loadRootEnv();

/**
 * Argon2id options must stay aligned with apps/api PasswordHasher.
 * Seed credentials are development-only and must never be used in production.
 */
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

const DEV_USERS = [
  {
    email: 'pouria@hector.local',
    firstName: 'Pouria',
    lastName: 'Dev',
    roleKey: OWNER_ROLE_KEY,
  },
  {
    email: 'ahmad@hector.local',
    firstName: 'Ahmad',
    lastName: 'Dev',
    roleKey: OWNER_ROLE_KEY,
  },
  {
    email: 'hossein@hector.local',
    firstName: 'Hossein',
    lastName: 'Dev',
    roleKey: WAREHOUSE_OPERATOR_ROLE_KEY,
  },
] as const;

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to seed the database');
  }

  const seedPassword = process.env.DEV_SEED_PASSWORD;
  if (!seedPassword || seedPassword.length < 8) {
    throw new Error(
      'DEV_SEED_PASSWORD is required for seeding (min 8 chars). Development-only — never use in production.',
    );
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run development seed while NODE_ENV=production');
  }

  const passwordHash = await argon2.hash(seedPassword, ARGON2_OPTIONS);

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  try {
    await syncPermissions(prisma);
    await syncOwnerRolePermissions(prisma);

    const company = await prisma.company.upsert({
      where: { slug: 'pishteh' },
      update: {
        name: 'Pishteh',
        baseCurrency: CurrencyCode.IRR,
        timezone: 'Asia/Tehran',
        status: CompanyStatus.ACTIVE,
        deletedAt: null,
      },
      create: {
        name: 'Pishteh',
        slug: 'pishteh',
        baseCurrency: CurrencyCode.IRR,
        timezone: 'Asia/Tehran',
        status: CompanyStatus.ACTIVE,
      },
    });

    await prisma.role.upsert({
      where: {
        companyId_key: {
          companyId: company.id,
          key: OWNER_ROLE_KEY,
        },
      },
      update: {
        name: 'Owner',
        description: 'Full access to company capabilities. Permission set is code-managed.',
        isSystem: true,
        deletedAt: null,
      },
      create: {
        companyId: company.id,
        key: OWNER_ROLE_KEY,
        name: 'Owner',
        description: 'Full access to company capabilities. Permission set is code-managed.',
        isSystem: true,
      },
    });

    await prisma.role.upsert({
      where: {
        companyId_key: {
          companyId: company.id,
          key: WAREHOUSE_OPERATOR_ROLE_KEY,
        },
      },
      update: {
        name: 'Warehouse Operator',
        description:
          'Warehouse operations role. Phase 3.4: warehouse.read + goods receipt read/manage/post.',
        isSystem: true,
        deletedAt: null,
      },
      create: {
        companyId: company.id,
        key: WAREHOUSE_OPERATOR_ROLE_KEY,
        name: 'Warehouse Operator',
        description:
          'Warehouse operations role. Phase 3.4: warehouse.read + goods receipt read/manage/post.',
        isSystem: true,
      },
    });

    // OWNER receives every registered permission (multi-company safe).
    await syncOwnerRolePermissions(prisma);
    await syncWarehouseOperatorPermissions(prisma);

    const ownerRole = await prisma.role.findUniqueOrThrow({
      where: {
        companyId_key: {
          companyId: company.id,
          key: OWNER_ROLE_KEY,
        },
      },
    });

    const warehouseRole = await prisma.role.findUniqueOrThrow({
      where: {
        companyId_key: {
          companyId: company.id,
          key: WAREHOUSE_OPERATOR_ROLE_KEY,
        },
      },
    });

    for (const userSeed of DEV_USERS) {
      const user = await prisma.user.upsert({
        where: { email: userSeed.email },
        update: {
          firstName: userSeed.firstName,
          lastName: userSeed.lastName,
          status: UserStatus.ACTIVE,
          deletedAt: null,
          passwordHash,
        },
        create: {
          email: userSeed.email,
          firstName: userSeed.firstName,
          lastName: userSeed.lastName,
          passwordHash,
          status: UserStatus.ACTIVE,
        },
      });

      const membership = await prisma.companyMember.upsert({
        where: {
          companyId_userId: {
            companyId: company.id,
            userId: user.id,
          },
        },
        update: {
          status: CompanyMemberStatus.ACTIVE,
        },
        create: {
          companyId: company.id,
          userId: user.id,
          status: CompanyMemberStatus.ACTIVE,
        },
      });

      const roleId = userSeed.roleKey === OWNER_ROLE_KEY ? ownerRole.id : warehouseRole.id;

      await prisma.companyMemberRole.upsert({
        where: {
          companyMemberId_roleId: {
            companyMemberId: membership.id,
            roleId,
          },
        },
        update: {},
        create: {
          companyMemberId: membership.id,
          roleId,
        },
      });
    }

    const secondary = await seedSecondaryDemoCompany(prisma, passwordHash);
    await seedCatalogForPishteh(prisma, company.id);
    await seedCatalogForSecondary(prisma, secondary.id);
    await seedSuppliersForPishteh(prisma, company.id);
    await seedSuppliersForSecondary(prisma, secondary.id);
    await seedSupplierOffersForPishteh(prisma, company.id);
    await seedSupplierOffersForSecondary(prisma, secondary.id);
    await seedPurchaseOrdersForPishteh(prisma, company.id);
    await seedWarehousesForPishteh(prisma, company.id);
    await seedWarehousesForSecondary(prisma, secondary.id);
    await seedFinanceAccountsForPishteh(prisma, company.id);
    await seedFinanceCapitalLoansForPishteh(prisma, company.id);
    await seedFinanceFxRatesForPishteh(prisma, company.id);
    await seedFinancePaymentsReceiptsForPishteh(prisma, company.id);

    console.log('Hector database seed completed.');
    console.log(`Company: ${company.name} (${company.slug})`);
    console.log(`Secondary company: ${secondary.name} (${secondary.slug})`);
    console.log(`Users: ${DEV_USERS.map((user) => user.email).join(', ')}`);
    console.log(`Roles: ${OWNER_ROLE_KEY}, ${WAREHOUSE_OPERATOR_ROLE_KEY}`);
    console.log(`Permissions: ${PERMISSION_DEFINITIONS.length} (OWNER synchronized)`);
    console.log('Dev passwords hashed from DEV_SEED_PASSWORD (development-only).');
    console.log(
      'Catalog sample data seeded (valid EAN-13 checksums + INTERNAL / OTHER demo barcodes).',
    );
    console.log(
      'Product attribute definitions seeded (Pishteh + Demo B isolation sample).',
    );
    console.log('Supplier Master sample data seeded (Pishteh + Demo B isolation sample).');
    console.log(
      'Purchase Order samples seeded (CASH, TERM 10/30/FIXED, FX 30-day, costs, legacy ORDERED).',
    );
    console.log('Supplier Offer sample quotes seeded (historical IRR/USD fixtures).');
    console.log('Warehouse Master samples seeded (MAIN default + RETURNS; Demo B MAIN isolation).');
    console.log(
      'Finance Accounts samples seeded (BANK-MELLAT-IRR, CASH-IRR, CASH-USD, KHANOUMI-WALLET with opening balances).',
    );
    console.log(
      'Finance Capital/Loans seeded (Ahmad/Pouria PARTNER_EQUITY → Mellat; Ahmad LOAN 500M IRR; External USD loan 10k → CASH-USD).',
    );
    console.log(
      'Finance FX rates seeded (USD→IRR REFERENCE 250000 + VALUATION 270000 — illustrative, not live market).',
    );
    console.log(
      'Finance Payments/Receipts seeded (SEED-PAY-DRAFT-001; SEED-PAY-000001 OTHER out; SEED-REC-000001 OTHER in — standalone, no payable settlement).',
    );
    await seedWarehouseLocationsForPishteh(prisma, company.id);
    console.log('Warehouse Locations samples seeded (MAIN shelves + nested R01/S04).');
    await seedGoodsReceiptsForPishteh(prisma, company.id);
    console.log(
      'Goods Receipt / receiving samples seeded (SEED-PO-RECEIVING-01 partial 90/100; SEED-PO-SCANNER-01 40/100 + draft GRN; SEED-PO-SHORT-01 closed-with-shortage).',
    );
    await seedFinanceSupplierPayablesForPishteh(prisma, company.id);
    console.log(
      'Finance Supplier Payables seeded (opening AP + recognition backfill for POSTED GRN items).',
    );
    await seedBatchesForPishteh(prisma, company.id);
    console.log(
      'Batch / Lot samples seeded (BAT-DEMO-001/002; GRN-2026-000030 = 60+40; posted GRNs fully allocated).',
    );
    await seedPutawaysForPishteh(prisma, company.id);
    console.log(
      'Putaway samples seeded (LOC-A-03; GRN-PUTAWAY-DEMO 100 received; PUT-000001 completed 40 → A-03; remaining 60).',
    );
    await seedInventoryLedgerForPishteh(prisma, company.id);
    console.log(
      'Inventory ledger/balance seeded (ESS-MASCARA-01 multi-position On Hand; see docs/stock-balance.md).',
    );
    await seedStockTransfersForPishteh(prisma, company.id);
    console.log(
      'Stock transfers seeded (TRF-000001 COMPLETED A-01→A-03 20; TRF-000002 IN_TRANSIT A-02→B-01 30; TRF-000003 DRAFT).',
    );
    await seedStockClassificationAndIssuesForPishteh(prisma, company.id);
    console.log(
      'Classification + stock issues seeded (A-03 ESS-MASCARA reclasses; ISS-000001/002 POSTED, ISS-000003 DRAFT).',
    );
    await seedInventoryAdjustmentsAndStockCountsForPishteh(prisma, company.id);
    console.log(
      'Adjustments + stock counts seeded (ADJ-000001 FOUND +5, ADJ-000002 MISSING −2, ADJ-000003 CORRECTION DRAFT; COUNT-000001 CYCLE POSTED 3 lines; COUNT-000002 SUBMITTED open discrepancy).',
    );
    await seedSupplierReturnExecutionsForPishteh(prisma, company.id);
    console.log(
      'Supplier return executions seeded (SEED-PR-000002 approved 100; SRE-000001 DISPATCHED 40 QUARANTINE; SRE-000002 DRAFT 30; remaining 60).',
    );
    const rebuild = await rebuildInventoryBalances(prisma, { companyId: company.id });
    console.log(
      `Inventory balances rebuilt from ledger (creates=${rebuild.creates}, updates=${rebuild.updates}, deletes=${rebuild.deletes}).`,
    );
    await seedReservationsFifoValuationForPishteh(prisma, company.id);
    console.log(
      'Reservations + FIFO + valuation seeded (UNVALUED bootstrap gaps; ESS-MASCARA FIFO demo 180@550k when possible; ACTIVE reservation 30).',
    );
    // Integrity: RECEIVED must not retain open remaining qty (short-close or partial status).
    const repaired = await prisma.$executeRaw`
      UPDATE purchase_orders po
      SET status = 'PARTIALLY_RECEIVED'::"purchase_order_status"
      WHERE po.company_id = ${company.id}::uuid
        AND po.status = 'RECEIVED'
        AND EXISTS (
          SELECT 1 FROM purchase_order_items poi
          LEFT JOIN (
            SELECT i.purchase_order_item_id, SUM(i.quantity)::int AS qty
            FROM goods_receipt_items i
            JOIN goods_receipts g ON g.id = i.goods_receipt_id
            WHERE g.status = 'POSTED' AND g.purchase_order_id = po.id
            GROUP BY i.purchase_order_item_id
          ) posted ON posted.purchase_order_item_id = poi.id
          WHERE poi.purchase_order_id = po.id
            AND poi.quantity - COALESCE(posted.qty, 0) - poi.closed_unfulfilled_quantity > 0
        )`;
    if (repaired > 0) {
      console.log(`Repaired ${repaired} RECEIVED PO(s) with remaining qty → PARTIALLY_RECEIVED.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function syncWarehouseOperatorPermissions(prisma: PrismaClient): Promise<void> {
  const keys = [
    PERMISSIONS.WAREHOUSE_READ,
    PERMISSIONS.WAREHOUSE_RECEIPT_READ,
    PERMISSIONS.WAREHOUSE_RECEIPT_MANAGE,
    PERMISSIONS.WAREHOUSE_RECEIPT_POST,
    PERMISSIONS.WAREHOUSE_BATCH_READ,
    PERMISSIONS.WAREHOUSE_BATCH_MANAGE,
    PERMISSIONS.WAREHOUSE_PUTAWAY_READ,
    PERMISSIONS.WAREHOUSE_PUTAWAY_MANAGE,
    PERMISSIONS.WAREHOUSE_PUTAWAY_COMPLETE,
    PERMISSIONS.WAREHOUSE_STOCK_READ,
    PERMISSIONS.WAREHOUSE_TRANSFER_READ,
    PERMISSIONS.WAREHOUSE_TRANSFER_MANAGE,
    PERMISSIONS.WAREHOUSE_TRANSFER_DISPATCH,
    PERMISSIONS.WAREHOUSE_TRANSFER_COMPLETE,
    PERMISSIONS.WAREHOUSE_TRANSFER_CANCEL,
    PERMISSIONS.WAREHOUSE_CLASSIFICATION_CHANGE,
    PERMISSIONS.WAREHOUSE_ISSUE_READ,
    PERMISSIONS.WAREHOUSE_ISSUE_CREATE,
    PERMISSIONS.WAREHOUSE_ISSUE_UPDATE,
    PERMISSIONS.WAREHOUSE_ISSUE_POST,
    PERMISSIONS.WAREHOUSE_ISSUE_CANCEL,
    PERMISSIONS.WAREHOUSE_ADJUSTMENT_READ,
    PERMISSIONS.WAREHOUSE_ADJUSTMENT_CREATE,
    PERMISSIONS.WAREHOUSE_ADJUSTMENT_UPDATE,
    PERMISSIONS.WAREHOUSE_ADJUSTMENT_POST,
    PERMISSIONS.WAREHOUSE_COUNT_READ,
    PERMISSIONS.WAREHOUSE_COUNT_CREATE,
    PERMISSIONS.WAREHOUSE_COUNT_PERFORM,
    PERMISSIONS.WAREHOUSE_COUNT_SUBMIT,
    PERMISSIONS.WAREHOUSE_COUNT_POST,
    PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_READ,
    PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_CREATE_EXECUTION,
    PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_UPDATE_EXECUTION,
    PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_DISPATCH,
    PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_CANCEL_EXECUTION,
    PERMISSIONS.WAREHOUSE_RESERVATION_READ,
    PERMISSIONS.WAREHOUSE_RESERVATION_MANAGE,
    PERMISSIONS.WAREHOUSE_SCANNER_USE,
    // Intentionally omit valuation/cost_layer — financial cost is Owner-only by default.
  ] as const;
  const permissions = await prisma.permission.findMany({
    where: { key: { in: [...keys] } },
  });
  const roles = await prisma.role.findMany({
    where: { key: WAREHOUSE_OPERATOR_ROLE_KEY, deletedAt: null },
    select: { id: true },
  });
  for (const role of roles) {
    for (const permission of permissions) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId: permission.id,
          },
        },
        update: {},
        create: {
          roleId: role.id,
          permissionId: permission.id,
        },
      });
    }
  }
}

async function seedGoodsReceiptsForPishteh(
  prisma: PrismaClient,
  companyId: string,
): Promise<void> {
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'pouria@hector.local' } });
  const warehouse = await prisma.warehouse.findUniqueOrThrow({
    where: { companyId_code: { companyId, code: 'MAIN' } },
  });
  const tehran = await prisma.supplier.findFirstOrThrow({
    where: { companyId, code: 'TEH-BEAUTY' },
  });
  const mascara = await prisma.sku.findFirstOrThrow({
    where: { companyId, code: 'ESS-MASCARA-01' },
    include: { product: true },
  });

  // Dedicated receiving fixture — leave SEED-PO-ORDERED-01 untouched as ORDERED.
  const poNumber = 'SEED-PO-RECEIVING-01';
  const unitPrice = new Prisma.Decimal('5800000');
  const orderedQty = 100;
  const lineSubtotal = unitPrice.mul(orderedQty);
  const orderDate = new Date('2026-10-02T09:00:00.000Z');

  let po = await prisma.purchaseOrder.findUnique({
    where: { companyId_number: { companyId, number: poNumber } },
    include: { items: true },
  });

  if (!po) {
    const createdPo = await prisma.purchaseOrder.create({
      data: {
        companyId,
        number: poNumber,
        supplierId: tehran.id,
        status: PurchaseOrderStatus.PARTIALLY_RECEIVED,
        currency: CurrencyCode.IRR,
        purchaseType: PurchaseCommercialType.CASH,
        paymentTermType: PaymentTermType.IMMEDIATE,
        orderDate,
        notes: 'SEED: Phase 3.5 receiving demo — 100 ordered, 90 posted, 10 remaining.',
        subtotal: lineSubtotal,
        total: lineSubtotal,
        createdById: owner.id,
        approvedById: owner.id,
        approvedAt: new Date(orderDate.getTime() + 3_600_000),
        orderedById: owner.id,
        orderedAt: new Date(orderDate.getTime() + 7_200_000),
        supplierNameSnapshot: tehran.name,
        supplierCodeSnapshot: tehran.code,
        version: 4,
      },
    });
    await prisma.purchaseOrderItem.create({
      data: {
        companyId,
        purchaseOrderId: createdPo.id,
        skuId: mascara.id,
        quantity: orderedQty,
        unitPrice,
        lineSubtotal,
        skuCodeSnapshot: mascara.code,
        productNameSnapshot: mascara.product.name,
        variantLabelSnapshot: mascara.name,
        productIdSnapshot: mascara.productId,
      },
    });
    po = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: createdPo.id },
      include: { items: true },
    });
  } else if (po.status !== PurchaseOrderStatus.PARTIALLY_RECEIVED) {
    po = await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: { status: PurchaseOrderStatus.PARTIALLY_RECEIVED },
      include: { items: true },
    });
  }

  // Restore legacy ORDERED fixture if a prior seed linked GRN to it.
  const legacyOrdered = await prisma.purchaseOrder.findUnique({
    where: { companyId_number: { companyId, number: 'SEED-PO-ORDERED-01' } },
  });
  if (legacyOrdered && legacyOrdered.status === PurchaseOrderStatus.PARTIALLY_RECEIVED) {
    const legacyPosted = await prisma.goodsReceipt.count({
      where: {
        companyId,
        purchaseOrderId: legacyOrdered.id,
        status: GoodsReceiptStatus.POSTED,
      },
    });
    if (legacyPosted === 0) {
      await prisma.purchaseOrder.update({
        where: { id: legacyOrdered.id },
        data: { status: PurchaseOrderStatus.ORDERED },
      });
    }
  }

  const poItem = po.items[0];
  if (!poItem) {
    return;
  }

  async function upsertPostedGrn(input: {
    number: string;
    quantity: number;
    receivedAt: Date;
    postedAt: Date;
    notes: string;
  }): Promise<void> {
    const existing = await prisma.goodsReceipt.findUnique({
      where: { companyId_number: { companyId, number: input.number } },
      include: { items: true },
    });
    if (!existing) {
      const receipt = await prisma.goodsReceipt.create({
        data: {
          companyId,
          number: input.number,
          warehouseId: warehouse.id,
          purchaseOrderId: po!.id,
          supplierId: po!.supplierId,
          status: GoodsReceiptStatus.POSTED,
          receivedAt: input.receivedAt,
          postedAt: input.postedAt,
          notes: input.notes,
          createdById: owner.id,
          postedById: owner.id,
          version: 2,
        },
      });
      await prisma.goodsReceiptItem.create({
        data: {
          companyId,
          goodsReceiptId: receipt.id,
          purchaseOrderItemId: poItem!.id,
          skuId: poItem!.skuId,
          quantity: input.quantity,
        },
      });
      return;
    }
    // Idempotent quantity repair for Phase 3.5 seed targets.
    const line = existing.items[0];
    if (line && line.quantity !== input.quantity) {
      await prisma.goodsReceiptItem.update({
        where: { id: line.id },
        data: { quantity: input.quantity },
      });
    }
    if (existing.notes !== input.notes) {
      await prisma.goodsReceipt.update({
        where: { id: existing.id },
        data: { notes: input.notes },
      });
    }
  }

  await upsertPostedGrn({
    number: 'GRN-2026-000001',
    quantity: 40,
    receivedAt: new Date('2026-10-03T11:00:00.000Z'),
    postedAt: new Date('2026-10-03T11:05:00.000Z'),
    notes: 'SEED: first partial delivery (40 of 100) — Phase 3.5',
  });
  await upsertPostedGrn({
    number: 'GRN-2026-000002',
    quantity: 50,
    receivedAt: new Date('2026-10-04T09:00:00.000Z'),
    postedAt: new Date('2026-10-04T09:05:00.000Z'),
    notes: 'SEED: second partial delivery (50) — 90 received, 10 remaining',
  });

  // Closed-with-shortage demo: 90 received + 10 short.
  const shortPoNumber = 'SEED-PO-SHORT-01';
  let shortPo = await prisma.purchaseOrder.findUnique({
    where: { companyId_number: { companyId, number: shortPoNumber } },
    include: { items: true },
  });
  if (!shortPo) {
    const created = await prisma.purchaseOrder.create({
      data: {
        companyId,
        number: shortPoNumber,
        supplierId: tehran.id,
        status: PurchaseOrderStatus.RECEIVED,
        currency: CurrencyCode.IRR,
        purchaseType: PurchaseCommercialType.CASH,
        paymentTermType: PaymentTermType.IMMEDIATE,
        orderDate: new Date('2026-09-20T09:00:00.000Z'),
        notes: 'SEED: Phase 3.5 closed-with-shortage (90 received + 10 short).',
        subtotal: lineSubtotal,
        total: lineSubtotal,
        createdById: owner.id,
        approvedById: owner.id,
        approvedAt: new Date('2026-09-20T10:00:00.000Z'),
        orderedById: owner.id,
        orderedAt: new Date('2026-09-20T11:00:00.000Z'),
        supplierNameSnapshot: tehran.name,
        supplierCodeSnapshot: tehran.code,
        version: 5,
      },
    });
    const shortItem = await prisma.purchaseOrderItem.create({
      data: {
        companyId,
        purchaseOrderId: created.id,
        skuId: mascara.id,
        quantity: orderedQty,
        unitPrice,
        lineSubtotal,
        closedUnfulfilledQuantity: 10,
        skuCodeSnapshot: mascara.code,
        productNameSnapshot: mascara.product.name,
        variantLabelSnapshot: mascara.name,
        productIdSnapshot: mascara.productId,
      },
    });
    const shortGrn = await prisma.goodsReceipt.create({
      data: {
        companyId,
        number: 'GRN-2026-000010',
        warehouseId: warehouse.id,
        purchaseOrderId: created.id,
        supplierId: tehran.id,
        status: GoodsReceiptStatus.POSTED,
        receivedAt: new Date('2026-09-25T10:00:00.000Z'),
        postedAt: new Date('2026-09-25T10:05:00.000Z'),
        notes: 'SEED: 90 of 100 physically received',
        createdById: owner.id,
        postedById: owner.id,
        version: 2,
      },
    });
    await prisma.goodsReceiptItem.create({
      data: {
        companyId,
        goodsReceiptId: shortGrn.id,
        purchaseOrderItemId: shortItem.id,
        skuId: mascara.id,
        quantity: 90,
      },
    });
    await prisma.purchaseDiscrepancy.create({
      data: {
        companyId,
        purchaseOrderId: created.id,
        purchaseOrderItemId: shortItem.id,
        type: PurchaseDiscrepancyType.SHORT_SHIPMENT,
        source: PurchaseDiscrepancySource.AT_RECEIPT,
        status: PurchaseDiscrepancyStatus.SHORT_CLOSED,
        quantity: 10,
        reason: 'Supplier cancelled remainder',
        notes: 'SEED: closed-with-shortage demo',
        createdById: owner.id,
        resolvedById: owner.id,
        resolvedAt: new Date('2026-09-26T08:00:00.000Z'),
      },
    });
    shortPo = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: created.id },
      include: { items: true },
    });
  } else if (shortPo.items[0] && shortPo.items[0].closedUnfulfilledQuantity !== 10) {
    await prisma.purchaseOrderItem.update({
      where: { id: shortPo.items[0].id },
      data: { closedUnfulfilledQuantity: 10 },
    });
  }

  void shortPo;

  // Phase 3.6 scanner receiving demo: 100 ordered, 40 posted, 60 remaining, empty DRAFT GRN.
  const scannerPoNumber = 'SEED-PO-SCANNER-01';
  let scannerPo = await prisma.purchaseOrder.findUnique({
    where: { companyId_number: { companyId, number: scannerPoNumber } },
    include: { items: true },
  });
  if (!scannerPo) {
    const created = await prisma.purchaseOrder.create({
      data: {
        companyId,
        number: scannerPoNumber,
        supplierId: tehran.id,
        status: PurchaseOrderStatus.PARTIALLY_RECEIVED,
        currency: CurrencyCode.IRR,
        purchaseType: PurchaseCommercialType.CASH,
        paymentTermType: PaymentTermType.IMMEDIATE,
        orderDate: new Date('2026-10-03T08:00:00.000Z'),
        notes: 'SEED: Phase 3.6 scanner receiving — 100 ordered, 40 posted, 60 remaining.',
        subtotal: lineSubtotal,
        total: lineSubtotal,
        createdById: owner.id,
        approvedById: owner.id,
        approvedAt: new Date('2026-10-03T09:00:00.000Z'),
        orderedById: owner.id,
        orderedAt: new Date('2026-10-03T10:00:00.000Z'),
        supplierNameSnapshot: tehran.name,
        supplierCodeSnapshot: tehran.code,
        version: 3,
      },
    });
    await prisma.purchaseOrderItem.create({
      data: {
        companyId,
        purchaseOrderId: created.id,
        skuId: mascara.id,
        quantity: orderedQty,
        unitPrice,
        lineSubtotal,
        skuCodeSnapshot: mascara.code,
        productNameSnapshot: mascara.product.name,
        variantLabelSnapshot: mascara.name,
        productIdSnapshot: mascara.productId,
      },
    });
    scannerPo = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: created.id },
      include: { items: true },
    });
  } else if (scannerPo.status !== PurchaseOrderStatus.PARTIALLY_RECEIVED) {
    scannerPo = await prisma.purchaseOrder.update({
      where: { id: scannerPo.id },
      data: { status: PurchaseOrderStatus.PARTIALLY_RECEIVED },
      include: { items: true },
    });
  }

  const scannerPoItem = scannerPo.items[0];
  if (scannerPoItem) {
    const postedNumber = 'GRN-2026-000020';
    let postedForScanner = await prisma.goodsReceipt.findUnique({
      where: { companyId_number: { companyId, number: postedNumber } },
      include: { items: true },
    });
    if (postedForScanner && postedForScanner.purchaseOrderId !== scannerPo.id) {
      await prisma.goodsReceiptItem.deleteMany({ where: { goodsReceiptId: postedForScanner.id } });
      await prisma.goodsReceiptScanRequest.deleteMany({
        where: { goodsReceiptId: postedForScanner.id },
      });
      await prisma.goodsReceipt.delete({ where: { id: postedForScanner.id } });
      postedForScanner = null;
    }
    if (!postedForScanner) {
      const receipt = await prisma.goodsReceipt.create({
        data: {
          companyId,
          number: postedNumber,
          warehouseId: warehouse.id,
          purchaseOrderId: scannerPo.id,
          supplierId: scannerPo.supplierId,
          status: GoodsReceiptStatus.POSTED,
          receivedAt: new Date('2026-10-03T14:00:00.000Z'),
          postedAt: new Date('2026-10-03T14:05:00.000Z'),
          notes: 'SEED: scanner demo prior posted receipt (40 of 100)',
          createdById: owner.id,
          postedById: owner.id,
          version: 2,
        },
      });
      await prisma.goodsReceiptItem.create({
        data: {
          companyId,
          goodsReceiptId: receipt.id,
          purchaseOrderItemId: scannerPoItem.id,
          skuId: scannerPoItem.skuId,
          quantity: 40,
        },
      });
    } else if (postedForScanner.items[0] && postedForScanner.items[0].quantity !== 40) {
      await prisma.goodsReceiptItem.update({
        where: { id: postedForScanner.items[0].id },
        data: { quantity: 40 },
      });
    }

    const draftNumber = 'GRN-2026-000021';
    const existingDraft = await prisma.goodsReceipt.findUnique({
      where: { companyId_number: { companyId, number: draftNumber } },
      include: { items: true },
    });
    if (!existingDraft) {
      await prisma.goodsReceipt.create({
        data: {
          companyId,
          number: draftNumber,
          warehouseId: warehouse.id,
          purchaseOrderId: scannerPo.id,
          supplierId: scannerPo.supplierId,
          status: GoodsReceiptStatus.DRAFT,
          receivedAt: new Date('2026-10-04T08:00:00.000Z'),
          notes: 'SEED: Phase 3.6 scanner draft — ready for barcode receiving',
          createdById: owner.id,
          version: 1,
        },
      });
    } else if (
      existingDraft.status === GoodsReceiptStatus.DRAFT &&
      existingDraft.purchaseOrderId !== scannerPo.id
    ) {
      await prisma.goodsReceiptItem.deleteMany({ where: { goodsReceiptId: existingDraft.id } });
      await prisma.goodsReceiptScanRequest.deleteMany({
        where: { goodsReceiptId: existingDraft.id },
      });
      await prisma.goodsReceipt.update({
        where: { id: existingDraft.id },
        data: {
          purchaseOrderId: scannerPo.id,
          supplierId: scannerPo.supplierId,
          notes: 'SEED: Phase 3.6 scanner draft — ready for barcode receiving',
        },
      });
    }
  }

  await prisma.goodsReceiptSequence.upsert({
    where: { companyId },
    update: {},
    create: { companyId, nextValue: 31 },
  });
  await prisma.$executeRaw`
    UPDATE goods_receipt_sequences
    SET next_value = GREATEST(next_value, 31)
    WHERE company_id = ${companyId}::uuid
  `;
}

/**
 * Phase 3.7: Batch identity + allocations for seeded POSTED GRNs.
 * Creating a Batch does NOT create inventory. Total Received = POSTED allocations only.
 */
async function seedBatchesForPishteh(prisma: PrismaClient, companyId: string): Promise<void> {
  const mascara = await prisma.sku.findFirstOrThrow({
    where: { companyId, code: 'ESS-MASCARA-01' },
  });

  async function upsertDemoBatch(input: {
    batchNumber: string;
    supplierBatchNumber: string;
    expiresAt: Date | null;
    notes: string;
  }) {
    const existing = await prisma.batch.findUnique({
      where: { companyId_batchNumber: { companyId, batchNumber: input.batchNumber } },
    });
    if (existing) {
      await prisma.batch.update({
        where: { id: existing.id },
        data: {
          supplierBatchNumber: input.supplierBatchNumber,
          expiresAt: input.expiresAt,
          notes: input.notes,
          skuId: mascara.id,
        },
      });
      return existing.id;
    }
    const created = await prisma.batch.create({
      data: {
        companyId,
        skuId: mascara.id,
        batchNumber: input.batchNumber,
        supplierBatchNumber: input.supplierBatchNumber,
        expiresAt: input.expiresAt,
        notes: input.notes,
      },
    });
    return created.id;
  }

  const batchAId = await upsertDemoBatch({
    batchNumber: 'BAT-DEMO-001',
    supplierBatchNumber: 'LOT-ESS-2026-01',
    expiresAt: null,
    notes: 'SEED: demo batch without expiry',
  });
  const batchBId = await upsertDemoBatch({
    batchNumber: 'BAT-DEMO-002',
    supplierBatchNumber: 'LOT-ESS-2026-02',
    expiresAt: new Date('2029-06-01T00:00:00.000Z'),
    notes: 'SEED: demo batch with expiry',
  });

  // GRN-2026-000001 (qty 40) → split 24 + 16 across demo batches (scaled from 60/40 of 100).
  // Spec demo wanted 60+40 on a 100-unit receipt; receiving fixture uses 40 then 50.
  // Keep GRN-001 as the multi-batch example: 24 + 16 = 40.
  await ensurePostedItemFullyAllocated(prisma, {
    companyId,
    goodsReceiptNumber: 'GRN-2026-000001',
    allocations: [
      { batchId: batchAId, quantity: 24 },
      { batchId: batchBId, quantity: 16 },
    ],
  });

  // Spec-shaped 100-unit multi-batch demo on a dedicated POSTED GRN if present later —
  // Also allocate remaining posted GRNs with a single default batch so integrity passes.
  const otherPosted = await prisma.goodsReceipt.findMany({
    where: {
      companyId,
      status: GoodsReceiptStatus.POSTED,
      number: {
        notIn: ['GRN-2026-000001', 'GRN-2026-000030', 'GRN-PUTAWAY-DEMO'],
      },
    },
    include: { items: true },
  });

  for (const grn of otherPosted) {
    for (const item of grn.items) {
      if (item.skuId !== mascara.id) {
        // Allocate to a SKU-specific anonymous seed batch.
        const batchNumber = `BAT-SEED-${item.skuId.slice(0, 8).toUpperCase()}`;
        let batch = await prisma.batch.findUnique({
          where: { companyId_batchNumber: { companyId, batchNumber } },
        });
        if (!batch) {
          batch = await prisma.batch.create({
            data: {
              companyId,
              skuId: item.skuId,
              batchNumber,
              supplierBatchNumber: `SEED-LOT-${item.skuId.slice(0, 8)}`,
              notes: 'SEED: auto allocation for posted GRN integrity',
            },
          });
        }
        await ensureItemAllocation(prisma, {
          companyId,
          goodsReceiptItemId: item.id,
          skuId: item.skuId,
          allocations: [{ batchId: batch.id, quantity: item.quantity }],
        });
        continue;
      }
      await ensureItemAllocation(prisma, {
        companyId,
        goodsReceiptItemId: item.id,
        skuId: item.skuId,
        allocations: [{ batchId: batchAId, quantity: item.quantity }],
      });
    }
  }

  // Dedicated Phase 3.7 acceptance-shaped allocations: create/overwrite a 100-qty demo receipt item
  // on GRN that matches 60+40 if we add SEED-PO-BATCH-01 — use synthetic allocations on demo batches
  // via a POSTED GRN dedicated to batch demo when receiving PO is fully received later.
  // For the 60/40 story, seed a DRAFT-free historical receipt GRN-2026-000030.
  const batchDemoPoNumber = 'SEED-PO-BATCH-01';
  let batchPo = await prisma.purchaseOrder.findUnique({
    where: { companyId_number: { companyId, number: batchDemoPoNumber } },
    include: { items: true },
  });
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'pouria@hector.local' } });
  const warehouse = await prisma.warehouse.findUniqueOrThrow({
    where: { companyId_code: { companyId, code: 'MAIN' } },
  });
  const tehran = await prisma.supplier.findFirstOrThrow({
    where: { companyId, code: 'TEH-BEAUTY' },
  });
  const unitPrice = '5850000';
  const lineSubtotal = '585000000';

  if (!batchPo) {
    const product = await prisma.product.findUniqueOrThrow({ where: { id: mascara.productId } });
    const createdPo = await prisma.purchaseOrder.create({
      data: {
        companyId,
        number: batchDemoPoNumber,
        supplierId: tehran.id,
        status: PurchaseOrderStatus.RECEIVED,
        currency: CurrencyCode.IRR,
        purchaseType: PurchaseCommercialType.CASH,
        paymentTermType: PaymentTermType.IMMEDIATE,
        orderDate: new Date('2026-10-01T09:00:00.000Z'),
        notes: 'SEED: Phase 3.7 batch split demo (100 received as 60+40)',
        subtotal: lineSubtotal,
        total: lineSubtotal,
        createdById: owner.id,
        approvedById: owner.id,
        approvedAt: new Date('2026-10-01T10:00:00.000Z'),
        orderedById: owner.id,
        orderedAt: new Date('2026-10-01T11:00:00.000Z'),
        supplierNameSnapshot: tehran.name,
        supplierCodeSnapshot: tehran.code,
        version: 4,
      },
    });
    await prisma.purchaseOrderItem.create({
      data: {
        companyId,
        purchaseOrderId: createdPo.id,
        skuId: mascara.id,
        quantity: 100,
        unitPrice,
        lineSubtotal,
        skuCodeSnapshot: mascara.code,
        productNameSnapshot: product.name,
        variantLabelSnapshot: mascara.name,
        productIdSnapshot: mascara.productId,
      },
    });
    batchPo = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: createdPo.id },
      include: { items: true },
    });
  }

  const batchPoItem = batchPo.items[0];
  if (batchPoItem) {
    const number = 'GRN-2026-000030';
    let receipt = await prisma.goodsReceipt.findUnique({
      where: { companyId_number: { companyId, number } },
      include: { items: true },
    });
    if (!receipt) {
      const createdReceipt = await prisma.goodsReceipt.create({
        data: {
          companyId,
          number,
          warehouseId: warehouse.id,
          purchaseOrderId: batchPo.id,
          supplierId: batchPo.supplierId,
          status: GoodsReceiptStatus.POSTED,
          receivedAt: new Date('2026-10-04T12:00:00.000Z'),
          postedAt: new Date('2026-10-04T12:05:00.000Z'),
          notes: 'SEED: Phase 3.7 multi-batch receipt (60 + 40)',
          createdById: owner.id,
          postedById: owner.id,
          version: 2,
        },
      });
      await prisma.goodsReceiptItem.create({
        data: {
          companyId,
          goodsReceiptId: createdReceipt.id,
          purchaseOrderItemId: batchPoItem.id,
          skuId: batchPoItem.skuId,
          quantity: 100,
        },
      });
      receipt = await prisma.goodsReceipt.findUniqueOrThrow({
        where: { id: createdReceipt.id },
        include: { items: true },
      });
    } else if (receipt.items[0] && receipt.items[0].quantity !== 100) {
      await prisma.goodsReceiptItem.update({
        where: { id: receipt.items[0].id },
        data: { quantity: 100 },
      });
      receipt = await prisma.goodsReceipt.findUniqueOrThrow({
        where: { id: receipt.id },
        include: { items: true },
      });
    }

    const item = receipt.items[0];
    if (item) {
      await ensureItemAllocation(prisma, {
        companyId,
        goodsReceiptItemId: item.id,
        skuId: item.skuId,
        allocations: [
          { batchId: batchAId, quantity: 60 },
          { batchId: batchBId, quantity: 40 },
        ],
      });
    }

    if (batchPo.status !== PurchaseOrderStatus.RECEIVED) {
      await prisma.purchaseOrder.update({
        where: { id: batchPo.id },
        data: { status: PurchaseOrderStatus.RECEIVED },
      });
    }
  }

  await prisma.batchSequence.upsert({
    where: { companyId },
    update: {},
    create: { companyId, nextValue: 100 },
  });
  await prisma.$executeRaw`
    UPDATE batch_sequences
    SET next_value = GREATEST(next_value, 100)
    WHERE company_id = ${companyId}::uuid
  `;

  // GRN-2026-000030 was seeded above — keep operational numbering past seeded numbers.
  await prisma.$executeRaw`
    UPDATE goods_receipt_sequences
    SET next_value = GREATEST(next_value, 31)
    WHERE company_id = ${companyId}::uuid
  `;
}

/**
 * Phase 3.8 putaway demo:
 * GRN-PUTAWAY-DEMO / ESS-MASCARA / LOT-001 / 100 received
 * COMPLETED PUT-000001: 40 → A-03 (LOC-A-03)
 * Remaining putaway: 60 (available for manual testing)
 */
async function seedPutawaysForPishteh(prisma: PrismaClient, companyId: string): Promise<void> {
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'pouria@hector.local' } });
  const warehouse = await prisma.warehouse.findUniqueOrThrow({
    where: { companyId_code: { companyId, code: 'MAIN' } },
  });
  const location = await prisma.warehouseLocation.findUniqueOrThrow({
    where: {
      companyId_warehouseId_code: { companyId, warehouseId: warehouse.id, code: 'A-03' },
    },
  });
  const mascara = await prisma.sku.findFirstOrThrow({
    where: { companyId, code: 'ESS-MASCARA-01' },
  });
  const product = await prisma.product.findUniqueOrThrow({ where: { id: mascara.productId } });
  const tehran = await prisma.supplier.findFirstOrThrow({
    where: { companyId, code: 'TEH-BEAUTY' },
  });

  let batch = await prisma.batch.findUnique({
    where: { companyId_batchNumber: { companyId, batchNumber: 'LOT-001' } },
  });
  if (!batch) {
    batch = await prisma.batch.create({
      data: {
        companyId,
        skuId: mascara.id,
        batchNumber: 'LOT-001',
        supplierBatchNumber: 'LOT-001',
        expiresAt: new Date('2029-10-01T00:00:00.000Z'),
        notes: 'SEED: Phase 3.8 putaway demo batch',
      },
    });
  } else {
    batch = await prisma.batch.update({
      where: { id: batch.id },
      data: {
        skuId: mascara.id,
        supplierBatchNumber: 'LOT-001',
        expiresAt: new Date('2029-10-01T00:00:00.000Z'),
        notes: 'SEED: Phase 3.8 putaway demo batch',
      },
    });
  }

  const poNumber = 'SEED-PO-PUTAWAY-01';
  let po = await prisma.purchaseOrder.findUnique({
    where: { companyId_number: { companyId, number: poNumber } },
    include: { items: true },
  });
  const unitPrice = '5850000';
  const lineSubtotal = '585000000';
  if (!po) {
    const createdPo = await prisma.purchaseOrder.create({
      data: {
        companyId,
        number: poNumber,
        supplierId: tehran.id,
        status: PurchaseOrderStatus.RECEIVED,
        currency: CurrencyCode.IRR,
        purchaseType: PurchaseCommercialType.CASH,
        paymentTermType: PaymentTermType.IMMEDIATE,
        orderDate: new Date('2026-10-02T09:00:00.000Z'),
        notes: 'SEED: Phase 3.8 putaway demo PO',
        subtotal: lineSubtotal,
        total: lineSubtotal,
        createdById: owner.id,
        approvedById: owner.id,
        approvedAt: new Date('2026-10-02T10:00:00.000Z'),
        orderedById: owner.id,
        orderedAt: new Date('2026-10-02T11:00:00.000Z'),
        supplierNameSnapshot: tehran.name,
        supplierCodeSnapshot: tehran.code,
        version: 4,
      },
    });
    await prisma.purchaseOrderItem.create({
      data: {
        companyId,
        purchaseOrderId: createdPo.id,
        skuId: mascara.id,
        quantity: 100,
        unitPrice,
        lineSubtotal,
        skuCodeSnapshot: mascara.code,
        productNameSnapshot: product.name,
        variantLabelSnapshot: mascara.name,
        productIdSnapshot: mascara.productId,
      },
    });
    po = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: createdPo.id },
      include: { items: true },
    });
  }

  const poItem = po.items[0];
  if (!poItem) return;

  const grnNumber = 'GRN-PUTAWAY-DEMO';
  let receipt = await prisma.goodsReceipt.findUnique({
    where: { companyId_number: { companyId, number: grnNumber } },
    include: { items: true },
  });
  if (!receipt) {
    const created = await prisma.goodsReceipt.create({
      data: {
        companyId,
        number: grnNumber,
        warehouseId: warehouse.id,
        purchaseOrderId: po.id,
        supplierId: po.supplierId,
        status: GoodsReceiptStatus.POSTED,
        receivedAt: new Date('2026-10-04T13:00:00.000Z'),
        postedAt: new Date('2026-10-04T13:05:00.000Z'),
        notes: 'SEED: Phase 3.8 putaway demo receipt (100 units)',
        createdById: owner.id,
        postedById: owner.id,
        version: 2,
      },
    });
    await prisma.goodsReceiptItem.create({
      data: {
        companyId,
        goodsReceiptId: created.id,
        purchaseOrderItemId: poItem.id,
        skuId: mascara.id,
        quantity: 100,
      },
    });
    receipt = await prisma.goodsReceipt.findUniqueOrThrow({
      where: { id: created.id },
      include: { items: true },
    });
  }

  const item = receipt.items[0];
  if (!item) return;
  if (item.quantity !== 100) {
    await prisma.goodsReceiptItem.update({
      where: { id: item.id },
      data: { quantity: 100 },
    });
  }

  await ensureItemAllocation(prisma, {
    companyId,
    goodsReceiptItemId: item.id,
    skuId: mascara.id,
    allocations: [{ batchId: batch.id, quantity: 100 }],
  });

  const allocation = await prisma.goodsReceiptItemBatch.findFirstOrThrow({
    where: { companyId, goodsReceiptItemId: item.id, batchId: batch.id },
  });

  let putaway = await prisma.putaway.findUnique({
    where: { companyId_number: { companyId, number: 'PUT-000001' } },
    include: { items: true },
  });
  if (!putaway) {
    putaway = await prisma.putaway.create({
      data: {
        companyId,
        number: 'PUT-000001',
        warehouseId: warehouse.id,
        goodsReceiptId: receipt.id,
        status: PutawayStatus.COMPLETED,
        startedAt: new Date('2026-10-04T14:00:00.000Z'),
        completedAt: new Date('2026-10-04T14:10:00.000Z'),
        createdById: owner.id,
        completedById: owner.id,
        version: 2,
      },
      include: { items: true },
    });
  } else if (putaway.status !== PutawayStatus.COMPLETED) {
    putaway = await prisma.putaway.update({
      where: { id: putaway.id },
      data: {
        status: PutawayStatus.COMPLETED,
        goodsReceiptId: receipt.id,
        warehouseId: warehouse.id,
        completedAt: putaway.completedAt ?? new Date('2026-10-04T14:10:00.000Z'),
        completedById: putaway.completedById ?? owner.id,
        startedAt: putaway.startedAt ?? new Date('2026-10-04T14:00:00.000Z'),
      },
      include: { items: true },
    });
  }

  const existingItem = putaway.items.find(
    (row) =>
      row.goodsReceiptItemBatchId === allocation.id &&
      row.warehouseLocationId === location.id,
  );
  if (!existingItem) {
    // Clear accidental prior items for this seed putaway (idempotent shape).
    if (putaway.items.length > 0) {
      await prisma.putawayItem.deleteMany({ where: { putawayId: putaway.id } });
    }
    await prisma.putawayItem.create({
      data: {
        companyId,
        putawayId: putaway.id,
        goodsReceiptItemBatchId: allocation.id,
        warehouseLocationId: location.id,
        quantity: 40,
      },
    });
  } else if (existingItem.quantity !== 40) {
    await prisma.putawayItem.update({
      where: { id: existingItem.id },
      data: { quantity: 40 },
    });
  }

  await prisma.putawaySequence.upsert({
    where: { companyId },
    update: {},
    create: { companyId, nextValue: 2 },
  });
  await prisma.$executeRaw`
    UPDATE putaway_sequences
    SET next_value = GREATEST(next_value, 2)
    WHERE company_id = ${companyId}::uuid
  `;

  // Phase 3.9: backfill RECEIVE for seeded COMPLETED putaway item (idempotent).
  const putawayItem = await prisma.putawayItem.findFirstOrThrow({
    where: {
      putawayId: putaway.id,
      goodsReceiptItemBatchId: allocation.id,
      warehouseLocationId: location.id,
    },
  });
  await upsertSeedMovementAndBalance(prisma, {
    companyId,
    warehouseId: warehouse.id,
    locationId: location.id,
    skuId: mascara.id,
    batchId: batch.id,
    movementType: InventoryMovementType.RECEIVE,
    quantityDelta: 40,
    sourceType: InventorySourceType.PUTAWAY,
    sourceId: putaway.id,
    sourceLineId: putawayItem.id,
    operationId: putaway.id,
    actorUserId: owner.id,
    occurredAt: new Date('2026-10-04T14:10:00.000Z'),
  });
}

/**
 * Phase 3.9 demo ledger history on A-03 / A-04 (idempotent SEED source lines).
 * A-03: RECEIVE(+60 seed) + ISSUE(-10) + ADJUSTMENT_OUT(-2) + RETURN_IN(+3)
 *   on top of Putaway RECEIVE(+40) → On Hand 91
 * A-04: RECEIVE(+50) → On Hand 50
 * SKU total = 141
 */
async function seedInventoryLedgerForPishteh(
  prisma: PrismaClient,
  companyId: string,
): Promise<void> {
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'pouria@hector.local' } });
  const warehouse = await prisma.warehouse.findUniqueOrThrow({
    where: { companyId_code: { companyId, code: 'MAIN' } },
  });
  const secondary = await prisma.warehouse.findUniqueOrThrow({
    where: { companyId_code: { companyId, code: 'SECONDARY' } },
  });
  const locA01 = await prisma.warehouseLocation.findUniqueOrThrow({
    where: {
      companyId_warehouseId_code: { companyId, warehouseId: warehouse.id, code: 'A-01' },
    },
  });
  const locA02 = await prisma.warehouseLocation.findUniqueOrThrow({
    where: {
      companyId_warehouseId_code: { companyId, warehouseId: warehouse.id, code: 'A-02' },
    },
  });
  const locA03 = await prisma.warehouseLocation.findUniqueOrThrow({
    where: {
      companyId_warehouseId_code: { companyId, warehouseId: warehouse.id, code: 'A-03' },
    },
  });
  const locA04 = await prisma.warehouseLocation.findUniqueOrThrow({
    where: {
      companyId_warehouseId_code: { companyId, warehouseId: warehouse.id, code: 'A-04' },
    },
  });
  const locB01 = await prisma.warehouseLocation.findUniqueOrThrow({
    where: {
      companyId_warehouseId_code: { companyId, warehouseId: secondary.id, code: 'B-01' },
    },
  });
  const mascara = await prisma.sku.findFirstOrThrow({
    where: { companyId, code: 'ESS-MASCARA-01' },
  });
  const batchLot001 = await prisma.batch.findUniqueOrThrow({
    where: { companyId_batchNumber: { companyId, batchNumber: 'LOT-001' } },
  });
  const batchLot002 = await prisma.batch.upsert({
    where: { companyId_batchNumber: { companyId, batchNumber: 'LOT-002' } },
    update: {
      skuId: mascara.id,
      supplierBatchNumber: 'LOT-002',
      notes: 'SEED: Phase 3.10 second lot for stock balance demo',
    },
    create: {
      companyId,
      skuId: mascara.id,
      batchNumber: 'LOT-002',
      supplierBatchNumber: 'LOT-002',
      manufacturedAt: new Date('2026-08-01T00:00:00.000Z'),
      expiresAt: new Date('2028-08-01T00:00:00.000Z'),
      notes: 'SEED: Phase 3.10 second lot for stock balance demo',
    },
  });

  // Deterministic SEED source line ids (stable across re-seed).
  const seedLines = {
    a03ReceiveExtra: 'aaaaaaaa-0003-4000-8000-000000000001',
    a03Issue: 'aaaaaaaa-0003-4000-8000-000000000002',
    a03AdjOut: 'aaaaaaaa-0003-4000-8000-000000000003',
    a03ReturnIn: 'aaaaaaaa-0003-4000-8000-000000000004',
    a04Receive: 'aaaaaaaa-0004-4000-8000-000000000001',
    a01Receive: 'aaaaaaaa-0001-4000-8000-000000000001',
    a01Issue: 'aaaaaaaa-0001-4000-8000-000000000002',
    a02Receive: 'aaaaaaaa-0002-4000-8000-000000000001',
    a03Lot002Receive: 'aaaaaaaa-0003-4000-8000-000000000011',
    a03Lot002Issue: 'aaaaaaaa-0003-4000-8000-000000000012',
    b01Receive: 'aaaaaaaa-000b-4000-8000-000000000001',
  } as const;
  const seedSourceId = 'aaaaaaaa-0000-4000-8000-000000000000';

  // Preserve Phase 3.9 A-03/A-04 LOT-001 demo (plus putaway RECEIVE elsewhere).
  await upsertSeedMovementAndBalance(prisma, {
    companyId,
    warehouseId: warehouse.id,
    locationId: locA03.id,
    skuId: mascara.id,
    batchId: batchLot001.id,
    movementType: InventoryMovementType.RECEIVE,
    quantityDelta: 60,
    sourceType: InventorySourceType.SEED,
    sourceId: seedSourceId,
    sourceLineId: seedLines.a03ReceiveExtra,
    actorUserId: owner.id,
    occurredAt: new Date('2026-10-04T15:00:00.000Z'),
  });
  await upsertSeedMovementAndBalance(prisma, {
    companyId,
    warehouseId: warehouse.id,
    locationId: locA03.id,
    skuId: mascara.id,
    batchId: batchLot001.id,
    movementType: InventoryMovementType.ISSUE,
    quantityDelta: -10,
    sourceType: InventorySourceType.SEED,
    sourceId: seedSourceId,
    sourceLineId: seedLines.a03Issue,
    actorUserId: owner.id,
    occurredAt: new Date('2026-10-04T16:00:00.000Z'),
  });
  await upsertSeedMovementAndBalance(prisma, {
    companyId,
    warehouseId: warehouse.id,
    locationId: locA03.id,
    skuId: mascara.id,
    batchId: batchLot001.id,
    movementType: InventoryMovementType.ADJUSTMENT_OUT,
    quantityDelta: -2,
    sourceType: InventorySourceType.SEED,
    sourceId: seedSourceId,
    sourceLineId: seedLines.a03AdjOut,
    actorUserId: owner.id,
    occurredAt: new Date('2026-10-04T17:00:00.000Z'),
    reasonCode: 'DATA_CORRECTION',
  });
  await upsertSeedMovementAndBalance(prisma, {
    companyId,
    warehouseId: warehouse.id,
    locationId: locA03.id,
    skuId: mascara.id,
    batchId: batchLot001.id,
    movementType: InventoryMovementType.RETURN_IN,
    quantityDelta: 3,
    sourceType: InventorySourceType.SEED,
    sourceId: seedSourceId,
    sourceLineId: seedLines.a03ReturnIn,
    actorUserId: owner.id,
    occurredAt: new Date('2026-10-04T18:00:00.000Z'),
  });
  await upsertSeedMovementAndBalance(prisma, {
    companyId,
    warehouseId: warehouse.id,
    locationId: locA04.id,
    skuId: mascara.id,
    batchId: batchLot001.id,
    movementType: InventoryMovementType.RECEIVE,
    quantityDelta: 50,
    sourceType: InventorySourceType.SEED,
    sourceId: seedSourceId,
    sourceLineId: seedLines.a04Receive,
    actorUserId: owner.id,
    occurredAt: new Date('2026-10-04T15:30:00.000Z'),
  });

  // Phase 3.10 multi-dimension demo (ledger-first; balance rebuilt from SUM).
  // A-01 / LOT-001: +100 -20 = 80
  await upsertSeedMovementAndBalance(prisma, {
    companyId,
    warehouseId: warehouse.id,
    locationId: locA01.id,
    skuId: mascara.id,
    batchId: batchLot001.id,
    movementType: InventoryMovementType.RECEIVE,
    quantityDelta: 100,
    sourceType: InventorySourceType.SEED,
    sourceId: seedSourceId,
    sourceLineId: seedLines.a01Receive,
    actorUserId: owner.id,
    occurredAt: new Date('2026-10-04T14:00:00.000Z'),
  });
  await upsertSeedMovementAndBalance(prisma, {
    companyId,
    warehouseId: warehouse.id,
    locationId: locA01.id,
    skuId: mascara.id,
    batchId: batchLot001.id,
    movementType: InventoryMovementType.ISSUE,
    quantityDelta: -20,
    sourceType: InventorySourceType.SEED,
    sourceId: seedSourceId,
    sourceLineId: seedLines.a01Issue,
    actorUserId: owner.id,
    occurredAt: new Date('2026-10-04T14:30:00.000Z'),
  });
  // A-02 / LOT-001: +50 = 50
  await upsertSeedMovementAndBalance(prisma, {
    companyId,
    warehouseId: warehouse.id,
    locationId: locA02.id,
    skuId: mascara.id,
    batchId: batchLot001.id,
    movementType: InventoryMovementType.RECEIVE,
    quantityDelta: 50,
    sourceType: InventorySourceType.SEED,
    sourceId: seedSourceId,
    sourceLineId: seedLines.a02Receive,
    actorUserId: owner.id,
    occurredAt: new Date('2026-10-04T14:15:00.000Z'),
  });
  // A-03 / LOT-002: +75 -5 = 70
  await upsertSeedMovementAndBalance(prisma, {
    companyId,
    warehouseId: warehouse.id,
    locationId: locA03.id,
    skuId: mascara.id,
    batchId: batchLot002.id,
    movementType: InventoryMovementType.RECEIVE,
    quantityDelta: 75,
    sourceType: InventorySourceType.SEED,
    sourceId: seedSourceId,
    sourceLineId: seedLines.a03Lot002Receive,
    actorUserId: owner.id,
    occurredAt: new Date('2026-10-04T15:45:00.000Z'),
  });
  await upsertSeedMovementAndBalance(prisma, {
    companyId,
    warehouseId: warehouse.id,
    locationId: locA03.id,
    skuId: mascara.id,
    batchId: batchLot002.id,
    movementType: InventoryMovementType.ISSUE,
    quantityDelta: -5,
    sourceType: InventorySourceType.SEED,
    sourceId: seedSourceId,
    sourceLineId: seedLines.a03Lot002Issue,
    actorUserId: owner.id,
    occurredAt: new Date('2026-10-04T16:15:00.000Z'),
  });
  // SECONDARY / B-01 / LOT-002: +25 = 25
  await upsertSeedMovementAndBalance(prisma, {
    companyId,
    warehouseId: secondary.id,
    locationId: locB01.id,
    skuId: mascara.id,
    batchId: batchLot002.id,
    movementType: InventoryMovementType.RECEIVE,
    quantityDelta: 25,
    sourceType: InventorySourceType.SEED,
    sourceId: seedSourceId,
    sourceLineId: seedLines.b01Receive,
    actorUserId: owner.id,
    occurredAt: new Date('2026-10-04T16:45:00.000Z'),
  });
}

/**
 * Phase 3.11 demo transfers (ledger-first; idempotent).
 * TRF-000001 COMPLETED: MAIN A-01 → MAIN A-03 / LOT-001 qty 20
 * TRF-000002 IN_TRANSIT: MAIN A-02 → SECONDARY B-01 / LOT-001 qty 30
 * TRF-000003 DRAFT: MAIN → SECONDARY (no movements)
 */
async function seedStockTransfersForPishteh(
  prisma: PrismaClient,
  companyId: string,
): Promise<void> {
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'pouria@hector.local' } });
  const transit = await ensureSystemTransitPosition(prisma, companyId);
  const main = await prisma.warehouse.findUniqueOrThrow({
    where: { companyId_code: { companyId, code: 'MAIN' } },
  });
  const secondary = await prisma.warehouse.findUniqueOrThrow({
    where: { companyId_code: { companyId, code: 'SECONDARY' } },
  });
  const locA01 = await prisma.warehouseLocation.findUniqueOrThrow({
    where: {
      companyId_warehouseId_code: { companyId, warehouseId: main.id, code: 'A-01' },
    },
  });
  const locA02 = await prisma.warehouseLocation.findUniqueOrThrow({
    where: {
      companyId_warehouseId_code: { companyId, warehouseId: main.id, code: 'A-02' },
    },
  });
  const locA03 = await prisma.warehouseLocation.findUniqueOrThrow({
    where: {
      companyId_warehouseId_code: { companyId, warehouseId: main.id, code: 'A-03' },
    },
  });
  const locB01 = await prisma.warehouseLocation.findUniqueOrThrow({
    where: {
      companyId_warehouseId_code: { companyId, warehouseId: secondary.id, code: 'B-01' },
    },
  });
  const mascara = await prisma.sku.findFirstOrThrow({
    where: { companyId, code: 'ESS-MASCARA-01' },
  });
  const lot001 = await prisma.batch.findUniqueOrThrow({
    where: { companyId_batchNumber: { companyId, batchNumber: 'LOT-001' } },
  });

  const ids = {
    trf1: 'bbbbbbbb-0001-4000-8000-000000000001',
    trf1Item: 'bbbbbbbb-0001-4000-8000-000000000011',
    trf1CompleteLine: 'bbbbbbbb-0001-4000-8000-000000000012',
    trf1CancelLine: 'bbbbbbbb-0001-4000-8000-000000000013',
    trf1DispatchOp: 'bbbbbbbb-0001-4000-8000-000000000014',
    trf1CompleteOp: 'bbbbbbbb-0001-4000-8000-000000000015',
    trf2: 'bbbbbbbb-0002-4000-8000-000000000001',
    trf2Item: 'bbbbbbbb-0002-4000-8000-000000000011',
    trf2CompleteLine: 'bbbbbbbb-0002-4000-8000-000000000012',
    trf2CancelLine: 'bbbbbbbb-0002-4000-8000-000000000013',
    trf2DispatchOp: 'bbbbbbbb-0002-4000-8000-000000000014',
    trf3: 'bbbbbbbb-0003-4000-8000-000000000001',
  } as const;

  await prisma.stockTransferSequence.upsert({
    where: { companyId },
    update: {},
    create: { companyId, nextValue: 4 },
  });
  // Keep sequence ahead of seeded numbers if already higher.
  await prisma.$executeRaw`
    UPDATE stock_transfer_sequences
    SET next_value = GREATEST(next_value, 4)
    WHERE company_id = ${companyId}::uuid
  `;

  // TRF-000001 COMPLETED
  await prisma.stockTransfer.upsert({
    where: { companyId_number: { companyId, number: 'TRF-000001' } },
    update: {
      status: StockTransferStatus.COMPLETED,
      sourceWarehouseId: main.id,
      destinationWarehouseId: main.id,
      dispatchedAt: new Date('2026-10-04T19:00:00.000Z'),
      completedAt: new Date('2026-10-04T19:30:00.000Z'),
      dispatchedById: owner.id,
      completedById: owner.id,
      notes: 'SEED: same-warehouse location transfer',
    },
    create: {
      id: ids.trf1,
      companyId,
      number: 'TRF-000001',
      sourceWarehouseId: main.id,
      destinationWarehouseId: main.id,
      status: StockTransferStatus.COMPLETED,
      notes: 'SEED: same-warehouse location transfer',
      createdById: owner.id,
      dispatchedById: owner.id,
      completedById: owner.id,
      dispatchedAt: new Date('2026-10-04T19:00:00.000Z'),
      completedAt: new Date('2026-10-04T19:30:00.000Z'),
    },
  });
  const trf1 = await prisma.stockTransfer.findUniqueOrThrow({
    where: { companyId_number: { companyId, number: 'TRF-000001' } },
  });
  await prisma.stockTransferItem.upsert({
    where: {
      transferId_skuId_batchId_classification_sourceLocationId_destinationLocationId: {
        transferId: trf1.id,
        skuId: mascara.id,
        batchId: lot001.id,
        classification: StockClassification.SELLABLE,
        sourceLocationId: locA01.id,
        destinationLocationId: locA03.id,
      },
    },
    update: {
      quantity: 20,
      dispatchOperationId: ids.trf1DispatchOp,
      completeOperationId: ids.trf1CompleteOp,
    },
    create: {
      id: ids.trf1Item,
      companyId,
      transferId: trf1.id,
      skuId: mascara.id,
      batchId: lot001.id,
      sourceLocationId: locA01.id,
      destinationLocationId: locA03.id,
      quantity: 20,
      completeSourceLineId: ids.trf1CompleteLine,
      cancelSourceLineId: ids.trf1CancelLine,
      dispatchOperationId: ids.trf1DispatchOp,
      completeOperationId: ids.trf1CompleteOp,
    },
  });
  const trf1Item = await prisma.stockTransferItem.findFirstOrThrow({
    where: { transferId: trf1.id },
  });
  // Dispatch pair
  await upsertSeedMovementAndBalance(prisma, {
    companyId,
    warehouseId: main.id,
    locationId: locA01.id,
    skuId: mascara.id,
    batchId: lot001.id,
    movementType: InventoryMovementType.TRANSFER_OUT,
    quantityDelta: -20,
    sourceType: InventorySourceType.TRANSFER,
    sourceId: trf1.id,
    sourceLineId: trf1Item.id,
    operationId: ids.trf1DispatchOp,
    actorUserId: owner.id,
    occurredAt: new Date('2026-10-04T19:00:00.000Z'),
  });
  await upsertSeedMovementAndBalance(prisma, {
    companyId,
    warehouseId: transit.warehouseId,
    locationId: transit.locationId,
    skuId: mascara.id,
    batchId: lot001.id,
    movementType: InventoryMovementType.TRANSFER_IN,
    quantityDelta: 20,
    sourceType: InventorySourceType.TRANSFER,
    sourceId: trf1.id,
    sourceLineId: trf1Item.id,
    operationId: ids.trf1DispatchOp,
    actorUserId: owner.id,
    occurredAt: new Date('2026-10-04T19:00:00.000Z'),
  });
  // Complete pair
  await upsertSeedMovementAndBalance(prisma, {
    companyId,
    warehouseId: transit.warehouseId,
    locationId: transit.locationId,
    skuId: mascara.id,
    batchId: lot001.id,
    movementType: InventoryMovementType.TRANSFER_OUT,
    quantityDelta: -20,
    sourceType: InventorySourceType.TRANSFER,
    sourceId: trf1.id,
    sourceLineId: trf1Item.completeSourceLineId,
    operationId: ids.trf1CompleteOp,
    actorUserId: owner.id,
    occurredAt: new Date('2026-10-04T19:30:00.000Z'),
  });
  await upsertSeedMovementAndBalance(prisma, {
    companyId,
    warehouseId: main.id,
    locationId: locA03.id,
    skuId: mascara.id,
    batchId: lot001.id,
    movementType: InventoryMovementType.TRANSFER_IN,
    quantityDelta: 20,
    sourceType: InventorySourceType.TRANSFER,
    sourceId: trf1.id,
    sourceLineId: trf1Item.completeSourceLineId,
    operationId: ids.trf1CompleteOp,
    actorUserId: owner.id,
    occurredAt: new Date('2026-10-04T19:30:00.000Z'),
  });

  // TRF-000002 IN_TRANSIT
  await prisma.stockTransfer.upsert({
    where: { companyId_number: { companyId, number: 'TRF-000002' } },
    update: {
      status: StockTransferStatus.IN_TRANSIT,
      sourceWarehouseId: main.id,
      destinationWarehouseId: secondary.id,
      dispatchedAt: new Date('2026-10-04T20:00:00.000Z'),
      dispatchedById: owner.id,
      completedAt: null,
      completedById: null,
      notes: 'SEED: cross-warehouse in transit',
    },
    create: {
      id: ids.trf2,
      companyId,
      number: 'TRF-000002',
      sourceWarehouseId: main.id,
      destinationWarehouseId: secondary.id,
      status: StockTransferStatus.IN_TRANSIT,
      notes: 'SEED: cross-warehouse in transit',
      createdById: owner.id,
      dispatchedById: owner.id,
      dispatchedAt: new Date('2026-10-04T20:00:00.000Z'),
    },
  });
  const trf2 = await prisma.stockTransfer.findUniqueOrThrow({
    where: { companyId_number: { companyId, number: 'TRF-000002' } },
  });
  await prisma.stockTransferItem.upsert({
    where: {
      transferId_skuId_batchId_classification_sourceLocationId_destinationLocationId: {
        transferId: trf2.id,
        skuId: mascara.id,
        batchId: lot001.id,
        classification: StockClassification.SELLABLE,
        sourceLocationId: locA02.id,
        destinationLocationId: locB01.id,
      },
    },
    update: {
      quantity: 30,
      dispatchOperationId: ids.trf2DispatchOp,
    },
    create: {
      id: ids.trf2Item,
      companyId,
      transferId: trf2.id,
      skuId: mascara.id,
      batchId: lot001.id,
      sourceLocationId: locA02.id,
      destinationLocationId: locB01.id,
      quantity: 30,
      completeSourceLineId: ids.trf2CompleteLine,
      cancelSourceLineId: ids.trf2CancelLine,
      dispatchOperationId: ids.trf2DispatchOp,
    },
  });
  const trf2Item = await prisma.stockTransferItem.findFirstOrThrow({
    where: { transferId: trf2.id },
  });
  await upsertSeedMovementAndBalance(prisma, {
    companyId,
    warehouseId: main.id,
    locationId: locA02.id,
    skuId: mascara.id,
    batchId: lot001.id,
    movementType: InventoryMovementType.TRANSFER_OUT,
    quantityDelta: -30,
    sourceType: InventorySourceType.TRANSFER,
    sourceId: trf2.id,
    sourceLineId: trf2Item.id,
    operationId: ids.trf2DispatchOp,
    actorUserId: owner.id,
    occurredAt: new Date('2026-10-04T20:00:00.000Z'),
  });
  await upsertSeedMovementAndBalance(prisma, {
    companyId,
    warehouseId: transit.warehouseId,
    locationId: transit.locationId,
    skuId: mascara.id,
    batchId: lot001.id,
    movementType: InventoryMovementType.TRANSFER_IN,
    quantityDelta: 30,
    sourceType: InventorySourceType.TRANSFER,
    sourceId: trf2.id,
    sourceLineId: trf2Item.id,
    operationId: ids.trf2DispatchOp,
    actorUserId: owner.id,
    occurredAt: new Date('2026-10-04T20:00:00.000Z'),
  });

  // TRF-000003 DRAFT (no movements)
  await prisma.stockTransfer.upsert({
    where: { companyId_number: { companyId, number: 'TRF-000003' } },
    update: {
      status: StockTransferStatus.DRAFT,
      sourceWarehouseId: main.id,
      destinationWarehouseId: secondary.id,
      notes: 'SEED: draft transfer (no stock reserved)',
      dispatchedAt: null,
      completedAt: null,
      cancelledAt: null,
      dispatchedById: null,
      completedById: null,
      cancelledById: null,
    },
    create: {
      id: ids.trf3,
      companyId,
      number: 'TRF-000003',
      sourceWarehouseId: main.id,
      destinationWarehouseId: secondary.id,
      status: StockTransferStatus.DRAFT,
      notes: 'SEED: draft transfer (no stock reserved)',
      createdById: owner.id,
    },
  });
}

async function upsertSeedMovementAndBalance(
  prisma: PrismaClient,
  input: {
    companyId: string;
    warehouseId: string;
    locationId: string;
    skuId: string;
    batchId: string;
    classification?: StockClassification;
    movementType: InventoryMovementType;
    quantityDelta: number;
    sourceType: InventorySourceType;
    sourceId: string;
    sourceLineId: string;
    operationId?: string;
    actorUserId: string;
    occurredAt: Date;
    reasonCode?: string;
  },
): Promise<void> {
  const classification = input.classification ?? StockClassification.SELLABLE;
  const existing = await prisma.inventoryMovement.findUnique({
    where: {
      companyId_sourceType_sourceLineId_movementType: {
        companyId: input.companyId,
        sourceType: input.sourceType,
        sourceLineId: input.sourceLineId,
        movementType: input.movementType,
      },
    },
  });
  if (!existing) {
    await prisma.inventoryMovement.create({
      data: {
        companyId: input.companyId,
        warehouseId: input.warehouseId,
        locationId: input.locationId,
        skuId: input.skuId,
        batchId: input.batchId,
        classification,
        movementType: input.movementType,
        quantityDelta: input.quantityDelta,
        occurredAt: input.occurredAt,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceLineId: input.sourceLineId,
        operationId: input.operationId ?? null,
        reasonCode: input.reasonCode ?? null,
        createdById: input.actorUserId,
      },
    });
  }

  const sum = await prisma.inventoryMovement.aggregate({
    where: {
      companyId: input.companyId,
      warehouseId: input.warehouseId,
      locationId: input.locationId,
      skuId: input.skuId,
      batchId: input.batchId,
      classification,
    },
    _sum: { quantityDelta: true },
  });
  const onHand = sum._sum.quantityDelta ?? 0;
  await prisma.inventoryBalance.upsert({
    where: {
      companyId_warehouseId_locationId_skuId_batchId_classification: {
        companyId: input.companyId,
        warehouseId: input.warehouseId,
        locationId: input.locationId,
        skuId: input.skuId,
        batchId: input.batchId,
        classification,
      },
    },
    update: { onHandQuantity: onHand },
    create: {
      companyId: input.companyId,
      warehouseId: input.warehouseId,
      locationId: input.locationId,
      skuId: input.skuId,
      batchId: input.batchId,
      classification,
      onHandQuantity: onHand,
    },
  });
}

async function upsertSeedClassificationChange(
  prisma: PrismaClient,
  input: {
    id: string;
    companyId: string;
    warehouseId: string;
    locationId: string;
    skuId: string;
    batchId: string;
    fromClassification: StockClassification;
    toClassification: StockClassification;
    quantity: number;
    operationId: string;
    actorUserId: string;
    occurredAt: Date;
    reason?: string;
  },
): Promise<void> {
  await prisma.stockClassificationChange.upsert({
    where: { id: input.id },
    update: {
      fromClassification: input.fromClassification,
      toClassification: input.toClassification,
      quantity: input.quantity,
      operationId: input.operationId,
    },
    create: {
      id: input.id,
      companyId: input.companyId,
      warehouseId: input.warehouseId,
      locationId: input.locationId,
      skuId: input.skuId,
      batchId: input.batchId,
      fromClassification: input.fromClassification,
      toClassification: input.toClassification,
      quantity: input.quantity,
      operationId: input.operationId,
      reason: input.reason ?? null,
      createdById: input.actorUserId,
    },
  });

  await upsertSeedMovementAndBalance(prisma, {
    companyId: input.companyId,
    warehouseId: input.warehouseId,
    locationId: input.locationId,
    skuId: input.skuId,
    batchId: input.batchId,
    classification: input.fromClassification,
    movementType: InventoryMovementType.RECLASSIFY_OUT,
    quantityDelta: -input.quantity,
    sourceType: InventorySourceType.CLASSIFICATION_CHANGE,
    sourceId: input.id,
    sourceLineId: input.id,
    operationId: input.operationId,
    actorUserId: input.actorUserId,
    occurredAt: input.occurredAt,
    reasonCode: input.reason ?? null,
  });
  await upsertSeedMovementAndBalance(prisma, {
    companyId: input.companyId,
    warehouseId: input.warehouseId,
    locationId: input.locationId,
    skuId: input.skuId,
    batchId: input.batchId,
    classification: input.toClassification,
    movementType: InventoryMovementType.RECLASSIFY_IN,
    quantityDelta: input.quantity,
    sourceType: InventorySourceType.CLASSIFICATION_CHANGE,
    sourceId: input.id,
    sourceLineId: input.id,
    operationId: input.operationId,
    actorUserId: input.actorUserId,
    occurredAt: input.occurredAt,
    reasonCode: input.reason ?? null,
  });
}

/**
 * Phase 3.12 demo: classification history + stock issues on ESS-MASCARA / A-03 / LOT-001.
 */
async function seedStockClassificationAndIssuesForPishteh(
  prisma: PrismaClient,
  companyId: string,
): Promise<void> {
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'pouria@hector.local' } });
  const warehouse = await prisma.warehouse.findUniqueOrThrow({
    where: { companyId_code: { companyId, code: 'MAIN' } },
  });
  const locA03 = await prisma.warehouseLocation.findUniqueOrThrow({
    where: {
      companyId_warehouseId_code: { companyId, warehouseId: warehouse.id, code: 'A-03' },
    },
  });
  const mascara = await prisma.sku.findFirstOrThrow({
    where: { companyId, code: 'ESS-MASCARA-01' },
  });
  const lot001 = await prisma.batch.findUniqueOrThrow({
    where: { companyId_batchNumber: { companyId, batchNumber: 'LOT-001' } },
  });

  const cls = {
    sellToTester: 'cccccccc-0001-4000-8000-000000000001',
    opSellToTester: 'cccccccc-0001-4000-8000-000000000011',
    sellToDamaged: 'cccccccc-0002-4000-8000-000000000001',
    opSellToDamaged: 'cccccccc-0002-4000-8000-000000000011',
    sellToQuarantine: 'cccccccc-0003-4000-8000-000000000001',
    opSellToQuarantine: 'cccccccc-0003-4000-8000-000000000011',
  } as const;

  await upsertSeedClassificationChange(prisma, {
    id: cls.sellToTester,
    companyId,
    warehouseId: warehouse.id,
    locationId: locA03.id,
    skuId: mascara.id,
    batchId: lot001.id,
    fromClassification: StockClassification.SELLABLE,
    toClassification: StockClassification.TESTER,
    quantity: 20,
    operationId: cls.opSellToTester,
    actorUserId: owner.id,
    occurredAt: new Date('2026-10-04T21:00:00.000Z'),
    reason: 'SEED: tester allocation',
  });
  await upsertSeedClassificationChange(prisma, {
    id: cls.sellToDamaged,
    companyId,
    warehouseId: warehouse.id,
    locationId: locA03.id,
    skuId: mascara.id,
    batchId: lot001.id,
    fromClassification: StockClassification.SELLABLE,
    toClassification: StockClassification.DAMAGED,
    quantity: 5,
    operationId: cls.opSellToDamaged,
    actorUserId: owner.id,
    occurredAt: new Date('2026-10-04T21:05:00.000Z'),
    reason: 'SEED: damage write-off prep',
  });
  await upsertSeedClassificationChange(prisma, {
    id: cls.sellToQuarantine,
    companyId,
    warehouseId: warehouse.id,
    locationId: locA03.id,
    skuId: mascara.id,
    batchId: lot001.id,
    fromClassification: StockClassification.SELLABLE,
    toClassification: StockClassification.QUARANTINE,
    quantity: 10,
    operationId: cls.opSellToQuarantine,
    actorUserId: owner.id,
    occurredAt: new Date('2026-10-04T21:10:00.000Z'),
    reason: 'SEED: quarantine hold',
  });

  await prisma.stockIssueSequence.upsert({
    where: { companyId },
    update: {},
    create: { companyId, nextValue: 4 },
  });
  await prisma.$executeRaw`
    UPDATE stock_issue_sequences
    SET next_value = GREATEST(next_value, 4)
    WHERE company_id = ${companyId}::uuid
  `;

  const issueIds = {
    iss1: 'dddddddd-0001-4000-8000-000000000001',
    iss1Item: 'dddddddd-0001-4000-8000-000000000011',
    iss2: 'dddddddd-0002-4000-8000-000000000001',
    iss2Item: 'dddddddd-0002-4000-8000-000000000011',
    iss3: 'dddddddd-0003-4000-8000-000000000001',
    iss3Item: 'dddddddd-0003-4000-8000-000000000011',
  } as const;

  const postedAt1 = new Date('2026-10-04T21:30:00.000Z');
  const postedAt2 = new Date('2026-10-04T21:35:00.000Z');

  await prisma.stockIssue.upsert({
    where: { companyId_number: { companyId, number: 'ISS-000001' } },
    update: {
      status: StockIssueStatus.POSTED,
      reason: StockIssueReason.SAMPLE,
      warehouseId: warehouse.id,
      postedAt: postedAt1,
      postedById: owner.id,
    },
    create: {
      id: issueIds.iss1,
      companyId,
      number: 'ISS-000001',
      warehouseId: warehouse.id,
      reason: StockIssueReason.SAMPLE,
      status: StockIssueStatus.POSTED,
      notes: 'SEED: sample issue',
      createdById: owner.id,
      postedById: owner.id,
      postedAt: postedAt1,
    },
  });
  const iss1 = await prisma.stockIssue.findUniqueOrThrow({
    where: { companyId_number: { companyId, number: 'ISS-000001' } },
  });
  await prisma.stockIssueItem.upsert({
    where: {
      stockIssueId_skuId_batchId_locationId_classification: {
        stockIssueId: iss1.id,
        skuId: mascara.id,
        batchId: lot001.id,
        locationId: locA03.id,
        classification: StockClassification.SELLABLE,
      },
    },
    update: { quantity: 10 },
    create: {
      id: issueIds.iss1Item,
      companyId,
      stockIssueId: iss1.id,
      skuId: mascara.id,
      batchId: lot001.id,
      locationId: locA03.id,
      classification: StockClassification.SELLABLE,
      quantity: 10,
    },
  });
  const iss1Item = await prisma.stockIssueItem.findFirstOrThrow({
    where: { stockIssueId: iss1.id },
  });
  await upsertSeedMovementAndBalance(prisma, {
    companyId,
    warehouseId: warehouse.id,
    locationId: locA03.id,
    skuId: mascara.id,
    batchId: lot001.id,
    classification: StockClassification.SELLABLE,
    movementType: InventoryMovementType.ISSUE,
    quantityDelta: -10,
    sourceType: InventorySourceType.STOCK_ISSUE,
    sourceId: iss1.id,
    sourceLineId: iss1Item.id,
    actorUserId: owner.id,
    occurredAt: postedAt1,
    reasonCode: StockIssueReason.SAMPLE,
  });

  await prisma.stockIssue.upsert({
    where: { companyId_number: { companyId, number: 'ISS-000002' } },
    update: {
      status: StockIssueStatus.POSTED,
      reason: StockIssueReason.COMPANY_USE,
      warehouseId: warehouse.id,
      postedAt: postedAt2,
      postedById: owner.id,
    },
    create: {
      id: issueIds.iss2,
      companyId,
      number: 'ISS-000002',
      warehouseId: warehouse.id,
      reason: StockIssueReason.COMPANY_USE,
      status: StockIssueStatus.POSTED,
      notes: 'SEED: internal use',
      createdById: owner.id,
      postedById: owner.id,
      postedAt: postedAt2,
    },
  });
  const iss2 = await prisma.stockIssue.findUniqueOrThrow({
    where: { companyId_number: { companyId, number: 'ISS-000002' } },
  });
  await prisma.stockIssueItem.upsert({
    where: {
      stockIssueId_skuId_batchId_locationId_classification: {
        stockIssueId: iss2.id,
        skuId: mascara.id,
        batchId: lot001.id,
        locationId: locA03.id,
        classification: StockClassification.SELLABLE,
      },
    },
    update: { quantity: 2 },
    create: {
      id: issueIds.iss2Item,
      companyId,
      stockIssueId: iss2.id,
      skuId: mascara.id,
      batchId: lot001.id,
      locationId: locA03.id,
      classification: StockClassification.SELLABLE,
      quantity: 2,
    },
  });
  const iss2Item = await prisma.stockIssueItem.findFirstOrThrow({
    where: { stockIssueId: iss2.id },
  });
  await upsertSeedMovementAndBalance(prisma, {
    companyId,
    warehouseId: warehouse.id,
    locationId: locA03.id,
    skuId: mascara.id,
    batchId: lot001.id,
    classification: StockClassification.SELLABLE,
    movementType: InventoryMovementType.ISSUE,
    quantityDelta: -2,
    sourceType: InventorySourceType.STOCK_ISSUE,
    sourceId: iss2.id,
    sourceLineId: iss2Item.id,
    actorUserId: owner.id,
    occurredAt: postedAt2,
    reasonCode: StockIssueReason.COMPANY_USE,
  });

  await prisma.stockIssue.upsert({
    where: { companyId_number: { companyId, number: 'ISS-000003' } },
    update: {
      status: StockIssueStatus.DRAFT,
      reason: StockIssueReason.DAMAGE,
      warehouseId: warehouse.id,
      postedAt: null,
      postedById: null,
    },
    create: {
      id: issueIds.iss3,
      companyId,
      number: 'ISS-000003',
      warehouseId: warehouse.id,
      reason: StockIssueReason.DAMAGE,
      status: StockIssueStatus.DRAFT,
      notes: 'SEED: draft damage disposal',
      createdById: owner.id,
    },
  });
  const iss3 = await prisma.stockIssue.findUniqueOrThrow({
    where: { companyId_number: { companyId, number: 'ISS-000003' } },
  });
  await prisma.stockIssueItem.upsert({
    where: {
      stockIssueId_skuId_batchId_locationId_classification: {
        stockIssueId: iss3.id,
        skuId: mascara.id,
        batchId: lot001.id,
        locationId: locA03.id,
        classification: StockClassification.DAMAGED,
      },
    },
    update: { quantity: 3 },
    create: {
      id: issueIds.iss3Item,
      companyId,
      stockIssueId: iss3.id,
      skuId: mascara.id,
      batchId: lot001.id,
      locationId: locA03.id,
      classification: StockClassification.DAMAGED,
      quantity: 3,
    },
  });
}

/**
 * Phase 3.13 demo: manual adjustments + cycle stock count on ESS-MASCARA positions.
 */
async function seedInventoryAdjustmentsAndStockCountsForPishteh(
  prisma: PrismaClient,
  companyId: string,
): Promise<void> {
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'pouria@hector.local' } });
  const warehouse = await prisma.warehouse.findUniqueOrThrow({
    where: { companyId_code: { companyId, code: 'MAIN' } },
  });
  const locA01 = await prisma.warehouseLocation.findUniqueOrThrow({
    where: {
      companyId_warehouseId_code: { companyId, warehouseId: warehouse.id, code: 'A-01' },
    },
  });
  const locA02 = await prisma.warehouseLocation.findUniqueOrThrow({
    where: {
      companyId_warehouseId_code: { companyId, warehouseId: warehouse.id, code: 'A-02' },
    },
  });
  const locA03 = await prisma.warehouseLocation.findUniqueOrThrow({
    where: {
      companyId_warehouseId_code: { companyId, warehouseId: warehouse.id, code: 'A-03' },
    },
  });
  const locA04 = await prisma.warehouseLocation.findUniqueOrThrow({
    where: {
      companyId_warehouseId_code: { companyId, warehouseId: warehouse.id, code: 'A-04' },
    },
  });
  const mascara = await prisma.sku.findFirstOrThrow({
    where: { companyId, code: 'ESS-MASCARA-01' },
  });
  const lot001 = await prisma.batch.findUniqueOrThrow({
    where: { companyId_batchNumber: { companyId, batchNumber: 'LOT-001' } },
  });

  const readOnHand = async (
    locationId: string,
    batchId: string,
    classification: StockClassification = StockClassification.SELLABLE,
  ): Promise<number> => {
    const row = await prisma.inventoryBalance.findUnique({
      where: {
        companyId_warehouseId_locationId_skuId_batchId_classification: {
          companyId,
          warehouseId: warehouse.id,
          locationId,
          skuId: mascara.id,
          batchId,
          classification,
        },
      },
    });
    return row?.onHandQuantity ?? 0;
  };

  await prisma.inventoryAdjustmentSequence.upsert({
    where: { companyId },
    update: {},
    create: { companyId, nextValue: 4 },
  });
  await prisma.$executeRaw`
    UPDATE inventory_adjustment_sequences
    SET next_value = GREATEST(next_value, 4)
    WHERE company_id = ${companyId}::uuid
  `;

  const adjIds = {
    adj1: 'eeeeeeee-0001-4000-8000-000000000001',
    adj1Item: 'eeeeeeee-0001-4000-8000-000000000011',
    adj2: 'eeeeeeee-0002-4000-8000-000000000001',
    adj2Item: 'eeeeeeee-0002-4000-8000-000000000011',
    adj3: 'eeeeeeee-0003-4000-8000-000000000001',
    adj3Item: 'eeeeeeee-0003-4000-8000-000000000011',
  } as const;

  const postedAt1 = new Date('2026-10-04T22:00:00.000Z');
  const postedAt2 = new Date('2026-10-04T22:05:00.000Z');

  await prisma.inventoryAdjustment.upsert({
    where: { companyId_number: { companyId, number: 'ADJ-000001' } },
    update: {
      status: InventoryAdjustmentStatus.POSTED,
      reason: InventoryAdjustmentReason.FOUND,
      warehouseId: warehouse.id,
      postedAt: postedAt1,
      postedById: owner.id,
    },
    create: {
      id: adjIds.adj1,
      companyId,
      number: 'ADJ-000001',
      warehouseId: warehouse.id,
      reason: InventoryAdjustmentReason.FOUND,
      status: InventoryAdjustmentStatus.POSTED,
      notes: 'SEED: found stock in A-03',
      createdById: owner.id,
      postedById: owner.id,
      postedAt: postedAt1,
    },
  });
  const adj1 = await prisma.inventoryAdjustment.findUniqueOrThrow({
    where: { companyId_number: { companyId, number: 'ADJ-000001' } },
  });
  await prisma.inventoryAdjustmentItem.upsert({
    where: {
      inventoryAdjustmentId_locationId_skuId_batchId_classification_direction: {
        inventoryAdjustmentId: adj1.id,
        locationId: locA03.id,
        skuId: mascara.id,
        batchId: lot001.id,
        classification: StockClassification.SELLABLE,
        direction: InventoryAdjustmentDirection.IN,
      },
    },
    update: { quantity: 5 },
    create: {
      id: adjIds.adj1Item,
      companyId,
      inventoryAdjustmentId: adj1.id,
      locationId: locA03.id,
      skuId: mascara.id,
      batchId: lot001.id,
      classification: StockClassification.SELLABLE,
      direction: InventoryAdjustmentDirection.IN,
      quantity: 5,
    },
  });
  const adj1Item = await prisma.inventoryAdjustmentItem.findFirstOrThrow({
    where: { inventoryAdjustmentId: adj1.id, direction: InventoryAdjustmentDirection.IN },
  });
  await upsertSeedMovementAndBalance(prisma, {
    companyId,
    warehouseId: warehouse.id,
    locationId: locA03.id,
    skuId: mascara.id,
    batchId: lot001.id,
    classification: StockClassification.SELLABLE,
    movementType: InventoryMovementType.ADJUSTMENT_IN,
    quantityDelta: 5,
    sourceType: InventorySourceType.MANUAL_ADJUSTMENT,
    sourceId: adj1.id,
    sourceLineId: adj1Item.id,
    actorUserId: owner.id,
    occurredAt: postedAt1,
    reasonCode: InventoryAdjustmentReason.FOUND,
  });

  await prisma.inventoryAdjustment.upsert({
    where: { companyId_number: { companyId, number: 'ADJ-000002' } },
    update: {
      status: InventoryAdjustmentStatus.POSTED,
      reason: InventoryAdjustmentReason.MISSING,
      warehouseId: warehouse.id,
      postedAt: postedAt2,
      postedById: owner.id,
    },
    create: {
      id: adjIds.adj2,
      companyId,
      number: 'ADJ-000002',
      warehouseId: warehouse.id,
      reason: InventoryAdjustmentReason.MISSING,
      status: InventoryAdjustmentStatus.POSTED,
      notes: 'SEED: missing units A-03',
      createdById: owner.id,
      postedById: owner.id,
      postedAt: postedAt2,
    },
  });
  const adj2 = await prisma.inventoryAdjustment.findUniqueOrThrow({
    where: { companyId_number: { companyId, number: 'ADJ-000002' } },
  });
  await prisma.inventoryAdjustmentItem.upsert({
    where: {
      inventoryAdjustmentId_locationId_skuId_batchId_classification_direction: {
        inventoryAdjustmentId: adj2.id,
        locationId: locA03.id,
        skuId: mascara.id,
        batchId: lot001.id,
        classification: StockClassification.SELLABLE,
        direction: InventoryAdjustmentDirection.OUT,
      },
    },
    update: { quantity: 2 },
    create: {
      id: adjIds.adj2Item,
      companyId,
      inventoryAdjustmentId: adj2.id,
      locationId: locA03.id,
      skuId: mascara.id,
      batchId: lot001.id,
      classification: StockClassification.SELLABLE,
      direction: InventoryAdjustmentDirection.OUT,
      quantity: 2,
    },
  });
  const adj2Item = await prisma.inventoryAdjustmentItem.findFirstOrThrow({
    where: { inventoryAdjustmentId: adj2.id, direction: InventoryAdjustmentDirection.OUT },
  });
  await upsertSeedMovementAndBalance(prisma, {
    companyId,
    warehouseId: warehouse.id,
    locationId: locA03.id,
    skuId: mascara.id,
    batchId: lot001.id,
    classification: StockClassification.SELLABLE,
    movementType: InventoryMovementType.ADJUSTMENT_OUT,
    quantityDelta: -2,
    sourceType: InventorySourceType.MANUAL_ADJUSTMENT,
    sourceId: adj2.id,
    sourceLineId: adj2Item.id,
    actorUserId: owner.id,
    occurredAt: postedAt2,
    reasonCode: InventoryAdjustmentReason.MISSING,
  });

  await prisma.inventoryAdjustment.upsert({
    where: { companyId_number: { companyId, number: 'ADJ-000003' } },
    update: {
      status: InventoryAdjustmentStatus.DRAFT,
      reason: InventoryAdjustmentReason.CORRECTION,
      reasonText: 'SEED: pending ledger correction review',
      warehouseId: warehouse.id,
      postedAt: null,
      postedById: null,
    },
    create: {
      id: adjIds.adj3,
      companyId,
      number: 'ADJ-000003',
      warehouseId: warehouse.id,
      reason: InventoryAdjustmentReason.CORRECTION,
      reasonText: 'SEED: pending ledger correction review',
      status: InventoryAdjustmentStatus.DRAFT,
      notes: 'SEED: draft adjustment (no movements)',
      createdById: owner.id,
    },
  });
  const adj3 = await prisma.inventoryAdjustment.findUniqueOrThrow({
    where: { companyId_number: { companyId, number: 'ADJ-000003' } },
  });
  await prisma.inventoryAdjustmentItem.upsert({
    where: {
      inventoryAdjustmentId_locationId_skuId_batchId_classification_direction: {
        inventoryAdjustmentId: adj3.id,
        locationId: locA03.id,
        skuId: mascara.id,
        batchId: lot001.id,
        classification: StockClassification.SELLABLE,
        direction: InventoryAdjustmentDirection.IN,
      },
    },
    update: { quantity: 1 },
    create: {
      id: adjIds.adj3Item,
      companyId,
      inventoryAdjustmentId: adj3.id,
      locationId: locA03.id,
      skuId: mascara.id,
      batchId: lot001.id,
      classification: StockClassification.SELLABLE,
      direction: InventoryAdjustmentDirection.IN,
      quantity: 1,
    },
  });

  await prisma.stockCountSequence.upsert({
    where: { companyId },
    update: {},
    create: { companyId, nextValue: 2 },
  });
  await prisma.$executeRaw`
    UPDATE stock_count_sequences
    SET next_value = GREATEST(next_value, 2)
    WHERE company_id = ${companyId}::uuid
  `;

  const countIds = {
    cnt1: 'ffffffff-0001-4000-8000-000000000001',
    lineA: 'ffffffff-0001-4000-8000-000000000011',
    lineB: 'ffffffff-0001-4000-8000-000000000012',
    lineC: 'ffffffff-0001-4000-8000-000000000013',
  } as const;

  const startedAt = new Date('2026-10-04T22:10:00.000Z');
  const countPostedAt = new Date('2026-10-04T22:20:00.000Z');

  const snapshotA = await readOnHand(locA01.id, lot001.id);
  const snapshotB = await readOnHand(locA02.id, lot001.id);
  const snapshotC = await readOnHand(locA04.id, lot001.id);

  const diffA = -6;
  const diffB = 0;
  const diffC = 3;
  const countedA = snapshotA + diffA;
  const countedB = snapshotB + diffB;
  const countedC = snapshotC + diffC;
  const movementsDuring = 0;

  await prisma.stockCount.upsert({
    where: { companyId_number: { companyId, number: 'COUNT-000001' } },
    update: {
      status: StockCountStatus.POSTED,
      type: StockCountType.CYCLE,
      warehouseId: warehouse.id,
      startedAt,
      postedAt: countPostedAt,
      postedById: owner.id,
      startedById: owner.id,
    },
    create: {
      id: countIds.cnt1,
      companyId,
      number: 'COUNT-000001',
      warehouseId: warehouse.id,
      type: StockCountType.CYCLE,
      status: StockCountStatus.POSTED,
      notes: 'SEED: cycle count MAIN (ESS-MASCARA LOT-001)',
      createdById: owner.id,
      startedById: owner.id,
      startedAt,
      postedById: owner.id,
      postedAt: countPostedAt,
    },
  });
  const count1 = await prisma.stockCount.findUniqueOrThrow({
    where: { companyId_number: { companyId, number: 'COUNT-000001' } },
  });

  const upsertCountLine = async (input: {
    id: string;
    locationId: string;
    snapshot: number;
    counted: number;
    difference: number;
  }) => {
    const expected = input.snapshot + movementsDuring;
    await prisma.stockCountItem.upsert({
      where: {
        stockCountId_locationId_skuId_batchId_classification: {
          stockCountId: count1.id,
          locationId: input.locationId,
          skuId: mascara.id,
          batchId: lot001.id,
          classification: StockClassification.SELLABLE,
        },
      },
      update: {
        snapshotQuantity: input.snapshot,
        countedQuantity: input.counted,
        movementsDuringCount: movementsDuring,
        expectedQuantity: expected,
        difference: input.difference,
        lineStatus: StockCountLineStatus.COUNTED,
        countedById: owner.id,
        countedAt: startedAt,
      },
      create: {
        id: input.id,
        companyId,
        stockCountId: count1.id,
        warehouseId: warehouse.id,
        locationId: input.locationId,
        skuId: mascara.id,
        batchId: lot001.id,
        classification: StockClassification.SELLABLE,
        snapshotQuantity: input.snapshot,
        countedQuantity: input.counted,
        movementsDuringCount: movementsDuring,
        expectedQuantity: expected,
        difference: input.difference,
        lineStatus: StockCountLineStatus.COUNTED,
        countedById: owner.id,
        countedAt: startedAt,
      },
    });
  };

  await upsertCountLine({
    id: countIds.lineA,
    locationId: locA01.id,
    snapshot: snapshotA,
    counted: countedA,
    difference: diffA,
  });
  await upsertCountLine({
    id: countIds.lineB,
    locationId: locA02.id,
    snapshot: snapshotB,
    counted: countedB,
    difference: diffB,
  });
  await upsertCountLine({
    id: countIds.lineC,
    locationId: locA04.id,
    snapshot: snapshotC,
    counted: countedC,
    difference: diffC,
  });

  const countLineA = await prisma.stockCountItem.findUniqueOrThrow({
    where: {
      stockCountId_locationId_skuId_batchId_classification: {
        stockCountId: count1.id,
        locationId: locA01.id,
        skuId: mascara.id,
        batchId: lot001.id,
        classification: StockClassification.SELLABLE,
      },
    },
  });
  const countLineC = await prisma.stockCountItem.findUniqueOrThrow({
    where: {
      stockCountId_locationId_skuId_batchId_classification: {
        stockCountId: count1.id,
        locationId: locA04.id,
        skuId: mascara.id,
        batchId: lot001.id,
        classification: StockClassification.SELLABLE,
      },
    },
  });

  await upsertSeedMovementAndBalance(prisma, {
    companyId,
    warehouseId: warehouse.id,
    locationId: locA01.id,
    skuId: mascara.id,
    batchId: lot001.id,
    classification: StockClassification.SELLABLE,
    movementType: InventoryMovementType.STOCK_COUNT_ADJUSTMENT_OUT,
    quantityDelta: diffA,
    sourceType: InventorySourceType.STOCK_COUNT,
    sourceId: count1.id,
    sourceLineId: countLineA.id,
    actorUserId: owner.id,
    occurredAt: countPostedAt,
  });
  await upsertSeedMovementAndBalance(prisma, {
    companyId,
    warehouseId: warehouse.id,
    locationId: locA04.id,
    skuId: mascara.id,
    batchId: lot001.id,
    classification: StockClassification.SELLABLE,
    movementType: InventoryMovementType.STOCK_COUNT_ADJUSTMENT_IN,
    quantityDelta: diffC,
    sourceType: InventorySourceType.STOCK_COUNT,
    sourceId: count1.id,
    sourceLineId: countLineC.id,
    actorUserId: owner.id,
    occurredAt: countPostedAt,
  });

  // Phase 3.17: open SUBMITTED count with unresolved discrepancy for dashboard.
  const submittedStartedAt = new Date('2026-10-05T08:00:00.000Z');
  const submittedAt = new Date('2026-10-05T08:30:00.000Z');
  const openSnapshot = await readOnHand(locA02.id, lot001.id);
  const openCounted = Math.max(0, openSnapshot - 2);
  await prisma.stockCount.upsert({
    where: { companyId_number: { companyId, number: 'COUNT-000002' } },
    update: {
      status: StockCountStatus.SUBMITTED,
      type: StockCountType.CYCLE,
      warehouseId: warehouse.id,
      startedAt: submittedStartedAt,
      submittedAt,
      submittedById: owner.id,
      startedById: owner.id,
      postedAt: null,
      postedById: null,
    },
    create: {
      id: 'ffffffff-0002-4000-8000-000000000001',
      companyId,
      number: 'COUNT-000002',
      warehouseId: warehouse.id,
      type: StockCountType.CYCLE,
      status: StockCountStatus.SUBMITTED,
      notes: 'SEED: open SUBMITTED count with discrepancy for dashboard',
      createdById: owner.id,
      startedById: owner.id,
      startedAt: submittedStartedAt,
      submittedById: owner.id,
      submittedAt,
    },
  });
  const count2 = await prisma.stockCount.findUniqueOrThrow({
    where: { companyId_number: { companyId, number: 'COUNT-000002' } },
  });
  await prisma.stockCountItem.upsert({
    where: {
      stockCountId_locationId_skuId_batchId_classification: {
        stockCountId: count2.id,
        locationId: locA02.id,
        skuId: mascara.id,
        batchId: lot001.id,
        classification: StockClassification.SELLABLE,
      },
    },
    update: {
      snapshotQuantity: openSnapshot,
      countedQuantity: openCounted,
      difference: null,
      lineStatus: StockCountLineStatus.COUNTED,
      countedById: owner.id,
      countedAt: submittedStartedAt,
    },
    create: {
      id: 'ffffffff-0002-4000-8000-000000000011',
      companyId,
      stockCountId: count2.id,
      warehouseId: warehouse.id,
      locationId: locA02.id,
      skuId: mascara.id,
      batchId: lot001.id,
      classification: StockClassification.SELLABLE,
      snapshotQuantity: openSnapshot,
      countedQuantity: openCounted,
      difference: null,
      lineStatus: StockCountLineStatus.COUNTED,
      countedById: owner.id,
      countedAt: submittedStartedAt,
    },
  });
  await prisma.$executeRaw`
    UPDATE stock_count_sequences
    SET next_value = GREATEST(next_value, 3)
    WHERE company_id = ${companyId}::uuid
  `;
}

/**
 * Phase 3.14 demo: warehouse execution of approved purchase returns (supplier RETURN_OUT).
 */
async function seedSupplierReturnExecutionsForPishteh(
  prisma: PrismaClient,
  companyId: string,
): Promise<void> {
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'pouria@hector.local' } });
  const warehouse = await prisma.warehouse.findUniqueOrThrow({
    where: { companyId_code: { companyId, code: 'MAIN' } },
  });
  const locA01 = await prisma.warehouseLocation.findUniqueOrThrow({
    where: {
      companyId_warehouseId_code: { companyId, warehouseId: warehouse.id, code: 'A-01' },
    },
  });
  const mascara = await prisma.sku.findFirstOrThrow({
    where: { companyId, code: 'ESS-MASCARA-01' },
  });
  const lot001 = await prisma.batch.findUniqueOrThrow({
    where: { companyId_batchNumber: { companyId, batchNumber: 'LOT-001' } },
  });
  const tehran = await prisma.supplier.findFirstOrThrow({
    where: { companyId, code: 'TEH-BEAUTY' },
  });

  const po = await prisma.purchaseOrder.findUniqueOrThrow({
    where: { companyId_number: { companyId, number: 'SEED-PO-RECEIVING-01' } },
    include: { items: true },
  });
  const poItem = po.items[0];
  if (!poItem) return;

  const seedIds = {
    pr2: 'bbbbbbbb-0002-4000-8000-000000000001',
    pr2Item: 'bbbbbbbb-0002-4000-8000-000000000011',
    sre1: 'cccccccc-0001-4000-8000-000000000001',
    sre1Item: 'cccccccc-0001-4000-8000-000000000011',
    sre2: 'cccccccc-0002-4000-8000-000000000001',
    sre2Item: 'cccccccc-0002-4000-8000-000000000011',
    quarantineOpening: 'aaaaaaaa-0001-4000-8000-000000000021',
  } as const;

  const approvedAt = new Date('2026-10-05T10:00:00.000Z');
  const dispatchedAt = new Date('2026-10-05T11:00:00.000Z');

  await prisma.purchaseReturn.upsert({
    where: { companyId_number: { companyId, number: 'SEED-PR-000002' } },
    update: {
      status: PurchaseReturnStatus.APPROVED,
      supplierId: tehran.id,
      purchaseOrderId: po.id,
      reason: PurchaseReturnReason.DEFECTIVE,
      expectedResolution: PurchaseReturnResolution.SUPPLIER_CREDIT,
      approvedAt,
      approvedById: owner.id,
      notes: 'SEED: 100-unit warehouse return demo (TEH-BEAUTY / SEED-PO-RECEIVING-01).',
    },
    create: {
      id: seedIds.pr2,
      companyId,
      number: 'SEED-PR-000002',
      supplierId: tehran.id,
      purchaseOrderId: po.id,
      status: PurchaseReturnStatus.APPROVED,
      reason: PurchaseReturnReason.DEFECTIVE,
      expectedResolution: PurchaseReturnResolution.SUPPLIER_CREDIT,
      notes: 'SEED: 100-unit warehouse return demo (TEH-BEAUTY / SEED-PO-RECEIVING-01).',
      createdById: owner.id,
      approvedById: owner.id,
      approvedAt,
      version: 2,
    },
  });
  const purchaseReturn = await prisma.purchaseReturn.findUniqueOrThrow({
    where: { companyId_number: { companyId, number: 'SEED-PR-000002' } },
  });
  await prisma.purchaseReturnItem.upsert({
    where: { id: seedIds.pr2Item },
    update: {
      purchaseReturnId: purchaseReturn.id,
      purchaseOrderItemId: poItem.id,
      skuId: mascara.id,
      quantity: 100,
      reason: PurchaseReturnReason.DEFECTIVE,
    },
    create: {
      id: seedIds.pr2Item,
      companyId,
      purchaseReturnId: purchaseReturn.id,
      purchaseOrderItemId: poItem.id,
      skuId: mascara.id,
      quantity: 100,
      reason: PurchaseReturnReason.DEFECTIVE,
    },
  });
  const returnItem = await prisma.purchaseReturnItem.findUniqueOrThrow({
    where: { id: seedIds.pr2Item },
  });

  await prisma.purchaseReturnSequence.upsert({
    where: { companyId },
    create: { companyId, nextValue: 3 },
    update: {},
  });
  await prisma.$executeRaw`
    UPDATE purchase_return_sequences
    SET next_value = GREATEST(next_value, 3)
    WHERE company_id = ${companyId}::uuid
  `;

  const seedSourceId = 'aaaaaaaa-0000-4000-8000-000000000000';
  await upsertSeedMovementAndBalance(prisma, {
    companyId,
    warehouseId: warehouse.id,
    locationId: locA01.id,
    skuId: mascara.id,
    batchId: lot001.id,
    classification: StockClassification.QUARANTINE,
    movementType: InventoryMovementType.RECEIVE,
    quantityDelta: 100,
    sourceType: InventorySourceType.SEED,
    sourceId: seedSourceId,
    sourceLineId: seedIds.quarantineOpening,
    actorUserId: owner.id,
    occurredAt: new Date('2026-10-05T09:30:00.000Z'),
    reasonCode: 'SEED_SUPPLIER_RETURN_QUARANTINE',
  });

  await prisma.supplierReturnExecutionSequence.upsert({
    where: { companyId },
    update: {},
    create: { companyId, nextValue: 3 },
  });
  await prisma.$executeRaw`
    UPDATE supplier_return_execution_sequences
    SET next_value = GREATEST(next_value, 3)
    WHERE company_id = ${companyId}::uuid
  `;

  await prisma.supplierReturnExecution.upsert({
    where: { companyId_number: { companyId, number: 'SRE-000001' } },
    update: {
      status: SupplierReturnExecutionStatus.DISPATCHED,
      purchaseReturnId: purchaseReturn.id,
      warehouseId: warehouse.id,
      dispatchedAt,
      dispatchedById: owner.id,
      cancelledAt: null,
      cancelledById: null,
    },
    create: {
      id: seedIds.sre1,
      companyId,
      number: 'SRE-000001',
      purchaseReturnId: purchaseReturn.id,
      warehouseId: warehouse.id,
      status: SupplierReturnExecutionStatus.DISPATCHED,
      notes: 'SEED: dispatched 40 QUARANTINE LOT-001 @ A-01',
      createdById: owner.id,
      dispatchedById: owner.id,
      dispatchedAt,
    },
  });
  const sre1 = await prisma.supplierReturnExecution.findUniqueOrThrow({
    where: { companyId_number: { companyId, number: 'SRE-000001' } },
  });
  await prisma.supplierReturnExecutionItem.upsert({
    where: {
      supplierReturnExecutionId_purchaseReturnItemId_locationId_skuId_batchId_classification: {
        supplierReturnExecutionId: sre1.id,
        purchaseReturnItemId: returnItem.id,
        locationId: locA01.id,
        skuId: mascara.id,
        batchId: lot001.id,
        classification: StockClassification.QUARANTINE,
      },
    },
    update: { quantity: 40 },
    create: {
      id: seedIds.sre1Item,
      companyId,
      supplierReturnExecutionId: sre1.id,
      purchaseReturnItemId: returnItem.id,
      skuId: mascara.id,
      batchId: lot001.id,
      locationId: locA01.id,
      classification: StockClassification.QUARANTINE,
      quantity: 40,
    },
  });
  const sre1Item = await prisma.supplierReturnExecutionItem.findFirstOrThrow({
    where: { supplierReturnExecutionId: sre1.id },
  });
  await upsertSeedMovementAndBalance(prisma, {
    companyId,
    warehouseId: warehouse.id,
    locationId: locA01.id,
    skuId: mascara.id,
    batchId: lot001.id,
    classification: StockClassification.QUARANTINE,
    movementType: InventoryMovementType.RETURN_OUT,
    quantityDelta: -40,
    sourceType: InventorySourceType.SUPPLIER_RETURN,
    sourceId: sre1.id,
    sourceLineId: sre1Item.id,
    actorUserId: owner.id,
    occurredAt: dispatchedAt,
    reasonCode: PurchaseReturnReason.DEFECTIVE,
  });

  await prisma.supplierReturnExecution.upsert({
    where: { companyId_number: { companyId, number: 'SRE-000002' } },
    update: {
      status: SupplierReturnExecutionStatus.DRAFT,
      purchaseReturnId: purchaseReturn.id,
      warehouseId: warehouse.id,
      dispatchedAt: null,
      dispatchedById: null,
      cancelledAt: null,
      cancelledById: null,
    },
    create: {
      id: seedIds.sre2,
      companyId,
      number: 'SRE-000002',
      purchaseReturnId: purchaseReturn.id,
      warehouseId: warehouse.id,
      status: SupplierReturnExecutionStatus.DRAFT,
      notes: 'SEED: draft 30 QUARANTINE (not dispatched)',
      createdById: owner.id,
    },
  });
  const sre2 = await prisma.supplierReturnExecution.findUniqueOrThrow({
    where: { companyId_number: { companyId, number: 'SRE-000002' } },
  });
  await prisma.supplierReturnExecutionItem.upsert({
    where: {
      supplierReturnExecutionId_purchaseReturnItemId_locationId_skuId_batchId_classification: {
        supplierReturnExecutionId: sre2.id,
        purchaseReturnItemId: returnItem.id,
        locationId: locA01.id,
        skuId: mascara.id,
        batchId: lot001.id,
        classification: StockClassification.QUARANTINE,
      },
    },
    update: { quantity: 30 },
    create: {
      id: seedIds.sre2Item,
      companyId,
      supplierReturnExecutionId: sre2.id,
      purchaseReturnItemId: returnItem.id,
      skuId: mascara.id,
      batchId: lot001.id,
      locationId: locA01.id,
      classification: StockClassification.QUARANTINE,
      quantity: 30,
    },
  });
}

async function ensurePostedItemFullyAllocated(
  prisma: PrismaClient,
  input: {
    companyId: string;
    goodsReceiptNumber: string;
    allocations: Array<{ batchId: string; quantity: number }>;
  },
): Promise<void> {
  const receipt = await prisma.goodsReceipt.findUnique({
    where: {
      companyId_number: {
        companyId: input.companyId,
        number: input.goodsReceiptNumber,
      },
    },
    include: { items: true },
  });
  const item = receipt?.items[0];
  if (!item) return;
  await ensureItemAllocation(prisma, {
    companyId: input.companyId,
    goodsReceiptItemId: item.id,
    skuId: item.skuId,
    allocations: input.allocations,
  });
}

async function ensureItemAllocation(
  prisma: PrismaClient,
  input: {
    companyId: string;
    goodsReceiptItemId: string;
    skuId: string;
    allocations: Array<{ batchId: string; quantity: number }>;
  },
): Promise<void> {
  const existing = await prisma.goodsReceiptItemBatch.findMany({
    where: { goodsReceiptItemId: input.goodsReceiptItemId, companyId: input.companyId },
  });
  const desired = new Map(input.allocations.map((a) => [a.batchId, a.quantity]));
  const existingByBatch = new Map(existing.map((a) => [a.batchId, a]));

  for (const [batchId, quantity] of desired) {
    const row = existingByBatch.get(batchId);
    if (!row) {
      await prisma.goodsReceiptItemBatch.create({
        data: {
          companyId: input.companyId,
          goodsReceiptItemId: input.goodsReceiptItemId,
          batchId,
          skuId: input.skuId,
          quantity,
        },
      });
    } else if (row.quantity !== quantity) {
      await prisma.goodsReceiptItemBatch.update({
        where: { id: row.id },
        data: { quantity },
      });
    }
  }

  for (const row of existing) {
    if (!desired.has(row.batchId)) {
      await prisma.goodsReceiptItemBatch.delete({ where: { id: row.id } });
    }
  }
}

async function seedWarehousesForPishteh(prisma: PrismaClient, companyId: string): Promise<void> {
  await upsertWarehouse(prisma, companyId, {
    code: 'MAIN',
    name: 'انبار اصلی',
    address: 'تهران',
    notes: 'انبار اصلی پیشته — seed fixture (not operational audit)',
    isDefault: true,
  });
  await upsertWarehouse(prisma, companyId, {
    code: 'SECONDARY',
    name: 'انبار فرعی',
    address: null,
    notes: 'SEED: Phase 3.10 multi-warehouse On Hand demo',
    isDefault: false,
  });
  await upsertWarehouse(prisma, companyId, {
    code: 'RETURNS',
    name: 'انبار مرجوعی',
    address: null,
    notes: 'انبار مرجوعی نمونه',
    isDefault: false,
  });
}

async function seedFinanceAccountsForPishteh(
  prisma: PrismaClient,
  companyId: string,
): Promise<void> {
  const fixtures: Array<{
    code: string;
    name: string;
    type: FinancialAccountType;
    currency: CurrencyCode;
    isDefault: boolean;
    opening: string;
    bankName?: string;
  }> = [
    {
      code: 'BANK-MELLAT-IRR',
      name: 'Mellat Bank',
      type: FinancialAccountType.BANK,
      currency: CurrencyCode.IRR,
      isDefault: true,
      opening: '2000000000',
      bankName: 'Bank Mellat',
    },
    {
      code: 'CASH-IRR',
      name: 'Cash Box',
      type: FinancialAccountType.CASH,
      currency: CurrencyCode.IRR,
      isDefault: false,
      opening: '200000000',
    },
    {
      code: 'CASH-USD',
      name: 'USD Cash',
      type: FinancialAccountType.CASH,
      currency: CurrencyCode.USD,
      isDefault: true,
      opening: '10000',
    },
    {
      code: 'KHANOUMI-WALLET',
      name: 'Khanoumi Wallet',
      type: FinancialAccountType.WALLET,
      currency: CurrencyCode.IRR,
      isDefault: false,
      opening: '500000000',
    },
  ];

  for (const fixture of fixtures) {
    if (fixture.isDefault) {
      await prisma.financialAccount.updateMany({
        where: {
          companyId,
          currency: fixture.currency,
          isDefault: true,
          code: { not: fixture.code },
        },
        data: { isDefault: false },
      });
    }

    const account = await prisma.financialAccount.upsert({
      where: { companyId_code: { companyId, code: fixture.code } },
      update: {
        name: fixture.name,
        type: fixture.type,
        currency: fixture.currency,
        status: FinancialAccountStatus.ACTIVE,
        isDefault: fixture.isDefault,
        bankName: fixture.bankName ?? null,
        archivedAt: null,
      },
      create: {
        companyId,
        code: fixture.code,
        name: fixture.name,
        type: fixture.type,
        currency: fixture.currency,
        status: FinancialAccountStatus.ACTIVE,
        isDefault: fixture.isDefault,
        bankName: fixture.bankName ?? null,
        description: 'SEED: Phase 4.2 finance account fixture',
      },
    });

    const existingOpening = await prisma.financialAccountMovement.findFirst({
      where: {
        companyId,
        accountId: account.id,
        type: FinancialAccountMovementType.OPENING_BALANCE,
      },
    });
    if (!existingOpening) {
      await prisma.financialAccountMovement.create({
        data: {
          companyId,
          accountId: account.id,
          direction: FinancialAccountMovementDirection.IN,
          amount: new Prisma.Decimal(fixture.opening),
          currency: fixture.currency,
          type: FinancialAccountMovementType.OPENING_BALANCE,
          sourceType: 'OPENING_BALANCE',
          effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
          postedAt: new Date('2026-01-01T00:00:00.000Z'),
          description: 'SEED opening balance (not revenue)',
        },
      });
    }
  }
}

async function seedFinanceCapitalLoansForPishteh(
  prisma: PrismaClient,
  companyId: string,
): Promise<void> {
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'pouria@hector.local' } });
  const mellat = await prisma.financialAccount.findUniqueOrThrow({
    where: { companyId_code: { companyId, code: 'BANK-MELLAT-IRR' } },
  });
  const cashUsd = await prisma.financialAccount.findUniqueOrThrow({
    where: { companyId_code: { companyId, code: 'CASH-USD' } },
  });

  const capitals: Array<{
    number: string;
    contributorName: string;
    amount: string;
    requestId: string;
  }> = [
    {
      number: 'CAP-000001',
      contributorName: 'Ahmad',
      amount: '2000000000',
      requestId: 'aaaaaaaa-0004-4300-8000-000000000001',
    },
    {
      number: 'CAP-000002',
      contributorName: 'Pouria',
      amount: '1000000000',
      requestId: 'aaaaaaaa-0004-4300-8000-000000000002',
    },
  ];

  for (const fixture of capitals) {
    const existing = await prisma.capitalContribution.findFirst({
      where: { companyId, requestId: fixture.requestId },
    });
    if (existing) continue;

    const contribution = await prisma.capitalContribution.create({
      data: {
        companyId,
        number: fixture.number,
        fundingType: CapitalFundingType.PARTNER_EQUITY,
        contributorType: FinanceCounterpartyType.PARTNER,
        contributorName: fixture.contributorName,
        accountId: mellat.id,
        amount: new Prisma.Decimal(fixture.amount),
        currency: CurrencyCode.IRR,
        status: CapitalContributionStatus.POSTED,
        effectiveAt: new Date('2026-02-01T00:00:00.000Z'),
        notes: 'SEED: Phase 4.3 partner equity (not revenue)',
        requestId: fixture.requestId,
        createdById: owner.id,
        postedAt: new Date('2026-02-01T00:00:00.000Z'),
        postedById: owner.id,
      },
    });

    await prisma.financialAccountMovement.create({
      data: {
        companyId,
        accountId: mellat.id,
        direction: FinancialAccountMovementDirection.IN,
        amount: new Prisma.Decimal(fixture.amount),
        currency: CurrencyCode.IRR,
        type: FinancialAccountMovementType.MONEY_IN,
        sourceType: 'CAPITAL_INJECTION',
        sourceId: contribution.id,
        effectiveAt: contribution.effectiveAt,
        postedAt: contribution.postedAt!,
        description: `SEED capital ${fixture.number}`,
        createdById: owner.id,
      },
    });
  }

  const maxCapNumber = await prisma.capitalContribution.findMany({
    where: { companyId },
    select: { number: true },
  });
  let nextCap = 3;
  for (const row of maxCapNumber) {
    const match = /^CAP-(\d+)$/.exec(row.number);
    if (match) nextCap = Math.max(nextCap, Number(match[1]) + 1);
  }
  await prisma.capitalContributionSequence.upsert({
    where: { companyId },
    update: { nextValue: nextCap },
    create: { companyId, nextValue: nextCap },
  });

  const ahmadLoanReq = 'aaaaaaaa-0004-4300-8000-000000000003';
  let ahmadLoan = await prisma.loan.findFirst({
    where: { companyId, requestId: ahmadLoanReq },
  });
  if (!ahmadLoan) {
    ahmadLoan = await prisma.loan.create({
      data: {
        companyId,
        number: 'LOAN-000001',
        lenderType: FinanceCounterpartyType.PARTNER,
        lenderName: 'Ahmad',
        currency: CurrencyCode.IRR,
        contractedPrincipal: new Prisma.Decimal('500000000'),
        status: LoanStatus.ACTIVE,
        receivingAccountId: mellat.id,
        notes: 'SEED: Ahmad partner loan (debt ≠ equity)',
        requestId: ahmadLoanReq,
        createdById: owner.id,
        postedAt: new Date('2026-02-02T00:00:00.000Z'),
        postedById: owner.id,
      },
    });

    const disb = await prisma.loanDisbursement.create({
      data: {
        companyId,
        loanId: ahmadLoan.id,
        number: 'LDS-000001',
        accountId: mellat.id,
        amount: new Prisma.Decimal('500000000'),
        currency: CurrencyCode.IRR,
        status: LoanDisbursementStatus.POSTED,
        effectiveAt: new Date('2026-02-02T00:00:00.000Z'),
        notes: 'SEED full disbursement',
        requestId: 'aaaaaaaa-0004-4300-8000-000000000013',
        createdById: owner.id,
        postedAt: new Date('2026-02-02T00:00:00.000Z'),
        postedById: owner.id,
      },
    });

    await prisma.financialAccountMovement.create({
      data: {
        companyId,
        accountId: mellat.id,
        direction: FinancialAccountMovementDirection.IN,
        amount: new Prisma.Decimal('500000000'),
        currency: CurrencyCode.IRR,
        type: FinancialAccountMovementType.MONEY_IN,
        sourceType: 'LOAN_DISBURSEMENT',
        sourceId: disb.id,
        effectiveAt: disb.effectiveAt,
        postedAt: disb.postedAt!,
        description: `SEED loan ${ahmadLoan.number}`,
        createdById: owner.id,
      },
    });
  }

  const usdLoanReq = 'aaaaaaaa-0004-4300-8000-000000000004';
  let usdLoan = await prisma.loan.findFirst({
    where: { companyId, requestId: usdLoanReq },
  });
  if (!usdLoan) {
    usdLoan = await prisma.loan.create({
      data: {
        companyId,
        number: 'LOAN-000002',
        lenderType: FinanceCounterpartyType.EXTERNAL_PERSON,
        lenderName: 'External USD Lender',
        currency: CurrencyCode.USD,
        contractedPrincipal: new Prisma.Decimal('10000'),
        referenceFxRate: new Prisma.Decimal('250000'),
        referenceFxBaseCurrency: CurrencyCode.USD,
        referenceFxQuoteCurrency: CurrencyCode.IRR,
        status: LoanStatus.ACTIVE,
        receivingAccountId: cashUsd.id,
        notes: 'SEED: USD loan — principal stays USD (never revalued to IRR)',
        requestId: usdLoanReq,
        createdById: owner.id,
        postedAt: new Date('2026-02-03T00:00:00.000Z'),
        postedById: owner.id,
      },
    });

    const disb = await prisma.loanDisbursement.create({
      data: {
        companyId,
        loanId: usdLoan.id,
        number: 'LDS-000002',
        accountId: cashUsd.id,
        amount: new Prisma.Decimal('10000'),
        currency: CurrencyCode.USD,
        status: LoanDisbursementStatus.POSTED,
        effectiveAt: new Date('2026-02-03T00:00:00.000Z'),
        notes: 'SEED USD disbursement',
        requestId: 'aaaaaaaa-0004-4300-8000-000000000014',
        createdById: owner.id,
        postedAt: new Date('2026-02-03T00:00:00.000Z'),
        postedById: owner.id,
      },
    });

    await prisma.financialAccountMovement.create({
      data: {
        companyId,
        accountId: cashUsd.id,
        direction: FinancialAccountMovementDirection.IN,
        amount: new Prisma.Decimal('10000'),
        currency: CurrencyCode.USD,
        type: FinancialAccountMovementType.MONEY_IN,
        sourceType: 'LOAN_DISBURSEMENT',
        sourceId: disb.id,
        effectiveAt: disb.effectiveAt,
        postedAt: disb.postedAt!,
        description: `SEED loan ${usdLoan.number}`,
        createdById: owner.id,
      },
    });
  }

  const loanNumbers = await prisma.loan.findMany({
    where: { companyId },
    select: { number: true },
  });
  let nextLoan = 3;
  for (const row of loanNumbers) {
    const match = /^LOAN-(\d+)$/.exec(row.number);
    if (match) nextLoan = Math.max(nextLoan, Number(match[1]) + 1);
  }
  const disbNumbers = await prisma.loanDisbursement.findMany({
    where: { companyId },
    select: { number: true },
  });
  let nextDisb = 3;
  for (const row of disbNumbers) {
    const match = /^LDS-(\d+)$/.exec(row.number);
    if (match) nextDisb = Math.max(nextDisb, Number(match[1]) + 1);
  }
  const repayNumbers = await prisma.loanRepayment.findMany({
    where: { companyId },
    select: { number: true },
  });
  let nextRepay = 1;
  for (const row of repayNumbers) {
    const match = /^LRP-(\d+)$/.exec(row.number);
    if (match) nextRepay = Math.max(nextRepay, Number(match[1]) + 1);
  }

  await prisma.loanSequence.upsert({
    where: { companyId },
    update: { nextValue: nextLoan },
    create: { companyId, nextValue: nextLoan },
  });
  await prisma.loanDisbursementSequence.upsert({
    where: { companyId },
    update: { nextValue: nextDisb },
    create: { companyId, nextValue: nextDisb },
  });
  await prisma.loanRepaymentSequence.upsert({
    where: { companyId },
    update: { nextValue: nextRepay },
    create: { companyId, nextValue: nextRepay },
  });
}

/**
 * Phase 4.5 — Idempotent USD→IRR REFERENCE + VALUATION rates for PISHTEH.
 * Illustrative fixtures only — not live market truth.
 */
async function seedFinanceFxRatesForPishteh(
  prisma: PrismaClient,
  companyId: string,
): Promise<void> {
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'pouria@hector.local' } });
  const effectiveAt = new Date('2026-01-01T00:00:00.000Z');

  const fixtures: Array<{
    rateType: FxRateType;
    rate: string;
    notes: string;
  }> = [
    {
      rateType: FxRateType.REFERENCE,
      rate: '250000',
      notes: 'SEED: illustrative REFERENCE 1 USD = 250000 IRR (not live market)',
    },
    {
      rateType: FxRateType.VALUATION,
      rate: '270000',
      notes: 'SEED: illustrative VALUATION 1 USD = 270000 IRR (not live market)',
    },
  ];

  for (const fixture of fixtures) {
    const existing = await prisma.fxRate.findFirst({
      where: {
        companyId,
        baseCurrency: CurrencyCode.USD,
        quoteCurrency: CurrencyCode.IRR,
        rateType: fixture.rateType,
        sourceType: FxRateSourceType.SYSTEM,
        sourceReference: `SEED-FX-${fixture.rateType}`,
        archivedAt: null,
      },
    });
    if (existing) {
      continue;
    }
    await prisma.fxRate.create({
      data: {
        companyId,
        baseCurrency: CurrencyCode.USD,
        quoteCurrency: CurrencyCode.IRR,
        rate: new Prisma.Decimal(fixture.rate),
        rateType: fixture.rateType,
        sourceType: FxRateSourceType.SYSTEM,
        sourceReference: `SEED-FX-${fixture.rateType}`,
        effectiveAt,
        notes: fixture.notes,
        createdById: owner.id,
      },
    });
  }
}

/**
 * Phase 4.6 — Minimal standalone Payment + Receipt examples (idempotent).
 * Numbers use SEED-PAY- / SEED-REC- so they never collide with API sequences (PAY-/REC-).
 * Payment purpose OTHER / Receipt source OTHER — no SupplierPayable settlement.
 * Capital/Loan keep specialized cash posting (not wrapped as Receipt/Payment).
 */
async function seedFinancePaymentsReceiptsForPishteh(
  prisma: PrismaClient,
  companyId: string,
): Promise<void> {
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'pouria@hector.local' } });
  const mellat = await prisma.financialAccount.findUniqueOrThrow({
    where: { companyId_code: { companyId, code: 'BANK-MELLAT-IRR' } },
  });

  const draftPaymentRequestId = 'aaaaaaaa-0004-4600-8000-000000000000';
  const existingDraft = await prisma.payment.findFirst({
    where: { companyId, requestId: draftPaymentRequestId },
  });
  if (!existingDraft) {
    await prisma.payment.create({
      data: {
        companyId,
        number: 'SEED-PAY-DRAFT-001',
        accountId: mellat.id,
        amount: new Prisma.Decimal('10000000'),
        currency: CurrencyCode.IRR,
        status: PaymentStatus.DRAFT,
        effectiveAt: new Date('2026-03-01T00:00:00.000Z'),
        purposeType: PaymentPurposeType.OTHER,
        counterpartyType: FinanceCounterpartyType.OTHER,
        counterpartyName: 'SEED draft vendor',
        notes: 'SEED: Phase 4.6 DRAFT payment (no movement until post)',
        requestId: draftPaymentRequestId,
        createdById: owner.id,
      },
    });
  }

  const paymentRequestId = 'aaaaaaaa-0004-4600-8000-000000000001';
  const existingPayment = await prisma.payment.findFirst({
    where: { companyId, requestId: paymentRequestId },
  });
  if (!existingPayment) {
    const payment = await prisma.payment.create({
      data: {
        companyId,
        number: 'SEED-PAY-000001',
        accountId: mellat.id,
        amount: new Prisma.Decimal('50000000'),
        currency: CurrencyCode.IRR,
        status: PaymentStatus.POSTED,
        effectiveAt: new Date('2026-03-01T00:00:00.000Z'),
        purposeType: PaymentPurposeType.OTHER,
        counterpartyType: FinanceCounterpartyType.OTHER,
        counterpartyName: 'SEED utility vendor',
        notes: 'SEED: Phase 4.6 standalone payment (not payable settlement)',
        requestId: paymentRequestId,
        createdById: owner.id,
        postedAt: new Date('2026-03-01T00:00:00.000Z'),
        postedById: owner.id,
      },
    });
    await prisma.financialAccountMovement.create({
      data: {
        companyId,
        accountId: mellat.id,
        direction: FinancialAccountMovementDirection.OUT,
        amount: payment.amount,
        currency: CurrencyCode.IRR,
        type: FinancialAccountMovementType.MONEY_OUT,
        sourceType: 'PAYMENT',
        sourceId: payment.id,
        effectiveAt: payment.effectiveAt,
        postedAt: payment.postedAt!,
        description: `SEED payment ${payment.number}`,
        createdById: owner.id,
      },
    });
  }

  const receiptRequestId = 'aaaaaaaa-0004-4600-8000-000000000002';
  const existingReceipt = await prisma.receipt.findFirst({
    where: { companyId, requestId: receiptRequestId },
  });
  if (!existingReceipt) {
    const receipt = await prisma.receipt.create({
      data: {
        companyId,
        number: 'SEED-REC-000001',
        accountId: mellat.id,
        amount: new Prisma.Decimal('75000000'),
        currency: CurrencyCode.IRR,
        status: ReceiptStatus.POSTED,
        effectiveAt: new Date('2026-03-02T00:00:00.000Z'),
        sourceType: ReceiptSourceType.OTHER,
        counterpartyType: FinanceCounterpartyType.OTHER,
        counterpartyName: 'SEED miscellaneous inflow',
        notes: 'SEED: Phase 4.6 standalone receipt (not capital/loan document)',
        requestId: receiptRequestId,
        createdById: owner.id,
        postedAt: new Date('2026-03-02T00:00:00.000Z'),
        postedById: owner.id,
      },
    });
    await prisma.financialAccountMovement.create({
      data: {
        companyId,
        accountId: mellat.id,
        direction: FinancialAccountMovementDirection.IN,
        amount: receipt.amount,
        currency: CurrencyCode.IRR,
        type: FinancialAccountMovementType.MONEY_IN,
        sourceType: 'RECEIPT',
        sourceId: receipt.id,
        effectiveAt: receipt.effectiveAt,
        postedAt: receipt.postedAt!,
        description: `SEED receipt ${receipt.number}`,
        createdById: owner.id,
      },
    });
  }

  // Only sequence-allocated PAY-/REC- numbers advance counters (ignore SEED-* fixtures).
  const maxPay = await prisma.payment.findMany({
    where: { companyId, number: { startsWith: 'PAY-' } },
    select: { number: true },
  });
  let payNext = 1;
  for (const row of maxPay) {
    const n = Number(row.number.replace(/^PAY-/, ''));
    if (Number.isFinite(n) && n >= payNext) payNext = n + 1;
  }
  await prisma.paymentSequence.upsert({
    where: { companyId },
    create: { companyId, nextValue: payNext },
    update: { nextValue: payNext },
  });

  const maxRec = await prisma.receipt.findMany({
    where: { companyId, number: { startsWith: 'REC-' } },
    select: { number: true },
  });
  let recNext = 1;
  for (const row of maxRec) {
    const n = Number(row.number.replace(/^REC-/, ''));
    if (Number.isFinite(n) && n >= recNext) recNext = n + 1;
  }
  await prisma.receiptSequence.upsert({
    where: { companyId },
    create: { companyId, nextValue: recNext },
    update: { nextValue: recNext },
  });
}

/**
 * Phase 4.4 — Opening payable + backfill recognition for existing POSTED GRN items.
 * Idempotent. Does not create FinancialAccountMovement (cash stays out of recognition).
 */
async function seedFinanceSupplierPayablesForPishteh(
  prisma: PrismaClient,
  companyId: string,
): Promise<void> {
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'pouria@hector.local' } });
  const supplier = await prisma.supplier.findFirstOrThrow({
    where: { companyId, code: 'TEH-BEAUTY' },
  });

  const openingRequestId = 'aaaaaaaa-0004-4400-8000-000000000001';
  const existingOpening = await prisma.supplierPayable.findFirst({
    where: { companyId, requestId: openingRequestId },
  });
  if (!existingOpening) {
    const payable = await prisma.supplierPayable.create({
      data: {
        companyId,
        number: 'AP-000001',
        supplierId: supplier.id,
        purchaseOrderId: null,
        purchaseType: SupplierPayablePurchaseType.OPENING,
        currency: CurrencyCode.IRR,
        dueDate: new Date('2026-09-01T00:00:00.000Z'),
        status: SupplierPayableStatus.OPEN,
        recognizedAt: new Date('2026-02-01T00:00:00.000Z'),
        notes: 'SEED: Phase 4.4 opening supplier payable',
        reference: 'OPENING-TEH-BEAUTY',
        requestId: openingRequestId,
      },
    });
    await prisma.supplierLiabilityMovement.create({
      data: {
        companyId,
        payableId: payable.id,
        supplierId: supplier.id,
        direction: SupplierLiabilityMovementDirection.INCREASE,
        type: SupplierLiabilityMovementType.OPENING_BALANCE,
        amount: new Prisma.Decimal('25000000'),
        currency: CurrencyCode.IRR,
        sourceType: 'OPENING_BALANCE',
        sourceId: payable.id,
        effectiveAt: payable.recognizedAt,
        notes: 'SEED opening supplier payable',
        requestId: openingRequestId,
        createdById: owner.id,
      },
    });
  }

  const postedItems = await prisma.goodsReceiptItem.findMany({
    where: {
      companyId,
      goodsReceipt: { status: GoodsReceiptStatus.POSTED },
      quantity: { gt: 0 },
      supplierPayableLine: { is: null },
    },
    include: {
      goodsReceipt: {
        select: {
          id: true,
          number: true,
          postedAt: true,
          purchaseOrderId: true,
        },
      },
    },
    orderBy: { id: 'asc' },
  });

  let nextSeq =
    (
      await prisma.supplierPayableSequence.findUnique({ where: { companyId } })
    )?.nextValue ?? 2;
  // Ensure we start after opening AP-000001
  if (nextSeq < 2) nextSeq = 2;

  const payableByPoCurrency = new Map<string, string>();

  for (const item of postedItems) {
    const po = await prisma.purchaseOrder.findFirst({
      where: { id: item.goodsReceipt.purchaseOrderId, companyId },
      include: {
        items: { select: { id: true, skuId: true, unitPrice: true } },
      },
    });
    if (!po?.purchaseType) continue;

    const poItem = po.items.find((row) => row.id === item.purchaseOrderItemId);
    if (!poItem) continue;

    const purchaseType =
      po.purchaseType === PurchaseCommercialType.TERM_CREDIT
        ? SupplierPayablePurchaseType.TERM_CREDIT
        : po.purchaseType === PurchaseCommercialType.FX_CREDIT
          ? SupplierPayablePurchaseType.FX_CREDIT
          : SupplierPayablePurchaseType.CASH;

    const currency =
      po.purchaseType === PurchaseCommercialType.FX_CREDIT
        ? (po.obligationCurrency ?? po.currency)
        : po.currency;

    const lineAmount = poItem.unitPrice.mul(item.quantity);
    if (lineAmount.lte(0)) continue;

    const mapKey = `${po.id}:${currency}`;
    let payableId = payableByPoCurrency.get(mapKey);
    if (!payableId) {
      const existing = await prisma.supplierPayable.findFirst({
        where: { companyId, purchaseOrderId: po.id, currency },
      });
      if (existing) {
        payableId = existing.id;
      } else {
        const number = `AP-${String(nextSeq).padStart(6, '0')}`;
        nextSeq += 1;
        const created = await prisma.supplierPayable.create({
          data: {
            companyId,
            number,
            supplierId: po.supplierId,
            purchaseOrderId: po.id,
            purchaseType,
            currency,
            referenceFxRate: po.referenceFxRate,
            referenceFxBaseCurrency: po.referenceFxBaseCurrency,
            referenceFxQuoteCurrency: po.referenceFxQuoteCurrency,
            dueDate: po.dueDate,
            status: SupplierPayableStatus.OPEN,
            recognizedAt: item.goodsReceipt.postedAt ?? new Date(),
            notes: `SEED recognition from ${item.goodsReceipt.number}`,
          },
        });
        payableId = created.id;
      }
      payableByPoCurrency.set(mapKey, payableId);
    }

    const existingLine = await prisma.supplierPayableLine.findFirst({
      where: { companyId, goodsReceiptItemId: item.id },
    });
    if (existingLine) continue;

    const recognizedAt = item.goodsReceipt.postedAt ?? new Date();
    await prisma.supplierPayableLine.create({
      data: {
        companyId,
        payableId,
        goodsReceiptId: item.goodsReceiptId,
        goodsReceiptItemId: item.id,
        purchaseOrderItemId: item.purchaseOrderItemId,
        skuId: item.skuId,
        quantity: item.quantity,
        unitPrice: poItem.unitPrice,
        lineAmount,
        currency,
        recognizedAt,
      },
    });

    const existingMovement = await prisma.supplierLiabilityMovement.findFirst({
      where: {
        companyId,
        sourceType: 'GOODS_RECEIPT_ITEM',
        sourceId: item.id,
        type: SupplierLiabilityMovementType.PURCHASE_RECOGNITION,
      },
    });
    if (!existingMovement) {
      await prisma.supplierLiabilityMovement.create({
        data: {
          companyId,
          payableId,
          supplierId: po.supplierId,
          direction: SupplierLiabilityMovementDirection.INCREASE,
          type: SupplierLiabilityMovementType.PURCHASE_RECOGNITION,
          amount: lineAmount,
          currency,
          sourceType: 'GOODS_RECEIPT_ITEM',
          sourceId: item.id,
          effectiveAt: recognizedAt,
          notes: `SEED GRN ${item.goodsReceipt.number} recognition`,
          createdById: owner.id,
        },
      });
    }
  }

  const apNumbers = await prisma.supplierPayable.findMany({
    where: { companyId },
    select: { number: true },
  });
  for (const row of apNumbers) {
    const match = /^AP-(\d+)$/.exec(row.number);
    if (match) nextSeq = Math.max(nextSeq, Number(match[1]) + 1);
  }
  await prisma.supplierPayableSequence.upsert({
    where: { companyId },
    update: { nextValue: nextSeq },
    create: { companyId, nextValue: nextSeq },
  });
  const scNumbers = await prisma.supplierCredit.findMany({
    where: { companyId },
    select: { number: true },
  });
  let nextCredit = 1;
  for (const row of scNumbers) {
    const match = /^SC-(\d+)$/.exec(row.number);
    if (match) nextCredit = Math.max(nextCredit, Number(match[1]) + 1);
  }
  await prisma.supplierCreditSequence.upsert({
    where: { companyId },
    update: { nextValue: nextCredit },
    create: { companyId, nextValue: nextCredit },
  });
}

async function seedWarehousesForSecondary(prisma: PrismaClient, companyId: string): Promise<void> {
  await upsertWarehouse(prisma, companyId, {
    code: 'MAIN',
    name: 'Demo B Main Warehouse',
    address: null,
    notes: 'Isolation sample — same code as Pishteh MAIN is allowed',
    isDefault: true,
  });
}

async function seedWarehouseLocationsForPishteh(
  prisma: PrismaClient,
  companyId: string,
): Promise<void> {
  const main = await prisma.warehouse.findUniqueOrThrow({
    where: { companyId_code: { companyId, code: 'MAIN' } },
  });

  // Small Pishteh-style flat shelves under warehouse (root parentId = null).
  // Phase 3.8–3.10 putaway + inventory demo shelves.
  await upsertWarehouseLocation(prisma, {
    companyId,
    warehouseId: main.id,
    parentId: null,
    type: WarehouseLocationType.SHELF,
    code: 'A-01',
    name: 'قفسه A-01',
    barcode: 'LOC-A-01',
    sortOrder: 0,
    notes: 'SEED: Phase 3.10 stock balance location',
  });
  await upsertWarehouseLocation(prisma, {
    companyId,
    warehouseId: main.id,
    parentId: null,
    type: WarehouseLocationType.SHELF,
    code: 'A-02',
    name: 'قفسه A-02',
    barcode: 'LOC-A-02',
    sortOrder: 0,
    notes: 'SEED: Phase 3.10 stock balance location',
  });
  await upsertWarehouseLocation(prisma, {
    companyId,
    warehouseId: main.id,
    parentId: null,
    type: WarehouseLocationType.SHELF,
    code: 'A-03',
    name: 'قفسه A-03',
    barcode: 'LOC-A-03',
    sortOrder: 0,
    notes: 'SEED: Phase 3.8 putaway destination',
  });
  await upsertWarehouseLocation(prisma, {
    companyId,
    warehouseId: main.id,
    parentId: null,
    type: WarehouseLocationType.SHELF,
    code: 'A-04',
    name: 'قفسه A-04',
    barcode: 'LOC-A-04',
    sortOrder: 0,
    notes: 'SEED: Phase 3.9 inventory second location',
  });

  const secondary = await prisma.warehouse.findUniqueOrThrow({
    where: { companyId_code: { companyId, code: 'SECONDARY' } },
  });
  await upsertWarehouseLocation(prisma, {
    companyId,
    warehouseId: secondary.id,
    parentId: null,
    type: WarehouseLocationType.SHELF,
    code: 'B-01',
    name: 'قفسه B-01',
    barcode: 'LOC-B-01',
    sortOrder: 0,
    notes: 'SEED: Phase 3.10 secondary warehouse location',
  });
  // Leading-zero barcode location for scanner exactness demos.
  await upsertWarehouseLocation(prisma, {
    companyId,
    warehouseId: main.id,
    parentId: null,
    type: WarehouseLocationType.SHELF,
    code: 'A-00',
    name: 'قفسه A-00',
    barcode: '000-A-03',
    sortOrder: 0,
    notes: 'SEED: leading-zero location barcode',
  });

  await upsertWarehouseLocation(prisma, {
    companyId,
    warehouseId: main.id,
    parentId: null,
    type: WarehouseLocationType.SHELF,
    code: 'S01',
    name: 'قفسه ۰۱',
    barcode: 'LOC-SEEDMAIN0S01',
    sortOrder: 1,
    notes: 'قفسه نمونه — ریمل',
  });
  await upsertWarehouseLocation(prisma, {
    companyId,
    warehouseId: main.id,
    parentId: null,
    type: WarehouseLocationType.SHELF,
    code: 'S02',
    name: 'قفسه ۰۲',
    barcode: 'LOC-SEEDMAIN0S02',
    sortOrder: 2,
    notes: null,
  });
  await upsertWarehouseLocation(prisma, {
    companyId,
    warehouseId: main.id,
    parentId: null,
    type: WarehouseLocationType.SHELF,
    code: 'S03',
    name: 'قفسه ۰۳',
    barcode: 'LOC-SEEDMAIN0S03',
    sortOrder: 3,
    notes: null,
  });

  // One nested example: Rack → Shelf (skipped Zone/Aisle levels).
  const rack = await upsertWarehouseLocation(prisma, {
    companyId,
    warehouseId: main.id,
    parentId: null,
    type: WarehouseLocationType.RACK,
    code: 'R01',
    name: 'قفسه فلزی ۰۱',
    barcode: 'LOC-SEEDMAIN0R01',
    sortOrder: 10,
    notes: 'نمونه سلسله‌مراتب تودرتو',
  });
  await upsertWarehouseLocation(prisma, {
    companyId,
    warehouseId: main.id,
    parentId: rack.id,
    type: WarehouseLocationType.SHELF,
    code: 'S04',
    name: 'قفسه ۰۴ روی R01',
    barcode: 'LOC-SEEDMAIN0S04',
    sortOrder: 1,
    notes: null,
  });
}

async function upsertWarehouseLocation(
  prisma: PrismaClient,
  input: {
    companyId: string;
    warehouseId: string;
    parentId: string | null;
    type: WarehouseLocationType;
    code: string;
    name: string | null;
    barcode: string;
    sortOrder: number;
    notes: string | null;
  },
): Promise<{ id: string }> {
  const existing = await prisma.warehouseLocation.findUnique({
    where: {
      companyId_warehouseId_code: {
        companyId: input.companyId,
        warehouseId: input.warehouseId,
        code: input.code,
      },
    },
  });

  if (existing) {
    return prisma.warehouseLocation.update({
      where: { id: existing.id },
      data: {
        parentId: input.parentId,
        type: input.type,
        name: input.name,
        barcode: input.barcode,
        sortOrder: input.sortOrder,
        notes: input.notes,
        status: WarehouseStatus.ACTIVE,
      },
      select: { id: true },
    });
  }

  return prisma.warehouseLocation.create({
    data: {
      companyId: input.companyId,
      warehouseId: input.warehouseId,
      parentId: input.parentId,
      type: input.type,
      code: input.code,
      name: input.name,
      barcode: input.barcode,
      sortOrder: input.sortOrder,
      notes: input.notes,
      status: WarehouseStatus.ACTIVE,
    },
    select: { id: true },
  });
}

async function upsertWarehouse(
  prisma: PrismaClient,
  companyId: string,
  input: {
    code: string;
    name: string;
    address: string | null;
    notes: string | null;
    isDefault: boolean;
  },
): Promise<void> {
  const existing = await prisma.warehouse.findUnique({
    where: { companyId_code: { companyId, code: input.code } },
  });

  if (input.isDefault) {
    await prisma.warehouse.updateMany({
      where: {
        companyId,
        isDefault: true,
        ...(existing ? { id: { not: existing.id } } : {}),
      },
      data: { isDefault: false },
    });
  }

  if (existing) {
    await prisma.warehouse.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        address: input.address,
        notes: input.notes,
        status: WarehouseStatus.ACTIVE,
        isDefault: input.isDefault,
      },
    });
    return;
  }

  await prisma.warehouse.create({
    data: {
      companyId,
      code: input.code,
      name: input.name,
      address: input.address,
      notes: input.notes,
      status: WarehouseStatus.ACTIVE,
      isDefault: input.isDefault,
    },
  });
}

async function seedSecondaryDemoCompany(
  prisma: PrismaClient,
  passwordHash: string,
): Promise<{ id: string; name: string; slug: string }> {
  const company = await prisma.company.upsert({
    where: { slug: 'hector-demo-b' },
    update: {
      name: 'Hector Demo B',
      baseCurrency: CurrencyCode.IRR,
      timezone: 'Asia/Tehran',
      status: CompanyStatus.ACTIVE,
      deletedAt: null,
    },
    create: {
      name: 'Hector Demo B',
      slug: 'hector-demo-b',
      baseCurrency: CurrencyCode.IRR,
      timezone: 'Asia/Tehran',
      status: CompanyStatus.ACTIVE,
    },
  });

  await prisma.role.upsert({
    where: {
      companyId_key: {
        companyId: company.id,
        key: OWNER_ROLE_KEY,
      },
    },
    update: {
      name: 'Owner',
      description: 'Full access to company capabilities. Permission set is code-managed.',
      isSystem: true,
      deletedAt: null,
    },
    create: {
      companyId: company.id,
      key: OWNER_ROLE_KEY,
      name: 'Owner',
      description: 'Full access to company capabilities. Permission set is code-managed.',
      isSystem: true,
    },
  });

  await syncOwnerRolePermissions(prisma);

  const ownerRole = await prisma.role.findUniqueOrThrow({
    where: {
      companyId_key: {
        companyId: company.id,
        key: OWNER_ROLE_KEY,
      },
    },
  });

  // Pouria is also an owner of the secondary demo company (tenant-isolation tests).
  const pouria = await prisma.user.findUniqueOrThrow({
    where: { email: 'pouria@hector.local' },
  });

  // Ensure password stays in sync if secondary seed runs after user upsert.
  await prisma.user.update({
    where: { id: pouria.id },
    data: { passwordHash },
  });

  const membership = await prisma.companyMember.upsert({
    where: {
      companyId_userId: {
        companyId: company.id,
        userId: pouria.id,
      },
    },
    update: {
      status: CompanyMemberStatus.ACTIVE,
    },
    create: {
      companyId: company.id,
      userId: pouria.id,
      status: CompanyMemberStatus.ACTIVE,
    },
  });

  await prisma.companyMemberRole.upsert({
    where: {
      companyMemberId_roleId: {
        companyMemberId: membership.id,
        roleId: ownerRole.id,
      },
    },
    update: {},
    create: {
      companyMemberId: membership.id,
      roleId: ownerRole.id,
    },
  });

  return company;
}

/**
 * Idempotent Catalog sample for Pishteh.
 * Sample barcodes use valid EAN-13 checksums or clearly marked OTHER/INTERNAL values.
 */
async function seedCatalogForPishteh(prisma: PrismaClient, companyId: string): Promise<void> {
  const fanoma = await upsertBrand(prisma, companyId, 'Fanoma', 'FAN');
  const essence = await upsertBrand(prisma, companyId, 'Essence', 'ESS');
  await upsertBrand(prisma, companyId, 'Mirador', 'MIRADOR');

  // Realistic Persian cosmetics category sample (development taxonomy — not permanent).
  const makeup = await upsertCategory(prisma, companyId, 'آرایشی', null, 'MAKEUP', 0);
  const face = await upsertCategory(prisma, companyId, 'صورت', makeup.id, 'FACE', 0);
  const foundationCat = await upsertCategory(prisma, companyId, 'کرم پودر', face.id, 'FOUNDATION', 0);
  const concealerCat = await upsertCategory(prisma, companyId, 'کانسیلر', face.id, 'CONCEALER', 1);
  const powderCat = await upsertCategory(prisma, companyId, 'پنکک', face.id, 'POWDER', 2);
  const primerCat = await upsertCategory(prisma, companyId, 'پرایمر', face.id, 'PRIMER', 3);
  const sunscreenCat = await upsertCategory(prisma, companyId, 'ضد آفتاب', face.id, 'SUNSCREEN', 4);

  const lips = await upsertCategory(prisma, companyId, 'لب', makeup.id, 'LIPS', 1);
  const solidLipstickCat = await upsertCategory(prisma, companyId, 'رژ لب جامد', lips.id, 'LIPSTICK', 0);
  const liquidLipstickCat = await upsertCategory(prisma, companyId, 'رژ لب مایع', lips.id, 'LIQUID_LIPSTICK', 1);

  const eyes = await upsertCategory(prisma, companyId, 'چشم', makeup.id, 'EYES', 2);
  const mascara = await upsertCategory(prisma, companyId, 'ریمل', eyes.id, 'MASCARA', 0);
  const eyelinerCat = await upsertCategory(prisma, companyId, 'مداد چشم', eyes.id, 'EYELINER', 1);

  const brows = await upsertCategory(prisma, companyId, 'ابرو', makeup.id, 'BROWS', 3);
  const browGelCat = await upsertCategory(prisma, companyId, 'ژل ابرو', brows.id, 'BROW_GEL', 0);

  const solidLipstick = await upsertProduct(prisma, companyId, {
    name: 'رژ لب جامد فانوما',
    code: 'FAN-SL',
    description: 'Development sample multi-SKU lipstick (variant option: رنگ 01–18).',
    brandId: fanoma.id,
    categoryId: solidLipstickCat.id,
  });
  const liquidLipstick = await upsertProduct(prisma, companyId, {
    name: 'رژ لب مایع فانوما',
    code: 'FAN-LL',
    description: 'Development sample liquid lipstick (variant option: رنگ 01–18).',
    brandId: fanoma.id,
    categoryId: liquidLipstickCat.id,
  });
  const foundation = await upsertProduct(prisma, companyId, {
    name: 'کرم پودر فانوما',
    code: 'FAN-FOUND',
    description: 'Development sample foundation (variant option: رنگ 01–06).',
    brandId: fanoma.id,
    categoryId: foundationCat.id,
  });
  const concealer = await upsertProduct(prisma, companyId, {
    name: 'کانسیلر فانوما',
    code: 'FAN-CONC',
    description: 'Development sample concealer (variant option: رنگ 01–04).',
    brandId: fanoma.id,
    categoryId: concealerCat.id,
  });
  const powder = await upsertProduct(prisma, companyId, {
    name: 'پنکک فانوما',
    code: 'FAN-POWDER',
    description: 'Development sample powder (variant option: رنگ 01–06).',
    brandId: fanoma.id,
    categoryId: powderCat.id,
  });
  const sunscreen = await upsertProduct(prisma, companyId, {
    name: 'ضد آفتاب فانوما',
    code: 'FAN-SUN',
    description: 'Development sample sunscreen (variant option: نوع رنگ).',
    brandId: fanoma.id,
    categoryId: sunscreenCat.id,
  });
  const primer = await upsertProduct(prisma, companyId, {
    name: 'پرایمر فانوما',
    code: 'FAN-PRIMER',
    description: 'Development sample simple product (single SKU).',
    brandId: fanoma.id,
    categoryId: primerCat.id,
  });
  const eyePencil = await upsertProduct(prisma, companyId, {
    name: 'مداد چشم فانوما',
    code: 'FAN-EYE-PENCIL',
    description: 'Development sample simple product (single SKU).',
    brandId: fanoma.id,
    categoryId: eyelinerCat.id,
  });
  const browGel = await upsertProduct(prisma, companyId, {
    name: 'ژل ابرو فانوما',
    code: 'FAN-BROW-GEL',
    description: 'Development sample simple product (single SKU).',
    brandId: fanoma.id,
    categoryId: browGelCat.id,
  });
  // Prefer ESS-MASC; migrate legacy Phase 1.1 code ESS-MASCARA when present.
  const essenceMascara = await upsertProduct(prisma, companyId, {
    name: 'Essence I Love Extreme Crazy Volume Mascara',
    code: 'ESS-MASC',
    description: 'Development sample single-SKU product.',
    brandId: essence.id,
    categoryId: mascara.id,
    alsoMatchCodes: ['ESS-MASCARA'],
  });

  const pad2 = (n: number): string => String(n).padStart(2, '0');
  const shades = (count: number): string[] => Array.from({ length: count }, (_, i) => pad2(i + 1));

  // Variant products: one option + values + one SKU per value (code prefix + value).
  const solidSkus = await seedVariantProduct(prisma, companyId, solidLipstick.id, {
    optionName: 'رنگ',
    skus: shades(18).map((n) => ({
      code: `FAN-SL-${n}`,
      name: `رنگ ${n}`,
      value: n,
    })),
  });
  await seedVariantProduct(prisma, companyId, liquidLipstick.id, {
    optionName: 'رنگ',
    skus: shades(18).map((n) => ({ code: `FAN-LL-${n}`, name: `رنگ ${n}`, value: n })),
  });
  await seedVariantProduct(prisma, companyId, foundation.id, {
    optionName: 'رنگ',
    skus: shades(6).map((n) => ({ code: `FAN-FOUND-${n}`, name: `رنگ ${n}`, value: n })),
  });
  await seedVariantProduct(prisma, companyId, concealer.id, {
    optionName: 'رنگ',
    skus: shades(4).map((n) => ({ code: `FAN-CONC-${n}`, name: `رنگ ${n}`, value: n })),
  });
  await seedVariantProduct(prisma, companyId, powder.id, {
    optionName: 'رنگ',
    skus: shades(6).map((n) => ({ code: `FAN-POWDER-${n}`, name: `رنگ ${n}`, value: n })),
  });
  await seedVariantProduct(prisma, companyId, sunscreen.id, {
    optionName: 'نوع رنگ',
    skus: [
      { code: 'FAN-SUN-CLEAR', name: 'بی‌رنگ', value: 'بی‌رنگ' },
      { code: 'FAN-SUN-01', name: 'رنگ 01', value: '01' },
      { code: 'FAN-SUN-02', name: 'رنگ 02', value: '02' },
    ],
  });

  // Simple products: exactly one SIMPLE SKU each.
  await upsertSku(prisma, companyId, primer.id, 'FAN-PRIMER-01', null);
  await upsertSku(prisma, companyId, eyePencil.id, 'FAN-EYE-PENCIL-01', null);
  await upsertSku(prisma, companyId, browGel.id, 'FAN-BROW-GEL-01', null);
  const mascaraSku = await upsertSku(
    prisma,
    companyId,
    essenceMascara.id,
    'ESS-MASCARA-01',
    'Black',
  );

  // Barcodes (Phase 1.5): valid EAN-13 samples + INTERNAL. Values never reused after archive.
  const solid01 = solidSkus.get('FAN-SL-01');
  const solid02 = solidSkus.get('FAN-SL-02');
  if (!solid01 || !solid02) throw new Error('Seed: FAN-SL-01/02 missing');

  await upsertBarcode(prisma, companyId, solid01.id, {
    value: withGtinCheckDigit('626100000001'),
    type: BarcodeType.EAN13,
    isPrimary: true,
  });
  await upsertBarcode(prisma, companyId, solid02.id, {
    value: withGtinCheckDigit('626100000002'),
    type: BarcodeType.EAN13,
    isPrimary: true,
  });
  await upsertBarcode(prisma, companyId, solid02.id, {
    value: 'HCT-SEEDFANSL02XX',
    type: BarcodeType.INTERNAL,
    isPrimary: false,
  });

  const primerSku = await prisma.sku.findFirst({
    where: { companyId, code: 'FAN-PRIMER-01' },
  });
  if (!primerSku) throw new Error('Seed: FAN-PRIMER-01 missing');
  await upsertBarcode(prisma, companyId, primerSku.id, {
    value: withGtinCheckDigit('626100000090'),
    type: BarcodeType.EAN13,
    isPrimary: true,
  });

  // Scanner receiving demo barcode (OTHER — not forced through EAN-13 checksum).
  await upsertBarcode(prisma, companyId, mascaraSku.id, {
    value: '4059729196967',
    type: BarcodeType.OTHER,
    isPrimary: true,
  });
  // Secondary barcode for same SKU (multi-barcode → same SKU).
  await upsertBarcode(prisma, companyId, mascaraSku.id, {
    value: 'DEV-BC-ESS-MASCARA-01',
    type: BarcodeType.OTHER,
    isPrimary: false,
  });
  // Leading-zero identity must remain a distinct string (never Number()).
  await upsertBarcode(prisma, companyId, mascaraSku.id, {
    value: '0012345678905',
    type: BarcodeType.OTHER,
    isPrimary: false,
  });

  await seedProductAttributesForPishteh(prisma, companyId, {
    sunscreenCategoryId: sunscreenCat.id,
    mascaraCategoryId: mascara.id,
    sunscreenProductId: sunscreen.id,
    mascaraProductId: essenceMascara.id,
    primerProductId: primer.id,
    shadeHexSkuId: solid01.id,
  });
}

/** Minimal Catalog row on secondary company for tenant isolation checks. */
async function seedCatalogForSecondary(prisma: PrismaClient, companyId: string): Promise<void> {
  const brand = await upsertBrand(prisma, companyId, 'Mirador Demo', 'MIR');
  const root = await upsertCategory(prisma, companyId, 'Demo Root', null, 'DEMO_ROOT', 0);
  const child = await upsertCategory(prisma, companyId, 'Demo Child', root.id, 'DEMO_CHILD', 0);
  const product = await upsertProduct(prisma, companyId, {
    name: 'Mirador Demo Serum',
    code: 'MIR-SERUM',
    description: 'Secondary-company catalog sample for isolation tests.',
    brandId: brand.id,
    categoryId: child.id,
  });
  const sku = await upsertSku(prisma, companyId, product.id, 'MIR-SERUM-01', null);
  // Same numeric barcode value as Pishteh FAN-SL-01 is allowed cross-company.
  await upsertBarcode(prisma, companyId, sku.id, {
    value: withGtinCheckDigit('626100000001'),
    type: BarcodeType.EAN13,
    isPrimary: true,
  });
  await upsertBarcode(prisma, companyId, sku.id, {
    value: 'DEV-BC-DEMO-B-ONLY',
    type: BarcodeType.OTHER,
    isPrimary: false,
  });

  // Minimal variant product on the secondary company (tenant isolation for variants).
  const lipTint = await upsertProduct(prisma, companyId, {
    name: 'Mirador Demo Lip Tint',
    code: 'MIR-LIP',
    description: 'Secondary-company variant sample (option Shade).',
    brandId: brand.id,
    categoryId: child.id,
  });
  await seedVariantProduct(prisma, companyId, lipTint.id, {
    optionName: 'Shade',
    skus: [
      { code: 'MIR-LIP-ROSE', name: 'Rose', value: 'Rose' },
      { code: 'MIR-LIP-PLUM', name: 'Plum', value: 'Plum' },
    ],
  });

  await upsertAttributeDefinition(prisma, companyId, {
    name: 'SPF',
    code: 'spf',
    type: AttributeType.NUMBER,
    scope: AttributeScope.PRODUCT,
    unit: null,
  });
}

function normalizeCatalogNameKey(value: string): string {
  let normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  normalized = normalized.replace(/\u064A/g, '\u06CC').replace(/\u0643/g, '\u06A9');
  return normalized.toLocaleLowerCase('en-US');
}

/** Idempotent Supplier Master sample for Pishteh (fictional — not real suppliers). */
async function seedSuppliersForPishteh(prisma: PrismaClient, companyId: string): Promise<void> {
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'pouria@hector.local' } });
  const tehran = await upsertSupplier(prisma, companyId, {
    name: 'پخش تهران',
    code: 'TEH-BEAUTY',
    phone: '02112345678',
  });
  await upsertSupplierContact(prisma, companyId, tehran.id, {
    name: 'آقای رضایی',
    role: 'فروش',
    mobile: '09121234567',
    isPrimary: true,
  });
  await upsertSupplierContact(prisma, companyId, tehran.id, {
    name: 'خانم محمدی',
    role: 'حسابداری',
    phone: '02187654321',
    isPrimary: false,
  });
  await upsertSupplierNote(prisma, companyId, tehran.id, owner.id, 'قیمت‌هاش معمولاً خوبه');
  await upsertSupplierNote(
    prisma,
    companyId,
    tehran.id,
    owner.id,
    'برای سفارش بعدی ۱۰ روزه تسویه می‌کند.',
  );

  await upsertSupplier(prisma, companyId, {
    name: 'پخش آرایشی تهران',
    code: 'TEH-COSMETICS',
    phone: '09129876543',
  });

  await upsertSupplier(prisma, companyId, {
    name: 'حاجی بازار تهران',
    code: null,
  });
}

/** Minimal Supplier on secondary company for tenant isolation checks. */
async function seedSuppliersForSecondary(prisma: PrismaClient, companyId: string): Promise<void> {
  await upsertSupplier(prisma, companyId, {
    name: 'Demo B Supplier',
    code: 'DEMO-SUP-B',
    phone: '09120000000',
  });
}

/**
 * Idempotent sample Purchase Orders for Pishteh.
 * Numbers use the `SEED-` prefix so they never collide with sequence-generated `PO-YYYY-NNNNNN` numbers.
 * Re-running the seed resets these fixtures (and only these) to their fixture state.
 * Covers CASH, TERM_CREDIT, and FX_CREDIT commercial types (Phase 2.5).
 */
async function seedPurchaseOrdersForPishteh(
  prisma: PrismaClient,
  companyId: string,
): Promise<void> {
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'pouria@hector.local' } });
  const tehran = await prisma.supplier.findFirstOrThrow({
    where: { companyId, code: 'TEH-BEAUTY' },
  });
  const mascara = await prisma.sku.findFirstOrThrow({
    where: { companyId, code: 'ESS-MASCARA-01' },
    include: { product: true },
  });
  const offer = await prisma.supplierOffer.findFirst({
    where: { companyId, notes: 'SEED:TEH-BEAUTY:ESS-MASCARA-01:5850000:2026-10-03' },
  });

  type SeedPoFixture = {
    number: string;
    status: PurchaseOrderStatus;
    currency: CurrencyCode;
    quantity: number;
    unitPrice: string;
    orderDate: Date;
    notes: string;
    purchaseType: PurchaseCommercialType;
    paymentTermType: PaymentTermType;
    netDays: number | null;
    termBasis: PurchaseTermBasis | null;
    dueDate: Date | null;
    obligationAmount: string | null;
    obligationCurrency: CurrencyCode | null;
    referenceFxRate: string | null;
    referenceFxBaseCurrency: CurrencyCode | null;
    referenceFxQuoteCurrency: CurrencyCode | null;
    referenceFxRateAt: Date | null;
    paymentTermsNote: string | null;
    supplierOrderReference: string | null;
    cancellationReason: string | null;
  };

  const fixtures: SeedPoFixture[] = [
    {
      number: 'SEED-PO-DRAFT-01',
      status: PurchaseOrderStatus.DRAFT,
      currency: CurrencyCode.IRR,
      quantity: 1000,
      unitPrice: '5850000',
      orderDate: new Date('2026-10-03T11:00:00.000Z'),
      notes: 'SEED: CASH draft (1,000 × 585,000 Toman).',
      purchaseType: PurchaseCommercialType.CASH,
      paymentTermType: PaymentTermType.IMMEDIATE,
      netDays: null,
      termBasis: null,
      dueDate: null,
      obligationAmount: null,
      obligationCurrency: null,
      referenceFxRate: null,
      referenceFxBaseCurrency: null,
      referenceFxQuoteCurrency: null,
      referenceFxRateAt: null,
      paymentTermsNote: null,
      supplierOrderReference: null,
      cancellationReason: null,
    },
    {
      number: 'SEED-PO-APPROVED-01',
      status: PurchaseOrderStatus.APPROVED,
      currency: CurrencyCode.IRR,
      quantity: 800,
      unitPrice: '5900000',
      orderDate: new Date('2026-10-03T10:30:00.000Z'),
      notes: 'SEED: CASH approved, awaiting supplier order placement.',
      purchaseType: PurchaseCommercialType.CASH,
      paymentTermType: PaymentTermType.IMMEDIATE,
      netDays: null,
      termBasis: null,
      dueDate: null,
      obligationAmount: null,
      obligationCurrency: null,
      referenceFxRate: null,
      referenceFxBaseCurrency: null,
      referenceFxQuoteCurrency: null,
      referenceFxRateAt: null,
      paymentTermsNote: null,
      supplierOrderReference: null,
      cancellationReason: null,
    },
    {
      number: 'SEED-PO-CANCELLED-01',
      status: PurchaseOrderStatus.CANCELLED,
      currency: CurrencyCode.IRR,
      quantity: 300,
      unitPrice: '5800000',
      orderDate: new Date('2026-10-02T12:00:00.000Z'),
      notes: 'SEED: CASH cancelled after order (supplier unavailable).',
      purchaseType: PurchaseCommercialType.CASH,
      paymentTermType: PaymentTermType.IMMEDIATE,
      netDays: null,
      termBasis: null,
      dueDate: null,
      obligationAmount: null,
      obligationCurrency: null,
      referenceFxRate: null,
      referenceFxBaseCurrency: null,
      referenceFxQuoteCurrency: null,
      referenceFxRateAt: null,
      paymentTermsNote: null,
      supplierOrderReference: 'SEED-WA-REF-CANCEL',
      cancellationReason: 'تأمین‌کننده موجودی نداشت',
    },
    {
      number: 'SEED-PO-TERM-01',
      status: PurchaseOrderStatus.ORDERED,
      currency: CurrencyCode.IRR,
      quantity: 1000,
      unitPrice: '6000000',
      orderDate: new Date('2026-10-03T09:30:00.000Z'),
      notes: 'SEED: TERM_CREDIT ordered (1,000 × 600,000 Toman, 10 days).',
      purchaseType: PurchaseCommercialType.TERM_CREDIT,
      paymentTermType: PaymentTermType.NET_DAYS,
      netDays: 10,
      termBasis: PurchaseTermBasis.ORDER_DATE,
      dueDate: new Date('2026-10-13T12:00:00.000Z'),
      obligationAmount: null,
      obligationCurrency: null,
      referenceFxRate: null,
      referenceFxBaseCurrency: null,
      referenceFxQuoteCurrency: null,
      referenceFxRateAt: null,
      paymentTermsNote: 'SEED: 10-day credit from order date.',
      supplierOrderReference: 'SEED-TERM-INV-10',
      cancellationReason: null,
    },
    {
      number: 'SEED-PO-TERM-30',
      status: PurchaseOrderStatus.ORDERED,
      currency: CurrencyCode.IRR,
      quantity: 500,
      unitPrice: '6000000',
      orderDate: new Date('2026-10-03T09:00:00.000Z'),
      notes: 'SEED: TERM_CREDIT ordered (30 days from order date).',
      purchaseType: PurchaseCommercialType.TERM_CREDIT,
      paymentTermType: PaymentTermType.NET_DAYS,
      netDays: 30,
      termBasis: PurchaseTermBasis.ORDER_DATE,
      dueDate: new Date('2026-11-02T12:00:00.000Z'),
      obligationAmount: null,
      obligationCurrency: null,
      referenceFxRate: null,
      referenceFxBaseCurrency: null,
      referenceFxQuoteCurrency: null,
      referenceFxRateAt: null,
      paymentTermsNote: null,
      supplierOrderReference: null,
      cancellationReason: null,
    },
    {
      number: 'SEED-PO-FIXED-01',
      status: PurchaseOrderStatus.ORDERED,
      currency: CurrencyCode.IRR,
      quantity: 200,
      unitPrice: '6000000',
      orderDate: new Date('2026-10-03T10:00:00.000Z'),
      notes: 'SEED: TERM_CREDIT FIXED_DATE (explicit due 2026-11-15).',
      purchaseType: PurchaseCommercialType.TERM_CREDIT,
      paymentTermType: PaymentTermType.FIXED_DATE,
      netDays: null,
      termBasis: null,
      dueDate: new Date('2026-11-15T12:00:00.000Z'),
      obligationAmount: null,
      obligationCurrency: null,
      referenceFxRate: null,
      referenceFxBaseCurrency: null,
      referenceFxQuoteCurrency: null,
      referenceFxRateAt: null,
      paymentTermsNote: 'SEED: explicit due date agreed with supplier.',
      supplierOrderReference: null,
      cancellationReason: null,
    },
    {
      // Canonical FX example (PO-FX-EXAMPLE): 1,000 USD @ 205,000 Toman/USD.
      number: 'SEED-PO-FX-01',
      status: PurchaseOrderStatus.ORDERED,
      currency: CurrencyCode.USD,
      quantity: 1000,
      unitPrice: '1.00',
      orderDate: new Date('2026-10-03T08:00:00.000Z'),
      notes:
        'SEED: FX_CREDIT ordered (PO-FX-EXAMPLE — 1,000 USD @ 205,000 Toman/USD reference, 30 days).',
      purchaseType: PurchaseCommercialType.FX_CREDIT,
      paymentTermType: PaymentTermType.NET_DAYS,
      netDays: 30,
      termBasis: PurchaseTermBasis.ORDER_DATE,
      dueDate: new Date('2026-11-02T12:00:00.000Z'),
      obligationAmount: '1000',
      obligationCurrency: CurrencyCode.USD,
      // 205,000 Toman/USD → 2,050,000 IRR/USD (canonical).
      referenceFxRate: '2050000',
      referenceFxBaseCurrency: CurrencyCode.USD,
      referenceFxQuoteCurrency: CurrencyCode.IRR,
      referenceFxRateAt: new Date('2026-10-02T14:00:00.000Z'),
      paymentTermsNote: null,
      supplierOrderReference: 'SEED-FX-USD-1000',
      cancellationReason: null,
    },
    {
      number: 'SEED-PO-FX-DECIMAL',
      status: PurchaseOrderStatus.ORDERED,
      currency: CurrencyCode.USD,
      quantity: 1,
      unitPrice: '842.75',
      orderDate: new Date('2026-10-03T07:00:00.000Z'),
      notes: 'SEED: FX_CREDIT decimal liability (842.75 USD).',
      purchaseType: PurchaseCommercialType.FX_CREDIT,
      paymentTermType: PaymentTermType.NET_DAYS,
      netDays: 30,
      termBasis: PurchaseTermBasis.ORDER_DATE,
      dueDate: new Date('2026-11-02T12:00:00.000Z'),
      obligationAmount: '842.75',
      obligationCurrency: CurrencyCode.USD,
      referenceFxRate: '2050000',
      referenceFxBaseCurrency: CurrencyCode.USD,
      referenceFxQuoteCurrency: CurrencyCode.IRR,
      referenceFxRateAt: new Date('2026-10-02T14:00:00.000Z'),
      paymentTermsNote: null,
      supplierOrderReference: null,
      cancellationReason: null,
    },
    // Legacy number kept for idempotent re-seed of older environments.
    {
      number: 'SEED-PO-ORDERED-01',
      status: PurchaseOrderStatus.ORDERED,
      currency: CurrencyCode.IRR,
      quantity: 500,
      unitPrice: '5800000',
      orderDate: new Date('2026-10-01T09:30:00.000Z'),
      notes: 'SEED: CASH ordered (500 × 580,000 Toman).',
      purchaseType: PurchaseCommercialType.CASH,
      paymentTermType: PaymentTermType.IMMEDIATE,
      netDays: null,
      termBasis: null,
      dueDate: null,
      obligationAmount: null,
      obligationCurrency: null,
      referenceFxRate: null,
      referenceFxBaseCurrency: null,
      referenceFxQuoteCurrency: null,
      referenceFxRateAt: null,
      paymentTermsNote: null,
      supplierOrderReference: null,
      cancellationReason: null,
    },
  ];

  for (const fixture of fixtures) {
    const unitPrice = new Prisma.Decimal(fixture.unitPrice);
    const lineSubtotal = unitPrice.mul(fixture.quantity);
    const wasOrdered =
      fixture.status === PurchaseOrderStatus.ORDERED ||
      (fixture.status === PurchaseOrderStatus.CANCELLED && fixture.cancellationReason != null);
    const wasApproved =
      wasOrdered ||
      fixture.status === PurchaseOrderStatus.APPROVED ||
      fixture.status === PurchaseOrderStatus.CANCELLED;
    const freezeSnapshots = wasOrdered;
    const timeline = {
      approvedById: wasApproved ? owner.id : null,
      approvedAt: wasApproved ? new Date(fixture.orderDate.getTime() + 3_600_000) : null,
      orderedById: wasOrdered ? owner.id : null,
      orderedAt: wasOrdered ? new Date(fixture.orderDate.getTime() + 7_200_000) : null,
      supplierNameSnapshot: freezeSnapshots ? tehran.name : null,
      supplierCodeSnapshot: freezeSnapshots ? tehran.code : null,
      cancelledById: fixture.status === PurchaseOrderStatus.CANCELLED ? owner.id : null,
      cancelledAt:
        fixture.status === PurchaseOrderStatus.CANCELLED
          ? new Date(fixture.orderDate.getTime() + 14_400_000)
          : null,
      cancellationReason: fixture.cancellationReason,
      supplierOrderReference: fixture.supplierOrderReference,
    };
    const version =
      fixture.status === PurchaseOrderStatus.CANCELLED
        ? 4
        : fixture.status === PurchaseOrderStatus.ORDERED
          ? 3
          : fixture.status === PurchaseOrderStatus.APPROVED
            ? 2
            : 1;

    const data = {
      supplierId: tehran.id,
      supplierContactId: null,
      status: fixture.status,
      currency: fixture.currency,
      purchaseType: fixture.purchaseType,
      paymentTermType: fixture.paymentTermType,
      netDays: fixture.netDays,
      termBasis: fixture.termBasis,
      dueDate: fixture.dueDate,
      obligationAmount: fixture.obligationAmount
        ? new Prisma.Decimal(fixture.obligationAmount)
        : null,
      obligationCurrency: fixture.obligationCurrency,
      referenceFxRate: fixture.referenceFxRate
        ? new Prisma.Decimal(fixture.referenceFxRate)
        : null,
      referenceFxBaseCurrency: fixture.referenceFxBaseCurrency,
      referenceFxQuoteCurrency: fixture.referenceFxQuoteCurrency,
      referenceFxRateAt: fixture.referenceFxRateAt,
      paymentTermsNote: fixture.paymentTermsNote,
      orderDate: fixture.orderDate,
      expectedAt: null,
      notes: fixture.notes,
      subtotal: lineSubtotal,
      total: lineSubtotal,
      createdById: owner.id,
      version,
      ...timeline,
    };

    const existing = await prisma.purchaseOrder.findUnique({
      where: { companyId_number: { companyId, number: fixture.number } },
    });
    const order = existing
      ? await prisma.purchaseOrder.update({ where: { id: existing.id }, data })
      : await prisma.purchaseOrder.create({
          data: { companyId, number: fixture.number, ...data },
        });

    const itemData = {
      skuId: mascara.id,
      quantity: fixture.quantity,
      unitPrice,
      lineSubtotal,
      supplierOfferId: fixture.status === PurchaseOrderStatus.DRAFT ? (offer?.id ?? null) : null,
      notes: null as string | null,
      skuCodeSnapshot: freezeSnapshots ? mascara.code : null,
      productNameSnapshot: freezeSnapshots ? mascara.product.name : null,
      variantLabelSnapshot: freezeSnapshots ? mascara.name : null,
      productIdSnapshot: freezeSnapshots ? mascara.productId : null,
    };

    const existingItems = await prisma.purchaseOrderItem.findMany({
      where: { purchaseOrderId: order.id, companyId },
      select: { id: true },
    });
    const referencedByReceipt =
      existingItems.length > 0
        ? await prisma.goodsReceiptItem.count({
            where: { purchaseOrderItemId: { in: existingItems.map((i) => i.id) } },
          })
        : 0;

    if (referencedByReceipt > 0 && existingItems[0]) {
      // Keep stable PO item identity for seeded GRNs (idempotent re-seed).
      await prisma.purchaseOrderItem.update({
        where: { id: existingItems[0].id },
        data: itemData,
      });
    } else {
      await prisma.purchaseOrderItem.deleteMany({
        where: { purchaseOrderId: order.id, companyId },
      });
      await prisma.purchaseOrderItem.create({
        data: {
          companyId,
          purchaseOrderId: order.id,
          ...itemData,
        },
      });
    }
  }

  await seedPurchaseOrderCostsForPishteh(prisma, companyId, owner.id);
  await seedPurchaseReturnsCorrectionsForPishteh(prisma, companyId, owner.id);
}

/**
 * Phase 2.11 sample: historical correction, short-close discrepancy, approved return intent.
 * No Warehouse execution / Finance refunds.
 */
async function seedPurchaseReturnsCorrectionsForPishteh(
  prisma: PrismaClient,
  companyId: string,
  actorUserId: string,
): Promise<void> {
  const tehran = await prisma.supplier.findFirstOrThrow({
    where: { companyId, code: 'TEH-BEAUTY' },
  });
  const mascara = await prisma.sku.findFirstOrThrow({
    where: { companyId, code: 'ESS-MASCARA-01' },
    include: { product: true },
  });

  const number = 'SEED-PO-CORR-01';
  const unitPrice = new Prisma.Decimal('500000');
  const quantity = 900;
  const lineSubtotal = unitPrice.mul(quantity);
  const existing = await prisma.purchaseOrder.findUnique({
    where: { companyId_number: { companyId, number } },
  });
  const order = existing
    ? await prisma.purchaseOrder.update({
        where: { id: existing.id },
        data: {
          status: PurchaseOrderStatus.ORDERED,
          supplierId: tehran.id,
          currency: CurrencyCode.IRR,
          purchaseType: PurchaseCommercialType.CASH,
          paymentTermType: PaymentTermType.IMMEDIATE,
          orderDate: new Date('2026-09-20T12:00:00.000Z'),
          subtotal: lineSubtotal,
          total: lineSubtotal,
          supplierNameSnapshot: tehran.name,
          supplierCodeSnapshot: tehran.code,
          approvedById: actorUserId,
          orderedById: actorUserId,
          approvedAt: new Date('2026-09-20T13:00:00.000Z'),
          orderedAt: new Date('2026-09-20T14:00:00.000Z'),
          version: 3,
        },
      })
    : await prisma.purchaseOrder.create({
        data: {
          companyId,
          number,
          status: PurchaseOrderStatus.ORDERED,
          supplierId: tehran.id,
          currency: CurrencyCode.IRR,
          purchaseType: PurchaseCommercialType.CASH,
          paymentTermType: PaymentTermType.IMMEDIATE,
          orderDate: new Date('2026-09-20T12:00:00.000Z'),
          subtotal: lineSubtotal,
          total: lineSubtotal,
          createdById: actorUserId,
          supplierNameSnapshot: tehran.name,
          supplierCodeSnapshot: tehran.code,
          approvedById: actorUserId,
          orderedById: actorUserId,
          approvedAt: new Date('2026-09-20T13:00:00.000Z'),
          orderedAt: new Date('2026-09-20T14:00:00.000Z'),
          version: 3,
        },
      });

  // Clear dependents before recreating the line (FK-safe idempotent seed).
  await prisma.purchaseReturnItem.deleteMany({
    where: { purchaseReturn: { companyId, purchaseOrderId: order.id } },
  });
  await prisma.purchaseReturn.deleteMany({
    where: { companyId, purchaseOrderId: order.id },
  });
  await prisma.purchaseOrderCorrection.deleteMany({
    where: { companyId, purchaseOrderId: order.id },
  });
  await prisma.purchaseDiscrepancy.deleteMany({
    where: { companyId, purchaseOrderId: order.id },
  });
  await prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: order.id, companyId } });

  const item = await prisma.purchaseOrderItem.create({
    data: {
      companyId,
      purchaseOrderId: order.id,
      skuId: mascara.id,
      quantity,
      closedUnfulfilledQuantity: 100,
      unitPrice,
      lineSubtotal,
      skuCodeSnapshot: mascara.code,
      productNameSnapshot: mascara.product.name,
      productIdSnapshot: mascara.productId,
    },
  });

  await prisma.purchaseOrderCorrection.create({
    data: {
      companyId,
      purchaseOrderId: order.id,
      purchaseOrderItemId: item.id,
      type: PurchaseCorrectionType.QUANTITY_CORRECTION,
      status: PurchaseCorrectionStatus.APPLIED,
      reason: 'Seed: actual supplier commitment was 900 (entered as 1000).',
      beforeSnapshot: {
        purchaseOrderItemId: item.id,
        quantity: 1000,
        unitPrice: unitPrice.toString(),
      },
      afterSnapshot: {
        purchaseOrderItemId: item.id,
        quantity: 900,
        unitPrice: unitPrice.toString(),
      },
      purchaseOrderVersion: 2,
      appliedById: actorUserId,
    },
  });

  await prisma.purchaseDiscrepancy.create({
    data: {
      companyId,
      purchaseOrderId: order.id,
      purchaseOrderItemId: item.id,
      type: PurchaseDiscrepancyType.SHORT_SHIPMENT,
      source: PurchaseDiscrepancySource.BEFORE_RECEIPT,
      status: PurchaseDiscrepancyStatus.SHORT_CLOSED,
      quantity: 100,
      reason: 'Seed: supplier cannot fulfill remaining 100; short-closed.',
      createdById: actorUserId,
      resolvedById: actorUserId,
      resolvedAt: new Date('2026-09-21T10:00:00.000Z'),
    },
  });

  const returnNumber = 'SEED-PR-000001';
  const purchaseReturn = await prisma.purchaseReturn.create({
    data: {
      companyId,
      number: returnNumber,
      supplierId: tehran.id,
      purchaseOrderId: order.id,
      status: PurchaseReturnStatus.APPROVED,
      reason: PurchaseReturnReason.DEFECTIVE,
      expectedResolution: PurchaseReturnResolution.SUPPLIER_CREDIT,
      notes:
        'Seed: commercially approved return intent. Physical Warehouse return / Finance credit deferred.',
      createdById: actorUserId,
      approvedById: actorUserId,
      approvedAt: new Date('2026-09-22T12:00:00.000Z'),
      version: 2,
    },
  });
  await prisma.purchaseReturnItem.create({
    data: {
      companyId,
      purchaseReturnId: purchaseReturn.id,
      purchaseOrderItemId: item.id,
      skuId: mascara.id,
      quantity: 20,
      reason: PurchaseReturnReason.DEFECTIVE,
    },
  });

  // Keep return sequence ahead of seed number for live creates.
  await prisma.purchaseReturnSequence.upsert({
    where: { companyId },
    create: { companyId, nextValue: 2 },
    update: {},
  });
}

/** Idempotent Phase 2.8 acquisition-cost samples (ACTIVE only; not paid). */
async function seedPurchaseOrderCostsForPishteh(
  prisma: PrismaClient,
  companyId: string,
  createdById: string,
): Promise<void> {
  const termPo = await prisma.purchaseOrder.findUnique({
    where: { companyId_number: { companyId, number: 'SEED-PO-TERM-01' } },
  });
  const fxPo = await prisma.purchaseOrder.findUnique({
    where: { companyId_number: { companyId, number: 'SEED-PO-FX-01' } },
  });
  if (!termPo || !fxPo) return;

  const fixtures: Array<{
    purchaseOrderId: string;
    reference: string;
    type: PurchaseCostType;
    amount: string;
    currency: CurrencyCode;
    description: string | null;
    payeeName: string | null;
    costDate: Date;
  }> = [
    {
      purchaseOrderId: termPo.id,
      reference: 'SEED:TERM-01:COURIER',
      type: PurchaseCostType.COURIER,
      amount: '8000000', // 800k Toman
      currency: CurrencyCode.IRR,
      description: 'پیک بازار تا انبار',
      payeeName: 'اسنپ باکس',
      costDate: new Date('2026-10-04T12:00:00.000Z'),
    },
    {
      purchaseOrderId: termPo.id,
      reference: 'SEED:TERM-01:FEE',
      type: PurchaseCostType.PURCHASE_FEE,
      amount: '12000000', // 1.2M Toman
      currency: CurrencyCode.IRR,
      description: 'کارمزد خرید',
      payeeName: null,
      costDate: new Date('2026-10-03T12:00:00.000Z'),
    },
    {
      purchaseOrderId: fxPo.id,
      reference: 'SEED:FX-01:COURIER',
      type: PurchaseCostType.COURIER,
      amount: '20000000', // 2M Toman
      currency: CurrencyCode.IRR,
      description: 'پیک تحویل ارزی',
      payeeName: 'پیک محلی',
      costDate: new Date('2026-10-04T12:00:00.000Z'),
    },
    {
      purchaseOrderId: fxPo.id,
      reference: 'SEED:FX-01:FEE-USD',
      type: PurchaseCostType.PURCHASE_FEE,
      amount: '10',
      currency: CurrencyCode.USD,
      description: 'Broker fee',
      payeeName: 'Broker',
      costDate: new Date('2026-10-03T12:00:00.000Z'),
    },
  ];

  for (const fixture of fixtures) {
    const existing = await prisma.purchaseOrderCost.findFirst({
      where: {
        companyId,
        purchaseOrderId: fixture.purchaseOrderId,
        reference: fixture.reference,
      },
    });
    const data = {
      type: fixture.type,
      status: PurchaseCostStatus.ACTIVE,
      description: fixture.description,
      amount: new Prisma.Decimal(fixture.amount),
      currency: fixture.currency,
      costDate: fixture.costDate,
      payeeName: fixture.payeeName,
      reference: fixture.reference,
      notes: 'SEED purchase cost (not paid).',
      allocationMethod: PurchaseCostAllocationMethod.UNALLOCATED,
      supplierId: null,
      voidedById: null,
      voidReason: null,
      voidedAt: null,
      createdById,
    };
    if (existing) {
      await prisma.purchaseOrderCost.update({ where: { id: existing.id }, data });
    } else {
      await prisma.purchaseOrderCost.create({
        data: {
          companyId,
          purchaseOrderId: fixture.purchaseOrderId,
          ...data,
        },
      });
    }
  }
}

/** Idempotent fictional Supplier Offer history for Pishteh. Prices in IRR (rials). */
async function seedSupplierOffersForPishteh(
  prisma: PrismaClient,
  companyId: string,
): Promise<void> {
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'pouria@hector.local' } });
  const tehran = await prisma.supplier.findFirstOrThrow({
    where: { companyId, code: 'TEH-BEAUTY' },
  });
  const cosmetics = await prisma.supplier.findFirstOrThrow({
    where: { companyId, code: 'TEH-COSMETICS' },
  });
  const mascara = await prisma.sku.findFirstOrThrow({
    where: { companyId, code: 'ESS-MASCARA-01' },
  });
  const contact = await prisma.supplierContact.findFirst({
    where: { companyId, supplierId: tehran.id, name: 'آقای رضایی', archivedAt: null },
  });

  // Historical quote then newer quote for same Supplier+SKU (585,000 Toman = 5,850,000 IRR).
  await upsertSupplierOffer(prisma, {
    companyId,
    supplierId: tehran.id,
    skuId: mascara.id,
    supplierContactId: contact?.id ?? null,
    unitPrice: '5800000',
    currency: CurrencyCode.IRR,
    purchaseType: PurchaseCommercialType.CASH,
    paymentTermType: PaymentTermType.IMMEDIATE,
    netDays: null,
    quotedAt: new Date('2026-10-01T09:00:00.000Z'),
    createdById: owner.id,
    notes: 'SEED:TEH-BEAUTY:ESS-MASCARA-01:5800000:2026-10-01',
  });
  await upsertSupplierOffer(prisma, {
    companyId,
    supplierId: tehran.id,
    skuId: mascara.id,
    supplierContactId: contact?.id ?? null,
    unitPrice: '5850000',
    currency: CurrencyCode.IRR,
    purchaseType: PurchaseCommercialType.CASH,
    paymentTermType: PaymentTermType.IMMEDIATE,
    netDays: null,
    quotedAt: new Date('2026-10-03T10:00:00.000Z'),
    createdById: owner.id,
    notes: 'SEED:TEH-BEAUTY:ESS-MASCARA-01:5850000:2026-10-03',
  });

  // Term credit competitor (600,000 Toman = 6,000,000 IRR, 30 days).
  await upsertSupplierOffer(prisma, {
    companyId,
    supplierId: cosmetics.id,
    skuId: mascara.id,
    supplierContactId: null,
    unitPrice: '6000000',
    currency: CurrencyCode.IRR,
    purchaseType: PurchaseCommercialType.TERM_CREDIT,
    paymentTermType: PaymentTermType.NET_DAYS,
    netDays: 30,
    quotedAt: new Date('2026-10-03T09:30:00.000Z'),
    createdById: owner.id,
    notes: 'SEED:TEH-COSMETICS:ESS-MASCARA-01:6000000:2026-10-03',
  });

  // FX quote example (1.00 USD/unit) with explicit reference pair USD→IRR.
  await upsertSupplierOffer(prisma, {
    companyId,
    supplierId: tehran.id,
    skuId: mascara.id,
    supplierContactId: null,
    unitPrice: '1.00',
    currency: CurrencyCode.USD,
    purchaseType: PurchaseCommercialType.FX_CREDIT,
    paymentTermType: null,
    netDays: null,
    referenceFxRate: '2050000',
    referenceFxBaseCurrency: CurrencyCode.USD,
    referenceFxQuoteCurrency: CurrencyCode.IRR,
    quotedAt: new Date('2026-10-02T14:00:00.000Z'),
    createdById: owner.id,
    notes: 'SEED:TEH-BEAUTY:ESS-MASCARA-01:USD1:2026-10-02',
  });
}

async function seedSupplierOffersForSecondary(
  prisma: PrismaClient,
  companyId: string,
): Promise<void> {
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'pouria@hector.local' } });
  const supplier = await prisma.supplier.findFirstOrThrow({
    where: { companyId, code: 'DEMO-SUP-B' },
  });
  const sku = await prisma.sku.findFirstOrThrow({
    where: { companyId, code: 'MIR-SERUM-01' },
  });
  await upsertSupplierOffer(prisma, {
    companyId,
    supplierId: supplier.id,
    skuId: sku.id,
    supplierContactId: null,
    unitPrice: '1000000',
    currency: CurrencyCode.IRR,
    purchaseType: PurchaseCommercialType.CASH,
    paymentTermType: PaymentTermType.IMMEDIATE,
    netDays: null,
    quotedAt: new Date('2026-10-01T08:00:00.000Z'),
    createdById: owner.id,
    notes: 'SEED:DEMO-SUP-B:MIR-SERUM-01:1000000:2026-10-01',
  });
}

async function upsertSupplierOffer(
  prisma: PrismaClient,
  input: {
    companyId: string;
    supplierId: string;
    skuId: string;
    supplierContactId: string | null;
    unitPrice: string;
    currency: CurrencyCode;
    purchaseType: PurchaseCommercialType | null;
    paymentTermType: PaymentTermType | null;
    netDays: number | null;
    referenceFxRate?: string;
    referenceFxBaseCurrency?: CurrencyCode;
    referenceFxQuoteCurrency?: CurrencyCode;
    quotedAt: Date;
    createdById: string;
    notes: string;
  },
): Promise<void> {
  const existing = await prisma.supplierOffer.findFirst({
    where: { companyId: input.companyId, notes: input.notes },
  });
  const data = {
    supplierId: input.supplierId,
    skuId: input.skuId,
    supplierContactId: input.supplierContactId,
    unitPrice: new Prisma.Decimal(input.unitPrice),
    currency: input.currency,
    purchaseType: input.purchaseType,
    paymentTermType: input.paymentTermType,
    netDays: input.netDays,
    referenceFxRate: input.referenceFxRate
      ? new Prisma.Decimal(input.referenceFxRate)
      : null,
    referenceFxBaseCurrency: input.referenceFxBaseCurrency ?? null,
    referenceFxQuoteCurrency: input.referenceFxQuoteCurrency ?? null,
    quotedAt: input.quotedAt,
    notes: input.notes,
    createdById: input.createdById,
    archivedAt: null,
  };
  if (existing) {
    await prisma.supplierOffer.update({ where: { id: existing.id }, data });
    return;
  }
  await prisma.supplierOffer.create({
    data: {
      companyId: input.companyId,
      ...data,
    },
  });
}

async function upsertSupplier(
  prisma: PrismaClient,
  companyId: string,
  input: { name: string; code: string | null; phone?: string | null },
): Promise<{ id: string }> {
  const existing = input.code
    ? await prisma.supplier.findFirst({ where: { companyId, code: input.code } })
    : await prisma.supplier.findFirst({ where: { companyId, name: input.name, code: null } });

  if (existing) {
    return prisma.supplier.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        code: input.code,
        phone: input.phone ?? existing.phone,
        status: PurchasingLifecycleStatus.ACTIVE,
        archivedAt: null,
      },
      select: { id: true },
    });
  }

  return prisma.supplier.create({
    data: {
      companyId,
      name: input.name,
      code: input.code,
      phone: input.phone ?? null,
      status: PurchasingLifecycleStatus.ACTIVE,
    },
    select: { id: true },
  });
}

async function upsertSupplierContact(
  prisma: PrismaClient,
  companyId: string,
  supplierId: string,
  input: {
    name: string;
    role?: string | null;
    phone?: string | null;
    mobile?: string | null;
    isPrimary: boolean;
  },
): Promise<void> {
  const existing = await prisma.supplierContact.findFirst({
    where: { companyId, supplierId, name: input.name, archivedAt: null },
  });

  if (input.isPrimary) {
    await prisma.supplierContact.updateMany({
      where: { companyId, supplierId, isPrimary: true, archivedAt: null },
      data: { isPrimary: false },
    });
  }

  if (existing) {
    await prisma.supplierContact.update({
      where: { id: existing.id },
      data: {
        role: input.role ?? null,
        phone: input.phone ?? null,
        mobile: input.mobile ?? null,
        isPrimary: input.isPrimary,
      },
    });
    return;
  }

  await prisma.supplierContact.create({
    data: {
      companyId,
      supplierId,
      name: input.name,
      role: input.role ?? null,
      phone: input.phone ?? null,
      mobile: input.mobile ?? null,
      isPrimary: input.isPrimary,
    },
  });
}

async function upsertSupplierNote(
  prisma: PrismaClient,
  companyId: string,
  supplierId: string,
  createdById: string,
  body: string,
): Promise<void> {
  const existing = await prisma.supplierNote.findFirst({
    where: { companyId, supplierId, body },
  });
  if (existing) return;
  await prisma.supplierNote.create({
    data: { companyId, supplierId, body, createdById },
  });
}

async function upsertBrand(
  prisma: PrismaClient,
  companyId: string,
  name: string,
  code: string,
): Promise<{ id: string }> {
  const normalizedName = normalizeCatalogNameKey(name);
  const existing = await prisma.brand.findFirst({
    where: {
      companyId,
      OR: [{ code }, { normalizedName }],
    },
  });
  if (existing) {
    return prisma.brand.update({
      where: { id: existing.id },
      data: {
        name,
        normalizedName,
        code,
        status: CatalogLifecycleStatus.ACTIVE,
        archivedAt: null,
      },
      select: { id: true },
    });
  }
  return prisma.brand.create({
    data: {
      companyId,
      name,
      normalizedName,
      code,
      status: CatalogLifecycleStatus.ACTIVE,
    },
    select: { id: true },
  });
}

async function upsertCategory(
  prisma: PrismaClient,
  companyId: string,
  name: string,
  parentId: string | null,
  code?: string | null,
  sortOrder = 0,
): Promise<{ id: string }> {
  const normalizedName = normalizeCatalogNameKey(name);
  const existingBySibling = await prisma.category.findFirst({
    where: {
      companyId,
      parentId,
      normalizedName,
    },
  });
  const existingByCode = code
    ? await prisma.category.findFirst({ where: { companyId, code } })
    : null;
  const existing = existingByCode ?? existingBySibling;

  if (existing) {
    return prisma.category.update({
      where: { id: existing.id },
      data: {
        name,
        normalizedName,
        parentId,
        code: code ?? existing.code,
        sortOrder,
        status: CatalogLifecycleStatus.ACTIVE,
        archivedAt: null,
      },
      select: { id: true },
    });
  }
  return prisma.category.create({
    data: {
      companyId,
      name,
      normalizedName,
      parentId,
      code: code ?? null,
      sortOrder,
      status: CatalogLifecycleStatus.ACTIVE,
    },
    select: { id: true },
  });
}

async function upsertProduct(
  prisma: PrismaClient,
  companyId: string,
  input: {
    name: string;
    code: string;
    description: string | null;
    brandId: string | null;
    categoryId: string | null;
    alsoMatchCodes?: string[];
  },
): Promise<{ id: string }> {
  const normalizedName = normalizeCatalogNameKey(input.name);
  const normalizedCode = input.code.trim().toUpperCase();
  const matchCodes = [normalizedCode, ...(input.alsoMatchCodes ?? []).map((c) => c.toUpperCase())];

  const existing = await prisma.product.findFirst({
    where: {
      companyId,
      OR: [
        { normalizedCode: { in: matchCodes } },
        { code: { in: matchCodes } },
      ],
    },
  });
  if (existing) {
    return prisma.product.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        normalizedName,
        code: normalizedCode,
        normalizedCode,
        description: input.description,
        brandId: input.brandId,
        categoryId: input.categoryId,
        status: CatalogLifecycleStatus.ACTIVE,
        archivedAt: null,
      },
      select: { id: true },
    });
  }
  return prisma.product.create({
    data: {
      companyId,
      name: input.name,
      normalizedName,
      code: normalizedCode,
      normalizedCode,
      description: input.description,
      brandId: input.brandId,
      categoryId: input.categoryId,
      status: CatalogLifecycleStatus.ACTIVE,
    },
    select: { id: true },
  });
}

/** Mirrors apps/api buildVariantSignature (IDs only, order independent). */
function buildVariantSignature(pairs: Array<{ optionId: string; optionValueId: string }>): string {
  if (pairs.length === 0) return 'SIMPLE';
  return [...pairs]
    .sort((a, b) =>
      a.optionId === b.optionId
        ? a.optionValueId < b.optionValueId
          ? -1
          : a.optionValueId > b.optionValueId
            ? 1
            : 0
        : a.optionId < b.optionId
          ? -1
          : 1,
    )
    .map((p) => `${p.optionId}:${p.optionValueId}`)
    .join('|');
}

async function upsertVariantOption(
  prisma: PrismaClient,
  companyId: string,
  productId: string,
  name: string,
  position: number,
): Promise<{ id: string }> {
  const normalizedName = normalizeCatalogNameKey(name);
  const existing = await prisma.variantOption.findFirst({
    where: { productId, companyId, normalizedName },
  });
  if (existing) {
    return prisma.variantOption.update({
      where: { id: existing.id },
      data: { name, position },
      select: { id: true },
    });
  }
  return prisma.variantOption.create({
    data: { companyId, productId, name, normalizedName, position },
    select: { id: true },
  });
}

async function upsertVariantValue(
  prisma: PrismaClient,
  companyId: string,
  optionId: string,
  value: string,
  position: number,
): Promise<{ id: string }> {
  const normalizedValue = normalizeCatalogNameKey(value);
  const existing = await prisma.variantOptionValue.findFirst({
    where: { optionId, companyId, normalizedValue },
  });
  if (existing) {
    return prisma.variantOptionValue.update({
      where: { id: existing.id },
      data: { value, position, isActive: true },
      select: { id: true },
    });
  }
  return prisma.variantOptionValue.create({
    data: { companyId, optionId, value, normalizedValue, position, isActive: true },
    select: { id: true },
  });
}

/** One option, its values and one SKU per value. Returns SKUs by code. */
async function seedVariantProduct(
  prisma: PrismaClient,
  companyId: string,
  productId: string,
  input: {
    optionName: string;
    skus: Array<{ code: string; name: string; value: string }>;
  },
): Promise<Map<string, { id: string }>> {
  const option = await upsertVariantOption(prisma, companyId, productId, input.optionName, 0);
  const result = new Map<string, { id: string }>();
  let position = 0;
  for (const item of input.skus) {
    const value = await upsertVariantValue(prisma, companyId, option.id, item.value, position++);
    const sku = await upsertSku(prisma, companyId, productId, item.code, item.name, [
      { optionId: option.id, optionValueId: value.id },
    ]);
    result.set(item.code, sku);
  }
  return result;
}

async function upsertSku(
  prisma: PrismaClient,
  companyId: string,
  productId: string,
  code: string,
  name: string | null,
  pairs: Array<{ optionId: string; optionValueId: string }> = [],
): Promise<{ id: string }> {
  const normalizedCode = code.trim().toUpperCase();
  const variantSignature = buildVariantSignature(pairs);
  const existing = await prisma.sku.findFirst({
    where: { companyId, normalizedCode },
  });

  let sku: { id: string };
  if (existing) {
    sku = await prisma.sku.update({
      where: { id: existing.id },
      data: {
        productId,
        code: normalizedCode,
        normalizedCode,
        name,
        variantSignature,
        status: CatalogLifecycleStatus.ACTIVE,
        archivedAt: null,
      },
      select: { id: true },
    });
  } else {
    sku = await prisma.sku.create({
      data: {
        companyId,
        productId,
        code: normalizedCode,
        normalizedCode,
        name,
        variantSignature,
        status: CatalogLifecycleStatus.ACTIVE,
      },
      select: { id: true },
    });
  }

  // Sync option links to the desired selection.
  await prisma.skuOptionValue.deleteMany({
    where: {
      skuId: sku.id,
      companyId,
      NOT: pairs.length > 0 ? { optionValueId: { in: pairs.map((p) => p.optionValueId) } } : undefined,
    },
  });
  for (const pair of pairs) {
    const link = await prisma.skuOptionValue.findFirst({
      where: { skuId: sku.id, optionId: pair.optionId, companyId },
    });
    if (!link) {
      await prisma.skuOptionValue.create({
        data: {
          companyId,
          skuId: sku.id,
          optionId: pair.optionId,
          optionValueId: pair.optionValueId,
        },
      });
    }
  }
  return sku;
}

async function upsertBarcode(
  prisma: PrismaClient,
  companyId: string,
  skuId: string,
  input: { value: string; type: BarcodeType; isPrimary: boolean },
): Promise<void> {
  const value = input.value.trim();
  const normalizedValue =
    input.type === BarcodeType.EAN13 ||
    input.type === BarcodeType.EAN8 ||
    input.type === BarcodeType.UPC_A
      ? value.replace(/\s+/g, '')
      : input.type === BarcodeType.INTERNAL || input.type === BarcodeType.CODE128
        ? value.toUpperCase()
        : value;

  let existing = await prisma.barcode.findFirst({
    where: { companyId, normalizedValue },
  });

  // Seed migration: refresh the single active INTERNAL on this SKU when value changed.
  if (!existing && input.type === BarcodeType.INTERNAL) {
    existing = await prisma.barcode.findFirst({
      where: { companyId, skuId, type: BarcodeType.INTERNAL, archivedAt: null },
    });
  }

  // Seed migration: refresh primary OTHER/legacy rows previously stored as INTERNAL.
  if (!existing && input.isPrimary) {
    existing = await prisma.barcode.findFirst({
      where: { companyId, skuId, isPrimary: true, archivedAt: null },
    });
  }

  if (existing) {
    if (input.isPrimary) {
      await prisma.barcode.updateMany({
        where: { skuId, companyId, isPrimary: true, id: { not: existing.id }, archivedAt: null },
        data: { isPrimary: false },
      });
    }
    await prisma.barcode.update({
      where: { id: existing.id },
      data: {
        skuId,
        value,
        normalizedValue,
        type: input.type,
        isPrimary: input.isPrimary,
        archivedAt: null,
      },
    });
    return;
  }

  if (input.isPrimary) {
    await prisma.barcode.updateMany({
      where: { skuId, companyId, isPrimary: true, archivedAt: null },
      data: { isPrimary: false },
    });
  }

  await prisma.barcode.create({
    data: {
      companyId,
      skuId,
      value,
      normalizedValue,
      type: input.type,
      isPrimary: input.isPrimary,
    },
  });
}

function normalizeAttributeCode(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

async function upsertAttributeDefinition(
  prisma: PrismaClient,
  companyId: string,
  input: {
    name: string;
    code: string;
    type: AttributeType;
    scope: AttributeScope;
    unit?: string | null;
    description?: string | null;
  },
): Promise<{ id: string; type: AttributeType }> {
  const normalizedCode = normalizeAttributeCode(input.code);
  const normalizedName = normalizeCatalogNameKey(input.name);
  const existing = await prisma.attributeDefinition.findFirst({
    where: { companyId, normalizedCode },
  });
  if (existing) {
    const updated = await prisma.attributeDefinition.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        normalizedName,
        code: normalizedCode,
        normalizedCode,
        unit: input.unit ?? null,
        description: input.description ?? null,
        status: CatalogLifecycleStatus.ACTIVE,
        archivedAt: null,
      },
      select: { id: true, type: true },
    });
    return updated;
  }
  const created = await prisma.attributeDefinition.create({
    data: {
      companyId,
      name: input.name,
      normalizedName,
      code: normalizedCode,
      normalizedCode,
      type: input.type,
      scope: input.scope,
      unit: input.unit ?? null,
      description: input.description ?? null,
      status: CatalogLifecycleStatus.ACTIVE,
    },
    select: { id: true, type: true },
  });
  return created;
}

async function upsertAttributeOption(
  prisma: PrismaClient,
  companyId: string,
  attributeDefinitionId: string,
  value: string,
  position: number,
): Promise<{ id: string }> {
  const normalizedValue = normalizeCatalogNameKey(value);
  const existing = await prisma.attributeOption.findFirst({
    where: { attributeDefinitionId, normalizedValue },
  });
  if (existing) {
    return prisma.attributeOption.update({
      where: { id: existing.id },
      data: { value, position, isActive: true },
      select: { id: true },
    });
  }
  return prisma.attributeOption.create({
    data: {
      companyId,
      attributeDefinitionId,
      value,
      normalizedValue,
      position,
      isActive: true,
    },
    select: { id: true },
  });
}

async function syncCategoryAttributeAssignments(
  prisma: PrismaClient,
  companyId: string,
  categoryId: string,
  attributeDefinitionIds: string[],
): Promise<void> {
  await prisma.categoryAttribute.deleteMany({
    where: {
      companyId,
      categoryId,
      attributeDefinitionId: { notIn: attributeDefinitionIds },
    },
  });
  let position = 0;
  for (const attributeDefinitionId of attributeDefinitionIds) {
    const existing = await prisma.categoryAttribute.findFirst({
      where: { categoryId, attributeDefinitionId },
    });
    if (existing) {
      await prisma.categoryAttribute.update({
        where: { id: existing.id },
        data: { position, isVisible: true },
      });
    } else {
      await prisma.categoryAttribute.create({
        data: {
          companyId,
          categoryId,
          attributeDefinitionId,
          position,
          isVisible: true,
        },
      });
    }
    position += 1;
  }
}

async function upsertProductNumberAttribute(
  prisma: PrismaClient,
  companyId: string,
  productId: string,
  attributeDefinitionId: string,
  numberValue: number,
): Promise<void> {
  const valueRow = await prisma.productAttributeValue.upsert({
    where: {
      productId_attributeDefinitionId: { productId, attributeDefinitionId },
    },
    create: {
      companyId,
      productId,
      attributeDefinitionId,
      numberValue: new Prisma.Decimal(numberValue),
    },
    update: { numberValue: new Prisma.Decimal(numberValue), textValue: null, booleanValue: null },
  });
  await prisma.productAttributeSelection.deleteMany({
    where: { productAttributeValueId: valueRow.id },
  });
}

async function upsertProductBooleanAttribute(
  prisma: PrismaClient,
  companyId: string,
  productId: string,
  attributeDefinitionId: string,
  booleanValue: boolean,
): Promise<void> {
  const valueRow = await prisma.productAttributeValue.upsert({
    where: {
      productId_attributeDefinitionId: { productId, attributeDefinitionId },
    },
    create: {
      companyId,
      productId,
      attributeDefinitionId,
      booleanValue,
    },
    update: { booleanValue, textValue: null, numberValue: null },
  });
  await prisma.productAttributeSelection.deleteMany({
    where: { productAttributeValueId: valueRow.id },
  });
}

async function upsertProductTextAttribute(
  prisma: PrismaClient,
  companyId: string,
  productId: string,
  attributeDefinitionId: string,
  textValue: string,
): Promise<void> {
  const valueRow = await prisma.productAttributeValue.upsert({
    where: {
      productId_attributeDefinitionId: { productId, attributeDefinitionId },
    },
    create: {
      companyId,
      productId,
      attributeDefinitionId,
      textValue,
    },
    update: { textValue, numberValue: null, booleanValue: null },
  });
  await prisma.productAttributeSelection.deleteMany({
    where: { productAttributeValueId: valueRow.id },
  });
}

async function upsertProductSelectAttribute(
  prisma: PrismaClient,
  companyId: string,
  productId: string,
  attributeDefinitionId: string,
  optionIds: string[],
): Promise<void> {
  const valueRow = await prisma.productAttributeValue.upsert({
    where: {
      productId_attributeDefinitionId: { productId, attributeDefinitionId },
    },
    create: {
      companyId,
      productId,
      attributeDefinitionId,
    },
    update: { textValue: null, numberValue: null, booleanValue: null },
  });
  await prisma.productAttributeSelection.deleteMany({
    where: { productAttributeValueId: valueRow.id },
  });
  for (const attributeOptionId of optionIds) {
    await prisma.productAttributeSelection.create({
      data: {
        companyId,
        productAttributeValueId: valueRow.id,
        attributeOptionId,
      },
    });
  }
}

async function upsertSkuTextAttribute(
  prisma: PrismaClient,
  companyId: string,
  skuId: string,
  attributeDefinitionId: string,
  textValue: string,
): Promise<void> {
  await prisma.skuAttributeValue.upsert({
    where: {
      skuId_attributeDefinitionId: { skuId, attributeDefinitionId },
    },
    create: {
      companyId,
      skuId,
      attributeDefinitionId,
      textValue,
    },
    update: { textValue, numberValue: null, booleanValue: null },
  });
}

async function seedProductAttributesForPishteh(
  prisma: PrismaClient,
  companyId: string,
  refs: {
    sunscreenCategoryId: string;
    mascaraCategoryId: string;
    sunscreenProductId: string;
    mascaraProductId: string;
    primerProductId: string;
    shadeHexSkuId: string;
  },
): Promise<void> {
  const spf = await upsertAttributeDefinition(prisma, companyId, {
    name: 'SPF',
    code: 'spf',
    type: AttributeType.NUMBER,
    scope: AttributeScope.PRODUCT,
    unit: null,
  });
  const skinType = await upsertAttributeDefinition(prisma, companyId, {
    name: 'نوع پوست',
    code: 'skin_type',
    type: AttributeType.MULTI_SELECT,
    scope: AttributeScope.PRODUCT,
  });
  const skinTypeOptions = await Promise.all(
    ['چرب', 'مختلط', 'حساس', 'مستعد آکنه', 'خشک', 'نرمال'].map((value, position) =>
      upsertAttributeOption(prisma, companyId, skinType.id, value, position),
    ),
  );
  const oilFree = await upsertAttributeDefinition(prisma, companyId, {
    name: 'فاقد چربی',
    code: 'oil_free',
    type: AttributeType.BOOLEAN,
    scope: AttributeScope.PRODUCT,
  });
  const finish = await upsertAttributeDefinition(prisma, companyId, {
    name: 'فینیش',
    code: 'finish',
    type: AttributeType.SINGLE_SELECT,
    scope: AttributeScope.PRODUCT,
  });
  const finishOptions = await Promise.all(
    ['مات', 'طبیعی', 'براق', 'ساتن'].map((value, position) =>
      upsertAttributeOption(prisma, companyId, finish.id, value, position),
    ),
  );
  const volume = await upsertAttributeDefinition(prisma, companyId, {
    name: 'حجم',
    code: 'volume',
    type: AttributeType.NUMBER,
    scope: AttributeScope.PRODUCT,
    unit: 'ml',
  });
  const waterproof = await upsertAttributeDefinition(prisma, companyId, {
    name: 'ضد آب',
    code: 'waterproof',
    type: AttributeType.BOOLEAN,
    scope: AttributeScope.PRODUCT,
  });
  const countryOfManufacture = await upsertAttributeDefinition(prisma, companyId, {
    name: 'کشور سازنده',
    code: 'country_of_manufacture',
    type: AttributeType.TEXT,
    scope: AttributeScope.PRODUCT,
  });
  const countryOfOrigin = await upsertAttributeDefinition(prisma, companyId, {
    name: 'کشور مبدا',
    code: 'country_of_origin',
    type: AttributeType.TEXT,
    scope: AttributeScope.PRODUCT,
  });
  const shadeHex = await upsertAttributeDefinition(prisma, companyId, {
    name: 'Shade hex',
    code: 'shade_hex',
    type: AttributeType.TEXT,
    scope: AttributeScope.SKU,
  });

  await syncCategoryAttributeAssignments(prisma, companyId, refs.sunscreenCategoryId, [
    spf.id,
    skinType.id,
    oilFree.id,
    finish.id,
    volume.id,
  ]);
  await syncCategoryAttributeAssignments(prisma, companyId, refs.mascaraCategoryId, [
    volume.id,
    waterproof.id,
    countryOfManufacture.id,
  ]);

  const oilyOption = skinTypeOptions[0]!;
  const dryOption = skinTypeOptions[4]!;
  const naturalFinish = finishOptions[1]!;

  await upsertProductNumberAttribute(prisma, companyId, refs.sunscreenProductId, spf.id, 50);
  await upsertProductSelectAttribute(prisma, companyId, refs.sunscreenProductId, skinType.id, [
    oilyOption.id,
    dryOption.id,
  ]);
  await upsertProductBooleanAttribute(prisma, companyId, refs.sunscreenProductId, oilFree.id, true);
  await upsertProductSelectAttribute(prisma, companyId, refs.sunscreenProductId, finish.id, [
    naturalFinish.id,
  ]);
  await upsertProductNumberAttribute(prisma, companyId, refs.sunscreenProductId, volume.id, 50);

  await upsertProductNumberAttribute(prisma, companyId, refs.mascaraProductId, volume.id, 12);
  await upsertProductBooleanAttribute(
    prisma,
    companyId,
    refs.mascaraProductId,
    waterproof.id,
    true,
  );
  await upsertProductTextAttribute(
    prisma,
    companyId,
    refs.mascaraProductId,
    countryOfManufacture.id,
    'آلمان',
  );

  // Primer intentionally has zero product attribute rows (development sample).
  void refs.primerProductId;

  await upsertSkuTextAttribute(prisma, companyId, refs.shadeHexSkuId, shadeHex.id, '#C41E3A');

  void countryOfOrigin;
}

/** GTIN check digit for seed EAN/UPC samples (must be valid checksums). */
function withGtinCheckDigit(bodyWithoutCheck: string): string {
  let sum = 0;
  for (let i = 0; i < bodyWithoutCheck.length; i++) {
    const digit = Number(bodyWithoutCheck[bodyWithoutCheck.length - 1 - i]);
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  const check = (10 - (sum % 10)) % 10;
  return `${bodyWithoutCheck}${check}`;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
