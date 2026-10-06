import { Injectable } from '@nestjs/common';
import {
  GoodsReceiptStatus,
  InventoryReservationStatus,
  Prisma,
  PutawayStatus,
  PurchaseReturnStatus,
  StockClassification,
  StockCountStatus,
  StockIssueStatus,
  StockTransferStatus,
  SupplierReturnExecutionStatus,
} from '@hector/database';
import { PERMISSIONS } from '@hector/database';
import { DatabaseService } from '../../infrastructure/database/database.service';
import type { CompanyContext } from '../companies/types/company.types';
import { AuthorizationService } from '../rbac/authorization.service';
import { InventoryValuationService } from './inventory-valuation.service';

export type WarehouseDashboardQuery = {
  warehouseId?: string;
};

/**
 * Operational warehouse dashboard aggregates (Phase 3.16–3.17).
 * Read model only — StockBalance / Reservations / operational docs remain truth.
 * Bounded DB aggregation — not intelligence/forecasting.
 */
@Injectable()
export class WarehouseDashboardService {
  constructor(
    private readonly database: DatabaseService,
    private readonly valuation: InventoryValuationService,
    private readonly authorization: AuthorizationService,
  ) {}

  async getSummary(company: CompanyContext, query: WarehouseDashboardQuery = {}) {
    const companyId = company.companyId;
    const warehouseId = query.warehouseId;

    const balanceWhere: Prisma.InventoryBalanceWhereInput = {
      companyId,
      onHandQuantity: { gt: 0 },
      ...(warehouseId ? { warehouseId } : {}),
    };
    const reservationWhere: Prisma.InventoryReservationWhereInput = {
      companyId,
      status: InventoryReservationStatus.ACTIVE,
      ...(warehouseId ? { warehouseId } : {}),
    };

    const [
      skuWithStock,
      unitsByClass,
      unitsByWarehouseClass,
      reservedAgg,
      reservedByWarehouse,
      pendingReceipts,
      draftPutaways,
      openTransfers,
      openCounts,
      countsAwaitingApproval,
      draftIssues,
      draftSupplierReturnExecutions,
      approvedReturns,
      recentMovements,
      recentReceipts,
      recentTransfers,
      discrepancyItems,
      warehouses,
    ] = await Promise.all([
      this.database.client.inventoryBalance.groupBy({
        by: ['skuId'],
        where: balanceWhere,
      }),
      this.database.client.inventoryBalance.groupBy({
        by: ['classification'],
        where: balanceWhere,
        _sum: { onHandQuantity: true },
      }),
      this.database.client.inventoryBalance.groupBy({
        by: ['warehouseId', 'classification'],
        where: balanceWhere,
        _sum: { onHandQuantity: true },
      }),
      this.database.client.inventoryReservation.aggregate({
        where: reservationWhere,
        _sum: { remainingQuantity: true },
      }),
      this.database.client.inventoryReservation.groupBy({
        by: ['warehouseId'],
        where: reservationWhere,
        _sum: { remainingQuantity: true },
      }),
      this.database.client.goodsReceipt.count({
        where: {
          companyId,
          status: GoodsReceiptStatus.DRAFT,
          ...(warehouseId ? { warehouseId } : {}),
        },
      }),
      this.database.client.putaway.count({
        where: {
          companyId,
          status: PutawayStatus.DRAFT,
          ...(warehouseId ? { warehouseId } : {}),
        },
      }),
      this.database.client.stockTransfer.count({
        where: {
          companyId,
          status: {
            in: [StockTransferStatus.DRAFT, StockTransferStatus.IN_TRANSIT],
          },
          ...(warehouseId
            ? {
                OR: [
                  { sourceWarehouseId: warehouseId },
                  { destinationWarehouseId: warehouseId },
                ],
              }
            : {}),
        },
      }),
      this.database.client.stockCount.count({
        where: {
          companyId,
          status: {
            in: [
              StockCountStatus.DRAFT,
              StockCountStatus.IN_PROGRESS,
              StockCountStatus.SUBMITTED,
            ],
          },
          ...(warehouseId ? { warehouseId } : {}),
        },
      }),
      this.database.client.stockCount.count({
        where: {
          companyId,
          status: StockCountStatus.SUBMITTED,
          ...(warehouseId ? { warehouseId } : {}),
        },
      }),
      this.database.client.stockIssue.count({
        where: {
          companyId,
          status: StockIssueStatus.DRAFT,
          ...(warehouseId ? { warehouseId } : {}),
        },
      }),
      this.database.client.supplierReturnExecution.count({
        where: {
          companyId,
          status: SupplierReturnExecutionStatus.DRAFT,
          ...(warehouseId ? { warehouseId } : {}),
        },
      }),
      this.database.client.purchaseReturn.findMany({
        where: { companyId, status: PurchaseReturnStatus.APPROVED },
        select: {
          id: true,
          items: { select: { quantity: true } },
          executions: {
            where: { status: SupplierReturnExecutionStatus.DISPATCHED },
            select: {
              items: { select: { quantity: true } },
            },
          },
        },
        take: 500,
      }),
      this.database.client.inventoryMovement.findMany({
        where: {
          companyId,
          ...(warehouseId ? { warehouseId } : {}),
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: 8,
        select: {
          id: true,
          movementType: true,
          quantityDelta: true,
          occurredAt: true,
          sourceType: true,
          sourceId: true,
          sku: { select: { code: true } },
          warehouse: { select: { code: true } },
          classification: true,
          createdBy: {
            select: { firstName: true, lastName: true, email: true },
          },
        },
      }),
      this.database.client.goodsReceipt.findMany({
        where: {
          companyId,
          ...(warehouseId ? { warehouseId } : {}),
        },
        orderBy: [{ createdAt: 'desc' }],
        take: 5,
        select: {
          id: true,
          number: true,
          status: true,
          createdAt: true,
          postedAt: true,
          receivedAt: true,
          warehouse: { select: { code: true } },
          supplier: { select: { name: true, code: true } },
          purchaseOrder: { select: { number: true } },
          createdBy: {
            select: { firstName: true, lastName: true, email: true },
          },
          items: { select: { quantity: true } },
        },
      }),
      this.database.client.stockTransfer.findMany({
        where: {
          companyId,
          ...(warehouseId
            ? {
                OR: [
                  { sourceWarehouseId: warehouseId },
                  { destinationWarehouseId: warehouseId },
                ],
              }
            : {}),
        },
        orderBy: [{ updatedAt: 'desc' }],
        take: 5,
        select: {
          id: true,
          number: true,
          status: true,
          createdAt: true,
          completedAt: true,
          sourceWarehouse: { select: { code: true } },
          destinationWarehouse: { select: { code: true } },
          items: { select: { quantity: true } },
        },
      }),
      this.database.client.stockCountItem.findMany({
        where: {
          companyId,
          countedQuantity: { not: null },
          stockCount: {
            status: StockCountStatus.SUBMITTED,
            ...(warehouseId ? { warehouseId } : {}),
          },
        },
        orderBy: [{ updatedAt: 'desc' }],
        take: 25,
        select: {
          id: true,
          snapshotQuantity: true,
          countedQuantity: true,
          difference: true,
          classification: true,
          sku: { select: { code: true } },
          location: { select: { code: true } },
          stockCount: {
            select: { id: true, number: true, warehouseId: true },
          },
        },
      }),
      this.database.client.warehouse.findMany({
        where: {
          companyId,
          isSystem: false,
          ...(warehouseId ? { id: warehouseId } : {}),
        },
        select: { id: true, code: true, name: true, status: true },
        orderBy: { code: 'asc' },
        take: 50,
      }),
    ]);

    const classMap = new Map(
      unitsByClass.map((r) => [r.classification, r._sum.onHandQuantity ?? 0]),
    );
    const sellable = classMap.get(StockClassification.SELLABLE) ?? 0;
    const tester = classMap.get(StockClassification.TESTER) ?? 0;
    const damaged = classMap.get(StockClassification.DAMAGED) ?? 0;
    const quarantine = classMap.get(StockClassification.QUARANTINE) ?? 0;
    const totalUnits = sellable + tester + damaged + quarantine;
    const reserved = reservedAgg._sum.remainingQuantity ?? 0;
    const available = Math.max(0, sellable - reserved);

    const reservedByWh = new Map(
      reservedByWarehouse.map((r) => [r.warehouseId, r._sum.remainingQuantity ?? 0]),
    );

    const warehouseClassMap = new Map<string, Map<StockClassification, number>>();
    for (const row of unitsByWarehouseClass) {
      const map = warehouseClassMap.get(row.warehouseId) ?? new Map();
      map.set(row.classification, row._sum.onHandQuantity ?? 0);
      warehouseClassMap.set(row.warehouseId, map);
    }

    const warehouseSummary = warehouses.map((wh) => {
      const classes = warehouseClassMap.get(wh.id) ?? new Map();
      const whSellable = classes.get(StockClassification.SELLABLE) ?? 0;
      const whTester = classes.get(StockClassification.TESTER) ?? 0;
      const whDamaged = classes.get(StockClassification.DAMAGED) ?? 0;
      const whQuarantine = classes.get(StockClassification.QUARANTINE) ?? 0;
      const whReserved = reservedByWh.get(wh.id) ?? 0;
      return {
        warehouseId: wh.id,
        warehouseCode: wh.code,
        warehouseName: wh.name,
        warehouseStatus: wh.status,
        totalUnits: whSellable + whTester + whDamaged + whQuarantine,
        sellableUnits: whSellable,
        reservedUnits: whReserved,
        availableUnits: Math.max(0, whSellable - whReserved),
        testerUnits: whTester,
        damagedUnits: whDamaged,
        quarantineUnits: whQuarantine,
      };
    });

    let pendingSupplierReturnsOpen = 0;
    for (const ret of approvedReturns) {
      const approved = ret.items.reduce((s, i) => s + i.quantity, 0);
      const dispatched = ret.executions.reduce(
        (s, ex) => s + ex.items.reduce((t, i) => t + i.quantity, 0),
        0,
      );
      if (dispatched < approved) pendingSupplierReturnsOpen += 1;
    }

    const actorName = (actor: {
      firstName: string | null;
      lastName: string | null;
      email: string;
    } | null) => {
      if (!actor) return null;
      const name = [actor.firstName, actor.lastName].filter(Boolean).join(' ').trim();
      return name || actor.email;
    };

    const stockDiscrepancies = discrepancyItems
      .map((d) => {
        const counted = d.countedQuantity ?? 0;
        const liveDiff = d.difference ?? counted - d.snapshotQuantity;
        return {
          stockCountItemId: d.id,
          stockCountId: d.stockCount.id,
          stockCountNumber: d.stockCount.number,
          skuCode: d.sku.code,
          locationCode: d.location.code,
          classification: d.classification,
          systemQuantity: d.snapshotQuantity,
          countedQuantity: counted,
          difference: liveDiff,
        };
      })
      .filter((d) => d.difference !== 0)
      .slice(0, 10);

    const summary = {
      skusWithStock: skuWithStock.length,
      totalUnits,
      sellableUnits: sellable,
      reservedUnits: reserved,
      availableUnits: available,
      testerUnits: tester,
      damagedUnits: damaged,
      quarantineUnits: quarantine,
    };

    const operations = {
      pendingReceipts,
      pendingPutaways: draftPutaways,
      openTransfers,
      openStockCounts: openCounts,
      countsAwaitingApproval,
      draftIssues,
      pendingSupplierReturnExecutions: draftSupplierReturnExecutions,
      pendingSupplierReturnsOpen,
    };

    const recentActivity = {
      recentMovements: recentMovements.map((m) => ({
        id: m.id,
        movementType: m.movementType,
        quantityDelta: m.quantityDelta,
        occurredAt: m.occurredAt.toISOString(),
        skuCode: m.sku.code,
        warehouseCode: m.warehouse.code,
        classification: m.classification,
        sourceType: m.sourceType,
        sourceId: m.sourceId,
        actorName: actorName(m.createdBy),
      })),
      recentReceipts: recentReceipts.map((r) => ({
        id: r.id,
        number: r.number,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        postedAt: r.postedAt?.toISOString() ?? null,
        receivedAt: r.receivedAt?.toISOString() ?? null,
        warehouseCode: r.warehouse.code,
        supplierName: r.supplier.name,
        supplierCode: r.supplier.code,
        purchaseOrderNumber: r.purchaseOrder.number,
        receivedQuantity: r.items.reduce((s, i) => s + i.quantity, 0),
        actorName: actorName(r.createdBy),
      })),
      recentTransfers: recentTransfers.map((t) => ({
        id: t.id,
        number: t.number,
        status: t.status,
        createdAt: t.createdAt.toISOString(),
        completedAt: t.completedAt?.toISOString() ?? null,
        sourceWarehouseCode: t.sourceWarehouse.code,
        destinationWarehouseCode: t.destinationWarehouse.code,
        quantity: t.items.reduce((s, i) => s + i.quantity, 0),
      })),
    };

    let valuation: Awaited<ReturnType<InventoryValuationService['summary']>> | null = null;
    const allowed = await this.authorization.hasAllPermissions(company.companyMemberId, [
      PERMISSIONS.WAREHOUSE_VALUATION_READ,
    ]);
    if (allowed) {
      valuation = await this.valuation.summary(company);
    }

    return {
      // Flat fields retained for Phase 3.16 clients.
      ...summary,
      ...operations,
      pendingSupplierReturns: draftSupplierReturnExecutions,
      recentMovements: recentActivity.recentMovements,
      recentReceipts: recentActivity.recentReceipts,
      // Phase 3.17 structured sections.
      summary,
      classificationSummary: {
        sellableUnits: sellable,
        testerUnits: tester,
        damagedUnits: damaged,
        quarantineUnits: quarantine,
      },
      warehouseSummary,
      operations: {
        ...operations,
        pendingSupplierReturns: draftSupplierReturnExecutions,
      },
      recentActivity,
      stockDiscrepancies,
      valuation,
      definitions: {
        skusWithStock: 'COUNT DISTINCT skuId WHERE onHandQuantity > 0',
        totalUnits: 'SUM onHandQuantity across StockBalance positions with onHandQuantity > 0',
        reservedUnits: 'SUM ACTIVE InventoryReservation.remainingQuantity',
        availableUnits: 'max(0, sellableUnits - reservedUnits)',
      },
    };
  }
}
