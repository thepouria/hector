import { Injectable } from '@nestjs/common';
import {
  ensureSystemTransitPosition,
  InventoryMovementType,
  InventorySourceType,
  Prisma,
  StockClassification,
  StockTransferStatus,
  SYSTEM_TRANSIT_WAREHOUSE_CODE,
  WarehouseLocationType,
  WarehouseStatus,
} from '@hector/database';
import { randomUUID } from 'node:crypto';
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
import { InventoryLedgerService, type PostMovementInput } from './inventory-ledger.service';
import { normalizeLocationBarcodeInput } from './location-barcode.util';
import {
  allocateStockTransferSequence,
  formatStockTransferNumber,
} from './stock-transfer-numbering';
import {
  STOCK_TRANSFER_ERROR_MESSAGES,
  STOCK_TRANSFER_SEARCH_MAX_LENGTH,
} from './stock-transfer.constants';
import type {
  CreateStockTransferDto,
  ListStockTransfersQueryDto,
  ScanApplyStockTransferDto,
  StockTransferItemInputDto,
  UpdateStockTransferDto,
  UpsertStockTransferItemDto,
} from './dto/stock-transfer.dto';
import type {
  StockTransferDetailView,
  StockTransferItemView,
  StockTransferListItemView,
  StockTransferScanApplyResultView,
} from './types/stock-transfer.types';

const detailInclude = {
  sourceWarehouse: {
    select: { id: true, code: true, name: true, status: true, isSystem: true },
  },
  destinationWarehouse: {
    select: { id: true, code: true, name: true, status: true, isSystem: true },
  },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  dispatchedBy: { select: { id: true, firstName: true, lastName: true } },
  completedBy: { select: { id: true, firstName: true, lastName: true } },
  cancelledBy: { select: { id: true, firstName: true, lastName: true } },
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
      sourceLocation: true,
      destinationLocation: true,
    },
  },
} satisfies Prisma.StockTransferInclude;

type DetailRow = Prisma.StockTransferGetPayload<{ include: typeof detailInclude }>;
type Tx = Prisma.TransactionClient;

/**
 * Internal stock transfer workflow (Phase 3.11).
 * All quantity changes go through InventoryLedgerService (TRANSFER_OUT/IN pairs).
 * DRAFT does not reserve stock. Dispatch → transit; Complete → destination.
 */
