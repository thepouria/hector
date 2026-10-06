import { Injectable } from '@nestjs/common';
import {
  GoodsReceiptStatus,
  InventoryMovementType,
  InventorySourceType,
  Prisma,
  PurchaseReturnStatus,
  StockClassification,
  SupplierReturnExecutionStatus,
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
import { SupplierPayablesService } from '../finance/supplier-payables.service';
import type {
  CreateSupplierReturnExecutionDto,
  ListSupplierReturnExecutionsQueryDto,
  ListWarehouseSupplierReturnsQueryDto,
  ScanApplySupplierReturnExecutionDto,
  SupplierReturnExecutionItemInputDto,
  UpdateSupplierReturnExecutionDto,
  UpsertSupplierReturnExecutionItemDto,
} from './dto/supplier-return-execution.dto';
import { InventoryLedgerService, type PostMovementInput } from './inventory-ledger.service';
import { normalizeLocationBarcodeInput } from './location-barcode.util';
import {
  SUPPLIER_RETURN_EXECUTION_ERROR_MESSAGES,
  SUPPLIER_RETURN_EXECUTION_SEARCH_MAX_LENGTH,
} from './supplier-return-execution.constants';
import {
  allocateSupplierReturnExecutionSequence,
  formatSupplierReturnExecutionNumber,
} from './supplier-return-execution-numbering';
import {
  buildProgressView,
  getDispatchedQuantitiesByReturnItem,
  toExecutionSummary,
} from './supplier-return-execution.progress';
import type {
  SupplierReturnExecutionDetailView,
  SupplierReturnExecutionItemView,
  SupplierReturnExecutionListItemView,
  SupplierReturnExecutionScanApplyResultView,
  SupplierReturnWarehouseDetailView,
  SupplierReturnWarehouseListItemView,
} from './types/supplier-return-execution.types';

export { getDispatchedQuantitiesByReturnItem } from './supplier-return-execution.progress';

const purchaseReturnCommercialInclude = {
  supplier: { select: { id: true, name: true, code: true } },
  purchaseOrder: { select: { id: true, number: true } },
  items: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    include: {
      sku: {
        select: {
          id: true,
          code: true,
          name: true,
          product: { select: { id: true, name: true, code: true } },
        },
      },
    },
  },
} satisfies Prisma.PurchaseReturnInclude;

const detailInclude = {
  purchaseReturn: { select: { id: true, number: true, supplierId: true, status: true } },
  warehouse: {
    select: { id: true, code: true, name: true, status: true, isSystem: true },
  },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  dispatchedBy: { select: { id: true, firstName: true, lastName: true } },
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
      location: true,
    },
  },
} satisfies Prisma.SupplierReturnExecutionInclude;

type DetailRow = Prisma.SupplierReturnExecutionGetPayload<{ include: typeof detailInclude }>;
type Tx = Prisma.TransactionClient;

