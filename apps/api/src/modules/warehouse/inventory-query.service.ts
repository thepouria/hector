import { Injectable } from '@nestjs/common';
import {
  CatalogLifecycleStatus,
  InventoryReservationStatus,
  Prisma,
  StockClassification,
  WarehouseLocationType,
  WarehouseStatus,
} from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import {
  buildPaginationMeta,
  type PaginationMeta,
} from '../../common/dto/pagination-query.dto';
import { AppError } from '../../common/exceptions/app.error';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { normalizeScannedValue } from '../catalog/barcode-normalize.util';
import { BarcodesService } from '../catalog/barcodes.service';
import type { CompanyContext } from '../companies/types/company.types';
import {
  INVENTORY_ERROR_MESSAGES,
  INVENTORY_SEARCH_MAX_LENGTH,
} from './inventory-ledger.constants';
import type { ListInventoryBalancesQueryDto } from './dto/inventory.dto';
import type {
  InventoryBalanceView,
  InventoryBatchSummaryView,
  InventoryLocationSummaryView,
  InventoryLookupView,
  InventorySkuSummaryView,
  InventoryWarehouseSummaryView,
  QuantityBucket,
} from './types/inventory.types';

/**
 * Read model for current On Hand (Phase 3.10).
 * Reads InventoryBalance projection — never mutates stock.
 * Ledger posting remains in InventoryLedgerService.
 */
@Injectable()
export class InventoryQueryService {
  constructor(
    private readonly database: DatabaseService,
    private readonly barcodesService: BarcodesService,
  ) {}

