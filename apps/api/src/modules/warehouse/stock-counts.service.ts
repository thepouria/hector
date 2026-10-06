import { Injectable } from '@nestjs/common';
import {
  InventoryMovementType,
  InventorySourceType,
  Prisma,
  StockClassification,
  StockCountLineStatus,
  StockCountStatus,
  StockCountType,
  SYSTEM_TRANSIT_WAREHOUSE_CODE,
  WarehouseLocationType,
  WarehouseStatus,
} from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import { getRequestContext } from '../../common/context/request-context';
import {
  buildPaginationMeta,
  type PaginationMeta,
} from '../../common/dto/pagination-query.dto';
import { AppError } from '../../common/exceptions/app.error';
import { DatabaseService } from '../../infrastructure/database/database.service';
import {
  DOMAIN_EVENTS,
  DomainEventBus,
  DomainEventFactory,
  commitThenPublish,
} from '../../infrastructure/events';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import { BarcodesService } from '../catalog/barcodes.service';
import type { CompanyContext } from '../companies/types/company.types';
import type {
  AddDiscoveredStockCountItemDto,
  CreateStockCountDto,
  ListStockCountsQueryDto,
  RecordStockCountItemDto,
  RequestRecountDto,
  ScanApplyStockCountDto,
  SkipStockCountItemDto,
  UpdateStockCountDto,
} from './dto/stock-count.dto';
import { InventoryLedgerService, type PostMovementInput } from './inventory-ledger.service';
import { normalizeLocationBarcodeInput } from './location-barcode.util';
import {
  allocateStockCountSequence,
  formatStockCountNumber,
} from './stock-count-numbering';
import {
  STOCK_COUNT_ERROR_MESSAGES,
  STOCK_COUNT_SEARCH_MAX_LENGTH,
} from './stock-count.constants';
import type {
  StockCountDetailView,
  StockCountItemView,
  StockCountListItemView,
  StockCountReviewView,
  StockCountScanApplyResultView,
} from './types/stock-count.types';

const detailInclude = {
  warehouse: {
    select: { id: true, code: true, name: true, status: true, isSystem: true },
  },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  startedBy: { select: { id: true, firstName: true, lastName: true } },
  submittedBy: { select: { id: true, firstName: true, lastName: true } },
  approvedBy: { select: { id: true, firstName: true, lastName: true } },
  rejectedBy: { select: { id: true, firstName: true, lastName: true } },
  postedBy: { select: { id: true, firstName: true, lastName: true } },
  cancelledBy: { select: { id: true, firstName: true, lastName: true } },
  scopeLocations: { select: { locationId: true } },
  scopeSkus: { select: { skuId: true } },
  items: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    include: {
      sku: {
        select: {
          id: true,
          code: true,
          name: true,
          product: { select: { name: true } },
        },
      },
      batch: {
        select: {
          id: true,
          batchNumber: true,
          supplierBatchNumber: true,
          skuId: true,
        },
      },
      location: true,
      countedBy: { select: { id: true, firstName: true, lastName: true } },
    },
  },
} satisfies Prisma.StockCountInclude;

type DetailRow = Prisma.StockCountGetPayload<{ include: typeof detailInclude }>;
type Tx = Prisma.TransactionClient;

type PositionKey = {
  warehouseId: string;
  locationId: string;
  skuId: string;
  batchId: string;
  classification: StockClassification;
};

type ComputedLineMetrics = {
  movementsDuringCount: number;
  expectedQuantity: number;
  difference: number | null;
};