@Injectable()
export class SupplierReturnExecutionsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
    private readonly inventoryLedger: InventoryLedgerService,
    private readonly barcodesService: BarcodesService,
    private readonly supplierPayablesService: SupplierPayablesService,
  ) {}

  async listApprovedReturns(
    company: CompanyContext,
    query: ListWarehouseSupplierReturnsQueryDto,
  ): Promise<{ data: SupplierReturnWarehouseListItemView[]; meta: PaginationMeta }> {
    const search = normalizeSearch(query.q);
    const where: Prisma.PurchaseReturnWhereInput = {
      companyId: company.companyId,
      status: PurchaseReturnStatus.APPROVED,
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(search
        ? {
            OR: [
              { number: { contains: search, mode: 'insensitive' } },
              { supplier: { name: { contains: search, mode: 'insensitive' } } },
              { purchaseOrder: { number: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
      ...(query.warehouseId
        ? {
            supplierReturnExecutions: {
              some: { warehouseId: query.warehouseId },
            },
          }
        : {}),
    };

    const skip = (query.page - 1) * query.pageSize;
    const rows = await this.database.client.purchaseReturn.findMany({
      where,
      orderBy: { approvedAt: 'desc' },
      skip: 0,
      take: 5000,
      include: {
        supplier: { select: { id: true, name: true, code: true } },
        purchaseOrder: { select: { number: true } },
        items: { select: { quantity: true } },
      },
    });

    const progressByReturnId = await this.loadDispatchedTotalsForReturns(
      company.companyId,
      rows.map((r) => r.id),
    );

    let projected = rows.map((row) => {
      const approvedQuantity = row.items.reduce((sum, i) => sum + i.quantity, 0);
      const dispatchedQuantity = progressByReturnId.get(row.id) ?? 0;
      const progress = buildProgressView(approvedQuantity, dispatchedQuantity);
      return {
        id: row.id,
        number: row.number,
        supplierId: row.supplierId,
        supplierName: row.supplier.name,
        supplierCode: row.supplier.code,
        purchaseOrderNumber: row.purchaseOrder?.number ?? null,
        approvedAt: row.approvedAt?.toISOString() ?? null,
        progress,
      };
    });

    if (query.fulfillmentStatus) {
      projected = projected.filter((r) => r.progress.fulfillmentStatus === query.fulfillmentStatus);
    }

    const total = projected.length;
    const pageSlice = projected.slice(skip, skip + query.pageSize);

    return {
      data: pageSlice,
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async getApprovedReturn(
    company: CompanyContext,
    purchaseReturnId: string,
  ): Promise<SupplierReturnWarehouseDetailView> {
    const row = await this.database.client.purchaseReturn.findFirst({
      where: {
        id: purchaseReturnId,
        companyId: company.companyId,
        status: PurchaseReturnStatus.APPROVED,
      },
      include: purchaseReturnCommercialInclude,
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.PURCHASE_RETURN_NOT_FOUND,
        message: SUPPLIER_RETURN_EXECUTION_ERROR_MESSAGES.PURCHASE_RETURN_NOT_FOUND,
        statusCode: 404,
      });
    }

    const [dispatchedMap, executions] = await Promise.all([
      getDispatchedQuantitiesByReturnItem(
        this.database.client,
        company.companyId,
        purchaseReturnId,
      ),
      this.database.client.supplierReturnExecution.findMany({
        where: { companyId: company.companyId, purchaseReturnId },
        orderBy: { createdAt: 'asc' },
        include: {
          warehouse: { select: { code: true } },
          items: { select: { quantity: true } },
        },
      }),
    ]);

    const approvedQuantity = row.items.reduce((sum, i) => sum + i.quantity, 0);
    const dispatchedQuantity = [...dispatchedMap.values()].reduce((sum, q) => sum + q, 0);
    const progress = buildProgressView(approvedQuantity, dispatchedQuantity);

    return {
      id: row.id,
      number: row.number,
      status: row.status,
      supplierId: row.supplierId,
      supplier: row.supplier,
      purchaseOrderId: row.purchaseOrderId,
      purchaseOrderNumber: row.purchaseOrder?.number ?? null,
      reason: row.reason,
      expectedResolution: row.expectedResolution,
      notes: row.notes,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      items: row.items.map((item) => ({
        id: item.id,
        skuId: item.skuId,
        quantity: item.quantity,
        reason: item.reason,
        notes: item.notes,
        sku: item.sku,
      })),
      progress,
      executions: executions.map(toExecutionSummary),
    };
  }

  async listExecutions(
    company: CompanyContext,
    query: ListSupplierReturnExecutionsQueryDto,
  ): Promise<{ data: SupplierReturnExecutionListItemView[]; meta: PaginationMeta }> {
    const search = normalizeSearch(query.q);
    const where: Prisma.SupplierReturnExecutionWhereInput = {
      companyId: company.companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.purchaseReturnId ? { purchaseReturnId: query.purchaseReturnId } : {}),
      ...(query.supplierId ? { purchaseReturn: { supplierId: query.supplierId } } : {}),
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
              { purchaseReturn: { number: { contains: search, mode: 'insensitive' } } },
              { warehouse: { code: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const skip = (query.page - 1) * query.pageSize;
    const [total, rows] = await this.database.client.$transaction([
      this.database.client.supplierReturnExecution.count({ where }),
      this.database.client.supplierReturnExecution.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.pageSize,
        include: {
          purchaseReturn: {
            select: {
              number: true,
              supplierId: true,
              supplier: { select: { name: true } },
            },
          },
          warehouse: {
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
        purchaseReturnId: row.purchaseReturnId,
        purchaseReturnNumber: row.purchaseReturn.number,
        supplierId: row.purchaseReturn.supplierId,
        supplierName: row.purchaseReturn.supplier.name,
        warehouse: row.warehouse,
        itemCount: row.items.length,
        totalQuantity: row.items.reduce((sum, i) => sum + i.quantity, 0),
        notes: row.notes,
        createdBy: row.createdBy,
        dispatchedAt: row.dispatchedAt?.toISOString() ?? null,
        cancelledAt: row.cancelledAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async getExecution(
    company: CompanyContext,
    executionId: string,
  ): Promise<SupplierReturnExecutionDetailView> {
    const row = await this.requireDetail(company.companyId, executionId);
    return this.toDetailView(row);
  }

  async createExecution(
    company: CompanyContext,
    purchaseReturnId: string,
    dto: CreateSupplierReturnExecutionDto,
  ): Promise<SupplierReturnExecutionDetailView> {
    const actorUserId = this.requireActorUserId();

    return commitThenPublish(this.eventBus, async (events) => {
      const created = await this.database.client.$transaction(async (tx) => {
        const purchaseReturn = await tx.purchaseReturn.findFirst({
          where: { id: purchaseReturnId, companyId: company.companyId },
          include: { items: true },
        });
        if (!purchaseReturn) {
          throw new AppError({
            code: ERROR_CODES.PURCHASE_RETURN_NOT_FOUND,
            message: SUPPLIER_RETURN_EXECUTION_ERROR_MESSAGES.PURCHASE_RETURN_NOT_FOUND,
            statusCode: 404,
          });
        }
        if (purchaseReturn.status !== PurchaseReturnStatus.APPROVED) {
          throw new AppError({
            code: ERROR_CODES.SUPPLIER_RETURN_EXECUTION_RETURN_INELIGIBLE,
            message: SUPPLIER_RETURN_EXECUTION_ERROR_MESSAGES.RETURN_INELIGIBLE,
            statusCode: 409,
          });
        }

        await this.assertOperationalWarehouse(tx, company.companyId, dto.warehouseId);

        const seq = await allocateSupplierReturnExecutionSequence(tx, company.companyId);
        const number = formatSupplierReturnExecutionNumber(seq);
        const execution = await tx.supplierReturnExecution.create({
          data: {
            companyId: company.companyId,
            number,
            purchaseReturnId,
            warehouseId: dto.warehouseId,
            notes: dto.notes ?? null,
            createdById: actorUserId,
            status: SupplierReturnExecutionStatus.DRAFT,
          },
        });

        const returnItemsById = new Map(purchaseReturn.items.map((i) => [i.id, i]));
        if (dto.items?.length) {
          for (const item of dto.items) {
            await this.insertItem(tx, company.companyId, execution, purchaseReturn, returnItemsById, item);
          }
        }

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.SUPPLIER_RETURN_EXECUTION_CREATED,
          entityType: AUDIT_ENTITY_TYPES.SUPPLIER_RETURN_EXECUTION,
          entityId: execution.id,
          before: null,
          after: {
            number: execution.number,
            purchaseReturnId,
            warehouseId: dto.warehouseId,
            itemCount: dto.items?.length ?? 0,
            status: SupplierReturnExecutionStatus.DRAFT,
          },
          metadata: {
            executionId: execution.id,
            executionNumber: execution.number,
            purchaseReturnId,
            warehouseId: dto.warehouseId,
            status: SupplierReturnExecutionStatus.DRAFT,
          },
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_SUPPLIER_RETURN_EXECUTION_CREATED,
            payload: {
              companyId: company.companyId,
              executionId: execution.id,
              executionNumber: execution.number,
              purchaseReturnId,
              warehouseId: dto.warehouseId,
              status: SupplierReturnExecutionStatus.DRAFT,
            },
          }),
        );

        return this.loadDetailInTx(tx, company.companyId, execution.id);
      });
      return this.toDetailView(created);
    });
  }

  async updateExecution(
    company: CompanyContext,
    executionId: string,
    dto: UpdateSupplierReturnExecutionDto,
  ): Promise<SupplierReturnExecutionDetailView> {
    return commitThenPublish(this.eventBus, async (events) => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockExecution(tx, company.companyId, executionId);
        this.assertDraft(locked.status);

        const purchaseReturn = await tx.purchaseReturn.findFirstOrThrow({
          where: { id: locked.purchaseReturnId, companyId: company.companyId },
          include: { items: true },
        });
        const returnItemsById = new Map(purchaseReturn.items.map((i) => [i.id, i]));

        await tx.supplierReturnExecution.update({
          where: { id: executionId },
          data: {
            ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
            version: { increment: 1 },
          },
        });

        if (dto.items) {
          await tx.supplierReturnExecutionItem.deleteMany({
            where: { supplierReturnExecutionId: executionId, companyId: company.companyId },
          });
          const header = {
            id: executionId,
            warehouseId: locked.warehouseId,
            purchaseReturnId: locked.purchaseReturnId,
          };
          for (const item of dto.items) {
            await this.insertItem(
              tx,
              company.companyId,
              header,
              purchaseReturn,
              returnItemsById,
              item,
            );
          }
        }

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.SUPPLIER_RETURN_EXECUTION_UPDATED,
          entityType: AUDIT_ENTITY_TYPES.SUPPLIER_RETURN_EXECUTION,
          entityId: executionId,
          before: { status: locked.status },
          after: {
            status: SupplierReturnExecutionStatus.DRAFT,
            ...(dto.items ? { itemCount: dto.items.length } : {}),
          },
          metadata: {
            executionId,
            executionNumber: locked.number,
            status: SupplierReturnExecutionStatus.DRAFT,
          },
        });

        void events;

        return this.loadDetailInTx(tx, company.companyId, executionId);
      });
      return this.toDetailView(updated);
    });
  }

  async upsertItem(
    company: CompanyContext,
    executionId: string,
    dto: UpsertSupplierReturnExecutionItemDto,
  ): Promise<SupplierReturnExecutionDetailView> {
    const classification = dto.classification ?? StockClassification.SELLABLE;

    return commitThenPublish(this.eventBus, async (events) => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockExecution(tx, company.companyId, executionId);
        this.assertDraft(locked.status);

        const purchaseReturn = await tx.purchaseReturn.findFirstOrThrow({
          where: { id: locked.purchaseReturnId, companyId: company.companyId },
          include: { items: true },
        });
        const returnItemsById = new Map(purchaseReturn.items.map((i) => [i.id, i]));

        const existing = await tx.supplierReturnExecutionItem.findUnique({
          where: {
            supplierReturnExecutionId_purchaseReturnItemId_locationId_skuId_batchId_classification:
              {
                supplierReturnExecutionId: executionId,
                purchaseReturnItemId: dto.purchaseReturnItemId,
                locationId: dto.locationId,
                skuId: dto.skuId,
                batchId: dto.batchId,
                classification,
              },
          },
        });

        const header = {
          id: executionId,
          warehouseId: locked.warehouseId,
          purchaseReturnId: locked.purchaseReturnId,
        };

        if (existing && dto.increment) {
          await tx.supplierReturnExecutionItem.update({
            where: { id: existing.id },
            data: {
              quantity: existing.quantity + dto.quantity,
              notes: dto.notes ?? existing.notes,
            },
          });
        } else if (existing) {
          await this.validateItemDimensions(
            tx,
            company.companyId,
            header,
            purchaseReturn,
            returnItemsById,
            { ...dto, classification },
          );
          await tx.supplierReturnExecutionItem.update({
            where: { id: existing.id },
            data: { quantity: dto.quantity, notes: dto.notes ?? null },
          });
        } else {
          await this.insertItem(
            tx,
            company.companyId,
            header,
            purchaseReturn,
            returnItemsById,
            { ...dto, classification },
          );
        }

        await tx.supplierReturnExecution.update({
          where: { id: executionId },
          data: { version: { increment: 1 } },
        });

        void events;
        return this.loadDetailInTx(tx, company.companyId, executionId);
      });
      return this.toDetailView(updated);
    });
  }

  async removeItem(
    company: CompanyContext,
    executionId: string,
    itemId: string,
  ): Promise<SupplierReturnExecutionDetailView> {
    return commitThenPublish(this.eventBus, async (events) => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockExecution(tx, company.companyId, executionId);
        this.assertDraft(locked.status);
        const deleted = await tx.supplierReturnExecutionItem.deleteMany({
          where: {
            id: itemId,
            supplierReturnExecutionId: executionId,
            companyId: company.companyId,
          },
        });
        if (deleted.count === 0) {
          throw new AppError({
            code: ERROR_CODES.SUPPLIER_RETURN_EXECUTION_ITEM_NOT_FOUND,
            message: SUPPLIER_RETURN_EXECUTION_ERROR_MESSAGES.ITEM_NOT_FOUND,
            statusCode: 404,
          });
        }
        await tx.supplierReturnExecution.update({
          where: { id: executionId },
          data: { version: { increment: 1 } },
        });
        void events;
        return this.loadDetailInTx(tx, company.companyId, executionId);
      });
      return this.toDetailView(updated);
    });
  }

  async scanApply(
    company: CompanyContext,
    executionId: string,
    dto: ScanApplySupplierReturnExecutionDto,
  ): Promise<SupplierReturnExecutionScanApplyResultView> {
    const existing = await this.database.client.supplierReturnExecutionScanRequest.findUnique({
      where: {
        companyId_supplierReturnExecutionId_requestId: {
          companyId: company.companyId,
          supplierReturnExecutionId: executionId,
          requestId: dto.requestId,
        },
      },
    });
    if (existing) {
      return existing.responseJson as unknown as SupplierReturnExecutionScanApplyResultView;
    }

    const execution = await this.requireDetail(company.companyId, executionId);
    if (execution.status !== SupplierReturnExecutionStatus.DRAFT) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_RETURN_EXECUTION_NOT_EDITABLE,
        message: SUPPLIER_RETURN_EXECUTION_ERROR_MESSAGES.NOT_EDITABLE,
        statusCode: 409,
      });
    }

    const locationBarcode = dto.locationBarcode
      ? normalizeLocationBarcodeInput(dto.locationBarcode)
      : null;
    if (!locationBarcode || !dto.productBarcode) {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Scan apply requires locationBarcode and productBarcode.',
        statusCode: 400,
      });
    }

    const location = await this.database.client.warehouseLocation.findFirst({
      where: { companyId: company.companyId, barcode: locationBarcode },
    });
    if (!location) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_RETURN_EXECUTION_UNKNOWN_LOCATION_BARCODE,
        message: SUPPLIER_RETURN_EXECUTION_ERROR_MESSAGES.UNKNOWN_LOCATION_BARCODE,
        statusCode: 404,
      });
    }
    if (location.warehouseId !== execution.warehouseId) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_RETURN_EXECUTION_LOCATION_WAREHOUSE_MISMATCH,
        message: SUPPLIER_RETURN_EXECUTION_ERROR_MESSAGES.LOCATION_WAREHOUSE_MISMATCH,
        statusCode: 409,
      });
    }

    const returnLine = execution.purchaseReturnId
      ? await this.database.client.purchaseReturnItem.findFirst({
          where: {
            id: dto.purchaseReturnItemId,
            companyId: company.companyId,
            purchaseReturnId: execution.purchaseReturnId,
          },
        })
      : null;
    if (!returnLine) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_RETURN_EXECUTION_SKU_NOT_ON_RETURN,
        message: SUPPLIER_RETURN_EXECUTION_ERROR_MESSAGES.SKU_NOT_ON_RETURN,
        statusCode: 400,
      });
    }

    const resolved = await this.barcodesService.resolve(company, dto.productBarcode);
    if (!resolved.sku?.id) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_RETURN_EXECUTION_UNKNOWN_PRODUCT_BARCODE,
        message: SUPPLIER_RETURN_EXECUTION_ERROR_MESSAGES.UNKNOWN_PRODUCT_BARCODE,
        statusCode: 404,
      });
    }
    if (resolved.sku.id !== returnLine.skuId) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_RETURN_EXECUTION_SKU_MISMATCH,
        message: SUPPLIER_RETURN_EXECUTION_ERROR_MESSAGES.SKU_MISMATCH,
        statusCode: 409,
      });
    }

    const classification = dto.classification ?? StockClassification.SELLABLE;
    let batchId = dto.batchId;
    if (!batchId) {
      const balances = await this.database.client.inventoryBalance.findMany({
        where: {
          companyId: company.companyId,
          warehouseId: execution.warehouseId,
          locationId: location.id,
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

    const quantity = dto.quantity ?? 1;
    const beforeIds = new Set(execution.items.map((i) => i.id));
    const detail = await this.upsertItem(company, executionId, {
      purchaseReturnItemId: dto.purchaseReturnItemId,
      skuId: resolved.sku.id,
      batchId,
      locationId: location.id,
      classification,
      quantity,
      increment: true,
    });
    const item =
      detail.items.find(
        (i) =>
          i.purchaseReturnItemId === dto.purchaseReturnItemId &&
          i.skuId === resolved.sku.id &&
          i.batchId === batchId &&
          i.location.id === location.id &&
          i.classification === classification,
      ) ?? detail.items[detail.items.length - 1]!;
    const result: SupplierReturnExecutionScanApplyResultView = {
      execution: detail,
      item,
      incremented: beforeIds.has(item.id),
    };

    await this.database.client.supplierReturnExecutionScanRequest.create({
      data: {
        companyId: company.companyId,
        supplierReturnExecutionId: executionId,
        requestId: dto.requestId,
        responseJson: result as unknown as Prisma.InputJsonValue,
      },
    });
    return result;
  }

  async dispatch(
    company: CompanyContext,
    executionId: string,
  ): Promise<SupplierReturnExecutionDetailView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const detail = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockExecution(tx, company.companyId, executionId);
        if (locked.status === SupplierReturnExecutionStatus.DISPATCHED) {
          return this.loadDetailInTx(tx, company.companyId, executionId);
        }
        if (locked.status !== SupplierReturnExecutionStatus.DRAFT) {
          throw new AppError({
            code: ERROR_CODES.SUPPLIER_RETURN_EXECUTION_NOT_DISPATCHABLE,
            message: SUPPLIER_RETURN_EXECUTION_ERROR_MESSAGES.NOT_DISPATCHABLE,
            statusCode: 409,
          });
        }

        const items = await tx.supplierReturnExecutionItem.findMany({
          where: { supplierReturnExecutionId: executionId, companyId: company.companyId },
          orderBy: { id: 'asc' },
        });
        if (items.length === 0) {
          throw new AppError({
            code: ERROR_CODES.SUPPLIER_RETURN_EXECUTION_EMPTY,
            message: SUPPLIER_RETURN_EXECUTION_ERROR_MESSAGES.EMPTY,
            statusCode: 409,
          });
        }

        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "purchase_returns"
          WHERE "id" = ${locked.purchaseReturnId}::uuid
            AND "company_id" = ${company.companyId}::uuid
          FOR UPDATE
        `);

        const purchaseReturn = await tx.purchaseReturn.findFirstOrThrow({
          where: { id: locked.purchaseReturnId, companyId: company.companyId },
          include: { items: true },
        });
        if (purchaseReturn.status !== PurchaseReturnStatus.APPROVED) {
          throw new AppError({
            code: ERROR_CODES.SUPPLIER_RETURN_EXECUTION_RETURN_INELIGIBLE,
            message: SUPPLIER_RETURN_EXECUTION_ERROR_MESSAGES.RETURN_INELIGIBLE,
            statusCode: 409,
          });
        }

        const dispatchedByItem = await getDispatchedQuantitiesByReturnItem(
          tx,
          company.companyId,
          locked.purchaseReturnId,
        );
        const thisExecutionByItem = new Map<string, number>();
        for (const item of items) {
          thisExecutionByItem.set(
            item.purchaseReturnItemId,
            (thisExecutionByItem.get(item.purchaseReturnItemId) ?? 0) + item.quantity,
          );
        }

        const returnItemsById = new Map(purchaseReturn.items.map((i) => [i.id, i]));
        for (const [returnItemId, qty] of thisExecutionByItem) {
          const returnItem = returnItemsById.get(returnItemId);
          if (!returnItem) {
            throw new AppError({
              code: ERROR_CODES.SUPPLIER_RETURN_EXECUTION_SKU_NOT_ON_RETURN,
              message: SUPPLIER_RETURN_EXECUTION_ERROR_MESSAGES.SKU_NOT_ON_RETURN,
              statusCode: 400,
            });
          }
          const already = dispatchedByItem.get(returnItemId) ?? 0;
          if (already + qty > returnItem.quantity) {
            throw new AppError({
              code: ERROR_CODES.SUPPLIER_RETURN_EXECUTION_OVER_AUTHORIZED,
              message: SUPPLIER_RETURN_EXECUTION_ERROR_MESSAGES.OVER_AUTHORIZED,
              statusCode: 409,
            });
          }
        }

        await this.assertOperationalWarehouse(tx, company.companyId, locked.warehouseId);
        const occurredAt = new Date();
        const posts: PostMovementInput[] = [];
        const header = {
          id: executionId,
          warehouseId: locked.warehouseId,
          purchaseReturnId: locked.purchaseReturnId,
        };

        for (const item of items) {
          await this.validateItemDimensions(
            tx,
            company.companyId,
            header,
            purchaseReturn,
            returnItemsById,
            {
              purchaseReturnItemId: item.purchaseReturnItemId,
              skuId: item.skuId,
              batchId: item.batchId,
              locationId: item.locationId,
              classification: item.classification,
              quantity: item.quantity,
            },
          );
          await this.assertBatchProvenance(
            tx,
            company.companyId,
            item.batchId,
            purchaseReturn.supplierId,
          );

          posts.push({
            warehouseId: locked.warehouseId,
            locationId: item.locationId,
            skuId: item.skuId,
            batchId: item.batchId,
            classification: item.classification,
            movementType: InventoryMovementType.RETURN_OUT,
            quantityDelta: -item.quantity,
            sourceType: InventorySourceType.SUPPLIER_RETURN,
            sourceId: executionId,
            sourceLineId: item.id,
            occurredAt,
            actorUserId,
            notes: `SRE dispatch ${locked.number}`,
          });
        }

        await this.inventoryLedger.postMovementsInTx(tx, company.companyId, posts, {
          recordAudit: true,
        });

        await tx.supplierReturnExecution.update({
          where: { id: executionId },
          data: {
            status: SupplierReturnExecutionStatus.DISPATCHED,
            dispatchedAt: occurredAt,
            dispatchedById: actorUserId,
            version: { increment: 1 },
          },
        });

        const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.SUPPLIER_RETURN_DISPATCHED,
          entityType: AUDIT_ENTITY_TYPES.SUPPLIER_RETURN_EXECUTION,
          entityId: executionId,
          before: { status: SupplierReturnExecutionStatus.DRAFT },
          after: {
            status: SupplierReturnExecutionStatus.DISPATCHED,
            itemCount: items.length,
            totalQuantity,
          },
          metadata: {
            executionId,
            executionNumber: locked.number,
            purchaseReturnId: locked.purchaseReturnId,
            supplierId: purchaseReturn.supplierId,
            warehouseId: locked.warehouseId,
            itemCount: items.length,
            totalQuantity,
            status: SupplierReturnExecutionStatus.DISPATCHED,
          },
        });

        // Phase 4.4 — reduce supplier liability / create credit for excess (no cash).
        const payableReduction =
          await this.supplierPayablesService.reduceFromSupplierReturnInTx(
            tx,
            company.companyId,
            executionId,
            actorUserId,
          );

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_SUPPLIER_RETURN_DISPATCHED,
            payload: {
              companyId: company.companyId,
              purchaseReturnId: locked.purchaseReturnId,
              executionId,
              supplierId: purchaseReturn.supplierId,
              warehouseId: locked.warehouseId,
              dispatchedAt: occurredAt.toISOString(),
              itemCount: items.length,
              totalQuantity,
            },
          }),
        );

        if (payableReduction.reducedTotal !== '0') {
          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.SUPPLIER_PAYABLE_ADJUSTED,
              payload: {
                companyId: company.companyId,
                supplierId: purchaseReturn.supplierId,
                executionId,
                reducedTotal: payableReduction.reducedTotal,
              },
            }),
          );
        }
        if (payableReduction.creditId) {
          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.SUPPLIER_CREDIT_CREATED,
              payload: {
                companyId: company.companyId,
                supplierId: purchaseReturn.supplierId,
                creditId: payableReduction.creditId,
                executionId,
              },
            }),
          );
        }

        return this.loadDetailInTx(tx, company.companyId, executionId);
      });
      return this.toDetailView(detail);
    });
  }

  async cancelExecution(
    company: CompanyContext,
    executionId: string,
  ): Promise<SupplierReturnExecutionDetailView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const detail = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockExecution(tx, company.companyId, executionId);
        if (locked.status === SupplierReturnExecutionStatus.CANCELLED) {
          return this.loadDetailInTx(tx, company.companyId, executionId);
        }
        if (locked.status === SupplierReturnExecutionStatus.DISPATCHED) {
          throw new AppError({
            code: ERROR_CODES.SUPPLIER_RETURN_EXECUTION_CANCEL_NOT_ALLOWED,
            message: SUPPLIER_RETURN_EXECUTION_ERROR_MESSAGES.CANCEL_NOT_ALLOWED,
            statusCode: 409,
          });
        }
        if (locked.status !== SupplierReturnExecutionStatus.DRAFT) {
          throw new AppError({
            code: ERROR_CODES.SUPPLIER_RETURN_EXECUTION_CANCEL_NOT_ALLOWED,
            message: SUPPLIER_RETURN_EXECUTION_ERROR_MESSAGES.CANCEL_NOT_ALLOWED,
            statusCode: 409,
          });
        }

        const occurredAt = new Date();
        await tx.supplierReturnExecution.update({
          where: { id: executionId },
          data: {
            status: SupplierReturnExecutionStatus.CANCELLED,
            cancelledAt: occurredAt,
            cancelledById: actorUserId,
            version: { increment: 1 },
          },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.SUPPLIER_RETURN_EXECUTION_CANCELLED,
          entityType: AUDIT_ENTITY_TYPES.SUPPLIER_RETURN_EXECUTION,
          entityId: executionId,
          before: { status: SupplierReturnExecutionStatus.DRAFT },
          after: { status: SupplierReturnExecutionStatus.CANCELLED },
          metadata: {
            executionId,
            executionNumber: locked.number,
            purchaseReturnId: locked.purchaseReturnId,
            status: SupplierReturnExecutionStatus.CANCELLED,
          },
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_SUPPLIER_RETURN_EXECUTION_CANCELLED,
            payload: {
              companyId: company.companyId,
              executionId,
              executionNumber: locked.number,
              purchaseReturnId: locked.purchaseReturnId,
              warehouseId: locked.warehouseId,
              status: SupplierReturnExecutionStatus.CANCELLED,
            },
          }),
        );

        return this.loadDetailInTx(tx, company.companyId, executionId);
      });
      return this.toDetailView(detail);
    });
  }

  private async loadDispatchedTotalsForReturns(
    companyId: string,
    purchaseReturnIds: string[],
  ): Promise<Map<string, number>> {
    if (purchaseReturnIds.length === 0) {
      return new Map();
    }
    const rows = await this.database.client.supplierReturnExecutionItem.groupBy({
      by: ['purchaseReturnItemId'],
      where: {
        companyId,
        execution: {
          purchaseReturnId: { in: purchaseReturnIds },
          status: SupplierReturnExecutionStatus.DISPATCHED,
        },
      },
      _sum: { quantity: true },
    });
    const itemToReturn = await this.database.client.purchaseReturnItem.findMany({
      where: { companyId, purchaseReturnId: { in: purchaseReturnIds } },
      select: { id: true, purchaseReturnId: true },
    });
    const returnIdByItem = new Map(itemToReturn.map((i) => [i.id, i.purchaseReturnId]));
    const totals = new Map<string, number>();
    for (const row of rows) {
      const returnId = returnIdByItem.get(row.purchaseReturnItemId);
      if (!returnId) continue;
      totals.set(returnId, (totals.get(returnId) ?? 0) + (row._sum.quantity ?? 0));
    }
    return totals;
  }

  private async insertItem(
    tx: Tx,
    companyId: string,
    execution: { id: string; warehouseId: string; purchaseReturnId: string },
    purchaseReturn: { supplierId: string; items: { id: string; skuId: string; quantity: number }[] },
    returnItemsById: Map<string, { id: string; skuId: string; quantity: number }>,
    item: SupplierReturnExecutionItemInputDto & { classification?: StockClassification },
  ): Promise<void> {
    const classification = item.classification ?? StockClassification.SELLABLE;
    await this.validateItemDimensions(
      tx,
      companyId,
      execution,
      purchaseReturn,
      returnItemsById,
      { ...item, classification },
    );
    await tx.supplierReturnExecutionItem.create({
      data: {
        companyId,
        supplierReturnExecutionId: execution.id,
        purchaseReturnItemId: item.purchaseReturnItemId,
        skuId: item.skuId,
        batchId: item.batchId,
        locationId: item.locationId,
        classification,
        quantity: item.quantity,
        notes: item.notes ?? null,
      },
    });
  }

  private async validateItemDimensions(
    tx: Tx,
    companyId: string,
    execution: { warehouseId: string },
    _purchaseReturn: { supplierId: string },
    returnItemsById: Map<string, { id: string; skuId: string; quantity: number }>,
    item: SupplierReturnExecutionItemInputDto & { classification: StockClassification },
  ): Promise<void> {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_RETURN_EXECUTION_INVALID_QUANTITY,
        message: SUPPLIER_RETURN_EXECUTION_ERROR_MESSAGES.INVALID_QUANTITY,
        statusCode: 400,
      });
    }

    const returnLine = returnItemsById.get(item.purchaseReturnItemId);
    if (!returnLine) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_RETURN_EXECUTION_SKU_NOT_ON_RETURN,
        message: SUPPLIER_RETURN_EXECUTION_ERROR_MESSAGES.SKU_NOT_ON_RETURN,
        statusCode: 400,
      });
    }
    if (returnLine.skuId !== item.skuId) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_RETURN_EXECUTION_SKU_MISMATCH,
        message: SUPPLIER_RETURN_EXECUTION_ERROR_MESSAGES.SKU_MISMATCH,
        statusCode: 409,
      });
    }

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
        code: ERROR_CODES.SUPPLIER_RETURN_EXECUTION_BATCH_SKU_MISMATCH,
        message: SUPPLIER_RETURN_EXECUTION_ERROR_MESSAGES.BATCH_SKU_MISMATCH,
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
    if (location.warehouseId !== execution.warehouseId) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_RETURN_EXECUTION_LOCATION_WAREHOUSE_MISMATCH,
        message: SUPPLIER_RETURN_EXECUTION_ERROR_MESSAGES.LOCATION_WAREHOUSE_MISMATCH,
        statusCode: 409,
      });
    }
    if (location.type === WarehouseLocationType.TRANSIT) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_RETURN_EXECUTION_SYSTEM_WAREHOUSE,
        message: SUPPLIER_RETURN_EXECUTION_ERROR_MESSAGES.SYSTEM_WAREHOUSE,
        statusCode: 409,
      });
    }
    if (location.status !== WarehouseStatus.ACTIVE) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_RETURN_EXECUTION_LOCATION_INACTIVE,
        message: SUPPLIER_RETURN_EXECUTION_ERROR_MESSAGES.LOCATION_INACTIVE,
        statusCode: 409,
      });
    }
  }

  /**
   * Batch provenance: POSTED GRN allocations tied to this batch must not implicate
   * only a supplier other than the purchase return supplier.
   * When no POSTED GRN allocations exist (seed/historical), allow dispatch.
   */
  private async assertBatchProvenance(
    tx: Tx,
    companyId: string,
    batchId: string,
    expectedSupplierId: string,
  ): Promise<void> {
    const allocations = await tx.goodsReceiptItemBatch.findMany({
      where: { companyId, batchId },
      include: {
        goodsReceiptItem: {
          include: {
            goodsReceipt: { select: { supplierId: true, status: true } },
          },
        },
      },
    });
    let hasSameSupplier = false;
    let hasDifferentSupplier = false;
    for (const allocation of allocations) {
      const grn = allocation.goodsReceiptItem.goodsReceipt;
      if (grn.status !== GoodsReceiptStatus.POSTED) {
        continue;
      }
      if (grn.supplierId === expectedSupplierId) {
        hasSameSupplier = true;
      } else {
        hasDifferentSupplier = true;
      }
    }
    if (hasDifferentSupplier && !hasSameSupplier) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_RETURN_EXECUTION_PROVENANCE_MISMATCH,
        message: SUPPLIER_RETURN_EXECUTION_ERROR_MESSAGES.PROVENANCE_MISMATCH,
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
        code: ERROR_CODES.SUPPLIER_RETURN_EXECUTION_SYSTEM_WAREHOUSE,
        message: SUPPLIER_RETURN_EXECUTION_ERROR_MESSAGES.SYSTEM_WAREHOUSE,
        statusCode: 409,
      });
    }
    if (warehouse.status !== WarehouseStatus.ACTIVE) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_RETURN_EXECUTION_WAREHOUSE_INACTIVE,
        message: SUPPLIER_RETURN_EXECUTION_ERROR_MESSAGES.WAREHOUSE_INACTIVE,
        statusCode: 409,
      });
    }
  }

  private assertDraft(status: SupplierReturnExecutionStatus): void {
    if (status !== SupplierReturnExecutionStatus.DRAFT) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_RETURN_EXECUTION_NOT_EDITABLE,
        message: SUPPLIER_RETURN_EXECUTION_ERROR_MESSAGES.NOT_EDITABLE,
        statusCode: 409,
      });
    }
  }

  private async lockExecution(
    tx: Tx,
    companyId: string,
    executionId: string,
  ): Promise<{
    id: string;
    number: string;
    status: SupplierReturnExecutionStatus;
    warehouseId: string;
    purchaseReturnId: string;
    version: number;
  }> {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        number: string;
        status: SupplierReturnExecutionStatus;
        warehouse_id: string;
        purchase_return_id: string;
        version: number;
      }>
    >(Prisma.sql`
      SELECT id, number, status, warehouse_id, purchase_return_id, version
      FROM supplier_return_executions
      WHERE id = ${executionId}::uuid
        AND company_id = ${companyId}::uuid
      FOR UPDATE
    `);
    const row = rows[0];
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_RETURN_EXECUTION_NOT_FOUND,
        message: SUPPLIER_RETURN_EXECUTION_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return {
      id: row.id,
      number: row.number,
      status: row.status,
      warehouseId: row.warehouse_id,
      purchaseReturnId: row.purchase_return_id,
      version: row.version,
    };
  }

  private async requireDetail(companyId: string, executionId: string): Promise<DetailRow> {
    const row = await this.database.client.supplierReturnExecution.findFirst({
      where: { id: executionId, companyId },
      include: detailInclude,
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_RETURN_EXECUTION_NOT_FOUND,
        message: SUPPLIER_RETURN_EXECUTION_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return row;
  }

  private async loadDetailInTx(
    tx: Tx,
    companyId: string,
    executionId: string,
  ): Promise<DetailRow> {
    return tx.supplierReturnExecution.findFirstOrThrow({
      where: { id: executionId, companyId },
      include: detailInclude,
    });
  }

  private async toDetailView(row: DetailRow): Promise<SupplierReturnExecutionDetailView> {
    const onHandKeys = row.items.map((item) => ({
      warehouseId: row.warehouseId,
      locationId: item.locationId,
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
      purchaseReturnId: row.purchaseReturnId,
      purchaseReturnNumber: row.purchaseReturn.number,
      supplierId: row.purchaseReturn.supplierId,
      warehouse: row.warehouse,
      notes: row.notes,
      version: row.version,
      items: row.items.map((item) => this.toItemView(item, row.warehouseId, balanceMap)),
      createdBy: row.createdBy,
      dispatchedBy: row.dispatchedBy,
      cancelledBy: row.cancelledBy,
      dispatchedAt: row.dispatchedAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toItemView(
    item: DetailRow['items'][number],
    warehouseId: string,
    balanceMap: Map<string, number>,
  ): SupplierReturnExecutionItemView {
    const key = `${warehouseId}:${item.locationId}:${item.skuId}:${item.batchId}:${item.classification}`;
    return {
      id: item.id,
      purchaseReturnItemId: item.purchaseReturnItemId,
      skuId: item.skuId,
      skuCode: item.sku.code,
      skuName: item.sku.name,
      productName: item.sku.product?.name ?? null,
      batchId: item.batchId,
      batchNumber: item.batch.batchNumber,
      supplierBatchNumber: item.batch.supplierBatchNumber,
      location: {
        id: item.location.id,
        code: item.location.code,
        name: item.location.name,
        barcode: item.location.barcode,
        status: item.location.status,
        type: item.location.type,
        warehouseId: item.location.warehouseId,
      },
      classification: item.classification,
      quantity: item.quantity,
      notes: item.notes,
      sourceOnHand: balanceMap.get(key) ?? 0,
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
  return trimmed.slice(0, SUPPLIER_RETURN_EXECUTION_SEARCH_MAX_LENGTH);
}