  async listBalances(
    company: CompanyContext,
    query: ListInventoryBalancesQueryDto,
  ): Promise<{ data: InventoryBalanceView[]; meta: PaginationMeta }> {
    const search = normalizeSearch(query.q);
    // Default: hide zeros. includeZero=true or onlyPositive=false shows all.
    const hideZero =
      query.includeZero === true ? false : query.onlyPositive === false ? false : true;

    const where: Prisma.InventoryBalanceWhereInput = {
      companyId: company.companyId,
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(query.skuId ? { skuId: query.skuId } : {}),
      ...(query.batchId ? { batchId: query.batchId } : {}),
      ...(query.classification ? { classification: query.classification } : {}),
      ...(query.productId ? { sku: { productId: query.productId } } : {}),
      ...(query.brandId ? { sku: { product: { brandId: query.brandId } } } : {}),
      ...(query.categoryId
        ? { sku: { product: { categoryId: query.categoryId } } }
        : {}),
      ...(query.includeTransit === true
        ? {}
        : { location: { type: { not: WarehouseLocationType.TRANSIT } } }),
      ...(hideZero ? { onHandQuantity: { gt: 0 } } : {}),
      ...(search
        ? {
            OR: [
              { sku: { code: { contains: search, mode: 'insensitive' } } },
              { sku: { product: { name: { contains: search, mode: 'insensitive' } } } },
              { sku: { product: { code: { contains: search, mode: 'insensitive' } } } },
              { batch: { batchNumber: { contains: search, mode: 'insensitive' } } },
              { warehouse: { code: { contains: search, mode: 'insensitive' } } },
              { location: { code: { contains: search, mode: 'insensitive' } } },
              { location: { barcode: { contains: search, mode: 'insensitive' } } },
              {
                sku: {
                  barcodes: {
                    some: {
                      companyId: company.companyId,
                      OR: [
                        { value: { contains: search, mode: 'insensitive' } },
                        { normalizedValue: { contains: search, mode: 'insensitive' } },
                      ],
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.database.client.inventoryBalance.count({ where }),
      this.database.client.inventoryBalance.findMany({
        where,
        include: balanceInclude,
        orderBy: [
          { sku: { code: 'asc' } },
          { batch: { batchNumber: 'asc' } },
          { warehouse: { code: 'asc' } },
          { location: { code: 'asc' } },
        ],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      data: rows.map(toBalanceView),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async getSkuSummary(
    company: CompanyContext,
    skuId: string,
  ): Promise<InventorySkuSummaryView> {
    const sku = await this.database.client.sku.findFirst({
      where: { id: skuId, companyId: company.companyId },
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        archivedAt: true,
        product: { select: { id: true, name: true, code: true } },
      },
    });
    if (!sku) {
      throw new AppError({
        code: ERROR_CODES.SKU_NOT_FOUND,
        message: 'SKU was not found.',
        statusCode: 404,
      });
    }

    const balances = await this.database.client.inventoryBalance.findMany({
      where: { companyId: company.companyId, skuId },
      include: {
        warehouse: {
          select: { id: true, code: true, name: true, status: true, isSystem: true },
        },
        location: {
          select: {
            id: true,
            code: true,
            name: true,
            barcode: true,
            status: true,
            type: true,
          },
        },
        batch: {
          select: {
            id: true,
            batchNumber: true,
            supplierBatchNumber: true,
            expiresAt: true,
          },
        },
      },
      orderBy: [
        { warehouse: { code: 'asc' } },
        { batch: { batchNumber: 'asc' } },
        { location: { code: 'asc' } },
      ],
    });

    const totalOnHand = sumOnHand(balances);
    const transitBalances = balances.filter(
      (b) => b.location.type === WarehouseLocationType.TRANSIT,
    );
    const storageBalances = balances.filter(
      (b) => b.location.type !== WarehouseLocationType.TRANSIT,
    );
    const inTransitOnHand = sumOnHand(transitBalances);
    const storageOnHand = sumOnHand(storageBalances);
    const byWarehouse = aggregateBuckets(
      storageBalances,
      (b) => b.warehouseId,
      (b) => ({
        id: b.warehouseId,
        code: b.warehouse.code,
        name: b.warehouse.name,
        status: b.warehouse.status,
      }),
    );
    const byBatch = aggregateBuckets(
      storageBalances,
      (b) => b.batchId,
      (b) => ({
        id: b.batchId,
        code: b.batch.batchNumber,
        name: b.batch.supplierBatchNumber,
        expiresAt: b.batch.expiresAt
          ? b.batch.expiresAt.toISOString().slice(0, 10)
          : null,
      }),
    );
    const byLocation = aggregateBuckets(
      storageBalances,
      (b) => b.locationId,
      (b) => ({
        id: b.locationId,
        code: b.location.code,
        name: b.location.name,
        barcode: b.location.barcode,
        warehouseId: b.warehouseId,
        warehouseCode: b.warehouse.code,
        status: b.location.status,
      }),
    );

    const hierarchy = buildSkuHierarchyFromSummary(storageBalances);
    const classificationTotals = sumByClassification(balances);

    // Phase 3.16: Reserved / Available (SELLABLE) — authoritative from reservations.
    const reservations = await this.database.client.inventoryReservation.groupBy({
      by: ['warehouseId'],
      where: {
        companyId: company.companyId,
        skuId,
        status: InventoryReservationStatus.ACTIVE,
      },
      _sum: { remainingQuantity: true },
    });
    const reservedByWarehouse = new Map(
      reservations.map((r) => [r.warehouseId, r._sum.remainingQuantity ?? 0]),
    );
    const sellableByWarehouse = new Map<string, number>();
    for (const b of balances) {
      if (b.classification !== StockClassification.SELLABLE || b.warehouse.isSystem) continue;
      sellableByWarehouse.set(
        b.warehouseId,
        (sellableByWarehouse.get(b.warehouseId) ?? 0) + b.onHandQuantity,
      );
    }
    let reservedTotal = 0;
    let availableTotal = 0;
    const warehouseIds = new Set([
      ...sellableByWarehouse.keys(),
      ...reservedByWarehouse.keys(),
    ]);
    for (const warehouseId of warehouseIds) {
      const onHand = sellableByWarehouse.get(warehouseId) ?? 0;
      const reserved = reservedByWarehouse.get(warehouseId) ?? 0;
      reservedTotal += reserved;
      availableTotal += Math.max(0, onHand - reserved);
    }

    return {
      skuId: sku.id,
      skuCode: sku.code,
      skuName: sku.name,
      skuStatus: sku.status,
      productId: sku.product.id,
      productName: sku.product.name,
      productCode: sku.product.code,
      totalOnHand,
      storageOnHand,
      inTransitOnHand,
      sellableOnHand: classificationTotals.sellableOnHand,
      reservedQuantity: reservedTotal,
      availableQuantity: availableTotal,
      testerOnHand: classificationTotals.testerOnHand,
      damagedOnHand: classificationTotals.damagedOnHand,
      quarantineOnHand: classificationTotals.quarantineOnHand,
      byWarehouse,
      byBatch,
      byLocation,
      hierarchy,
      positions: balances.map((b) => ({
        warehouseId: b.warehouseId,
        warehouseCode: b.warehouse.code,
        warehouseName: b.warehouse.name,
        warehouseStatus: b.warehouse.status,
        locationId: b.locationId,
        locationCode: b.location.code,
        locationName: b.location.name,
        locationBarcode: b.location.barcode,
        locationStatus: b.location.status,
        batchId: b.batchId,
        batchNumber: b.batch.batchNumber,
        classification: b.classification,
        onHandQuantity: b.onHandQuantity,
      })),
    };
  }

  async getWarehouseSummary(
    company: CompanyContext,
    warehouseId: string,
    query: { includeZero?: boolean; page?: number; pageSize?: number },
  ): Promise<InventoryWarehouseSummaryView> {
    const warehouse = await this.database.client.warehouse.findFirst({
      where: { id: warehouseId, companyId: company.companyId },
      select: { id: true, code: true, name: true, status: true },
    });
    if (!warehouse) {
      throw new AppError({
        code: ERROR_CODES.WAREHOUSE_NOT_FOUND,
        message: 'Warehouse was not found.',
        statusCode: 404,
      });
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const where: Prisma.InventoryBalanceWhereInput = {
      companyId: company.companyId,
      warehouseId,
      ...(query.includeZero ? {} : { onHandQuantity: { gt: 0 } }),
    };

    const [totalOnHandAgg, total, rows] = await Promise.all([
      this.database.client.inventoryBalance.aggregate({
        where: { companyId: company.companyId, warehouseId },
        _sum: { onHandQuantity: true },
      }),
      this.database.client.inventoryBalance.count({ where }),
      this.database.client.inventoryBalance.findMany({
        where,
        include: balanceInclude,
        orderBy: [
          { sku: { code: 'asc' } },
          { batch: { batchNumber: 'asc' } },
          { location: { code: 'asc' } },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const bySkuRows = await this.database.client.inventoryBalance.groupBy({
      by: ['skuId'],
      where: { companyId: company.companyId, warehouseId },
      _sum: { onHandQuantity: true },
    });
    const skuIds = bySkuRows.map((r) => r.skuId);
    const skus = skuIds.length
      ? await this.database.client.sku.findMany({
          where: { companyId: company.companyId, id: { in: skuIds } },
          select: {
            id: true,
            code: true,
            name: true,
            status: true,
            product: { select: { name: true } },
          },
        })
      : [];
    const skuMap = new Map(skus.map((s) => [s.id, s]));

    return {
      warehouseId: warehouse.id,
      warehouseCode: warehouse.code,
      warehouseName: warehouse.name,
      warehouseStatus: warehouse.status,
      totalOnHand: totalOnHandAgg._sum.onHandQuantity ?? 0,
      note: 'Total units across heterogeneous SKUs is mathematical only — prefer SKU-level quantities.',
      bySku: bySkuRows
        .map((r) => {
          const s = skuMap.get(r.skuId);
          return {
            id: r.skuId,
            code: s?.code ?? r.skuId,
            name: s?.product?.name ?? s?.name ?? null,
            status: s?.status ?? CatalogLifecycleStatus.ACTIVE,
            onHandQuantity: r._sum.onHandQuantity ?? 0,
          };
        })
        .sort((a, b) => a.code.localeCompare(b.code)),
      positions: {
        data: rows.map(toBalanceView),
        meta: buildPaginationMeta(page, pageSize, total),
      },
    };
  }

  async getLocationSummary(
    company: CompanyContext,
    locationId: string,
  ): Promise<InventoryLocationSummaryView> {
    const location = await this.database.client.warehouseLocation.findFirst({
      where: { id: locationId, companyId: company.companyId },
      include: {
        warehouse: { select: { id: true, code: true, name: true, status: true } },
      },
    });
    if (!location) {
      throw new AppError({
        code: ERROR_CODES.WAREHOUSE_LOCATION_NOT_FOUND,
        message: 'Warehouse location was not found.',
        statusCode: 404,
      });
    }

    const balances = await this.database.client.inventoryBalance.findMany({
      where: { companyId: company.companyId, locationId },
      include: balanceInclude,
      orderBy: [
        { sku: { code: 'asc' } },
        { batch: { batchNumber: 'asc' } },
      ],
    });

    return {
      locationId: location.id,
      locationCode: location.code,
      locationName: location.name,
      locationBarcode: location.barcode,
      locationStatus: location.status,
      warehouseId: location.warehouse.id,
      warehouseCode: location.warehouse.code,
      warehouseName: location.warehouse.name,
      warehouseStatus: location.warehouse.status,
      totalOnHand: sumOnHand(balances),
      note: 'Location unit total across SKUs may not be a meaningful KPI.',
      inactiveWithStock:
        location.status !== WarehouseStatus.ACTIVE &&
        balances.some((b) => b.onHandQuantity > 0),
      positions: balances.map(toBalanceView),
    };
  }

  async getBatchSummary(
    company: CompanyContext,
    batchId: string,
  ): Promise<InventoryBatchSummaryView> {
    const batch = await this.database.client.batch.findFirst({
      where: { id: batchId, companyId: company.companyId },
      include: {
        sku: {
          select: {
            id: true,
            code: true,
            name: true,
            status: true,
            product: { select: { name: true, code: true } },
          },
        },
      },
    });
    if (!batch) {
      throw new AppError({
        code: ERROR_CODES.BATCH_NOT_FOUND,
        message: 'Batch was not found.',
        statusCode: 404,
      });
    }

    const balances = await this.database.client.inventoryBalance.findMany({
      where: { companyId: company.companyId, batchId },
      include: balanceInclude,
      orderBy: [
        { warehouse: { code: 'asc' } },
        { location: { code: 'asc' } },
      ],
    });

    return {
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      supplierBatchNumber: batch.supplierBatchNumber,
      expiresAt: batch.expiresAt
        ? batch.expiresAt.toISOString().slice(0, 10)
        : null,
      skuId: batch.sku.id,
      skuCode: batch.sku.code,
      skuStatus: batch.sku.status,
      productName: batch.sku.product?.name ?? batch.sku.name,
      totalOnHand: sumOnHand(balances),
      byWarehouse: aggregateBuckets(
        balances,
        (b) => b.warehouseId,
        (b) => ({
          id: b.warehouseId,
          code: b.warehouse.code,
          name: b.warehouse.name,
          status: b.warehouse.status,
        }),
      ),
      byLocation: aggregateBuckets(
        balances,
        (b) => b.locationId,
        (b) => ({
          id: b.locationId,
          code: b.location.code,
          name: b.location.name,
          barcode: b.location.barcode,
          warehouseId: b.warehouseId,
          warehouseCode: b.warehouse.code,
          status: b.location.status,
        }),
      ),
      positions: balances.map(toBalanceView),
    };
  }

  /**
   * Resolve product barcode → SKU On Hand summary (Catalog barcode identity).
   * Leading zeros preserved via Catalog normalizeScannedValue.
   */
  async lookupByProductBarcode(
    company: CompanyContext,
    rawValue: string,
  ): Promise<InventoryLookupView> {
    const resolved = await this.barcodesService.resolve(company, rawValue);
    const summary = await this.getSkuSummary(company, resolved.sku.id);
    return {
      kind: 'PRODUCT_BARCODE',
      scannedValue: rawValue,
      normalizedValue: normalizeScannedValue(rawValue),
      sku: summary,
    };
  }

  /**
   * Resolve Warehouse location barcode → location On Hand contents.
   */
  async lookupByLocationBarcode(
    company: CompanyContext,
    rawValue: string,
  ): Promise<InventoryLookupView> {
    const normalized = normalizeScannedValue(rawValue);
    const location = await this.database.client.warehouseLocation.findFirst({
      where: {
        companyId: company.companyId,
        OR: [{ barcode: rawValue.trim() }, { barcode: normalized }],
      },
      select: { id: true, barcode: true },
    });
    if (!location) {
      throw new AppError({
        code: ERROR_CODES.WAREHOUSE_LOCATION_BARCODE_NOT_FOUND,
        message: INVENTORY_ERROR_MESSAGES.LOCATION_BARCODE_NOT_FOUND,
        statusCode: 404,
      });
    }
    const summary = await this.getLocationSummary(company, location.id);
    return {
      kind: 'LOCATION_BARCODE',
      scannedValue: rawValue,
      normalizedValue: normalized,
      location: summary,
    };
  }
}

const balanceInclude = {
  warehouse: { select: { id: true, code: true, name: true, status: true } },
  location: {
    select: { id: true, code: true, name: true, barcode: true, status: true },
  },
  sku: {
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      archivedAt: true,
      product: { select: { name: true, code: true } },
    },
  },
  batch: {
    select: {
      id: true,
      batchNumber: true,
      supplierBatchNumber: true,
      expiresAt: true,
    },
  },
} satisfies Prisma.InventoryBalanceInclude;

type BalanceRow = Prisma.InventoryBalanceGetPayload<{ include: typeof balanceInclude }>;

function toBalanceView(row: BalanceRow): InventoryBalanceView {
  return {
    id: row.id,
    warehouseId: row.warehouseId,
    warehouseCode: row.warehouse.code,
    warehouseName: row.warehouse.name,
    warehouseStatus: row.warehouse.status,
    locationId: row.locationId,
    locationCode: row.location.code,
    locationName: row.location.name,
    locationBarcode: row.location.barcode,
    locationStatus: row.location.status,
    skuId: row.skuId,
    skuCode: row.sku.code,
    skuStatus: row.sku.status,
    productName: row.sku.product?.name ?? row.sku.name,
    productCode: row.sku.product?.code ?? null,
    batchId: row.batchId,
    batchNumber: row.batch.batchNumber,
    supplierBatchNumber: row.batch.supplierBatchNumber,
    expiresAt: row.batch.expiresAt
      ? row.batch.expiresAt.toISOString().slice(0, 10)
      : null,
    classification: row.classification,
    onHandQuantity: row.onHandQuantity,
    updatedAt: row.updatedAt.toISOString(),
    warnings: {
      archivedSku: row.sku.status === CatalogLifecycleStatus.ARCHIVED,
      inactiveWarehouse: row.warehouse.status !== WarehouseStatus.ACTIVE,
      inactiveLocation: row.location.status !== WarehouseStatus.ACTIVE,
      negativeOnHand: row.onHandQuantity < 0,
    },
  };
}

function sumOnHand(rows: Array<{ onHandQuantity: number }>): number {
  let total = 0;
  for (const row of rows) total += row.onHandQuantity;
  return total;
}

function sumByClassification(
  rows: Array<{ classification: StockClassification; onHandQuantity: number }>,
): {
  sellableOnHand: number;
  testerOnHand: number;
  damagedOnHand: number;
  quarantineOnHand: number;
} {
  let sellableOnHand = 0;
  let testerOnHand = 0;
  let damagedOnHand = 0;
  let quarantineOnHand = 0;
  for (const row of rows) {
    switch (row.classification) {
      case StockClassification.SELLABLE:
        sellableOnHand += row.onHandQuantity;
        break;
      case StockClassification.TESTER:
        testerOnHand += row.onHandQuantity;
        break;
      case StockClassification.DAMAGED:
        damagedOnHand += row.onHandQuantity;
        break;
      case StockClassification.QUARANTINE:
        quarantineOnHand += row.onHandQuantity;
        break;
      default:
        break;
    }
  }
  return { sellableOnHand, testerOnHand, damagedOnHand, quarantineOnHand };
}

function aggregateBuckets<TRow extends { onHandQuantity: number }, TMeta>(
  rows: TRow[],
  keyFn: (row: TRow) => string,
  metaFn: (row: TRow) => TMeta,
): Array<QuantityBucket & TMeta> {
  const map = new Map<string, QuantityBucket & TMeta>();
  for (const row of rows) {
    const key = keyFn(row);
    const existing = map.get(key);
    if (existing) {
      existing.onHandQuantity += row.onHandQuantity;
    } else {
      map.set(key, { ...metaFn(row), onHandQuantity: row.onHandQuantity });
    }
  }
  return [...map.values()].sort((a, b) => {
    const ac = 'code' in a ? String((a as { code?: string }).code ?? '') : '';
    const bc = 'code' in b ? String((b as { code?: string }).code ?? '') : '';
    return ac.localeCompare(bc);
  });
}

type SkuSummaryBalance = {
  warehouseId: string;
  locationId: string;
  batchId: string;
  onHandQuantity: number;
  warehouse: { code: string; name: string };
  location: { code: string; name: string | null };
  batch: { batchNumber: string };
};

function buildSkuHierarchyFromSummary(balances: SkuSummaryBalance[]) {
  type LocNode = {
    locationId: string;
    locationCode: string;
    locationName: string | null;
    onHandQuantity: number;
  };
  type BatchNode = {
    batchId: string;
    batchNumber: string;
    onHandQuantity: number;
    locations: LocNode[];
  };
  type WhNode = {
    warehouseId: string;
    warehouseCode: string;
    warehouseName: string;
    onHandQuantity: number;
    batches: BatchNode[];
  };

  const warehouses = new Map<string, WhNode>();
  for (const b of balances) {
    let wh = warehouses.get(b.warehouseId);
    if (!wh) {
      wh = {
        warehouseId: b.warehouseId,
        warehouseCode: b.warehouse.code,
        warehouseName: b.warehouse.name,
        onHandQuantity: 0,
        batches: [],
      };
      warehouses.set(b.warehouseId, wh);
    }
    wh.onHandQuantity += b.onHandQuantity;

    let batch = wh.batches.find((x) => x.batchId === b.batchId);
    if (!batch) {
      batch = {
        batchId: b.batchId,
        batchNumber: b.batch.batchNumber,
        onHandQuantity: 0,
        locations: [],
      };
      wh.batches.push(batch);
    }
    batch.onHandQuantity += b.onHandQuantity;
    batch.locations.push({
      locationId: b.locationId,
      locationCode: b.location.code,
      locationName: b.location.name,
      onHandQuantity: b.onHandQuantity,
    });
  }

  return [...warehouses.values()].sort((a, b) =>
    a.warehouseCode.localeCompare(b.warehouseCode),
  );
}

function normalizeSearch(q?: string): string | null {
  if (!q) return null;
  const trimmed = q.trim().slice(0, INVENTORY_SEARCH_MAX_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}