@Injectable()
export class StockCountsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
    private readonly inventoryLedger: InventoryLedgerService,
    private readonly barcodesService: BarcodesService,
  ) {}

  async list(
    company: CompanyContext,
    query: ListStockCountsQueryDto,
  ): Promise<{ data: StockCountListItemView[]; meta: PaginationMeta }> {
    const search = normalizeSearch(query.q);
    const where: Prisma.StockCountWhereInput = {
      companyId: company.companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.createdById ? { createdById: query.createdById } : {}),
      ...(query.locationId
        ? {
            OR: [
              { scopeLocations: { some: { locationId: query.locationId } } },
              { items: { some: { locationId: query.locationId } } },
            ],
          }
        : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            createdAt: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { number: { contains: search, mode: 'insensitive' } },
              { warehouse: { code: { contains: search, mode: 'insensitive' } } },
              { notes: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const skip = (query.page - 1) * query.pageSize;
    const [total, rows] = await this.database.client.$transaction([
      this.database.client.stockCount.count({ where }),
      this.database.client.stockCount.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.pageSize,
        include: {
          warehouse: {
            select: { id: true, code: true, name: true, status: true, isSystem: true },
          },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          scopeLocations: { select: { locationId: true } },
          scopeSkus: { select: { skuId: true } },
          items: {
            select: {
              lineStatus: true,
              snapshotQuantity: true,
              countedQuantity: true,
              difference: true,
            },
          },
        },
      }),
    ]);

    return {
      data: rows.map((row) => {
        const countedLineCount = row.items.filter(
          (i) =>
            i.lineStatus === StockCountLineStatus.COUNTED ||
            i.lineStatus === StockCountLineStatus.SKIPPED,
        ).length;
        const differenceLineCount = row.items.filter((i) => {
          if (i.difference != null) return i.difference !== 0;
          if (i.lineStatus !== StockCountLineStatus.COUNTED) return false;
          if (i.countedQuantity == null) return false;
          return i.countedQuantity !== i.snapshotQuantity;
        }).length;

        return {
          id: row.id,
          number: row.number,
          type: row.type,
          status: row.status,
          warehouse: row.warehouse,
          scopeSummary: buildScopeSummary(
            row.type,
            row.scopeLocations.length,
            row.scopeSkus.length,
            row.scopeClassifications.length,
          ),
          lineCount: row.items.length,
          countedLineCount,
          differenceLineCount,
          blindCount: row.blindCount,
          startedAt: row.startedAt?.toISOString() ?? null,
          submittedAt: row.submittedAt?.toISOString() ?? null,
          postedAt: row.postedAt?.toISOString() ?? null,
          createdBy: row.createdBy,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        };
      }),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async get(company: CompanyContext, countId: string): Promise<StockCountDetailView> {
    const row = await this.requireDetail(company.companyId, countId);
    return this.toDetailView(row);
  }

  async create(
    company: CompanyContext,
    dto: CreateStockCountDto,
  ): Promise<StockCountDetailView> {
    const actorUserId = this.requireActorUserId();

    return commitThenPublish(this.eventBus, async (events) => {
      const detail = await this.database.client.$transaction(async (tx) => {
        await this.assertOperationalWarehouse(tx, company.companyId, dto.warehouseId);
        await this.validateScopeRefs(
          tx,
          company.companyId,
          dto.warehouseId,
          dto.locationIds,
          dto.skuIds,
        );

        const sequence = await allocateStockCountSequence(tx, company.companyId);
        const number = formatStockCountNumber(sequence);

        let count;
        try {
          count = await tx.stockCount.create({
            data: {
              companyId: company.companyId,
              number,
              warehouseId: dto.warehouseId,
              type: dto.type,
              status: StockCountStatus.DRAFT,
              blindCount: dto.blindCount ?? false,
              allowDiscoveredItems: dto.allowDiscoveredItems ?? false,
              scopeClassifications: dto.classifications ?? [],
              highDifferenceThreshold: dto.highDifferenceThreshold ?? null,
              notes: dto.notes?.trim() || null,
              createdById: actorUserId,
            },
          });
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            throw new AppError({
              code: ERROR_CODES.STOCK_COUNT_NUMBER_CONFLICT,
              message: 'Stock count number conflict; retry.',
              statusCode: 409,
            });
          }
          throw error;
        }

        await this.replaceScope(
          tx,
          company.companyId,
          count.id,
          dto.locationIds ?? [],
          dto.skuIds ?? [],
        );

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.STOCK_COUNT_CREATED,
          entityType: AUDIT_ENTITY_TYPES.STOCK_COUNT,
          entityId: count.id,
          after: {
            number,
            warehouseId: dto.warehouseId,
            type: dto.type,
            status: StockCountStatus.DRAFT,
          },
          metadata: {
            countId: count.id,
            countNumber: number,
            warehouseId: dto.warehouseId,
            type: dto.type,
            status: StockCountStatus.DRAFT,
          },
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_STOCK_COUNT_CREATED,
            payload: {
              companyId: company.companyId,
              countId: count.id,
              countNumber: number,
              warehouseId: dto.warehouseId,
              type: dto.type,
              status: StockCountStatus.DRAFT,
            },
          }),
        );

        return this.loadDetailInTx(tx, company.companyId, count.id);
      });
      return this.toDetailView(detail);
    });
  }

  async update(
    company: CompanyContext,
    countId: string,
    dto: UpdateStockCountDto,
  ): Promise<StockCountDetailView> {
    this.requireActorUserId();
    return commitThenPublish(this.eventBus, async () => {
      const detail = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockCount(tx, company.companyId, countId);
        this.assertDraft(locked.status);

        if (dto.locationIds !== undefined || dto.skuIds !== undefined) {
          await this.validateScopeRefs(
            tx,
            company.companyId,
            locked.warehouseId,
            dto.locationIds ?? [],
            dto.skuIds ?? [],
          );
        }

        await tx.stockCount.update({
          where: { id: countId },
          data: {
            ...(dto.blindCount !== undefined ? { blindCount: dto.blindCount } : {}),
            ...(dto.allowDiscoveredItems !== undefined
              ? { allowDiscoveredItems: dto.allowDiscoveredItems }
              : {}),
            ...(dto.classifications !== undefined
              ? { scopeClassifications: dto.classifications }
              : {}),
            ...(dto.highDifferenceThreshold !== undefined
              ? { highDifferenceThreshold: dto.highDifferenceThreshold }
              : {}),
            ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
            version: { increment: 1 },
          },
        });

        if (dto.locationIds !== undefined || dto.skuIds !== undefined) {
          const current = await tx.stockCount.findFirstOrThrow({
            where: { id: countId, companyId: company.companyId },
            include: { scopeLocations: true, scopeSkus: true },
          });
          await this.replaceScope(
            tx,
            company.companyId,
            countId,
            dto.locationIds ?? current.scopeLocations.map((s) => s.locationId),
            dto.skuIds ?? current.scopeSkus.map((s) => s.skuId),
          );
        }

        return this.loadDetailInTx(tx, company.companyId, countId);
      });
      return this.toDetailView(detail);
    });
  }

  async start(company: CompanyContext, countId: string): Promise<StockCountDetailView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const detail = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockCount(tx, company.companyId, countId);
        if (locked.status !== StockCountStatus.DRAFT) {
          throw new AppError({
            code: ERROR_CODES.STOCK_COUNT_NOT_STARTABLE,
            message: STOCK_COUNT_ERROR_MESSAGES.NOT_STARTABLE,
            statusCode: 409,
          });
        }

        await this.assertOperationalWarehouse(tx, company.companyId, locked.warehouseId);

        const scope = await tx.stockCount.findFirstOrThrow({
          where: { id: countId, companyId: company.companyId },
          include: { scopeLocations: true, scopeSkus: true },
        });

        const locationIds = scope.scopeLocations.map((s) => s.locationId);
        const skuIds = scope.scopeSkus.map((s) => s.skuId);
        const classifications = scope.scopeClassifications;

        const balanceWhere: Prisma.InventoryBalanceWhereInput = {
          companyId: company.companyId,
          warehouseId: locked.warehouseId,
          onHandQuantity: { gte: 0 },
          ...(locationIds.length ? { locationId: { in: locationIds } } : {}),
          ...(skuIds.length ? { skuId: { in: skuIds } } : {}),
          ...(classifications.length ? { classification: { in: classifications } } : {}),
        };

        const balances = await tx.inventoryBalance.findMany({
          where: balanceWhere,
          orderBy: [{ locationId: 'asc' }, { skuId: 'asc' }, { batchId: 'asc' }],
        });

        const now = new Date();
        if (balances.length > 0) {
          await tx.stockCountItem.createMany({
            data: balances.map((b) => ({
              companyId: company.companyId,
              stockCountId: countId,
              warehouseId: b.warehouseId,
              locationId: b.locationId,
              skuId: b.skuId,
              batchId: b.batchId,
              classification: b.classification,
              snapshotQuantity: b.onHandQuantity,
              lineStatus: StockCountLineStatus.PENDING,
              isDiscovered: false,
            })),
            skipDuplicates: true,
          });
        }

        await tx.stockCount.update({
          where: { id: countId },
          data: {
            status: StockCountStatus.IN_PROGRESS,
            startedAt: now,
            startedById: actorUserId,
            version: { increment: 1 },
          },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.STOCK_COUNT_STARTED,
          entityType: AUDIT_ENTITY_TYPES.STOCK_COUNT,
          entityId: countId,
          before: { status: StockCountStatus.DRAFT },
          after: { status: StockCountStatus.IN_PROGRESS, lineCount: balances.length },
          metadata: {
            countId,
            countNumber: locked.number,
            warehouseId: locked.warehouseId,
            status: StockCountStatus.IN_PROGRESS,
            lineCount: balances.length,
          },
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_STOCK_COUNT_STARTED,
            payload: {
              companyId: company.companyId,
              countId,
              countNumber: locked.number,
              warehouseId: locked.warehouseId,
              status: StockCountStatus.IN_PROGRESS,
              lineCount: balances.length,
            },
          }),
        );

        return this.loadDetailInTx(tx, company.companyId, countId);
      });
      return this.toDetailView(detail);
    });
  }

  async recordItem(
    company: CompanyContext,
    countId: string,
    itemId: string,
    dto: RecordStockCountItemDto,
  ): Promise<StockCountDetailView> {
    if (dto.itemId !== undefined && dto.itemId !== itemId) {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'itemId in path and body must match.',
        statusCode: 400,
      });
    }
    if (!Number.isInteger(dto.countedQuantity) || dto.countedQuantity < 0) {
      throw new AppError({
        code: ERROR_CODES.STOCK_COUNT_INVALID_QUANTITY,
        message: STOCK_COUNT_ERROR_MESSAGES.INVALID_QUANTITY,
        statusCode: 400,
      });
    }

    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async () => {
      const detail = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockCount(tx, company.companyId, countId);
        this.assertRecordable(locked.status);

        const item = await tx.stockCountItem.findFirst({
          where: { id: itemId, stockCountId: countId, companyId: company.companyId },
        });
        if (!item) {
          throw new AppError({
            code: ERROR_CODES.STOCK_COUNT_ITEM_NOT_FOUND,
            message: STOCK_COUNT_ERROR_MESSAGES.ITEM_NOT_FOUND,
            statusCode: 404,
          });
        }

        const nextQty = dto.increment
          ? (item.countedQuantity ?? 0) + dto.countedQuantity
          : dto.countedQuantity;

        await tx.stockCountItem.update({
          where: { id: itemId },
          data: {
            countedQuantity: nextQty,
            lineStatus: StockCountLineStatus.COUNTED,
            countedById: actorUserId,
            countedAt: new Date(),
            notes: dto.notes?.trim() ?? item.notes,
          },
        });

        await tx.stockCount.update({
          where: { id: countId },
          data: { version: { increment: 1 } },
        });

        return this.loadDetailInTx(tx, company.companyId, countId);
      });
      return this.toDetailView(detail);
    });
  }

  async skipItem(
    company: CompanyContext,
    countId: string,
    itemId: string,
    dto: SkipStockCountItemDto,
  ): Promise<StockCountDetailView> {
    this.requireActorUserId();
    return commitThenPublish(this.eventBus, async () => {
      const detail = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockCount(tx, company.companyId, countId);
        this.assertRecordable(locked.status);

        const updated = await tx.stockCountItem.updateMany({
          where: { id: itemId, stockCountId: countId, companyId: company.companyId },
          data: {
            lineStatus: StockCountLineStatus.SKIPPED,
            countedQuantity: null,
            countedById: null,
            countedAt: null,
            notes: dto.notes?.trim() ?? undefined,
          },
        });
        if (updated.count === 0) {
          throw new AppError({
            code: ERROR_CODES.STOCK_COUNT_ITEM_NOT_FOUND,
            message: STOCK_COUNT_ERROR_MESSAGES.ITEM_NOT_FOUND,
            statusCode: 404,
          });
        }

        await tx.stockCount.update({
          where: { id: countId },
          data: { version: { increment: 1 } },
        });

        return this.loadDetailInTx(tx, company.companyId, countId);
      });
      return this.toDetailView(detail);
    });
  }

  async addDiscoveredItem(
    company: CompanyContext,
    countId: string,
    dto: AddDiscoveredStockCountItemDto,
  ): Promise<StockCountDetailView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async () => {
      const detail = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockCount(tx, company.companyId, countId);
        this.assertRecordable(locked.status);

        const count = await tx.stockCount.findFirstOrThrow({
          where: { id: countId, companyId: company.companyId },
          include: { scopeLocations: true, scopeSkus: true },
        });
        if (!count.allowDiscoveredItems) {
          throw new AppError({
            code: ERROR_CODES.STOCK_COUNT_OUTSIDE_SCOPE,
            message: STOCK_COUNT_ERROR_MESSAGES.OUTSIDE_SCOPE,
            statusCode: 409,
          });
        }

        const classification = dto.classification ?? StockClassification.SELLABLE;
        await this.validateItemDimensions(tx, company.companyId, locked.warehouseId, {
          locationId: dto.locationId,
          skuId: dto.skuId,
          batchId: dto.batchId,
          classification,
        });

        try {
          await tx.stockCountItem.create({
            data: {
              companyId: company.companyId,
              stockCountId: countId,
              warehouseId: locked.warehouseId,
              locationId: dto.locationId,
              skuId: dto.skuId,
              batchId: dto.batchId,
              classification,
              snapshotQuantity: 0,
              countedQuantity: dto.countedQuantity,
              lineStatus: StockCountLineStatus.COUNTED,
              isDiscovered: true,
              countedById: actorUserId,
              countedAt: new Date(),
              notes: dto.notes?.trim() || null,
            },
          });
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            throw new AppError({
              code: ERROR_CODES.VALIDATION_ERROR,
              message: 'Count line already exists for this position.',
              statusCode: 409,
            });
          }
          throw error;
        }

        await tx.stockCount.update({
          where: { id: countId },
          data: { version: { increment: 1 } },
        });

        return this.loadDetailInTx(tx, company.companyId, countId);
      });
      return this.toDetailView(detail);
    });
  }

  async scanApply(
    company: CompanyContext,
    countId: string,
    dto: ScanApplyStockCountDto,
  ): Promise<StockCountScanApplyResultView> {
    const existing = await this.database.client.stockCountScanRequest.findUnique({
      where: {
        companyId_stockCountId_requestId: {
          companyId: company.companyId,
          stockCountId: countId,
          requestId: dto.requestId,
        },
      },
    });
    if (existing) {
      return existing.responseJson as unknown as StockCountScanApplyResultView;
    }

    const actorUserId = this.requireActorUserId();
    const locationBarcode = dto.locationBarcode
      ? normalizeLocationBarcodeInput(dto.locationBarcode)
      : null;

    if (!locationBarcode && !dto.productBarcode && !dto.locationId) {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Scan apply requires locationBarcode, locationId, and/or productBarcode.',
        statusCode: 400,
      });
    }

    const result = await commitThenPublish(this.eventBus, async () => {
      return this.database.client.$transaction(async (tx) => {
        const locked = await this.lockCount(tx, company.companyId, countId);
        this.assertRecordable(locked.status);

        const count = await tx.stockCount.findFirstOrThrow({
          where: { id: countId, companyId: company.companyId },
          include: { scopeLocations: true, scopeSkus: true },
        });

        let activeLocationId: string | null = dto.locationId ?? null;

        if (locationBarcode) {
          const location = await tx.warehouseLocation.findFirst({
            where: { companyId: company.companyId, barcode: locationBarcode },
          });
          if (!location) {
            throw new AppError({
              code: ERROR_CODES.STOCK_COUNT_UNKNOWN_LOCATION_BARCODE,
              message: STOCK_COUNT_ERROR_MESSAGES.UNKNOWN_LOCATION_BARCODE,
              statusCode: 404,
            });
          }
          if (location.warehouseId !== locked.warehouseId) {
            throw new AppError({
              code: ERROR_CODES.STOCK_COUNT_LOCATION_MISMATCH,
              message: STOCK_COUNT_ERROR_MESSAGES.LOCATION_MISMATCH,
              statusCode: 409,
            });
          }
          activeLocationId = location.id;
        }

        if (!dto.productBarcode) {
          const detail = await this.loadDetailInTx(tx, company.companyId, countId);
          const view = this.toDetailViewSync(detail);
          return {
            count: view,
            item: this.emptyItemPlaceholder(),
            activeLocationId,
            incremented: false,
          } satisfies StockCountScanApplyResultView;
        }

        if (!activeLocationId) {
          throw new AppError({
            code: ERROR_CODES.STOCK_COUNT_LOCATION_MISMATCH,
            message: STOCK_COUNT_ERROR_MESSAGES.LOCATION_MISMATCH,
            statusCode: 409,
          });
        }

        const resolved = await this.barcodesService.resolve(company, dto.productBarcode);
        if (!resolved.sku?.id) {
          throw new AppError({
            code: ERROR_CODES.STOCK_COUNT_UNKNOWN_PRODUCT_BARCODE,
            message: STOCK_COUNT_ERROR_MESSAGES.UNKNOWN_PRODUCT_BARCODE,
            statusCode: 404,
          });
        }

        const classification = dto.classification ?? StockClassification.SELLABLE;
        let batchId = dto.batchId;
        if (!batchId) {
          const balances = await tx.inventoryBalance.findMany({
            where: {
              companyId: company.companyId,
              warehouseId: locked.warehouseId,
              locationId: activeLocationId,
              skuId: resolved.sku.id,
              classification,
              onHandQuantity: { gt: 0 },
            },
            orderBy: { batch: { batchNumber: 'asc' } },
            take: 2,
            select: { batchId: true },
          });
          if (balances.length === 1) {
            batchId = balances[0]!.batchId;
          } else {
            throw new AppError({
              code: ERROR_CODES.VALIDATION_ERROR,
              message:
                'batchId is required when multiple batches have On Hand at the location for this classification.',
              statusCode: 400,
            });
          }
        }

        const inScope = this.isInScope(
          count,
          activeLocationId,
          resolved.sku.id,
          classification,
          count.allowDiscoveredItems,
        );
        if (!inScope) {
          throw new AppError({
            code: ERROR_CODES.STOCK_COUNT_OUTSIDE_SCOPE,
            message: STOCK_COUNT_ERROR_MESSAGES.OUTSIDE_SCOPE,
            statusCode: 409,
          });
        }

        const existingItem = await tx.stockCountItem.findFirst({
          where: {
            stockCountId: countId,
            companyId: company.companyId,
            locationId: activeLocationId,
            skuId: resolved.sku.id,
            batchId,
            classification,
          },
        });

        const increment =
          dto.increment ??
          (dto.countedQuantity === undefined ? true : false);
        const delta = dto.countedQuantity ?? 1;

        let itemRow;
        let incremented = false;

        if (existingItem) {
          const nextQty = increment
            ? (existingItem.countedQuantity ?? 0) + delta
            : delta;
          itemRow = await tx.stockCountItem.update({
            where: { id: existingItem.id },
            data: {
              countedQuantity: nextQty,
              lineStatus: StockCountLineStatus.COUNTED,
              countedById: actorUserId,
              countedAt: new Date(),
              notes: dto.notes?.trim() ?? existingItem.notes,
            },
            include: detailInclude.items.include,
          });
          incremented = increment && existingItem.countedQuantity != null;
        } else if (count.allowDiscoveredItems) {
          itemRow = await tx.stockCountItem.create({
            data: {
              companyId: company.companyId,
              stockCountId: countId,
              warehouseId: locked.warehouseId,
              locationId: activeLocationId,
              skuId: resolved.sku.id,
              batchId,
              classification,
              snapshotQuantity: 0,
              countedQuantity: delta,
              lineStatus: StockCountLineStatus.COUNTED,
              isDiscovered: true,
              countedById: actorUserId,
              countedAt: new Date(),
              notes: dto.notes?.trim() || null,
            },
            include: detailInclude.items.include,
          });
          incremented = false;
        } else {
          throw new AppError({
            code: ERROR_CODES.STOCK_COUNT_OUTSIDE_SCOPE,
            message: STOCK_COUNT_ERROR_MESSAGES.OUTSIDE_SCOPE,
            statusCode: 409,
          });
        }

        await tx.stockCount.update({
          where: { id: countId },
          data: { version: { increment: 1 } },
        });

        const detail = await this.loadDetailInTx(tx, company.companyId, countId);
        const view = this.toDetailViewSync(detail);
        const itemView =
          view.items.find((i) => i.id === itemRow.id) ??
          this.mapItemRowToView(itemRow, detail, null);

        return {
          count: view,
          item: itemView,
          activeLocationId,
          incremented,
        } satisfies StockCountScanApplyResultView;
      });
    });

    await this.database.client.stockCountScanRequest.create({
      data: {
        companyId: company.companyId,
        stockCountId: countId,
        requestId: dto.requestId,
        responseJson: result as unknown as Prisma.InputJsonValue,
      },
    });

    return result;
  }

  async submit(company: CompanyContext, countId: string): Promise<StockCountDetailView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const detail = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockCount(tx, company.companyId, countId);
        if (locked.status === StockCountStatus.SUBMITTED) {
          return this.loadDetailInTx(tx, company.companyId, countId);
        }
        if (
          locked.status !== StockCountStatus.IN_PROGRESS &&
          locked.status !== StockCountStatus.RECOUNT_REQUIRED
        ) {
          throw new AppError({
            code: ERROR_CODES.STOCK_COUNT_NOT_SUBMITTABLE,
            message: STOCK_COUNT_ERROR_MESSAGES.NOT_SUBMITTABLE,
            statusCode: 409,
          });
        }

        const items = await tx.stockCountItem.findMany({
          where: { stockCountId: countId, companyId: company.companyId },
        });
        if (items.length === 0) {
          throw new AppError({
            code: ERROR_CODES.STOCK_COUNT_EMPTY,
            message: STOCK_COUNT_ERROR_MESSAGES.EMPTY,
            statusCode: 409,
          });
        }

        const pending = items.filter(
          (i) =>
            i.lineStatus !== StockCountLineStatus.COUNTED &&
            i.lineStatus !== StockCountLineStatus.SKIPPED,
        );
        if (pending.length > 0) {
          throw new AppError({
            code: ERROR_CODES.STOCK_COUNT_UNCOUNTED_LINES,
            message: STOCK_COUNT_ERROR_MESSAGES.UNCOUNTED_LINES,
            statusCode: 409,
          });
        }

        const now = new Date();
        await tx.stockCount.update({
          where: { id: countId },
          data: {
            status: StockCountStatus.SUBMITTED,
            submittedAt: now,
            submittedById: actorUserId,
            version: { increment: 1 },
          },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.STOCK_COUNT_SUBMITTED,
          entityType: AUDIT_ENTITY_TYPES.STOCK_COUNT,
          entityId: countId,
          before: { status: locked.status },
          after: { status: StockCountStatus.SUBMITTED },
          metadata: {
            countId,
            countNumber: locked.number,
            warehouseId: locked.warehouseId,
            status: StockCountStatus.SUBMITTED,
          },
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_STOCK_COUNT_SUBMITTED,
            payload: {
              companyId: company.companyId,
              countId,
              countNumber: locked.number,
              warehouseId: locked.warehouseId,
              status: StockCountStatus.SUBMITTED,
            },
          }),
        );

        return this.loadDetailInTx(tx, company.companyId, countId);
      });
      return this.toDetailView(detail);
    });
  }

  async requestRecount(
    company: CompanyContext,
    countId: string,
    dto: RequestRecountDto,
  ): Promise<StockCountDetailView> {
    this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const detail = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockCount(tx, company.companyId, countId);
        if (locked.status !== StockCountStatus.SUBMITTED) {
          throw new AppError({
            code: ERROR_CODES.STOCK_COUNT_NOT_APPROVABLE,
            message: STOCK_COUNT_ERROR_MESSAGES.NOT_APPROVABLE,
            statusCode: 409,
          });
        }

        if (!locked.startedAt) {
          throw new AppError({
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'Count has no startedAt timestamp.',
            statusCode: 409,
          });
        }

        const items = await tx.stockCountItem.findMany({
          where: { stockCountId: countId, companyId: company.companyId },
        });

        const metrics = await this.computeMetricsForItems(
          tx,
          company.companyId,
          countId,
          locked.startedAt,
          items,
        );

        let targetIds: Set<string>;
        if (dto.itemIds?.length) {
          targetIds = new Set(dto.itemIds);
        } else {
          targetIds = new Set(
            items
              .filter((item) => {
                if (item.lineStatus === StockCountLineStatus.SKIPPED) return false;
                const m = metrics.get(item.id);
                return m?.difference != null && m.difference !== 0;
              })
              .map((i) => i.id),
          );
        }

        if (targetIds.size > 0) {
          await tx.stockCountItem.updateMany({
            where: {
              stockCountId: countId,
              companyId: company.companyId,
              id: { in: [...targetIds] },
            },
            data: {
              lineStatus: StockCountLineStatus.RECOUNT_REQUIRED,
              countedQuantity: null,
              countedById: null,
              countedAt: null,
              difference: null,
              expectedQuantity: null,
              movementsDuringCount: null,
            },
          });
        }

        const now = new Date();
        await tx.stockCount.update({
          where: { id: countId },
          data: {
            status: StockCountStatus.RECOUNT_REQUIRED,
            recountRequestedAt: now,
            ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || locked.notes } : {}),
            version: { increment: 1 },
          },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.STOCK_COUNT_RECOUNT_REQUESTED,
          entityType: AUDIT_ENTITY_TYPES.STOCK_COUNT,
          entityId: countId,
          before: { status: StockCountStatus.SUBMITTED },
          after: { status: StockCountStatus.RECOUNT_REQUIRED, recountLines: targetIds.size },
          metadata: {
            countId,
            countNumber: locked.number,
            status: StockCountStatus.RECOUNT_REQUIRED,
            recountLineCount: targetIds.size,
          },
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_STOCK_COUNT_SUBMITTED,
            payload: {
              companyId: company.companyId,
              countId,
              countNumber: locked.number,
              warehouseId: locked.warehouseId,
              status: StockCountStatus.RECOUNT_REQUIRED,
              recount: true,
            },
          }),
        );

        return this.loadDetailInTx(tx, company.companyId, countId);
      });
      return this.toDetailView(detail);
    });
  }

  async approve(company: CompanyContext, countId: string): Promise<StockCountDetailView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const detail = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockCount(tx, company.companyId, countId);
        if (locked.status === StockCountStatus.APPROVED) {
          return this.loadDetailInTx(tx, company.companyId, countId);
        }
        if (locked.status !== StockCountStatus.SUBMITTED) {
          throw new AppError({
            code: ERROR_CODES.STOCK_COUNT_NOT_APPROVABLE,
            message: STOCK_COUNT_ERROR_MESSAGES.NOT_APPROVABLE,
            statusCode: 409,
          });
        }

        const now = new Date();
        await tx.stockCount.update({
          where: { id: countId },
          data: {
            status: StockCountStatus.APPROVED,
            approvedAt: now,
            approvedById: actorUserId,
            version: { increment: 1 },
          },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.STOCK_COUNT_APPROVED,
          entityType: AUDIT_ENTITY_TYPES.STOCK_COUNT,
          entityId: countId,
          before: { status: StockCountStatus.SUBMITTED },
          after: { status: StockCountStatus.APPROVED },
          metadata: {
            countId,
            countNumber: locked.number,
            warehouseId: locked.warehouseId,
            status: StockCountStatus.APPROVED,
          },
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_STOCK_COUNT_APPROVED,
            payload: {
              companyId: company.companyId,
              countId,
              countNumber: locked.number,
              warehouseId: locked.warehouseId,
              status: StockCountStatus.APPROVED,
            },
          }),
        );

        return this.loadDetailInTx(tx, company.companyId, countId);
      });
      return this.toDetailView(detail);
    });
  }

  async reject(company: CompanyContext, countId: string): Promise<StockCountDetailView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const detail = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockCount(tx, company.companyId, countId);
        if (locked.status === StockCountStatus.REJECTED) {
          return this.loadDetailInTx(tx, company.companyId, countId);
        }
        if (locked.status !== StockCountStatus.SUBMITTED) {
          throw new AppError({
            code: ERROR_CODES.STOCK_COUNT_NOT_APPROVABLE,
            message: STOCK_COUNT_ERROR_MESSAGES.NOT_APPROVABLE,
            statusCode: 409,
          });
        }

        const now = new Date();
        await tx.stockCount.update({
          where: { id: countId },
          data: {
            status: StockCountStatus.REJECTED,
            rejectedAt: now,
            rejectedById: actorUserId,
            version: { increment: 1 },
          },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.STOCK_COUNT_REJECTED,
          entityType: AUDIT_ENTITY_TYPES.STOCK_COUNT,
          entityId: countId,
          before: { status: StockCountStatus.SUBMITTED },
          after: { status: StockCountStatus.REJECTED },
          metadata: {
            countId,
            countNumber: locked.number,
            status: StockCountStatus.REJECTED,
          },
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_STOCK_COUNT_CANCELLED,
            payload: {
              companyId: company.companyId,
              countId,
              countNumber: locked.number,
              warehouseId: locked.warehouseId,
              status: StockCountStatus.REJECTED,
            },
          }),
        );

        return this.loadDetailInTx(tx, company.companyId, countId);
      });
      return this.toDetailView(detail);
    });
  }

  async post(company: CompanyContext, countId: string): Promise<StockCountDetailView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const detail = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockCount(tx, company.companyId, countId);
        if (locked.status === StockCountStatus.POSTED) {
          return this.loadDetailInTx(tx, company.companyId, countId);
        }
        if (locked.status !== StockCountStatus.APPROVED) {
          throw new AppError({
            code: ERROR_CODES.STOCK_COUNT_NOT_POSTABLE,
            message: STOCK_COUNT_ERROR_MESSAGES.NOT_POSTABLE,
            statusCode: 409,
          });
        }
        if (!locked.startedAt) {
          throw new AppError({
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'Count has no startedAt timestamp.',
            statusCode: 409,
          });
        }

        const items = await tx.stockCountItem.findMany({
          where: { stockCountId: countId, companyId: company.companyId },
          orderBy: { id: 'asc' },
        });
        if (items.length === 0) {
          throw new AppError({
            code: ERROR_CODES.STOCK_COUNT_EMPTY,
            message: STOCK_COUNT_ERROR_MESSAGES.EMPTY,
            statusCode: 409,
          });
        }

        await this.assertOperationalWarehouse(tx, company.companyId, locked.warehouseId);
        const occurredAt = new Date();
        const metrics = await this.computeMetricsForItems(
          tx,
          company.companyId,
          countId,
          locked.startedAt,
          items,
        );

        const posts: PostMovementInput[] = [];

        for (const item of items) {
          const m = metrics.get(item.id)!;
          await tx.stockCountItem.update({
            where: { id: item.id },
            data: {
              movementsDuringCount: m.movementsDuringCount,
              expectedQuantity: m.expectedQuantity,
              difference: m.difference,
            },
          });

          if (item.lineStatus === StockCountLineStatus.SKIPPED || m.difference == null) {
            continue;
          }
          if (m.difference === 0) continue;

          posts.push({
            warehouseId: item.warehouseId,
            locationId: item.locationId,
            skuId: item.skuId,
            batchId: item.batchId,
            classification: item.classification,
            movementType:
              m.difference > 0
                ? InventoryMovementType.STOCK_COUNT_ADJUSTMENT_IN
                : InventoryMovementType.STOCK_COUNT_ADJUSTMENT_OUT,
            quantityDelta: m.difference,
            sourceType: InventorySourceType.STOCK_COUNT,
            sourceId: countId,
            sourceLineId: item.id,
            occurredAt,
            actorUserId,
            notes: `COUNT post ${locked.number}`,
          });
        }

        if (posts.length > 0) {
          await this.inventoryLedger.postMovementsInTx(tx, company.companyId, posts, {
            recordAudit: true,
          });
        }

        await tx.stockCount.update({
          where: { id: countId },
          data: {
            status: StockCountStatus.POSTED,
            postedAt: occurredAt,
            postedById: actorUserId,
            version: { increment: 1 },
          },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.STOCK_COUNT_POSTED,
          entityType: AUDIT_ENTITY_TYPES.STOCK_COUNT,
          entityId: countId,
          before: { status: StockCountStatus.APPROVED },
          after: {
            status: StockCountStatus.POSTED,
            adjustmentLines: posts.length,
          },
          metadata: {
            countId,
            countNumber: locked.number,
            warehouseId: locked.warehouseId,
            status: StockCountStatus.POSTED,
            adjustmentLineCount: posts.length,
          },
        });

        const positiveAdjustmentQty = posts
          .filter((p) => p.quantityDelta > 0)
          .reduce((s, p) => s + p.quantityDelta, 0);
        const negativeAdjustmentQty = posts
          .filter((p) => p.quantityDelta < 0)
          .reduce((s, p) => s + Math.abs(p.quantityDelta), 0);

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_STOCK_COUNT_COMPLETED,
            payload: {
              companyId: company.companyId,
              stockCountId: countId,
              countId,
              countNumber: locked.number,
              warehouseId: locked.warehouseId,
              status: StockCountStatus.POSTED,
              differenceLineCount: posts.length,
              adjustmentLineCount: posts.length,
              positiveAdjustmentQty,
              negativeAdjustmentQty,
            },
          }),
        );

        return this.loadDetailInTx(tx, company.companyId, countId);
      });
      return this.toDetailView(detail);
    });
  }

  async cancel(company: CompanyContext, countId: string): Promise<StockCountDetailView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const detail = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockCount(tx, company.companyId, countId);
        if (locked.status === StockCountStatus.CANCELLED) {
          return this.loadDetailInTx(tx, company.companyId, countId);
        }
        if (locked.status === StockCountStatus.POSTED) {
          throw new AppError({
            code: ERROR_CODES.STOCK_COUNT_CANCEL_NOT_ALLOWED,
            message: STOCK_COUNT_ERROR_MESSAGES.CANCEL_NOT_ALLOWED,
            statusCode: 409,
          });
        }

        const beforeStatus = locked.status;
        const now = new Date();
        await tx.stockCount.update({
          where: { id: countId },
          data: {
            status: StockCountStatus.CANCELLED,
            cancelledAt: now,
            cancelledById: actorUserId,
            version: { increment: 1 },
          },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.STOCK_COUNT_CANCELLED,
          entityType: AUDIT_ENTITY_TYPES.STOCK_COUNT,
          entityId: countId,
          before: { status: beforeStatus },
          after: { status: StockCountStatus.CANCELLED },
          metadata: {
            countId,
            countNumber: locked.number,
            status: StockCountStatus.CANCELLED,
          },
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_STOCK_COUNT_CANCELLED,
            payload: {
              companyId: company.companyId,
              countId,
              countNumber: locked.number,
              warehouseId: locked.warehouseId,
              status: StockCountStatus.CANCELLED,
            },
          }),
        );

        return this.loadDetailInTx(tx, company.companyId, countId);
      });
      return this.toDetailView(detail);
    });
  }

  async review(company: CompanyContext, countId: string): Promise<StockCountReviewView> {
    const row = await this.requireDetail(company.companyId, countId);
    if (!row.startedAt) {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Review is available after the count has started.',
        statusCode: 409,
      });
    }

    const metrics = await this.database.client.$transaction((tx) =>
      this.computeMetricsForItems(
        tx,
        company.companyId,
        countId,
        row.startedAt!,
        row.items,
      ),
    );

    const countView = this.toDetailViewSync(row, metrics);
    const lineViews = countView.items;

    let exactMatches = 0;
    let positiveDifferences = 0;
    let negativeDifferences = 0;
    let totalPositiveUnits = 0;
    let totalNegativeUnits = 0;
    let highDifferenceWarnings = 0;
    const threshold = row.highDifferenceThreshold;

    for (const line of lineViews) {
      if (line.lineStatus === StockCountLineStatus.SKIPPED) continue;
      const diff = line.difference;
      if (diff == null) continue;
      if (diff === 0) {
        exactMatches += 1;
      } else if (diff > 0) {
        positiveDifferences += 1;
        totalPositiveUnits += diff;
      } else {
        negativeDifferences += 1;
        totalNegativeUnits += diff;
      }
      if (threshold != null && Math.abs(diff) >= threshold) {
        highDifferenceWarnings += 1;
      }
    }

    const countedLines = lineViews.filter(
      (l) => l.lineStatus === StockCountLineStatus.COUNTED,
    ).length;
    const skippedLines = lineViews.filter(
      (l) => l.lineStatus === StockCountLineStatus.SKIPPED,
    ).length;

    const potentialClassificationMismatches = detectClassificationMismatches(
      lineViews,
      row.warehouseId,
    );
    const potentialLocationMismatches = detectLocationMismatches(
      lineViews,
      row.warehouseId,
    );

    return {
      count: countView,
      summary: {
        totalLines: lineViews.length,
        countedLines,
        skippedLines,
        exactMatches,
        positiveDifferences,
        negativeDifferences,
        totalPositiveUnits,
        totalNegativeUnits,
        highDifferenceWarnings,
      },
      potentialClassificationMismatches,
      potentialLocationMismatches,
    };
  }

  private async computeMetricsForItems(
    tx: Tx,
    companyId: string,
    countId: string,
    startedAt: Date,
    items: Array<{
      id: string;
      warehouseId: string;
      locationId: string;
      skuId: string;
      batchId: string;
      classification: StockClassification;
      snapshotQuantity: number;
      countedQuantity: number | null;
      lineStatus: StockCountLineStatus;
    }>,
  ): Promise<Map<string, ComputedLineMetrics>> {
    const map = new Map<string, ComputedLineMetrics>();
    for (const item of items) {
      const movementsDuringCount = await this.sumMovementsDuringCount(
        tx,
        companyId,
        countId,
        startedAt,
        {
          warehouseId: item.warehouseId,
          locationId: item.locationId,
          skuId: item.skuId,
          batchId: item.batchId,
          classification: item.classification,
        },
      );
      const expectedQuantity = item.snapshotQuantity + movementsDuringCount;
      let difference: number | null = null;
      if (item.lineStatus !== StockCountLineStatus.SKIPPED && item.countedQuantity != null) {
        difference = item.countedQuantity - expectedQuantity;
      }
      map.set(item.id, { movementsDuringCount, expectedQuantity, difference });
    }
    return map;
  }

  private async sumMovementsDuringCount(
    tx: Tx,
    companyId: string,
    countId: string,
    startedAt: Date,
    position: PositionKey,
  ): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ total: bigint | number | null }>>(Prisma.sql`
      SELECT COALESCE(SUM(quantity_delta), 0) AS total
      FROM inventory_movements
      WHERE company_id = ${companyId}::uuid
        AND warehouse_id = ${position.warehouseId}::uuid
        AND location_id = ${position.locationId}::uuid
        AND sku_id = ${position.skuId}::uuid
        AND batch_id = ${position.batchId}::uuid
        AND classification = ${position.classification}::"stock_classification"
        AND occurred_at >= ${startedAt}
        AND NOT (
          source_type = 'STOCK_COUNT'::inventory_source_type
          AND source_id = ${countId}::uuid
        )
    `);
    const total = rows[0]?.total ?? 0;
    return typeof total === 'bigint' ? Number(total) : Number(total);
  }

  private isInScope(
    count: {
      scopeLocations: { locationId: string }[];
      scopeSkus: { skuId: string }[];
      scopeClassifications: StockClassification[];
      allowDiscoveredItems: boolean;
    },
    locationId: string,
    skuId: string,
    classification: StockClassification,
    allowOutsideScope: boolean,
  ): boolean {
    if (allowOutsideScope) return true;
    const locationIds = count.scopeLocations.map((s) => s.locationId);
    const skuIds = count.scopeSkus.map((s) => s.skuId);
    if (locationIds.length && !locationIds.includes(locationId)) return false;
    if (skuIds.length && !skuIds.includes(skuId)) return false;
    if (count.scopeClassifications.length && !count.scopeClassifications.includes(classification)) {
      return false;
    }
    return true;
  }

  private async replaceScope(
    tx: Tx,
    companyId: string,
    countId: string,
    locationIds: string[],
    skuIds: string[],
  ): Promise<void> {
    await tx.stockCountScopeLocation.deleteMany({
      where: { stockCountId: countId, companyId },
    });
    await tx.stockCountScopeSku.deleteMany({
      where: { stockCountId: countId, companyId },
    });
    if (locationIds.length) {
      await tx.stockCountScopeLocation.createMany({
        data: locationIds.map((locationId) => ({
          companyId,
          stockCountId: countId,
          locationId,
        })),
        skipDuplicates: true,
      });
    }
    if (skuIds.length) {
      await tx.stockCountScopeSku.createMany({
        data: skuIds.map((skuId) => ({
          companyId,
          stockCountId: countId,
          skuId,
        })),
        skipDuplicates: true,
      });
    }
  }

  private async validateScopeRefs(
    tx: Tx,
    companyId: string,
    warehouseId: string,
    locationIds: string[] | undefined,
    skuIds: string[] | undefined,
  ): Promise<void> {
    if (locationIds?.length) {
      const locations = await tx.warehouseLocation.findMany({
        where: { companyId, id: { in: locationIds } },
      });
      if (locations.length !== locationIds.length) {
        throw new AppError({
          code: ERROR_CODES.WAREHOUSE_LOCATION_NOT_FOUND,
          message: 'One or more scope locations were not found.',
          statusCode: 404,
        });
      }
      for (const loc of locations) {
        if (loc.warehouseId !== warehouseId) {
          throw new AppError({
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'Scope location must belong to the count warehouse.',
            statusCode: 409,
          });
        }
        if (loc.status !== WarehouseStatus.ACTIVE) {
          throw new AppError({
            code: ERROR_CODES.STOCK_COUNT_LOCATION_INACTIVE,
            message: STOCK_COUNT_ERROR_MESSAGES.LOCATION_INACTIVE,
            statusCode: 409,
          });
        }
      }
    }

    if (skuIds?.length) {
      const skus = await tx.sku.findMany({
        where: { companyId, id: { in: skuIds } },
        select: { id: true },
      });
      if (skus.length !== skuIds.length) {
        throw new AppError({
          code: ERROR_CODES.SKU_NOT_FOUND,
          message: 'One or more scope SKUs were not found.',
          statusCode: 404,
        });
      }
    }
  }

  private async validateItemDimensions(
    tx: Tx,
    companyId: string,
    warehouseId: string,
    item: {
      locationId: string;
      skuId: string;
      batchId: string;
      classification: StockClassification;
    },
  ): Promise<void> {
    const [sku, batch, location] = await Promise.all([
      tx.sku.findFirst({ where: { id: item.skuId, companyId } }),
      tx.batch.findFirst({ where: { id: item.batchId, companyId } }),
      tx.warehouseLocation.findFirst({ where: { id: item.locationId, companyId } }),
    ]);

    if (!sku) {
      throw new AppError({
        code: ERROR_CODES.SKU_NOT_FOUND,
        message: 'SKU was not found.',
        statusCode: 404,
      });
    }
    if (!batch) {
      throw new AppError({
        code: ERROR_CODES.BATCH_NOT_FOUND,
        message: 'Batch was not found.',
        statusCode: 404,
      });
    }
    if (batch.skuId !== item.skuId) {
      throw new AppError({
        code: ERROR_CODES.STOCK_COUNT_BATCH_SKU_MISMATCH,
        message: STOCK_COUNT_ERROR_MESSAGES.BATCH_SKU_MISMATCH,
        statusCode: 409,
      });
    }
    if (!location) {
      throw new AppError({
        code: ERROR_CODES.WAREHOUSE_LOCATION_NOT_FOUND,
        message: 'Warehouse location was not found.',
        statusCode: 404,
      });
    }
    if (location.warehouseId !== warehouseId) {
      throw new AppError({
        code: ERROR_CODES.STOCK_COUNT_LOCATION_MISMATCH,
        message: STOCK_COUNT_ERROR_MESSAGES.LOCATION_MISMATCH,
        statusCode: 409,
      });
    }
    if (location.type === WarehouseLocationType.TRANSIT) {
      throw new AppError({
        code: ERROR_CODES.STOCK_COUNT_SYSTEM_WAREHOUSE,
        message: STOCK_COUNT_ERROR_MESSAGES.SYSTEM_WAREHOUSE,
        statusCode: 409,
      });
    }
    if (location.status !== WarehouseStatus.ACTIVE) {
      throw new AppError({
        code: ERROR_CODES.STOCK_COUNT_LOCATION_INACTIVE,
        message: STOCK_COUNT_ERROR_MESSAGES.LOCATION_INACTIVE,
        statusCode: 409,
      });
    }
  }

  private async assertOperationalWarehouse(
    tx: Tx,
    companyId: string,
    warehouseId: string,
  ): Promise<void> {
    const warehouse = await tx.warehouse.findFirst({
      where: { companyId, id: warehouseId },
    });
    if (!warehouse) {
      throw new AppError({
        code: ERROR_CODES.WAREHOUSE_NOT_FOUND,
        message: 'Warehouse was not found.',
        statusCode: 404,
      });
    }
    if (warehouse.isSystem || warehouse.code === SYSTEM_TRANSIT_WAREHOUSE_CODE) {
      throw new AppError({
        code: ERROR_CODES.STOCK_COUNT_SYSTEM_WAREHOUSE,
        message: STOCK_COUNT_ERROR_MESSAGES.SYSTEM_WAREHOUSE,
        statusCode: 409,
      });
    }
    if (warehouse.status !== WarehouseStatus.ACTIVE) {
      throw new AppError({
        code: ERROR_CODES.STOCK_COUNT_WAREHOUSE_INACTIVE,
        message: STOCK_COUNT_ERROR_MESSAGES.WAREHOUSE_INACTIVE,
        statusCode: 409,
      });
    }
  }

  private assertDraft(status: StockCountStatus): void {
    if (status !== StockCountStatus.DRAFT) {
      throw new AppError({
        code: ERROR_CODES.STOCK_COUNT_NOT_EDITABLE,
        message: STOCK_COUNT_ERROR_MESSAGES.NOT_EDITABLE,
        statusCode: 409,
      });
    }
  }

  private assertRecordable(status: StockCountStatus): void {
    if (
      status !== StockCountStatus.IN_PROGRESS &&
      status !== StockCountStatus.RECOUNT_REQUIRED
    ) {
      throw new AppError({
        code: ERROR_CODES.STOCK_COUNT_NOT_RECORDABLE,
        message: STOCK_COUNT_ERROR_MESSAGES.NOT_RECORDABLE,
        statusCode: 409,
      });
    }
  }

  private async lockCount(
    tx: Tx,
    companyId: string,
    countId: string,
  ): Promise<{
    id: string;
    number: string;
    status: StockCountStatus;
    warehouseId: string;
    startedAt: Date | null;
    notes: string | null;
    version: number;
  }> {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        number: string;
        status: StockCountStatus;
        warehouse_id: string;
        started_at: Date | null;
        notes: string | null;
        version: number;
      }>
    >(Prisma.sql`
      SELECT id, number, status, warehouse_id, started_at, notes, version
      FROM stock_counts
      WHERE id = ${countId}::uuid
        AND company_id = ${companyId}::uuid
      FOR UPDATE
    `);
    const row = rows[0];
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.STOCK_COUNT_NOT_FOUND,
        message: STOCK_COUNT_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return {
      id: row.id,
      number: row.number,
      status: row.status,
      warehouseId: row.warehouse_id,
      startedAt: row.started_at,
      notes: row.notes,
      version: row.version,
    };
  }

  private async requireDetail(companyId: string, countId: string): Promise<DetailRow> {
    const row = await this.database.client.stockCount.findFirst({
      where: { id: countId, companyId },
      include: detailInclude,
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.STOCK_COUNT_NOT_FOUND,
        message: STOCK_COUNT_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return row;
  }

  private async loadDetailInTx(
    tx: Tx,
    companyId: string,
    countId: string,
  ): Promise<DetailRow> {
    const row = await tx.stockCount.findFirst({
      where: { id: countId, companyId },
      include: detailInclude,
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.STOCK_COUNT_NOT_FOUND,
        message: STOCK_COUNT_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return row;
  }

  private async toDetailView(row: DetailRow): Promise<StockCountDetailView> {
    let metrics: Map<string, ComputedLineMetrics> | undefined;
    if (
      row.startedAt &&
      row.status !== StockCountStatus.DRAFT &&
      row.status !== StockCountStatus.CANCELLED &&
      row.status !== StockCountStatus.POSTED
    ) {
      metrics = await this.database.client.$transaction((tx) =>
        this.computeMetricsForItems(
          tx,
          row.companyId,
          row.id,
          row.startedAt!,
          row.items,
        ),
      );
    }
    return this.toDetailViewSync(row, metrics);
  }

  private toDetailViewSync(
    row: DetailRow,
    liveMetrics?: Map<string, ComputedLineMetrics>,
  ): StockCountDetailView {
    const hideSystemQtys =
      row.blindCount &&
      (row.status === StockCountStatus.IN_PROGRESS ||
        row.status === StockCountStatus.RECOUNT_REQUIRED);

    const items: StockCountItemView[] = row.items.map((item) =>
      this.mapItemRowToView(item, row, liveMetrics?.get(item.id) ?? null, hideSystemQtys),
    );

    const totalLines = items.length;
    const countedLines = items.filter(
      (i) => i.lineStatus === StockCountLineStatus.COUNTED,
    ).length;
    const skippedLines = items.filter(
      (i) => i.lineStatus === StockCountLineStatus.SKIPPED,
    ).length;
    const pendingLines = items.filter(
      (i) =>
        i.lineStatus === StockCountLineStatus.PENDING ||
        i.lineStatus === StockCountLineStatus.RECOUNT_REQUIRED,
    ).length;
    const matchLines = items.filter((i) => i.difference === 0).length;
    const differenceLines = items.filter(
      (i) => i.difference != null && i.difference !== 0,
    ).length;
    const actionable = totalLines - skippedLines;
    const percentCounted =
      actionable > 0 ? Math.round((countedLines / actionable) * 100) : 0;

    return {
      id: row.id,
      number: row.number,
      type: row.type,
      status: row.status,
      warehouse: row.warehouse,
      blindCount: row.blindCount,
      allowDiscoveredItems: row.allowDiscoveredItems,
      scopeClassifications: row.scopeClassifications,
      scopeLocationIds: row.scopeLocations.map((s) => s.locationId),
      scopeSkuIds: row.scopeSkus.map((s) => s.skuId),
      highDifferenceThreshold: row.highDifferenceThreshold,
      notes: row.notes,
      version: row.version,
      items,
      progress: {
        totalLines,
        countedLines,
        skippedLines,
        pendingLines,
        matchLines,
        differenceLines,
        percentCounted,
      },
      createdBy: row.createdBy,
      startedBy: row.startedBy,
      submittedBy: row.submittedBy,
      approvedBy: row.approvedBy,
      rejectedBy: row.rejectedBy,
      postedBy: row.postedBy,
      cancelledBy: row.cancelledBy,
      startedAt: row.startedAt?.toISOString() ?? null,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      recountRequestedAt: row.recountRequestedAt?.toISOString() ?? null,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      rejectedAt: row.rejectedAt?.toISOString() ?? null,
      postedAt: row.postedAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private mapItemRowToView(
    item: DetailRow['items'][number],
    row: DetailRow,
    live: ComputedLineMetrics | null,
    hideSystemQtys = false,
  ): StockCountItemView {
    const posted = row.status === StockCountStatus.POSTED;
    const movementsDuringCount = posted
      ? item.movementsDuringCount
      : (live?.movementsDuringCount ?? item.movementsDuringCount);
    const expectedQuantity = posted
      ? item.expectedQuantity
      : (live?.expectedQuantity ?? item.expectedQuantity);
    const difference = posted
      ? item.difference
      : (live?.difference ?? item.difference);

    const showSystem = !hideSystemQtys;
    const effectiveDifference =
      item.lineStatus === StockCountLineStatus.SKIPPED ? null : difference;

    return {
      id: item.id,
      warehouseId: item.warehouseId,
      location: {
        id: item.location.id,
        code: item.location.code,
        name: item.location.name,
        barcode: item.location.barcode,
        status: item.location.status,
        type: item.location.type,
        warehouseId: item.location.warehouseId,
      },
      skuId: item.skuId,
      skuCode: item.sku.code,
      skuName: item.sku.name,
      productName: item.sku.product?.name ?? null,
      batchId: item.batchId,
      batchNumber: item.batch.batchNumber,
      supplierBatchNumber: item.batch.supplierBatchNumber,
      classification: item.classification,
      snapshotQuantity: showSystem ? item.snapshotQuantity : null,
      countedQuantity: item.countedQuantity,
      movementsDuringCount: showSystem ? movementsDuringCount : null,
      expectedQuantity: showSystem ? expectedQuantity : null,
      difference: showSystem ? effectiveDifference : null,
      lineStatus: item.lineStatus,
      isDiscovered: item.isDiscovered,
      differenceLabel: showSystem
        ? formatDifferenceLabel(item.lineStatus, effectiveDifference)
        : null,
      countedBy: item.countedBy,
      countedAt: item.countedAt?.toISOString() ?? null,
      notes: item.notes,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private emptyItemPlaceholder(): StockCountItemView {
    return {
      id: '',
      warehouseId: '',
      location: {
        id: '',
        code: '',
        name: null,
        barcode: '',
        status: '',
        type: '',
        warehouseId: '',
      },
      skuId: '',
      skuCode: '',
      skuName: null,
      productName: null,
      batchId: '',
      batchNumber: '',
      supplierBatchNumber: null,
      classification: StockClassification.SELLABLE,
      snapshotQuantity: null,
      countedQuantity: null,
      movementsDuringCount: null,
      expectedQuantity: null,
      difference: null,
      lineStatus: StockCountLineStatus.PENDING,
      isDiscovered: false,
      differenceLabel: null,
      countedBy: null,
      countedAt: null,
      notes: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
  }

  private requireActorUserId(): string {
    const userId = getRequestContext()?.userId;
    if (!userId) {
      throw new AppError({
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Authentication required.',
        statusCode: 401,
      });
    }
    return userId;
  }
}

function normalizeSearch(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, STOCK_COUNT_SEARCH_MAX_LENGTH);
}

function buildScopeSummary(
  type: StockCountType,
  locationCount: number,
  skuCount: number,
  classificationCount: number,
): string {
  if (type === StockCountType.FULL && !locationCount && !skuCount && !classificationCount) {
    return 'Full warehouse';
  }
  const parts: string[] = [];
  if (locationCount) parts.push(`${locationCount} location${locationCount === 1 ? '' : 's'}`);
  if (skuCount) parts.push(`${skuCount} SKU${skuCount === 1 ? '' : 's'}`);
  if (classificationCount) {
    parts.push(`${classificationCount} classification${classificationCount === 1 ? '' : 's'}`);
  }
  if (!parts.length) {
    return type === StockCountType.CYCLE ? 'Cycle (warehouse-wide)' : 'Full warehouse';
  }
  return parts.join(', ');
}

function formatDifferenceLabel(
  lineStatus: StockCountLineStatus,
  difference: number | null,
): string | null {
  if (lineStatus === StockCountLineStatus.SKIPPED) return 'Skipped';
  if (difference == null) return null;
  if (difference === 0) return 'Match';
  if (difference > 0) return `+${difference}`;
  return String(difference);
}

function detectClassificationMismatches(
  lines: StockCountItemView[],
  warehouseId: string,
): StockCountReviewView['potentialClassificationMismatches'] {
  const groups = new Map<
    string,
    StockCountReviewView['potentialClassificationMismatches'][number]
  >();

  for (const line of lines) {
    if (line.difference == null || line.difference === 0) continue;
    if (line.lineStatus === StockCountLineStatus.SKIPPED) continue;
    const key = `${line.skuId}|${line.batchId}|${warehouseId}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        skuId: line.skuId,
        skuCode: line.skuCode,
        batchId: line.batchId,
        batchNumber: line.batchNumber,
        warehouseId,
        lines: [],
      };
      groups.set(key, group);
    }
    group.lines.push({
      itemId: line.id,
      locationId: line.location.id,
      classification: line.classification,
      difference: line.difference,
    });
  }

  return [...groups.values()].filter((g) => hasOpposingDiffs(g.lines.map((l) => l.difference)));
}

function detectLocationMismatches(
  lines: StockCountItemView[],
  warehouseId: string,
): StockCountReviewView['potentialLocationMismatches'] {
  const groups = new Map<
    string,
    StockCountReviewView['potentialLocationMismatches'][number]
  >();

  for (const line of lines) {
    if (line.difference == null || line.difference === 0) continue;
    if (line.lineStatus === StockCountLineStatus.SKIPPED) continue;
    const key = `${line.skuId}|${line.batchId}|${line.classification}|${warehouseId}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        skuId: line.skuId,
        skuCode: line.skuCode,
        batchId: line.batchId,
        batchNumber: line.batchNumber,
        classification: line.classification,
        warehouseId,
        lines: [],
      };
      groups.set(key, group);
    }
    group.lines.push({
      itemId: line.id,
      locationId: line.location.id,
      locationCode: line.location.code,
      difference: line.difference,
    });
  }

  return [...groups.values()].filter((g) => hasOpposingDiffs(g.lines.map((l) => l.difference)));
}

function hasOpposingDiffs(diffs: number[]): boolean {
  let hasPositive = false;
  let hasNegative = false;
  for (const d of diffs) {
    if (d > 0) hasPositive = true;
    if (d < 0) hasNegative = true;
    if (hasPositive && hasNegative) return true;
  }
  return false;
}