@Injectable()
export class StockTransfersService {
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
    query: ListStockTransfersQueryDto,
  ): Promise<{ data: StockTransferListItemView[]; meta: PaginationMeta }> {
    const search = normalizeSearch(query.q);
    const where: Prisma.StockTransferWhereInput = {
      companyId: company.companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.sourceWarehouseId ? { sourceWarehouseId: query.sourceWarehouseId } : {}),
      ...(query.destinationWarehouseId
        ? { destinationWarehouseId: query.destinationWarehouseId }
        : {}),
      ...(query.skuId ? { items: { some: { skuId: query.skuId } } } : {}),
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
              { externalReference: { contains: search, mode: 'insensitive' } },
              { sourceWarehouse: { code: { contains: search, mode: 'insensitive' } } },
              {
                destinationWarehouse: { code: { contains: search, mode: 'insensitive' } },
              },
            ],
          }
        : {}),
    };

    const skip = (query.page - 1) * query.pageSize;
    const [total, rows] = await this.database.client.$transaction([
      this.database.client.stockTransfer.count({ where }),
      this.database.client.stockTransfer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.pageSize,
        include: {
          sourceWarehouse: {
            select: { id: true, code: true, name: true, status: true, isSystem: true },
          },
          destinationWarehouse: {
            select: { id: true, code: true, name: true, status: true, isSystem: true },
          },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          items: { select: { quantity: true } },
        },
      }),
    ]);

    return {
      data: rows.map((row) => ({
        id: row.id,
        number: row.number,
        status: row.status,
        sourceWarehouse: row.sourceWarehouse,
        destinationWarehouse: row.destinationWarehouse,
        itemCount: row.items.length,
        totalQuantity: row.items.reduce((sum, i) => sum + i.quantity, 0),
        notes: row.notes,
        externalReference: row.externalReference,
        createdBy: row.createdBy,
        dispatchedAt: row.dispatchedAt?.toISOString() ?? null,
        completedAt: row.completedAt?.toISOString() ?? null,
        cancelledAt: row.cancelledAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async get(company: CompanyContext, transferId: string): Promise<StockTransferDetailView> {
    const row = await this.requireDetail(company.companyId, transferId);
    return this.toDetailView(row);
  }

  async create(
    company: CompanyContext,
    dto: CreateStockTransferDto,
  ): Promise<StockTransferDetailView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const created = await this.database.client.$transaction(async (tx) => {
        await this.assertOperationalWarehouses(
          tx,
          company.companyId,
          dto.sourceWarehouseId,
          dto.destinationWarehouseId,
        );
        // Ensure transit exists early so company is transfer-ready.
        await ensureSystemTransitPosition(tx, company.companyId);

        const seq = await allocateStockTransferSequence(tx, company.companyId);
        const number = formatStockTransferNumber(seq);
        const transfer = await tx.stockTransfer.create({
          data: {
            companyId: company.companyId,
            number,
            sourceWarehouseId: dto.sourceWarehouseId,
            destinationWarehouseId: dto.destinationWarehouseId,
            notes: dto.notes ?? null,
            externalReference: dto.externalReference ?? null,
            createdById: actorUserId,
            status: StockTransferStatus.DRAFT,
          },
        });

        if (dto.items?.length) {
          for (const item of dto.items) {
            await this.insertItem(tx, company.companyId, transfer, item);
          }
        }

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.STOCK_TRANSFER_CREATED,
          entityType: AUDIT_ENTITY_TYPES.STOCK_TRANSFER,
          entityId: transfer.id,
          before: null,
          after: {
            number: transfer.number,
            sourceWarehouseId: transfer.sourceWarehouseId,
            destinationWarehouseId: transfer.destinationWarehouseId,
            itemCount: dto.items?.length ?? 0,
            status: StockTransferStatus.DRAFT,
          },
          metadata: {
            transferId: transfer.id,
            transferNumber: transfer.number,
            sourceWarehouseId: transfer.sourceWarehouseId,
            destinationWarehouseId: transfer.destinationWarehouseId,
            itemCount: dto.items?.length ?? 0,
            status: StockTransferStatus.DRAFT,
          },
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_STOCK_TRANSFER_CREATED,
            payload: {
              companyId: company.companyId,
              transferId: transfer.id,
              transferNumber: transfer.number,
              sourceWarehouseId: transfer.sourceWarehouseId,
              destinationWarehouseId: transfer.destinationWarehouseId,
              itemCount: dto.items?.length ?? 0,
              status: StockTransferStatus.DRAFT,
            },
          }),
        );

        return this.loadDetailInTx(tx, company.companyId, transfer.id);
      });
      return this.toDetailView(created);
    });
  }

  async update(
    company: CompanyContext,
    transferId: string,
    dto: UpdateStockTransferDto,
  ): Promise<StockTransferDetailView> {
    return commitThenPublish(this.eventBus, async (events) => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockTransfer(tx, company.companyId, transferId);
        if (locked.status !== StockTransferStatus.DRAFT) {
          throw new AppError({
            code: ERROR_CODES.STOCK_TRANSFER_NOT_EDITABLE,
            message: STOCK_TRANSFER_ERROR_MESSAGES.NOT_EDITABLE,
            statusCode: 409,
          });
        }

        const sourceWarehouseId = dto.sourceWarehouseId ?? locked.sourceWarehouseId;
        const destinationWarehouseId =
          dto.destinationWarehouseId ?? locked.destinationWarehouseId;
        await this.assertOperationalWarehouses(
          tx,
          company.companyId,
          sourceWarehouseId,
          destinationWarehouseId,
        );

        await tx.stockTransfer.update({
          where: { id: transferId },
          data: {
            sourceWarehouseId,
            destinationWarehouseId,
            ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
            ...(dto.externalReference !== undefined
              ? { externalReference: dto.externalReference }
              : {}),
            version: { increment: 1 },
          },
        });

        if (dto.items) {
          await tx.stockTransferItem.deleteMany({
            where: { transferId, companyId: company.companyId },
          });
          const header = {
            id: transferId,
            sourceWarehouseId,
            destinationWarehouseId,
          };
          for (const item of dto.items) {
            await this.insertItem(tx, company.companyId, header, item);
          }
        }

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.STOCK_TRANSFER_UPDATED,
          entityType: AUDIT_ENTITY_TYPES.STOCK_TRANSFER,
          entityId: transferId,
          before: {
            sourceWarehouseId: locked.sourceWarehouseId,
            destinationWarehouseId: locked.destinationWarehouseId,
            status: locked.status,
          },
          after: {
            sourceWarehouseId,
            destinationWarehouseId,
            status: StockTransferStatus.DRAFT,
            ...(dto.items ? { itemCount: dto.items.length } : {}),
          },
          metadata: {
            transferId,
            transferNumber: locked.number,
            status: StockTransferStatus.DRAFT,
          },
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_STOCK_TRANSFER_UPDATED,
            payload: {
              companyId: company.companyId,
              transferId,
              transferNumber: locked.number,
              sourceWarehouseId,
              destinationWarehouseId,
              status: StockTransferStatus.DRAFT,
            },
          }),
        );

        return this.loadDetailInTx(tx, company.companyId, transferId);
      });
      return this.toDetailView(updated);
    });
  }

  async upsertItem(
    company: CompanyContext,
    transferId: string,
    dto: UpsertStockTransferItemDto,
  ): Promise<StockTransferDetailView> {
    return commitThenPublish(this.eventBus, async (events) => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockTransfer(tx, company.companyId, transferId);
        this.assertDraft(locked.status);

        const classification = dto.classification ?? StockClassification.SELLABLE;
        const existing = await tx.stockTransferItem.findUnique({
          where: {
            transferId_skuId_batchId_classification_sourceLocationId_destinationLocationId: {
              transferId,
              skuId: dto.skuId,
              batchId: dto.batchId,
              classification,
              sourceLocationId: dto.sourceLocationId,
              destinationLocationId: dto.destinationLocationId,
            },
          },
        });

        if (existing && dto.increment) {
          await tx.stockTransferItem.update({
            where: { id: existing.id },
            data: { quantity: existing.quantity + dto.quantity, notes: dto.notes ?? existing.notes },
          });
        } else if (existing) {
          await this.validateItemDimensions(tx, company.companyId, locked, {
            ...dto,
            classification,
          });
          await tx.stockTransferItem.update({
            where: { id: existing.id },
            data: { quantity: dto.quantity, notes: dto.notes ?? null },
          });
        } else {
          await this.insertItem(tx, company.companyId, locked, { ...dto, classification });
        }

        await tx.stockTransfer.update({
          where: { id: transferId },
          data: { version: { increment: 1 } },
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_STOCK_TRANSFER_UPDATED,
            payload: {
              companyId: company.companyId,
              transferId,
              transferNumber: locked.number,
              sourceWarehouseId: locked.sourceWarehouseId,
              destinationWarehouseId: locked.destinationWarehouseId,
              status: StockTransferStatus.DRAFT,
            },
          }),
        );

        return this.loadDetailInTx(tx, company.companyId, transferId);
      });
      return this.toDetailView(updated);
    });
  }

  async removeItem(
    company: CompanyContext,
    transferId: string,
    itemId: string,
  ): Promise<StockTransferDetailView> {
    return commitThenPublish(this.eventBus, async (events) => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockTransfer(tx, company.companyId, transferId);
        this.assertDraft(locked.status);
        const deleted = await tx.stockTransferItem.deleteMany({
          where: { id: itemId, transferId, companyId: company.companyId },
        });
        if (deleted.count === 0) {
          throw new AppError({
            code: ERROR_CODES.STOCK_TRANSFER_ITEM_NOT_FOUND,
            message: STOCK_TRANSFER_ERROR_MESSAGES.ITEM_NOT_FOUND,
            statusCode: 404,
          });
        }
        await tx.stockTransfer.update({
          where: { id: transferId },
          data: { version: { increment: 1 } },
        });
        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_STOCK_TRANSFER_UPDATED,
            payload: {
              companyId: company.companyId,
              transferId,
              transferNumber: locked.number,
              sourceWarehouseId: locked.sourceWarehouseId,
              destinationWarehouseId: locked.destinationWarehouseId,
              status: StockTransferStatus.DRAFT,
            },
          }),
        );
        return this.loadDetailInTx(tx, company.companyId, transferId);
      });
      return this.toDetailView(updated);
    });
  }

  async scanApply(
    company: CompanyContext,
    transferId: string,
    dto: ScanApplyStockTransferDto,
  ): Promise<StockTransferScanApplyResultView> {
    const existing = await this.database.client.stockTransferScanRequest.findUnique({
      where: {
        companyId_transferId_requestId: {
          companyId: company.companyId,
          transferId,
          requestId: dto.requestId,
        },
      },
    });
    if (existing) {
      return existing.responseJson as unknown as StockTransferScanApplyResultView;
    }

    const transfer = await this.requireDetail(company.companyId, transferId);
    if (transfer.status !== StockTransferStatus.DRAFT) {
      throw new AppError({
        code: ERROR_CODES.STOCK_TRANSFER_NOT_EDITABLE,
        message: STOCK_TRANSFER_ERROR_MESSAGES.NOT_EDITABLE,
        statusCode: 409,
      });
    }

    const sourceBarcode = dto.sourceLocationBarcode
      ? normalizeLocationBarcodeInput(dto.sourceLocationBarcode)
      : null;
    const destBarcode = dto.destinationLocationBarcode
      ? normalizeLocationBarcodeInput(dto.destinationLocationBarcode)
      : null;

    if (!sourceBarcode || !destBarcode || !dto.productBarcode) {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message:
          'Scan apply requires sourceLocationBarcode, destinationLocationBarcode, and productBarcode.',
        statusCode: 400,
      });
    }

    const [sourceLoc, destLoc] = await Promise.all([
      this.database.client.warehouseLocation.findFirst({
        where: { companyId: company.companyId, barcode: sourceBarcode },
      }),
      this.database.client.warehouseLocation.findFirst({
        where: { companyId: company.companyId, barcode: destBarcode },
      }),
    ]);
    if (!sourceLoc) {
      throw new AppError({
        code: ERROR_CODES.UNKNOWN_LOCATION_BARCODE,
        message: STOCK_TRANSFER_ERROR_MESSAGES.UNKNOWN_LOCATION_BARCODE,
        statusCode: 404,
      });
    }
    if (!destLoc) {
      throw new AppError({
        code: ERROR_CODES.UNKNOWN_LOCATION_BARCODE,
        message: STOCK_TRANSFER_ERROR_MESSAGES.UNKNOWN_LOCATION_BARCODE,
        statusCode: 404,
      });
    }
    if (sourceLoc.warehouseId !== transfer.sourceWarehouseId) {
      throw new AppError({
        code: ERROR_CODES.STOCK_TRANSFER_LOCATION_WAREHOUSE_MISMATCH,
        message: STOCK_TRANSFER_ERROR_MESSAGES.LOCATION_WAREHOUSE_MISMATCH,
        statusCode: 409,
      });
    }
    if (destLoc.warehouseId !== transfer.destinationWarehouseId) {
      throw new AppError({
        code: ERROR_CODES.STOCK_TRANSFER_LOCATION_WAREHOUSE_MISMATCH,
        message: STOCK_TRANSFER_ERROR_MESSAGES.LOCATION_WAREHOUSE_MISMATCH,
        statusCode: 409,
      });
    }

    const resolved = await this.barcodesService.resolve(company, dto.productBarcode);
    if (!resolved.sku?.id) {
      throw new AppError({
        code: ERROR_CODES.BARCODE_NOT_FOUND,
        message: STOCK_TRANSFER_ERROR_MESSAGES.UNKNOWN_PRODUCT_BARCODE,
        statusCode: 404,
      });
    }

    const classification = dto.classification ?? StockClassification.SELLABLE;
    let batchId = dto.batchId;
    if (!batchId) {
      const balances = await this.database.client.inventoryBalance.findMany({
        where: {
          companyId: company.companyId,
          warehouseId: transfer.sourceWarehouseId,
          locationId: sourceLoc.id,
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
          message: 'batchId is required when multiple batches have On Hand at the source location.',
          statusCode: 400,
        });
      }
    }

    const quantity = dto.quantity ?? 1;
    const beforeIds = new Set(transfer.items.map((i) => i.id));
    const detail = await this.upsertItem(company, transferId, {
      skuId: resolved.sku.id,
      batchId,
      sourceLocationId: sourceLoc.id,
      destinationLocationId: destLoc.id,
      classification,
      quantity,
      increment: true,
    });
    const item =
      detail.items.find(
        (i) =>
          i.skuId === resolved.sku.id &&
          i.batchId === batchId &&
          i.classification === classification &&
          i.sourceLocation.id === sourceLoc.id &&
          i.destinationLocation.id === destLoc.id,
      ) ?? detail.items[detail.items.length - 1]!;
    const result: StockTransferScanApplyResultView = {
      transfer: detail,
      item,
      incremented: beforeIds.has(item.id),
    };

    await this.database.client.stockTransferScanRequest.create({
      data: {
        companyId: company.companyId,
        transferId,
        requestId: dto.requestId,
        responseJson: result as unknown as Prisma.InputJsonValue,
      },
    });
    return result;
  }

  async dispatch(
    company: CompanyContext,
    transferId: string,
  ): Promise<StockTransferDetailView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const detail = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockTransfer(tx, company.companyId, transferId);
        if (locked.status === StockTransferStatus.IN_TRANSIT) {
          return this.loadDetailInTx(tx, company.companyId, transferId);
        }
        if (locked.status === StockTransferStatus.COMPLETED) {
          throw new AppError({
            code: ERROR_CODES.STOCK_TRANSFER_NOT_DISPATCHABLE,
            message: STOCK_TRANSFER_ERROR_MESSAGES.NOT_DISPATCHABLE,
            statusCode: 409,
          });
        }
        if (locked.status !== StockTransferStatus.DRAFT) {
          throw new AppError({
            code: ERROR_CODES.STOCK_TRANSFER_NOT_DISPATCHABLE,
            message: STOCK_TRANSFER_ERROR_MESSAGES.NOT_DISPATCHABLE,
            statusCode: 409,
          });
        }

        const items = await tx.stockTransferItem.findMany({
          where: { transferId, companyId: company.companyId },
          include: {
            batch: { select: { skuId: true } },
            sourceLocation: true,
            destinationLocation: true,
          },
          orderBy: { id: 'asc' },
        });
        if (items.length === 0) {
          throw new AppError({
            code: ERROR_CODES.STOCK_TRANSFER_EMPTY,
            message: STOCK_TRANSFER_ERROR_MESSAGES.EMPTY,
            statusCode: 409,
          });
        }

        await this.assertOperationalWarehouses(
          tx,
          company.companyId,
          locked.sourceWarehouseId,
          locked.destinationWarehouseId,
        );
        const transit = await ensureSystemTransitPosition(tx, company.companyId);
        const occurredAt = new Date();
        const posts: PostMovementInput[] = [];

        for (const item of items) {
          await this.validateItemDimensions(tx, company.companyId, locked, {
            skuId: item.skuId,
            batchId: item.batchId,
            sourceLocationId: item.sourceLocationId,
            destinationLocationId: item.destinationLocationId,
            quantity: item.quantity,
          });
          if (item.destinationLocation.status !== WarehouseStatus.ACTIVE) {
            throw new AppError({
              code: ERROR_CODES.STOCK_TRANSFER_LOCATION_INACTIVE,
              message: STOCK_TRANSFER_ERROR_MESSAGES.LOCATION_INACTIVE,
              statusCode: 409,
            });
          }

          const operationId = randomUUID();
          await tx.stockTransferItem.update({
            where: { id: item.id },
            data: { dispatchOperationId: operationId },
          });

          posts.push(
            {
              warehouseId: locked.sourceWarehouseId,
              locationId: item.sourceLocationId,
              skuId: item.skuId,
              batchId: item.batchId,
              classification: item.classification,
              movementType: InventoryMovementType.TRANSFER_OUT,
              quantityDelta: -item.quantity,
              sourceType: InventorySourceType.TRANSFER,
              sourceId: transferId,
              sourceLineId: item.id,
              operationId,
              occurredAt,
              actorUserId,
              notes: `TRF dispatch ${locked.number}`,
            },
            {
              warehouseId: transit.warehouseId,
              locationId: transit.locationId,
              skuId: item.skuId,
              batchId: item.batchId,
              classification: item.classification,
              movementType: InventoryMovementType.TRANSFER_IN,
              quantityDelta: item.quantity,
              sourceType: InventorySourceType.TRANSFER,
              sourceId: transferId,
              sourceLineId: item.id,
              operationId,
              occurredAt,
              actorUserId,
              notes: `TRF dispatch ${locked.number}`,
            },
          );
        }

        await this.inventoryLedger.postMovementsInTx(tx, company.companyId, posts, {
          recordAudit: true,
        });

        await tx.stockTransfer.update({
          where: { id: transferId },
          data: {
            status: StockTransferStatus.IN_TRANSIT,
            dispatchedAt: occurredAt,
            dispatchedById: actorUserId,
            version: { increment: 1 },
          },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.STOCK_TRANSFER_DISPATCHED,
          entityType: AUDIT_ENTITY_TYPES.STOCK_TRANSFER,
          entityId: transferId,
          before: { status: StockTransferStatus.DRAFT },
          after: {
            status: StockTransferStatus.IN_TRANSIT,
            itemCount: items.length,
          },
          metadata: {
            transferId,
            transferNumber: locked.number,
            sourceWarehouseId: locked.sourceWarehouseId,
            destinationWarehouseId: locked.destinationWarehouseId,
            itemCount: items.length,
            status: StockTransferStatus.IN_TRANSIT,
          },
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_STOCK_TRANSFER_DISPATCHED,
            payload: {
              companyId: company.companyId,
              transferId,
              transferNumber: locked.number,
              sourceWarehouseId: locked.sourceWarehouseId,
              destinationWarehouseId: locked.destinationWarehouseId,
              itemCount: items.length,
              status: StockTransferStatus.IN_TRANSIT,
            },
          }),
        );

        return this.loadDetailInTx(tx, company.companyId, transferId);
      });
      return this.toDetailView(detail);
    });
  }

  async complete(
    company: CompanyContext,
    transferId: string,
  ): Promise<StockTransferDetailView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const detail = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockTransfer(tx, company.companyId, transferId);
        if (locked.status === StockTransferStatus.COMPLETED) {
          return this.loadDetailInTx(tx, company.companyId, transferId);
        }
        if (locked.status !== StockTransferStatus.IN_TRANSIT) {
          throw new AppError({
            code: ERROR_CODES.STOCK_TRANSFER_NOT_COMPLETABLE,
            message: STOCK_TRANSFER_ERROR_MESSAGES.NOT_COMPLETABLE,
            statusCode: 409,
          });
        }

        const items = await tx.stockTransferItem.findMany({
          where: { transferId, companyId: company.companyId },
          orderBy: { id: 'asc' },
        });
        const transit = await ensureSystemTransitPosition(tx, company.companyId);
        const occurredAt = new Date();
        const posts: PostMovementInput[] = [];

        for (const item of items) {
          const operationId = randomUUID();
          await tx.stockTransferItem.update({
            where: { id: item.id },
            data: { completeOperationId: operationId },
          });
          posts.push(
            {
              warehouseId: transit.warehouseId,
              locationId: transit.locationId,
              skuId: item.skuId,
              batchId: item.batchId,
              classification: item.classification,
              movementType: InventoryMovementType.TRANSFER_OUT,
              quantityDelta: -item.quantity,
              sourceType: InventorySourceType.TRANSFER,
              sourceId: transferId,
              sourceLineId: item.completeSourceLineId,
              operationId,
              occurredAt,
              actorUserId,
              notes: `TRF complete ${locked.number}`,
            },
            {
              warehouseId: locked.destinationWarehouseId,
              locationId: item.destinationLocationId,
              skuId: item.skuId,
              batchId: item.batchId,
              classification: item.classification,
              movementType: InventoryMovementType.TRANSFER_IN,
              quantityDelta: item.quantity,
              sourceType: InventorySourceType.TRANSFER,
              sourceId: transferId,
              sourceLineId: item.completeSourceLineId,
              operationId,
              occurredAt,
              actorUserId,
              notes: `TRF complete ${locked.number}`,
            },
          );
        }

        await this.inventoryLedger.postMovementsInTx(tx, company.companyId, posts, {
          recordAudit: true,
        });

        await tx.stockTransfer.update({
          where: { id: transferId },
          data: {
            status: StockTransferStatus.COMPLETED,
            completedAt: occurredAt,
            completedById: actorUserId,
            version: { increment: 1 },
          },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.STOCK_TRANSFER_COMPLETED,
          entityType: AUDIT_ENTITY_TYPES.STOCK_TRANSFER,
          entityId: transferId,
          before: { status: StockTransferStatus.IN_TRANSIT },
          after: { status: StockTransferStatus.COMPLETED, itemCount: items.length },
          metadata: {
            transferId,
            transferNumber: locked.number,
            sourceWarehouseId: locked.sourceWarehouseId,
            destinationWarehouseId: locked.destinationWarehouseId,
            itemCount: items.length,
            status: StockTransferStatus.COMPLETED,
          },
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_STOCK_TRANSFER_COMPLETED,
            payload: {
              companyId: company.companyId,
              transferId,
              transferNumber: locked.number,
              sourceWarehouseId: locked.sourceWarehouseId,
              destinationWarehouseId: locked.destinationWarehouseId,
              itemCount: items.length,
              status: StockTransferStatus.COMPLETED,
            },
          }),
        );

        return this.loadDetailInTx(tx, company.companyId, transferId);
      });
      return this.toDetailView(detail);
    });
  }

  async cancel(
    company: CompanyContext,
    transferId: string,
  ): Promise<StockTransferDetailView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const detail = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockTransfer(tx, company.companyId, transferId);
        if (locked.status === StockTransferStatus.CANCELLED) {
          return this.loadDetailInTx(tx, company.companyId, transferId);
        }
        if (locked.status === StockTransferStatus.COMPLETED) {
          throw new AppError({
            code: ERROR_CODES.STOCK_TRANSFER_CANCEL_NOT_ALLOWED,
            message: STOCK_TRANSFER_ERROR_MESSAGES.CANCEL_NOT_ALLOWED,
            statusCode: 409,
          });
        }

        const occurredAt = new Date();

        if (locked.status === StockTransferStatus.IN_TRANSIT) {
          const items = await tx.stockTransferItem.findMany({
            where: { transferId, companyId: company.companyId },
            orderBy: { id: 'asc' },
          });
          const transit = await ensureSystemTransitPosition(tx, company.companyId);
          const posts: PostMovementInput[] = [];
          for (const item of items) {
            const operationId = randomUUID();
            await tx.stockTransferItem.update({
              where: { id: item.id },
              data: { cancelOperationId: operationId },
            });
            posts.push(
              {
                warehouseId: transit.warehouseId,
                locationId: transit.locationId,
                skuId: item.skuId,
                batchId: item.batchId,
                classification: item.classification,
                movementType: InventoryMovementType.TRANSFER_OUT,
                quantityDelta: -item.quantity,
                sourceType: InventorySourceType.TRANSFER,
                sourceId: transferId,
                sourceLineId: item.cancelSourceLineId,
                operationId,
                occurredAt,
                actorUserId,
                notes: `TRF cancel-return ${locked.number}`,
              },
              {
                warehouseId: locked.sourceWarehouseId,
                locationId: item.sourceLocationId,
                skuId: item.skuId,
                batchId: item.batchId,
                classification: item.classification,
                movementType: InventoryMovementType.TRANSFER_IN,
                quantityDelta: item.quantity,
                sourceType: InventorySourceType.TRANSFER,
                sourceId: transferId,
                sourceLineId: item.cancelSourceLineId,
                operationId,
                occurredAt,
                actorUserId,
                notes: `TRF cancel-return ${locked.number}`,
              },
            );
          }
          await this.inventoryLedger.postMovementsInTx(tx, company.companyId, posts, {
            recordAudit: true,
          });
        }

        await tx.stockTransfer.update({
          where: { id: transferId },
          data: {
            status: StockTransferStatus.CANCELLED,
            cancelledAt: occurredAt,
            cancelledById: actorUserId,
            version: { increment: 1 },
          },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.STOCK_TRANSFER_CANCELLED,
          entityType: AUDIT_ENTITY_TYPES.STOCK_TRANSFER,
          entityId: transferId,
          before: { status: locked.status },
          after: { status: StockTransferStatus.CANCELLED },
          metadata: {
            transferId,
            transferNumber: locked.number,
            sourceWarehouseId: locked.sourceWarehouseId,
            destinationWarehouseId: locked.destinationWarehouseId,
            status: StockTransferStatus.CANCELLED,
            returnedToSource: locked.status === StockTransferStatus.IN_TRANSIT,
          },
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_STOCK_TRANSFER_CANCELLED,
            payload: {
              companyId: company.companyId,
              transferId,
              transferNumber: locked.number,
              sourceWarehouseId: locked.sourceWarehouseId,
              destinationWarehouseId: locked.destinationWarehouseId,
              status: StockTransferStatus.CANCELLED,
              returnedToSource: locked.status === StockTransferStatus.IN_TRANSIT,
            },
          }),
        );

        return this.loadDetailInTx(tx, company.companyId, transferId);
      });
      return this.toDetailView(detail);
    });
  }

  private async insertItem(
    tx: Tx,
    companyId: string,
    transfer: {
      id: string;
      sourceWarehouseId: string;
      destinationWarehouseId: string;
    },
    item: StockTransferItemInputDto,
  ): Promise<void> {
    await this.validateItemDimensions(tx, companyId, transfer, item);
    const classification = item.classification ?? StockClassification.SELLABLE;
    await tx.stockTransferItem.create({
      data: {
        companyId,
        transferId: transfer.id,
        skuId: item.skuId,
        batchId: item.batchId,
        classification,
        sourceLocationId: item.sourceLocationId,
        destinationLocationId: item.destinationLocationId,
        quantity: item.quantity,
        notes: item.notes ?? null,
      },
    });
  }

  private async validateItemDimensions(
    tx: Tx,
    companyId: string,
    transfer: { sourceWarehouseId: string; destinationWarehouseId: string },
    item: StockTransferItemInputDto,
  ): Promise<void> {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new AppError({
        code: ERROR_CODES.STOCK_TRANSFER_INVALID_QUANTITY,
        message: STOCK_TRANSFER_ERROR_MESSAGES.INVALID_QUANTITY,
        statusCode: 400,
      });
    }
    if (item.sourceLocationId === item.destinationLocationId) {
      throw new AppError({
        code: ERROR_CODES.STOCK_TRANSFER_SAME_LOCATION,
        message: STOCK_TRANSFER_ERROR_MESSAGES.SAME_LOCATION,
        statusCode: 400,
      });
    }

    const [sku, batch, sourceLoc, destLoc] = await Promise.all([
      tx.sku.findFirst({ where: { id: item.skuId, companyId } }),
      tx.batch.findFirst({ where: { id: item.batchId, companyId } }),
      tx.warehouseLocation.findFirst({
        where: { id: item.sourceLocationId, companyId },
      }),
      tx.warehouseLocation.findFirst({
        where: { id: item.destinationLocationId, companyId },
      }),
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
        code: ERROR_CODES.STOCK_TRANSFER_BATCH_SKU_MISMATCH,
        message: STOCK_TRANSFER_ERROR_MESSAGES.BATCH_SKU_MISMATCH,
        statusCode: 409,
      });
    }
    if (!sourceLoc || !destLoc) {
      throw new AppError({
        code: ERROR_CODES.WAREHOUSE_LOCATION_NOT_FOUND,
        message: 'Warehouse location was not found.',
        statusCode: 404,
      });
    }
    if (
      sourceLoc.warehouseId !== transfer.sourceWarehouseId ||
      destLoc.warehouseId !== transfer.destinationWarehouseId
    ) {
      throw new AppError({
        code: ERROR_CODES.STOCK_TRANSFER_LOCATION_WAREHOUSE_MISMATCH,
        message: STOCK_TRANSFER_ERROR_MESSAGES.LOCATION_WAREHOUSE_MISMATCH,
        statusCode: 409,
      });
    }
    if (
      sourceLoc.type === WarehouseLocationType.TRANSIT ||
      destLoc.type === WarehouseLocationType.TRANSIT
    ) {
      throw new AppError({
        code: ERROR_CODES.STOCK_TRANSFER_SYSTEM_WAREHOUSE,
        message: STOCK_TRANSFER_ERROR_MESSAGES.SYSTEM_WAREHOUSE,
        statusCode: 409,
      });
    }
    if (destLoc.status !== WarehouseStatus.ACTIVE) {
      throw new AppError({
        code: ERROR_CODES.STOCK_TRANSFER_LOCATION_INACTIVE,
        message: STOCK_TRANSFER_ERROR_MESSAGES.LOCATION_INACTIVE,
        statusCode: 409,
      });
    }
  }

  private async assertOperationalWarehouses(
    tx: Tx,
    companyId: string,
    sourceWarehouseId: string,
    destinationWarehouseId: string,
  ): Promise<void> {
    const warehouses = await tx.warehouse.findMany({
      where: {
        companyId,
        id: { in: [sourceWarehouseId, destinationWarehouseId] },
      },
    });
    if (warehouses.length !== new Set([sourceWarehouseId, destinationWarehouseId]).size) {
      throw new AppError({
        code: ERROR_CODES.WAREHOUSE_NOT_FOUND,
        message: 'Warehouse was not found.',
        statusCode: 404,
      });
    }
    for (const wh of warehouses) {
      if (wh.isSystem || wh.code === SYSTEM_TRANSIT_WAREHOUSE_CODE) {
        throw new AppError({
          code: ERROR_CODES.STOCK_TRANSFER_SYSTEM_WAREHOUSE,
          message: STOCK_TRANSFER_ERROR_MESSAGES.SYSTEM_WAREHOUSE,
          statusCode: 409,
        });
      }
      if (wh.status !== WarehouseStatus.ACTIVE) {
        throw new AppError({
          code: ERROR_CODES.STOCK_TRANSFER_WAREHOUSE_INACTIVE,
          message: STOCK_TRANSFER_ERROR_MESSAGES.WAREHOUSE_INACTIVE,
          statusCode: 409,
        });
      }
    }
  }

  private assertDraft(status: StockTransferStatus): void {
    if (status !== StockTransferStatus.DRAFT) {
      throw new AppError({
        code: ERROR_CODES.STOCK_TRANSFER_NOT_EDITABLE,
        message: STOCK_TRANSFER_ERROR_MESSAGES.NOT_EDITABLE,
        statusCode: 409,
      });
    }
  }

  private async lockTransfer(
    tx: Tx,
    companyId: string,
    transferId: string,
  ): Promise<{
    id: string;
    number: string;
    status: StockTransferStatus;
    sourceWarehouseId: string;
    destinationWarehouseId: string;
    version: number;
  }> {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        number: string;
        status: StockTransferStatus;
        source_warehouse_id: string;
        destination_warehouse_id: string;
        version: number;
      }>
    >(Prisma.sql`
      SELECT id, number, status, source_warehouse_id, destination_warehouse_id, version
      FROM stock_transfers
      WHERE id = ${transferId}::uuid
        AND company_id = ${companyId}::uuid
      FOR UPDATE
    `);
    const row = rows[0];
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.STOCK_TRANSFER_NOT_FOUND,
        message: STOCK_TRANSFER_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return {
      id: row.id,
      number: row.number,
      status: row.status,
      sourceWarehouseId: row.source_warehouse_id,
      destinationWarehouseId: row.destination_warehouse_id,
      version: row.version,
    };
  }

  private async requireDetail(companyId: string, transferId: string): Promise<DetailRow> {
    const row = await this.database.client.stockTransfer.findFirst({
      where: { id: transferId, companyId },
      include: detailInclude,
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.STOCK_TRANSFER_NOT_FOUND,
        message: STOCK_TRANSFER_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return row;
  }

  private async loadDetailInTx(
    tx: Tx,
    companyId: string,
    transferId: string,
  ): Promise<DetailRow> {
    return tx.stockTransfer.findFirstOrThrow({
      where: { id: transferId, companyId },
      include: detailInclude,
    });
  }

  private async toDetailView(row: DetailRow): Promise<StockTransferDetailView> {
    const onHandKeys = row.items.map((item) => ({
      warehouseId: row.sourceWarehouseId,
      locationId: item.sourceLocationId,
      skuId: item.skuId,
      batchId: item.batchId,
      classification: item.classification,
    }));
    const balances =
      onHandKeys.length === 0
        ? []
        : await this.database.client.inventoryBalance.findMany({
            where: {
              companyId: row.companyId,
              OR: onHandKeys,
            },
          });
    const balanceMap = new Map(
      balances.map((b) => [
        `${b.warehouseId}:${b.locationId}:${b.skuId}:${b.batchId}:${b.classification}`,
        b.onHandQuantity,
      ]),
    );

    return {
      id: row.id,
      number: row.number,
      status: row.status,
      sourceWarehouse: row.sourceWarehouse,
      destinationWarehouse: row.destinationWarehouse,
      notes: row.notes,
      externalReference: row.externalReference,
      version: row.version,
      items: row.items.map((item) => this.toItemView(item, balanceMap)),
      createdBy: row.createdBy,
      dispatchedBy: row.dispatchedBy,
      completedBy: row.completedBy,
      cancelledBy: row.cancelledBy,
      dispatchedAt: row.dispatchedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toItemView(
    item: DetailRow['items'][number],
    balanceMap: Map<string, number>,
  ): StockTransferItemView {
    const key = `${item.sourceLocation.warehouseId}:${item.sourceLocationId}:${item.skuId}:${item.batchId}:${item.classification}`;
    return {
      id: item.id,
      skuId: item.skuId,
      skuCode: item.sku.code,
      skuName: item.sku.name,
      productName: item.sku.product?.name ?? null,
      batchId: item.batchId,
      batchNumber: item.batch.batchNumber,
      supplierBatchNumber: item.batch.supplierBatchNumber,
      sourceLocation: {
        id: item.sourceLocation.id,
        code: item.sourceLocation.code,
        name: item.sourceLocation.name,
        barcode: item.sourceLocation.barcode,
        status: item.sourceLocation.status,
        type: item.sourceLocation.type,
        warehouseId: item.sourceLocation.warehouseId,
      },
      destinationLocation: {
        id: item.destinationLocation.id,
        code: item.destinationLocation.code,
        name: item.destinationLocation.name,
        barcode: item.destinationLocation.barcode,
        status: item.destinationLocation.status,
        type: item.destinationLocation.type,
        warehouseId: item.destinationLocation.warehouseId,
      },
      classification: item.classification,
      quantity: item.quantity,
      notes: item.notes,
      sourceOnHand: balanceMap.get(key) ?? 0,
      dispatchOperationId: item.dispatchOperationId,
      completeOperationId: item.completeOperationId,
      cancelOperationId: item.cancelOperationId,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private requireActorUserId(): string {
    const userId = getRequestContext()?.userId;
    if (!userId) {
      throw new AppError({
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Authenticated actor is required.',
        statusCode: 401,
      });
    }
    return userId;
  }
}

function normalizeSearch(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, STOCK_TRANSFER_SEARCH_MAX_LENGTH);
}
