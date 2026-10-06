import { Injectable } from '@nestjs/common';
import {
  GoodsReceiptStatus,
  Prisma,
  PurchaseOrderStatus,
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
import { PurchaseReceivingContract } from '../purchasing/contracts/purchase-receiving.contract';
import type { AcceptedReceivedLine } from '../purchasing/contracts/purchase-receiving.types';
import {
  PURCHASE_RECEIVING_ELIGIBLE_STATUSES,
} from '../purchasing/contracts/purchase-receiving.policy';
import { BATCH_ERROR_MESSAGES } from './batch.constants';
import { BatchesService } from './batches.service';
import type {
  UpdateGoodsReceiptItemBatchDto,
  UpsertGoodsReceiptItemBatchDto,
} from './dto/batch.dto';
import type { CancelGoodsReceiptDto } from './dto/cancel-goods-receipt.dto';
import type { CreateGoodsReceiptDto } from './dto/create-goods-receipt.dto';
import type {
  AddGoodsReceiptItemDto,
  UpdateGoodsReceiptItemDto,
} from './dto/goods-receipt-item.dto';
import type { ListGoodsReceiptsQueryDto } from './dto/list-goods-receipts.query.dto';
import type {
  ScanApplyGoodsReceiptDto,
  ScanResolveGoodsReceiptDto,
} from './dto/scan-goods-receipt.dto';
import type { UpdateGoodsReceiptDto } from './dto/update-goods-receipt.dto';
import {
  allocateGoodsReceiptSequence,
  formatGoodsReceiptNumber,
} from './goods-receipt-numbering';
import {
  GOODS_RECEIPT_CANCELLATION_REASON_MAX_LENGTH,
  GOODS_RECEIPT_ERROR_MESSAGES,
  GOODS_RECEIPT_ITEM_NOTES_MAX_LENGTH,
  GOODS_RECEIPT_NOTES_MAX_LENGTH,
  GOODS_RECEIPT_SEARCH_MAX_LENGTH,
} from './goods-receipt.constants';
import type { GoodsReceiptItemBatchView } from './types/batch.types';
import type {
  EligiblePurchaseOrderView,
  GoodsReceiptDetailView,
  GoodsReceiptItemView,
  GoodsReceiptListItemView,
  PurchaseOrderReceivingProgressView,
  ScanApplyResultView,
  ScanResolveResultView,
  ScannerSkuRef,
} from './types/goods-receipt.types';

const detailInclude = {
  warehouse: { select: { id: true, code: true, name: true, status: true } },
  purchaseOrder: {
    select: {
      id: true,
      number: true,
      status: true,
      supplierId: true,
      currency: true,
      supplier: { select: { id: true, name: true } },
      items: {
        select: {
          id: true,
          skuId: true,
          quantity: true,
          closedUnfulfilledQuantity: true,
          skuCodeSnapshot: true,
          productNameSnapshot: true,
          sku: { select: { code: true, name: true, product: { select: { name: true } } } },
        },
      },
    },
  },
  supplier: { select: { id: true, name: true } },
  items: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    include: {
      batchAllocations: {
        orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
        include: {
          batch: {
            select: {
              id: true,
              batchNumber: true,
              supplierBatchNumber: true,
              skuId: true,
              manufacturedAt: true,
              expiresAt: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.GoodsReceiptInclude;

type DetailRow = Prisma.GoodsReceiptGetPayload<{ include: typeof detailInclude }>;

@Injectable()
export class GoodsReceiptsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
    private readonly purchaseReceiving: PurchaseReceivingContract,
    private readonly barcodesService: BarcodesService,
    private readonly batchesService: BatchesService,
    private readonly supplierPayablesService: SupplierPayablesService,
  ) {}

  async list(
    company: CompanyContext,
    query: ListGoodsReceiptsQueryDto,
  ): Promise<{ data: GoodsReceiptListItemView[]; meta: PaginationMeta }> {
    const search = normalizeSearch(query.search);
    const where: Prisma.GoodsReceiptWhereInput = {
      companyId: company.companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.purchaseOrderId ? { purchaseOrderId: query.purchaseOrderId } : {}),
      ...(query.receivedFrom || query.receivedTo
        ? {
            receivedAt: {
              ...(query.receivedFrom ? { gte: new Date(query.receivedFrom) } : {}),
              ...(query.receivedTo ? { lte: new Date(query.receivedTo) } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { number: { contains: search, mode: 'insensitive' } },
              { purchaseOrder: { number: { contains: search, mode: 'insensitive' } } },
              { supplier: { name: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const skip = (query.page - 1) * query.pageSize;
    const [total, rows] = await this.database.client.$transaction([
      this.database.client.goodsReceipt.count({ where }),
      this.database.client.goodsReceipt.findMany({
        where,
        orderBy: { [query.sortBy]: query.sortOrder },
        skip,
        take: query.pageSize,
        include: {
          warehouse: { select: { code: true, name: true } },
          purchaseOrder: { select: { number: true } },
          supplier: { select: { name: true } },
          _count: { select: { items: true } },
        },
      }),
    ]);

    return {
      data: rows.map((row) => ({
        id: row.id,
        number: row.number,
        status: row.status,
        warehouseId: row.warehouseId,
        warehouseCode: row.warehouse.code,
        warehouseName: row.warehouse.name,
        purchaseOrderId: row.purchaseOrderId,
        purchaseOrderNumber: row.purchaseOrder.number,
        supplierId: row.supplierId,
        supplierName: row.supplier.name,
        receivedAt: row.receivedAt?.toISOString() ?? null,
        postedAt: row.postedAt?.toISOString() ?? null,
        itemCount: row._count.items,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async get(company: CompanyContext, goodsReceiptId: string): Promise<GoodsReceiptDetailView> {
    const row = await this.requireDetail(company.companyId, goodsReceiptId);
    const postedByPoItem = await this.aggregatePostedQuantities(
      company.companyId,
      row.purchaseOrderId,
      row.status === GoodsReceiptStatus.POSTED ? undefined : row.id,
    );
    return this.toDetailView(row, postedByPoItem);
  }

  async listEligiblePurchaseOrders(
    company: CompanyContext,
  ): Promise<{ data: EligiblePurchaseOrderView[] }> {
    const rows = await this.database.client.purchaseOrder.findMany({
      where: {
        companyId: company.companyId,
        status: { in: [...PURCHASE_RECEIVING_ELIGIBLE_STATUSES] },
      },
      orderBy: [{ orderDate: 'desc' }, { number: 'desc' }],
      take: 100,
      select: {
        id: true,
        number: true,
        status: true,
        supplierId: true,
        orderDate: true,
        supplier: { select: { name: true } },
        _count: { select: { items: true } },
      },
    });

    return {
      data: rows.map((row) => ({
        id: row.id,
        number: row.number,
        status: row.status,
        supplierId: row.supplierId,
        supplierName: row.supplier.name,
        orderDate: row.orderDate.toISOString(),
        itemCount: row._count.items,
      })),
    };
  }

  async getPurchaseOrderReceivingProgress(
    company: CompanyContext,
    purchaseOrderId: string,
  ): Promise<PurchaseOrderReceivingProgressView> {
    // Canonical formulas live in Purchasing (Phase 3.5) — Warehouse reuses them.
    return this.purchaseReceiving.getReceivingProgress(company, purchaseOrderId);
  }

  async create(
    company: CompanyContext,
    dto: CreateGoodsReceiptDto,
  ): Promise<GoodsReceiptDetailView> {
    const actorUserId = this.requireActorUserId();
    const notes = normalizeOptionalText(dto.notes, GOODS_RECEIPT_NOTES_MAX_LENGTH);
    const receivedAt = dto.receivedAt ? new Date(dto.receivedAt) : null;

    return commitThenPublish(this.eventBus, async (events) => {
      const created = await this.database.client.$transaction(async (tx) => {
        await this.purchaseReceiving.assertReceivingAllowed(company, dto.purchaseOrderId);

        const warehouse = await tx.warehouse.findFirst({
          where: { id: dto.warehouseId, companyId: company.companyId },
        });
        if (!warehouse) {
          throw new AppError({
            code: ERROR_CODES.WAREHOUSE_NOT_FOUND,
            message: 'Warehouse not found.',
            statusCode: 404,
          });
        }
        if (warehouse.status !== WarehouseStatus.ACTIVE) {
          throw new AppError({
            code: ERROR_CODES.GOODS_RECEIPT_WAREHOUSE_INACTIVE,
            message: GOODS_RECEIPT_ERROR_MESSAGES.WAREHOUSE_INACTIVE,
            statusCode: 409,
          });
        }

        const po = await tx.purchaseOrder.findFirstOrThrow({
          where: { id: dto.purchaseOrderId, companyId: company.companyId },
          include: { items: true },
        });

        const resolvedItems = (dto.items ?? []).map((line) =>
          this.resolveItemInput(po, line.purchaseOrderItemId, line.quantity, line.notes),
        );
        this.assertUniquePoItems(resolvedItems.map((i) => i.purchaseOrderItemId));

        const seq = await allocateGoodsReceiptSequence(tx, company.companyId);
        const number = formatGoodsReceiptNumber(receivedAt ?? new Date(), seq);

        const receipt = await tx.goodsReceipt.create({
          data: {
            companyId: company.companyId,
            number,
            warehouseId: warehouse.id,
            purchaseOrderId: po.id,
            supplierId: po.supplierId,
            status: GoodsReceiptStatus.DRAFT,
            receivedAt,
            notes,
            createdById: actorUserId,
          },
        });

        if (resolvedItems.length > 0) {
          await tx.goodsReceiptItem.createMany({
            data: resolvedItems.map((item) => ({
              companyId: company.companyId,
              goodsReceiptId: receipt.id,
              purchaseOrderItemId: item.purchaseOrderItemId,
              skuId: item.skuId,
              quantity: item.quantity,
              notes: item.notes,
            })),
          });
        }

        const detail = await tx.goodsReceipt.findFirstOrThrow({
          where: { id: receipt.id, companyId: company.companyId },
          include: detailInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.GOODS_RECEIPT_CREATED,
          entityType: AUDIT_ENTITY_TYPES.GOODS_RECEIPT,
          entityId: detail.id,
          before: null,
          after: this.snapshot(detail),
        });

        return detail;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.WAREHOUSE_GOODS_RECEIPT_CREATED,
          payload: {
            companyId: company.companyId,
            goodsReceiptId: created.id,
            purchaseOrderId: created.purchaseOrderId,
            warehouseId: created.warehouseId,
            number: created.number,
          },
        }),
      );

      const postedByPoItem = await this.aggregatePostedQuantities(
        company.companyId,
        created.purchaseOrderId,
      );
      return this.toDetailView(created, postedByPoItem);
    });
  }

  async update(
    company: CompanyContext,
    goodsReceiptId: string,
    dto: UpdateGoodsReceiptDto,
  ): Promise<GoodsReceiptDetailView> {
    return commitThenPublish(this.eventBus, async () => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const current = await this.lockDraft(tx, company.companyId, goodsReceiptId);
        const before = this.snapshot(current);

        const data: Prisma.GoodsReceiptUpdateInput = {};
        if (dto.receivedAt !== undefined) {
          data.receivedAt = dto.receivedAt ? new Date(dto.receivedAt) : null;
        }
        if (dto.notes !== undefined) {
          data.notes = normalizeOptionalText(dto.notes, GOODS_RECEIPT_NOTES_MAX_LENGTH);
        }
        if (Object.keys(data).length === 0) {
          return current;
        }

        await tx.goodsReceipt.update({
          where: { id: current.id },
          data: { ...data, version: { increment: 1 } },
        });

        const detail = await tx.goodsReceipt.findFirstOrThrow({
          where: { id: current.id, companyId: company.companyId },
          include: detailInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.GOODS_RECEIPT_UPDATED,
          entityType: AUDIT_ENTITY_TYPES.GOODS_RECEIPT,
          entityId: detail.id,
          before,
          after: this.snapshot(detail),
        });

        return detail;
      });

      const postedByPoItem = await this.aggregatePostedQuantities(
        company.companyId,
        updated.purchaseOrderId,
      );
      return this.toDetailView(updated, postedByPoItem);
    });
  }

  async addItem(
    company: CompanyContext,
    goodsReceiptId: string,
    dto: AddGoodsReceiptItemDto,
  ): Promise<GoodsReceiptDetailView> {
    return commitThenPublish(this.eventBus, async () => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const current = await this.lockDraft(tx, company.companyId, goodsReceiptId);
        const po = await tx.purchaseOrder.findFirstOrThrow({
          where: { id: current.purchaseOrderId, companyId: company.companyId },
          include: { items: true },
        });
        const resolved = this.resolveItemInput(
          po,
          dto.purchaseOrderItemId,
          dto.quantity,
          dto.notes,
        );

        try {
          await tx.goodsReceiptItem.create({
            data: {
              companyId: company.companyId,
              goodsReceiptId: current.id,
              purchaseOrderItemId: resolved.purchaseOrderItemId,
              skuId: resolved.skuId,
              quantity: resolved.quantity,
              notes: resolved.notes,
            },
          });
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            throw new AppError({
              code: ERROR_CODES.GOODS_RECEIPT_ITEM_DUPLICATE,
              message: GOODS_RECEIPT_ERROR_MESSAGES.ITEM_DUPLICATE,
              statusCode: 409,
            });
          }
          throw error;
        }

        await tx.goodsReceipt.update({
          where: { id: current.id },
          data: { version: { increment: 1 } },
        });

        const detail = await tx.goodsReceipt.findFirstOrThrow({
          where: { id: current.id, companyId: company.companyId },
          include: detailInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.GOODS_RECEIPT_ITEM_ADDED,
          entityType: AUDIT_ENTITY_TYPES.GOODS_RECEIPT,
          entityId: detail.id,
          before: null,
          after: {
            purchaseOrderItemId: resolved.purchaseOrderItemId,
            skuId: resolved.skuId,
            quantity: resolved.quantity,
          },
        });

        return detail;
      });

      const postedByPoItem = await this.aggregatePostedQuantities(
        company.companyId,
        updated.purchaseOrderId,
      );
      return this.toDetailView(updated, postedByPoItem);
    });
  }

  async updateItem(
    company: CompanyContext,
    goodsReceiptId: string,
    itemId: string,
    dto: UpdateGoodsReceiptItemDto,
  ): Promise<GoodsReceiptDetailView> {
    return commitThenPublish(this.eventBus, async () => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const current = await this.lockDraft(tx, company.companyId, goodsReceiptId);
        const item = current.items.find((i) => i.id === itemId);
        if (!item) {
          throw new AppError({
            code: ERROR_CODES.GOODS_RECEIPT_ITEM_NOT_FOUND,
            message: GOODS_RECEIPT_ERROR_MESSAGES.ITEM_NOT_FOUND,
            statusCode: 404,
          });
        }

        const data: Prisma.GoodsReceiptItemUpdateInput = {};
        if (dto.quantity !== undefined) {
          this.assertPositiveQuantity(dto.quantity);
          const allocatedSum = item.batchAllocations.reduce((sum, a) => sum + a.quantity, 0);
          if (dto.quantity < allocatedSum) {
            throw new AppError({
              code: ERROR_CODES.BATCH_ALLOCATION_ITEM_QUANTITY_CONFLICT,
              message: BATCH_ERROR_MESSAGES.ALLOCATION_ITEM_QUANTITY_CONFLICT,
              statusCode: 409,
              details: {
                quantity: dto.quantity,
                allocatedQuantity: allocatedSum,
              },
            });
          }
          data.quantity = dto.quantity;
        }
        if (dto.notes !== undefined) {
          data.notes = normalizeOptionalText(dto.notes, GOODS_RECEIPT_ITEM_NOTES_MAX_LENGTH);
        }
        if (Object.keys(data).length === 0) {
          return current;
        }

        await tx.goodsReceiptItem.update({
          where: { id: item.id },
          data,
        });
        await tx.goodsReceipt.update({
          where: { id: current.id },
          data: { version: { increment: 1 } },
        });

        const detail = await tx.goodsReceipt.findFirstOrThrow({
          where: { id: current.id, companyId: company.companyId },
          include: detailInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.GOODS_RECEIPT_ITEM_UPDATED,
          entityType: AUDIT_ENTITY_TYPES.GOODS_RECEIPT,
          entityId: detail.id,
          before: { itemId: item.id, quantity: item.quantity, notes: item.notes },
          after: {
            itemId: item.id,
            quantity: dto.quantity ?? item.quantity,
            notes:
              dto.notes !== undefined
                ? normalizeOptionalText(dto.notes, GOODS_RECEIPT_ITEM_NOTES_MAX_LENGTH)
                : item.notes,
          },
        });

        return detail;
      });

      const postedByPoItem = await this.aggregatePostedQuantities(
        company.companyId,
        updated.purchaseOrderId,
      );
      return this.toDetailView(updated, postedByPoItem);
    });
  }

  async removeItem(
    company: CompanyContext,
    goodsReceiptId: string,
    itemId: string,
  ): Promise<GoodsReceiptDetailView> {
    return commitThenPublish(this.eventBus, async () => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const current = await this.lockDraft(tx, company.companyId, goodsReceiptId);
        const item = current.items.find((i) => i.id === itemId);
        if (!item) {
          throw new AppError({
            code: ERROR_CODES.GOODS_RECEIPT_ITEM_NOT_FOUND,
            message: GOODS_RECEIPT_ERROR_MESSAGES.ITEM_NOT_FOUND,
            statusCode: 404,
          });
        }

        await tx.goodsReceiptItem.delete({ where: { id: item.id } });
        await tx.goodsReceipt.update({
          where: { id: current.id },
          data: { version: { increment: 1 } },
        });

        const detail = await tx.goodsReceipt.findFirstOrThrow({
          where: { id: current.id, companyId: company.companyId },
          include: detailInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.GOODS_RECEIPT_ITEM_REMOVED,
          entityType: AUDIT_ENTITY_TYPES.GOODS_RECEIPT,
          entityId: detail.id,
          before: {
            itemId: item.id,
            purchaseOrderItemId: item.purchaseOrderItemId,
            quantity: item.quantity,
          },
          after: null,
        });

        return detail;
      });

      const postedByPoItem = await this.aggregatePostedQuantities(
        company.companyId,
        updated.purchaseOrderId,
      );
      return this.toDetailView(updated, postedByPoItem);
    });
  }

  /**
   * Upsert a batch allocation on a DRAFT GRN item.
   * Creates Batch identity when needed (does not create inventory).
   * Same goodsReceiptItemId + batchId consolidates quantity (no duplicate rows).
   */
  async upsertItemBatch(
    company: CompanyContext,
    goodsReceiptId: string,
    itemId: string,
    dto: UpsertGoodsReceiptItemBatchDto,
  ): Promise<GoodsReceiptDetailView> {
    this.assertPositiveQuantity(dto.quantity);

    return commitThenPublish(this.eventBus, async (events) => {
      const result = await this.database.client.$transaction(async (tx) => {
        const current = await this.lockDraft(tx, company.companyId, goodsReceiptId);
        const item = current.items.find((i) => i.id === itemId);
        if (!item) {
          throw new AppError({
            code: ERROR_CODES.GOODS_RECEIPT_ITEM_NOT_FOUND,
            message: GOODS_RECEIPT_ERROR_MESSAGES.ITEM_NOT_FOUND,
            statusCode: 404,
          });
        }

        const batch = await this.resolveBatchForAllocation(tx, company.companyId, item.skuId, dto);
        if (batch.skuId !== item.skuId) {
          throw new AppError({
            code: ERROR_CODES.BATCH_SKU_MISMATCH,
            message: BATCH_ERROR_MESSAGES.SKU_MISMATCH,
            statusCode: 409,
          });
        }

        const otherAllocated = item.batchAllocations
          .filter((a) => a.batchId !== batch.id)
          .reduce((sum, a) => sum + a.quantity, 0);
        if (otherAllocated + dto.quantity > item.quantity) {
          throw new AppError({
            code: ERROR_CODES.BATCH_ALLOCATION_EXCEEDED,
            message: BATCH_ERROR_MESSAGES.ALLOCATION_EXCEEDED,
            statusCode: 409,
            details: {
              itemQuantity: item.quantity,
              allocatedQuantity: otherAllocated + dto.quantity,
            },
          });
        }

        const existing = item.batchAllocations.find((a) => a.batchId === batch.id);
        let allocation;
        if (existing) {
          allocation = await tx.goodsReceiptItemBatch.update({
            where: { id: existing.id },
            data: { quantity: dto.quantity },
          });
        } else {
          try {
            allocation = await tx.goodsReceiptItemBatch.create({
              data: {
                companyId: company.companyId,
                goodsReceiptItemId: item.id,
                batchId: batch.id,
                skuId: item.skuId,
                quantity: dto.quantity,
              },
            });
          } catch (error) {
            if (
              error instanceof Prisma.PrismaClientKnownRequestError &&
              error.code === 'P2002'
            ) {
              const raced = await tx.goodsReceiptItemBatch.findUnique({
                where: {
                  goodsReceiptItemId_batchId: {
                    goodsReceiptItemId: item.id,
                    batchId: batch.id,
                  },
                },
              });
              if (!raced) throw error;
              allocation = await tx.goodsReceiptItemBatch.update({
                where: { id: raced.id },
                data: { quantity: dto.quantity },
              });
            } else {
              throw error;
            }
          }
        }

        await tx.goodsReceipt.update({
          where: { id: current.id },
          data: { version: { increment: 1 } },
        });

        const detail = await tx.goodsReceipt.findFirstOrThrow({
          where: { id: current.id, companyId: company.companyId },
          include: detailInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.GOODS_RECEIPT_BATCH_ALLOCATION_UPSERTED,
          entityType: AUDIT_ENTITY_TYPES.GOODS_RECEIPT,
          entityId: detail.id,
          before: existing
            ? { allocationId: existing.id, batchId: existing.batchId, quantity: existing.quantity }
            : null,
          after: {
            allocationId: allocation.id,
            batchId: batch.id,
            batchNumber: batch.batchNumber,
            quantity: dto.quantity,
            goodsReceiptItemId: item.id,
            skuId: item.skuId,
          },
          metadata: {
            goodsReceiptId: detail.id,
            batchId: batch.id,
            batchNumber: batch.batchNumber,
            skuId: item.skuId,
            supplierBatchNumber: batch.supplierBatchNumber,
          },
        });

        return { detail, batch };
      });

      if (result.batch.created) {
        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_BATCH_CREATED,
            payload: {
              companyId: company.companyId,
              batchId: result.batch.id,
              batchNumber: result.batch.batchNumber,
              skuId: result.batch.skuId,
              supplierBatchNumber: result.batch.supplierBatchNumber,
              expiresAt: result.batch.expiresAt?.toISOString().slice(0, 10) ?? null,
            },
          }),
        );
      }

      const postedByPoItem = await this.aggregatePostedQuantities(
        company.companyId,
        result.detail.purchaseOrderId,
      );
      return this.toDetailView(result.detail, postedByPoItem);
    });
  }

  async updateItemBatch(
    company: CompanyContext,
    goodsReceiptId: string,
    itemId: string,
    allocationId: string,
    dto: UpdateGoodsReceiptItemBatchDto,
  ): Promise<GoodsReceiptDetailView> {
    this.assertPositiveQuantity(dto.quantity);

    return commitThenPublish(this.eventBus, async () => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const current = await this.lockDraft(tx, company.companyId, goodsReceiptId);
        const item = current.items.find((i) => i.id === itemId);
        if (!item) {
          throw new AppError({
            code: ERROR_CODES.GOODS_RECEIPT_ITEM_NOT_FOUND,
            message: GOODS_RECEIPT_ERROR_MESSAGES.ITEM_NOT_FOUND,
            statusCode: 404,
          });
        }
        const existing = item.batchAllocations.find((a) => a.id === allocationId);
        if (!existing) {
          throw new AppError({
            code: ERROR_CODES.BATCH_ALLOCATION_NOT_FOUND,
            message: BATCH_ERROR_MESSAGES.ALLOCATION_NOT_FOUND,
            statusCode: 404,
          });
        }

        const otherAllocated = item.batchAllocations
          .filter((a) => a.id !== existing.id)
          .reduce((sum, a) => sum + a.quantity, 0);
        if (otherAllocated + dto.quantity > item.quantity) {
          throw new AppError({
            code: ERROR_CODES.BATCH_ALLOCATION_EXCEEDED,
            message: BATCH_ERROR_MESSAGES.ALLOCATION_EXCEEDED,
            statusCode: 409,
          });
        }

        await tx.goodsReceiptItemBatch.update({
          where: { id: existing.id },
          data: { quantity: dto.quantity },
        });
        await tx.goodsReceipt.update({
          where: { id: current.id },
          data: { version: { increment: 1 } },
        });

        const detail = await tx.goodsReceipt.findFirstOrThrow({
          where: { id: current.id, companyId: company.companyId },
          include: detailInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.GOODS_RECEIPT_BATCH_ALLOCATION_UPSERTED,
          entityType: AUDIT_ENTITY_TYPES.GOODS_RECEIPT,
          entityId: detail.id,
          before: { allocationId: existing.id, quantity: existing.quantity },
          after: { allocationId: existing.id, quantity: dto.quantity },
          metadata: {
            goodsReceiptId: detail.id,
            batchId: existing.batchId,
            skuId: item.skuId,
          },
        });

        return detail;
      });

      const postedByPoItem = await this.aggregatePostedQuantities(
        company.companyId,
        updated.purchaseOrderId,
      );
      return this.toDetailView(updated, postedByPoItem);
    });
  }

  async removeItemBatch(
    company: CompanyContext,
    goodsReceiptId: string,
    itemId: string,
    allocationId: string,
  ): Promise<GoodsReceiptDetailView> {
    return commitThenPublish(this.eventBus, async () => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const current = await this.lockDraft(tx, company.companyId, goodsReceiptId);
        const item = current.items.find((i) => i.id === itemId);
        if (!item) {
          throw new AppError({
            code: ERROR_CODES.GOODS_RECEIPT_ITEM_NOT_FOUND,
            message: GOODS_RECEIPT_ERROR_MESSAGES.ITEM_NOT_FOUND,
            statusCode: 404,
          });
        }
        const existing = item.batchAllocations.find((a) => a.id === allocationId);
        if (!existing) {
          throw new AppError({
            code: ERROR_CODES.BATCH_ALLOCATION_NOT_FOUND,
            message: BATCH_ERROR_MESSAGES.ALLOCATION_NOT_FOUND,
            statusCode: 404,
          });
        }

        await tx.goodsReceiptItemBatch.delete({ where: { id: existing.id } });
        await tx.goodsReceipt.update({
          where: { id: current.id },
          data: { version: { increment: 1 } },
        });

        const detail = await tx.goodsReceipt.findFirstOrThrow({
          where: { id: current.id, companyId: company.companyId },
          include: detailInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.GOODS_RECEIPT_BATCH_ALLOCATION_REMOVED,
          entityType: AUDIT_ENTITY_TYPES.GOODS_RECEIPT,
          entityId: detail.id,
          before: {
            allocationId: existing.id,
            batchId: existing.batchId,
            quantity: existing.quantity,
          },
          after: null,
          metadata: {
            goodsReceiptId: detail.id,
            batchId: existing.batchId,
            skuId: item.skuId,
          },
        });

        return detail;
      });

      const postedByPoItem = await this.aggregatePostedQuantities(
        company.companyId,
        updated.purchaseOrderId,
      );
      return this.toDetailView(updated, postedByPoItem);
    });
  }

  async post(company: CompanyContext, goodsReceiptId: string): Promise<GoodsReceiptDetailView> {
    const actorUserId = this.requireActorUserId();

    return commitThenPublish(this.eventBus, async (events) => {
      const result = await this.database.client.$transaction(async (tx) => {
        // Lock GRN first for same-GRN concurrent post serialization.
        const lockedGrn = await tx.$queryRaw<
          Array<{ id: string; status: GoodsReceiptStatus; version: number; purchase_order_id: string; warehouse_id: string }>
        >(Prisma.sql`
          SELECT id, status, version, purchase_order_id, warehouse_id
          FROM goods_receipts
          WHERE id = ${goodsReceiptId}::uuid
            AND company_id = ${company.companyId}::uuid
          FOR UPDATE
        `);
        const grnLock = lockedGrn[0];
        if (!grnLock) {
          throw new AppError({
            code: ERROR_CODES.GOODS_RECEIPT_NOT_FOUND,
            message: GOODS_RECEIPT_ERROR_MESSAGES.NOT_FOUND,
            statusCode: 404,
          });
        }
        if (grnLock.status === GoodsReceiptStatus.POSTED) {
          throw new AppError({
            code: ERROR_CODES.GOODS_RECEIPT_ALREADY_POSTED,
            message: GOODS_RECEIPT_ERROR_MESSAGES.ALREADY_POSTED,
            statusCode: 409,
          });
        }
        if (grnLock.status !== GoodsReceiptStatus.DRAFT) {
          throw new AppError({
            code: ERROR_CODES.GOODS_RECEIPT_NOT_DRAFT,
            message: GOODS_RECEIPT_ERROR_MESSAGES.NOT_DRAFT,
            statusCode: 409,
          });
        }

        const detail = await tx.goodsReceipt.findFirstOrThrow({
          where: { id: goodsReceiptId, companyId: company.companyId },
          include: detailInclude,
        });

        if (detail.warehouse.status !== WarehouseStatus.ACTIVE) {
          throw new AppError({
            code: ERROR_CODES.GOODS_RECEIPT_WAREHOUSE_INACTIVE,
            message: GOODS_RECEIPT_ERROR_MESSAGES.WAREHOUSE_INACTIVE,
            statusCode: 409,
          });
        }
        if (detail.items.length === 0) {
          throw new AppError({
            code: ERROR_CODES.GOODS_RECEIPT_EMPTY,
            message: GOODS_RECEIPT_ERROR_MESSAGES.EMPTY,
            statusCode: 409,
          });
        }

        // Validate items belong to PO and SKU matches.
        const poItemsById = new Map(detail.purchaseOrder.items.map((i) => [i.id, i]));
        for (const item of detail.items) {
          const poItem = poItemsById.get(item.purchaseOrderItemId);
          if (!poItem) {
            throw new AppError({
              code: ERROR_CODES.GOODS_RECEIPT_PO_ITEM_MISMATCH,
              message: GOODS_RECEIPT_ERROR_MESSAGES.PO_ITEM_MISMATCH,
              statusCode: 409,
            });
          }
          if (item.skuId !== poItem.skuId) {
            throw new AppError({
              code: ERROR_CODES.GOODS_RECEIPT_SKU_MISMATCH,
              message: GOODS_RECEIPT_ERROR_MESSAGES.SKU_MISMATCH,
              statusCode: 409,
            });
          }
          if (detail.supplierId !== detail.purchaseOrder.supplierId) {
            throw new AppError({
              code: ERROR_CODES.GOODS_RECEIPT_ITEM_INVALID,
              message: 'Goods receipt supplier must match purchase order supplier.',
              statusCode: 409,
            });
          }
        }

        // Phase 3.7: every item must be fully allocated to Batch(es) before POST.
        this.assertBatchAllocationsComplete(detail.items);

        // Aggregate already-posted + this GRN (still DRAFT until we flip status).
        const existingPosted = await this.aggregatePostedQuantitiesTx(
          tx,
          company.companyId,
          detail.purchaseOrderId,
        );
        const accepted: AcceptedReceivedLine[] = [];
        const acceptedMap = new Map<string, number>(existingPosted);

        for (const item of detail.items) {
          acceptedMap.set(
            item.purchaseOrderItemId,
            (acceptedMap.get(item.purchaseOrderItemId) ?? 0) + item.quantity,
          );
        }
        for (const [purchaseOrderItemId, acceptedReceivedQuantity] of acceptedMap) {
          accepted.push({ purchaseOrderItemId, acceptedReceivedQuantity });
        }

        const receivingResult = await this.purchaseReceiving.applyPostedReceivingEvidence(tx, {
          companyId: company.companyId,
          purchaseOrderId: detail.purchaseOrderId,
          acceptedReceived: accepted,
        });

        const postedAt = new Date();
        const receivedAt = detail.receivedAt ?? postedAt;

        const posted = await tx.goodsReceipt.update({
          where: { id: detail.id },
          data: {
            status: GoodsReceiptStatus.POSTED,
            postedAt,
            postedById: actorUserId,
            receivedAt,
            version: { increment: 1 },
          },
          include: detailInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.GOODS_RECEIPT_POSTED,
          entityType: AUDIT_ENTITY_TYPES.GOODS_RECEIPT,
          entityId: posted.id,
          before: { status: GoodsReceiptStatus.DRAFT, version: detail.version },
          after: {
            status: GoodsReceiptStatus.POSTED,
            postedAt: postedAt.toISOString(),
            receivedAt: receivedAt.toISOString(),
            purchaseOrderId: posted.purchaseOrderId,
            warehouseId: posted.warehouseId,
            itemCount: posted.items.length,
            quantities: posted.items.map((i) => ({
              purchaseOrderItemId: i.purchaseOrderItemId,
              skuId: i.skuId,
              quantity: i.quantity,
            })),
            purchaseOrderStatus: receivingResult.newStatus,
          },
        });

        // Phase 4.4 — recognize supplier payable in the same TX (no cash movement).
        const payableRecognition =
          await this.supplierPayablesService.recognizeFromPostedGoodsReceiptInTx(
            tx,
            company.companyId,
            posted.id,
            actorUserId,
          );

        return { posted, receivingResult, payableRecognition };
      });

      for (const payableId of result.payableRecognition.payableIds) {
        events.push(
          this.eventFactory.create({
            type:
              result.payableRecognition.createdLineCount > 0
                ? DOMAIN_EVENTS.SUPPLIER_PAYABLE_CREATED
                : DOMAIN_EVENTS.SUPPLIER_PAYABLE_ADJUSTED,
            payload: {
              companyId: company.companyId,
              payableId,
              goodsReceiptId: result.posted.id,
              purchaseOrderId: result.posted.purchaseOrderId,
            },
          }),
        );
      }

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.WAREHOUSE_GOODS_RECEIPT_POSTED,
          payload: {
            companyId: company.companyId,
            goodsReceiptId: result.posted.id,
            purchaseOrderId: result.posted.purchaseOrderId,
            warehouseId: result.posted.warehouseId,
            postedAt: result.posted.postedAt!.toISOString(),
            itemIds: result.posted.items.map((i) => i.id),
          },
        }),
      );

      if (result.receivingResult.previousStatus !== result.receivingResult.newStatus) {
        const eventType =
          result.receivingResult.newStatus === PurchaseOrderStatus.RECEIVED
            ? DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_RECEIVED
            : DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_PARTIALLY_RECEIVED;

        events.push(
          this.eventFactory.create({
            type: eventType,
            payload: {
              companyId: company.companyId,
              purchaseOrderId: result.posted.purchaseOrderId,
              number: result.posted.purchaseOrder.number,
              supplierId: result.posted.supplierId,
              status: result.receivingResult.newStatus,
              currency: result.posted.purchaseOrder.currency,
              previousStatus: result.receivingResult.previousStatus,
              purchaseType: null,
              total: '0',
              itemCount: result.posted.purchaseOrder.items.length,
              version: result.receivingResult.purchaseOrderVersion,
            },
          }),
        );
      }

      const postedByPoItem = await this.aggregatePostedQuantities(
        company.companyId,
        result.posted.purchaseOrderId,
      );
      // Exclude this receipt from "previously" when rendering — use all posted.
      return this.toDetailView(result.posted, postedByPoItem, true);
    });
  }

  async cancel(
    company: CompanyContext,
    goodsReceiptId: string,
    dto: CancelGoodsReceiptDto = {},
  ): Promise<GoodsReceiptDetailView> {
    const actorUserId = this.requireActorUserId();
    const reason = normalizeOptionalText(
      dto.reason,
      GOODS_RECEIPT_CANCELLATION_REASON_MAX_LENGTH,
    );

    return commitThenPublish(this.eventBus, async (events) => {
      const cancelled = await this.database.client.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<
          Array<{ id: string; status: GoodsReceiptStatus }>
        >(Prisma.sql`
          SELECT id, status
          FROM goods_receipts
          WHERE id = ${goodsReceiptId}::uuid
            AND company_id = ${company.companyId}::uuid
          FOR UPDATE
        `);
        const row = locked[0];
        if (!row) {
          throw new AppError({
            code: ERROR_CODES.GOODS_RECEIPT_NOT_FOUND,
            message: GOODS_RECEIPT_ERROR_MESSAGES.NOT_FOUND,
            statusCode: 404,
          });
        }
        if (row.status === GoodsReceiptStatus.POSTED) {
          throw new AppError({
            code: ERROR_CODES.GOODS_RECEIPT_CANCEL_NOT_ALLOWED,
            message: GOODS_RECEIPT_ERROR_MESSAGES.CANCEL_NOT_ALLOWED,
            statusCode: 409,
          });
        }
        if (row.status === GoodsReceiptStatus.CANCELLED) {
          throw new AppError({
            code: ERROR_CODES.GOODS_RECEIPT_NOT_DRAFT,
            message: GOODS_RECEIPT_ERROR_MESSAGES.NOT_DRAFT,
            statusCode: 409,
          });
        }

        const cancelledAt = new Date();
        const updated = await tx.goodsReceipt.update({
          where: { id: goodsReceiptId },
          data: {
            status: GoodsReceiptStatus.CANCELLED,
            cancelledAt,
            cancelledById: actorUserId,
            cancellationReason: reason,
            version: { increment: 1 },
          },
          include: detailInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.GOODS_RECEIPT_CANCELLED,
          entityType: AUDIT_ENTITY_TYPES.GOODS_RECEIPT,
          entityId: updated.id,
          before: { status: GoodsReceiptStatus.DRAFT },
          after: {
            status: GoodsReceiptStatus.CANCELLED,
            cancellationReason: reason,
            cancelledAt: cancelledAt.toISOString(),
          },
        });

        return updated;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.WAREHOUSE_GOODS_RECEIPT_CANCELLED,
          payload: {
            companyId: company.companyId,
            goodsReceiptId: cancelled.id,
            purchaseOrderId: cancelled.purchaseOrderId,
          },
        }),
      );

      const postedByPoItem = await this.aggregatePostedQuantities(
        company.companyId,
        cancelled.purchaseOrderId,
      );
      return this.toDetailView(cancelled, postedByPoItem);
    });
  }

  // ---------------------------------------------------------------------------
  // Scanner receiving (Phase 3.6) — input method only; GRN remains truth
  // ---------------------------------------------------------------------------

  /**
   * Resolve barcode → Catalog SKU → PO item + draft capacity. No mutation.
   * Expected operational outcomes return structured status (not HTTP 500).
   */
  async scanResolve(
    company: CompanyContext,
    goodsReceiptId: string,
    dto: ScanResolveGoodsReceiptDto,
  ): Promise<ScanResolveResultView> {
    const receipt = await this.requireDetail(company.companyId, goodsReceiptId);
    this.assertScannerDraft(receipt.status);
    await this.purchaseReceiving.assertReceivingAllowed(company, receipt.purchaseOrderId);

    const barcodeRaw = dto.barcode;
    const resolved = await this.resolveBarcodeForScanner(company, barcodeRaw);
    if (resolved.kind === 'unknown') {
      return { status: 'UNKNOWN_BARCODE', barcode: resolved.barcode };
    }
    if (resolved.kind === 'inactive') {
      return { status: 'BARCODE_NOT_ACTIVE', barcode: resolved.barcode };
    }

    const sku = resolved.sku;
    const match = this.matchSkuToPoItems(receipt, sku.id);
    if (match.kind === 'none') {
      return {
        status: 'SKU_NOT_IN_PURCHASE_ORDER',
        barcode: resolved.barcode,
        sku,
      };
    }
    if (match.kind === 'ambiguous') {
      return {
        status: 'AMBIGUOUS_PO_ITEM',
        barcode: resolved.barcode,
        sku,
        purchaseOrderItemIds: match.purchaseOrderItemIds,
      };
    }

    const capacity = await this.computeDraftCapacity(
      company.companyId,
      receipt,
      match.poItem,
    );

    if (capacity.remainingQuantity <= 0 && capacity.closedUnfulfilledQuantity > 0) {
      return {
        status: 'PO_ITEM_RECEIVING_CLOSED',
        barcode: resolved.barcode,
        sku,
        line: {
          purchaseOrderItemId: match.poItem.id,
          skuId: match.poItem.skuId,
          skuCode: match.poItem.skuCodeSnapshot ?? match.poItem.sku.code,
          productName:
            match.poItem.productNameSnapshot ??
            match.poItem.sku.product.name ??
            match.poItem.sku.name,
          orderedQuantity: match.poItem.quantity,
          remainingQuantity: 0,
          draftQuantity: capacity.draftQuantity,
          availableToAdd: 0,
        },
      };
    }

    if (capacity.remainingQuantity <= 0) {
      return {
        status: 'PO_ITEM_ALREADY_FULLY_RECEIVED',
        barcode: resolved.barcode,
        sku,
        line: {
          purchaseOrderItemId: match.poItem.id,
          skuId: match.poItem.skuId,
          skuCode: match.poItem.skuCodeSnapshot ?? match.poItem.sku.code,
          productName:
            match.poItem.productNameSnapshot ??
            match.poItem.sku.product.name ??
            match.poItem.sku.name,
          orderedQuantity: match.poItem.quantity,
          remainingQuantity: 0,
          draftQuantity: capacity.draftQuantity,
          availableToAdd: 0,
        },
      };
    }

    return {
      status: 'MATCHED',
      barcode: resolved.barcode,
      sku,
      line: {
        purchaseOrderItemId: match.poItem.id,
        skuId: match.poItem.skuId,
        skuCode: match.poItem.skuCodeSnapshot ?? match.poItem.sku.code,
        productName:
          match.poItem.productNameSnapshot ??
          match.poItem.sku.product.name ??
          match.poItem.sku.name,
        orderedQuantity: match.poItem.quantity,
        remainingQuantity: capacity.remainingQuantity,
        draftQuantity: capacity.draftQuantity,
        availableToAdd: capacity.availableToAdd,
      },
    };
  }

  /**
   * Atomically resolve barcode and increment/create DRAFT GRN item.
   * Client-supplied skuId / purchaseOrderItemId are never trusted (not accepted).
   */
  async scanApply(
    company: CompanyContext,
    goodsReceiptId: string,
    dto: ScanApplyGoodsReceiptDto,
  ): Promise<ScanApplyResultView> {
    this.assertPositiveQuantity(dto.quantity);

    return commitThenPublish(this.eventBus, async () => {
      const applied = await this.database.client.$transaction(async (tx) => {
        const current = await this.lockDraft(tx, company.companyId, goodsReceiptId);

        if (dto.requestId) {
          const existing = await tx.goodsReceiptScanRequest.findUnique({
            where: {
              companyId_goodsReceiptId_requestId: {
                companyId: company.companyId,
                goodsReceiptId: current.id,
                requestId: dto.requestId,
              },
            },
          });
          if (existing) {
            return {
              kind: 'replay' as const,
              response: existing.responseJson as unknown as ScanApplyResultView,
            };
          }
        }

        await this.purchaseReceiving.assertReceivingAllowed(company, current.purchaseOrderId);

        const resolved = await this.resolveBarcodeForScanner(company, dto.barcode);
        if (resolved.kind === 'unknown') {
          throw new AppError({
            code: ERROR_CODES.UNKNOWN_BARCODE,
            message: GOODS_RECEIPT_ERROR_MESSAGES.UNKNOWN_BARCODE,
            statusCode: 404,
            details: { barcode: resolved.barcode },
          });
        }
        if (resolved.kind === 'inactive') {
          throw new AppError({
            code: ERROR_CODES.BARCODE_NOT_ACTIVE,
            message: GOODS_RECEIPT_ERROR_MESSAGES.BARCODE_NOT_ACTIVE,
            statusCode: 409,
            details: { barcode: resolved.barcode },
          });
        }

        const sku = resolved.sku;
        const match = this.matchSkuToPoItems(current, sku.id);
        if (match.kind === 'none') {
          throw new AppError({
            code: ERROR_CODES.SKU_NOT_IN_PURCHASE_ORDER,
            message: GOODS_RECEIPT_ERROR_MESSAGES.SKU_NOT_IN_PURCHASE_ORDER,
            statusCode: 409,
            details: { barcode: resolved.barcode, sku },
          });
        }
        if (match.kind === 'ambiguous') {
          throw new AppError({
            code: ERROR_CODES.AMBIGUOUS_PO_ITEM,
            message: GOODS_RECEIPT_ERROR_MESSAGES.AMBIGUOUS_PO_ITEM,
            statusCode: 409,
            details: {
              barcode: resolved.barcode,
              sku,
              purchaseOrderItemIds: match.purchaseOrderItemIds,
            },
          });
        }

        const capacity = await this.computeDraftCapacityTx(
          tx,
          company.companyId,
          current,
          match.poItem,
        );

        if (capacity.remainingQuantity <= 0 && capacity.closedUnfulfilledQuantity > 0) {
          throw new AppError({
            code: ERROR_CODES.PO_ITEM_RECEIVING_CLOSED,
            message: GOODS_RECEIPT_ERROR_MESSAGES.PO_ITEM_RECEIVING_CLOSED,
            statusCode: 409,
            details: {
              remaining: capacity.remainingQuantity,
              draftQuantity: capacity.draftQuantity,
              availableToAdd: 0,
              requested: dto.quantity,
            },
          });
        }

        if (capacity.remainingQuantity <= 0) {
          throw new AppError({
            code: ERROR_CODES.PO_ITEM_ALREADY_FULLY_RECEIVED,
            message: GOODS_RECEIPT_ERROR_MESSAGES.PO_ITEM_ALREADY_FULLY_RECEIVED,
            statusCode: 409,
            details: {
              remaining: capacity.remainingQuantity,
              draftQuantity: capacity.draftQuantity,
              availableToAdd: 0,
              requested: dto.quantity,
            },
          });
        }

        if (dto.quantity > capacity.availableToAdd) {
          throw new AppError({
            code: ERROR_CODES.RECEIVING_QUANTITY_EXCEEDED,
            message: GOODS_RECEIPT_ERROR_MESSAGES.RECEIVING_QUANTITY_EXCEEDED,
            statusCode: 409,
            details: {
              remaining: capacity.remainingQuantity,
              draftQuantity: capacity.draftQuantity,
              availableToAdd: capacity.availableToAdd,
              requested: dto.quantity,
            },
          });
        }

        const existingItem = current.items.find(
          (i) => i.purchaseOrderItemId === match.poItem.id,
        );
        let goodsReceiptItemId: string;
        let draftQuantity: number;
        const beforeQty = existingItem?.quantity ?? 0;

        if (existingItem) {
          const updatedItem = await tx.goodsReceiptItem.update({
            where: { id: existingItem.id },
            data: { quantity: { increment: dto.quantity } },
          });
          goodsReceiptItemId = updatedItem.id;
          draftQuantity = updatedItem.quantity;
          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.GOODS_RECEIPT_ITEM_UPDATED,
            entityType: AUDIT_ENTITY_TYPES.GOODS_RECEIPT,
            entityId: current.id,
            before: { purchaseOrderItemId: match.poItem.id, quantity: beforeQty },
            after: {
              purchaseOrderItemId: match.poItem.id,
              quantity: draftQuantity,
              source: 'scanner',
              barcode: resolved.barcode,
            },
          });
        } else {
          const createdItem = await tx.goodsReceiptItem.create({
            data: {
              companyId: company.companyId,
              goodsReceiptId: current.id,
              purchaseOrderItemId: match.poItem.id,
              skuId: match.poItem.skuId,
              quantity: dto.quantity,
            },
          });
          goodsReceiptItemId = createdItem.id;
          draftQuantity = createdItem.quantity;
          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.GOODS_RECEIPT_ITEM_ADDED,
            entityType: AUDIT_ENTITY_TYPES.GOODS_RECEIPT,
            entityId: current.id,
            before: null,
            after: {
              purchaseOrderItemId: match.poItem.id,
              skuId: match.poItem.skuId,
              quantity: draftQuantity,
              source: 'scanner',
              barcode: resolved.barcode,
            },
          });
        }

        const wantsBatch =
          dto.batchId !== undefined ||
          dto.supplierBatchNumber !== undefined ||
          dto.manufacturedAt !== undefined ||
          dto.expiresAt !== undefined;
        if (wantsBatch) {
          const batch = await this.resolveBatchForAllocation(tx, company.companyId, match.poItem.skuId, {
            batchId: dto.batchId,
            supplierBatchNumber: dto.supplierBatchNumber,
            manufacturedAt: dto.manufacturedAt,
            expiresAt: dto.expiresAt,
          });
          if (batch.skuId !== match.poItem.skuId) {
            throw new AppError({
              code: ERROR_CODES.BATCH_SKU_MISMATCH,
              message: BATCH_ERROR_MESSAGES.SKU_MISMATCH,
              statusCode: 409,
            });
          }

          const existingAllocation = await tx.goodsReceiptItemBatch.findUnique({
            where: {
              goodsReceiptItemId_batchId: {
                goodsReceiptItemId,
                batchId: batch.id,
              },
            },
          });
          if (existingAllocation) {
            await tx.goodsReceiptItemBatch.update({
              where: { id: existingAllocation.id },
              data: { quantity: { increment: dto.quantity } },
            });
          } else {
            await tx.goodsReceiptItemBatch.create({
              data: {
                companyId: company.companyId,
                goodsReceiptItemId,
                batchId: batch.id,
                skuId: match.poItem.skuId,
                quantity: dto.quantity,
              },
            });
          }

          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.GOODS_RECEIPT_BATCH_ALLOCATION_UPSERTED,
            entityType: AUDIT_ENTITY_TYPES.GOODS_RECEIPT,
            entityId: current.id,
            before: existingAllocation
              ? {
                  allocationId: existingAllocation.id,
                  batchId: existingAllocation.batchId,
                  quantity: existingAllocation.quantity,
                }
              : null,
            after: {
              batchId: batch.id,
              batchNumber: batch.batchNumber,
              quantityAdded: dto.quantity,
              goodsReceiptItemId,
              source: 'scanner',
            },
            metadata: {
              goodsReceiptId: current.id,
              batchId: batch.id,
              batchNumber: batch.batchNumber,
              skuId: match.poItem.skuId,
              supplierBatchNumber: batch.supplierBatchNumber,
            },
          });
        }

        await tx.goodsReceipt.update({
          where: { id: current.id },
          data: { version: { increment: 1 } },
        });

        const detail = await tx.goodsReceipt.findFirstOrThrow({
          where: { id: current.id, companyId: company.companyId },
          include: detailInclude,
        });

        const postedByPoItem = await this.aggregatePostedQuantitiesTx(
          tx,
          company.companyId,
          detail.purchaseOrderId,
        );
        const receiptView = this.toDetailView(detail, postedByPoItem);
        const availableToAdd = Math.max(0, capacity.remainingQuantity - draftQuantity);

        const response: ScanApplyResultView = {
          status: 'APPLIED',
          barcode: resolved.barcode,
          quantityAdded: dto.quantity,
          draftQuantity,
          availableToAdd,
          remainingQuantity: capacity.remainingQuantity,
          sku,
          purchaseOrderItemId: match.poItem.id,
          goodsReceiptItemId,
          replayed: false,
          receipt: receiptView,
        };

        if (dto.requestId) {
          try {
            await tx.goodsReceiptScanRequest.create({
              data: {
                companyId: company.companyId,
                goodsReceiptId: current.id,
                requestId: dto.requestId,
                responseJson: response as unknown as Prisma.InputJsonValue,
              },
            });
          } catch (error) {
            if (
              error instanceof Prisma.PrismaClientKnownRequestError &&
              error.code === 'P2002'
            ) {
              const raced = await tx.goodsReceiptScanRequest.findUniqueOrThrow({
                where: {
                  companyId_goodsReceiptId_requestId: {
                    companyId: company.companyId,
                    goodsReceiptId: current.id,
                    requestId: dto.requestId,
                  },
                },
              });
              return {
                kind: 'replay' as const,
                response: raced.responseJson as unknown as ScanApplyResultView,
              };
            }
            throw error;
          }
        }

        return { kind: 'applied' as const, response };
      });

      if (applied.kind === 'replay') {
        return { ...applied.response, replayed: true };
      }
      return applied.response;
    });
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private assertBatchAllocationsComplete(
    items: DetailRow['items'],
  ): void {
    for (const item of items) {
      const allocated = item.batchAllocations.reduce((sum, a) => sum + a.quantity, 0);
      if (allocated < item.quantity) {
        throw new AppError({
          code: ERROR_CODES.BATCH_ALLOCATION_INCOMPLETE,
          message: BATCH_ERROR_MESSAGES.ALLOCATION_INCOMPLETE,
          statusCode: 409,
          details: {
            goodsReceiptItemId: item.id,
            skuId: item.skuId,
            quantity: item.quantity,
            allocatedQuantity: allocated,
          },
        });
      }
      if (allocated > item.quantity) {
        throw new AppError({
          code: ERROR_CODES.BATCH_ALLOCATION_EXCEEDED,
          message: BATCH_ERROR_MESSAGES.ALLOCATION_EXCEEDED,
          statusCode: 409,
          details: {
            goodsReceiptItemId: item.id,
            skuId: item.skuId,
            quantity: item.quantity,
            allocatedQuantity: allocated,
          },
        });
      }
      for (const allocation of item.batchAllocations) {
        if (allocation.quantity <= 0) {
          throw new AppError({
            code: ERROR_CODES.BATCH_ALLOCATION_INVALID_QUANTITY,
            message: BATCH_ERROR_MESSAGES.ALLOCATION_INVALID_QUANTITY,
            statusCode: 409,
          });
        }
        if (allocation.batch.skuId !== item.skuId || allocation.skuId !== item.skuId) {
          throw new AppError({
            code: ERROR_CODES.BATCH_SKU_MISMATCH,
            message: BATCH_ERROR_MESSAGES.SKU_MISMATCH,
            statusCode: 409,
            details: {
              goodsReceiptItemId: item.id,
              itemSkuId: item.skuId,
              batchId: allocation.batchId,
              batchSkuId: allocation.batch.skuId,
            },
          });
        }
      }
    }
  }

  private async resolveBatchForAllocation(
    tx: Prisma.TransactionClient,
    companyId: string,
    skuId: string,
    dto: Pick<
      UpsertGoodsReceiptItemBatchDto,
      'batchId' | 'supplierBatchNumber' | 'manufacturedAt' | 'expiresAt'
    >,
  ) {
    if (dto.batchId) {
      const batch = await this.batchesService.requireBatchInCompany(tx, companyId, dto.batchId);
      if (batch.skuId !== skuId) {
        throw new AppError({
          code: ERROR_CODES.BATCH_SKU_MISMATCH,
          message: BATCH_ERROR_MESSAGES.SKU_MISMATCH,
          statusCode: 409,
        });
      }
      return {
        id: batch.id,
        batchNumber: batch.batchNumber,
        skuId: batch.skuId,
        supplierBatchNumber: batch.supplierBatchNumber,
        manufacturedAt: batch.manufacturedAt,
        expiresAt: batch.expiresAt,
        notes: batch.notes,
        created: false,
      };
    }

    return this.batchesService.createBatchInTx(tx, companyId, {
      skuId,
      supplierBatchNumber: dto.supplierBatchNumber,
      manufacturedAt: dto.manufacturedAt,
      expiresAt: dto.expiresAt,
    });
  }

  private toBatchAllocationView(
    allocation: DetailRow['items'][number]['batchAllocations'][number],
  ): GoodsReceiptItemBatchView {
    return {
      id: allocation.id,
      batchId: allocation.batchId,
      batchNumber: allocation.batch.batchNumber,
      supplierBatchNumber: allocation.batch.supplierBatchNumber,
      skuId: allocation.skuId,
      quantity: allocation.quantity,
      manufacturedAt: allocation.batch.manufacturedAt
        ? allocation.batch.manufacturedAt.toISOString().slice(0, 10)
        : null,
      expiresAt: allocation.batch.expiresAt
        ? allocation.batch.expiresAt.toISOString().slice(0, 10)
        : null,
      createdAt: allocation.createdAt.toISOString(),
      updatedAt: allocation.updatedAt.toISOString(),
    };
  }

  private assertScannerDraft(status: GoodsReceiptStatus): void {
    if (status === GoodsReceiptStatus.POSTED) {
      throw new AppError({
        code: ERROR_CODES.GOODS_RECEIPT_POSTED_IMMUTABLE,
        message: GOODS_RECEIPT_ERROR_MESSAGES.POSTED_IMMUTABLE,
        statusCode: 409,
      });
    }
    if (status !== GoodsReceiptStatus.DRAFT) {
      throw new AppError({
        code: ERROR_CODES.GRN_NOT_DRAFT,
        message: GOODS_RECEIPT_ERROR_MESSAGES.GRN_NOT_DRAFT,
        statusCode: 409,
      });
    }
  }

  private async resolveBarcodeForScanner(
    company: CompanyContext,
    rawBarcode: string,
  ): Promise<
    | { kind: 'matched'; barcode: string; sku: ScannerSkuRef }
    | { kind: 'unknown'; barcode: string }
    | { kind: 'inactive'; barcode: string }
  > {
    try {
      const lookup = await this.barcodesService.resolve(company, rawBarcode);
      return {
        kind: 'matched',
        barcode: lookup.barcode.value,
        sku: {
          id: lookup.sku.id,
          code: lookup.sku.code,
          name: lookup.sku.name,
          productName: lookup.product.name,
        },
      };
    } catch (error) {
      if (error instanceof AppError) {
        if (error.code === ERROR_CODES.BARCODE_NOT_FOUND) {
          // Preserve string identity; do not parse as number (leading zeros).
          return { kind: 'unknown', barcode: String(rawBarcode) };
        }
        if (error.code === ERROR_CODES.BARCODE_NOT_ACTIVE) {
          return { kind: 'inactive', barcode: String(rawBarcode) };
        }
      }
      throw error;
    }
  }

  private matchSkuToPoItems(
    receipt: DetailRow,
    skuId: string,
  ):
    | { kind: 'one'; poItem: DetailRow['purchaseOrder']['items'][number] }
    | { kind: 'none' }
    | { kind: 'ambiguous'; purchaseOrderItemIds: string[] } {
    const matches = receipt.purchaseOrder.items.filter((i) => i.skuId === skuId);
    if (matches.length === 0) return { kind: 'none' };
    if (matches.length > 1) {
      return {
        kind: 'ambiguous',
        purchaseOrderItemIds: matches.map((m) => m.id),
      };
    }
    return { kind: 'one', poItem: matches[0]! };
  }

  private async computeDraftCapacity(
    companyId: string,
    receipt: DetailRow,
    poItem: DetailRow['purchaseOrder']['items'][number],
  ): Promise<{
    remainingQuantity: number;
    draftQuantity: number;
    availableToAdd: number;
    closedUnfulfilledQuantity: number;
  }> {
    return this.computeDraftCapacityTx(this.database.client, companyId, receipt, poItem);
  }

  private async computeDraftCapacityTx(
    tx: Prisma.TransactionClient | DatabaseService['client'],
    companyId: string,
    receipt: DetailRow,
    poItem: DetailRow['purchaseOrder']['items'][number],
  ): Promise<{
    remainingQuantity: number;
    draftQuantity: number;
    availableToAdd: number;
    closedUnfulfilledQuantity: number;
  }> {
    const postedByPoItem = await this.aggregatePostedQuantitiesTx(
      tx,
      companyId,
      receipt.purchaseOrderId,
    );
    const previouslyReceived = postedByPoItem.get(poItem.id) ?? 0;
    const closed = poItem.closedUnfulfilledQuantity;
    const remainingQuantity = Math.max(0, poItem.quantity - previouslyReceived - closed);
    const draftQuantity =
      receipt.items.find((i) => i.purchaseOrderItemId === poItem.id)?.quantity ?? 0;
    const availableToAdd = Math.max(0, remainingQuantity - draftQuantity);
    return {
      remainingQuantity,
      draftQuantity,
      availableToAdd,
      closedUnfulfilledQuantity: closed,
    };
  }

  private async requireDetail(companyId: string, goodsReceiptId: string): Promise<DetailRow> {
    const row = await this.database.client.goodsReceipt.findFirst({
      where: { id: goodsReceiptId, companyId },
      include: detailInclude,
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.GOODS_RECEIPT_NOT_FOUND,
        message: GOODS_RECEIPT_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return row;
  }

  private async lockDraft(
    tx: Prisma.TransactionClient,
    companyId: string,
    goodsReceiptId: string,
  ): Promise<DetailRow> {
    const locked = await tx.$queryRaw<Array<{ id: string; status: GoodsReceiptStatus }>>(
      Prisma.sql`
        SELECT id, status
        FROM goods_receipts
        WHERE id = ${goodsReceiptId}::uuid
          AND company_id = ${companyId}::uuid
        FOR UPDATE
      `,
    );
    const row = locked[0];
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.GOODS_RECEIPT_NOT_FOUND,
        message: GOODS_RECEIPT_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    if (row.status === GoodsReceiptStatus.POSTED) {
      throw new AppError({
        code: ERROR_CODES.GOODS_RECEIPT_POSTED_IMMUTABLE,
        message: GOODS_RECEIPT_ERROR_MESSAGES.POSTED_IMMUTABLE,
        statusCode: 409,
      });
    }
    if (row.status !== GoodsReceiptStatus.DRAFT) {
      throw new AppError({
        code: ERROR_CODES.GOODS_RECEIPT_NOT_DRAFT,
        message: GOODS_RECEIPT_ERROR_MESSAGES.NOT_DRAFT,
        statusCode: 409,
      });
    }
    return tx.goodsReceipt.findFirstOrThrow({
      where: { id: goodsReceiptId, companyId },
      include: detailInclude,
    });
  }

  private resolveItemInput(
    po: { id: string; items: Array<{ id: string; skuId: string }> },
    purchaseOrderItemId: string,
    quantity: number,
    notes?: string | null,
  ): { purchaseOrderItemId: string; skuId: string; quantity: number; notes: string | null } {
    this.assertPositiveQuantity(quantity);
    const poItem = po.items.find((i) => i.id === purchaseOrderItemId);
    if (!poItem) {
      throw new AppError({
        code: ERROR_CODES.GOODS_RECEIPT_PO_ITEM_MISMATCH,
        message: GOODS_RECEIPT_ERROR_MESSAGES.PO_ITEM_MISMATCH,
        statusCode: 400,
      });
    }
    return {
      purchaseOrderItemId: poItem.id,
      skuId: poItem.skuId,
      quantity,
      notes: normalizeOptionalText(notes, GOODS_RECEIPT_ITEM_NOTES_MAX_LENGTH),
    };
  }

  private assertUniquePoItems(ids: string[]): void {
    if (new Set(ids).size !== ids.length) {
      throw new AppError({
        code: ERROR_CODES.GOODS_RECEIPT_ITEM_DUPLICATE,
        message: GOODS_RECEIPT_ERROR_MESSAGES.ITEM_DUPLICATE,
        statusCode: 400,
      });
    }
  }

  private assertPositiveQuantity(quantity: number): void {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new AppError({
        code: ERROR_CODES.GOODS_RECEIPT_INVALID_QUANTITY,
        message: GOODS_RECEIPT_ERROR_MESSAGES.INVALID_QUANTITY,
        statusCode: 400,
      });
    }
  }

  /**
   * Aggregate POSTED receipt quantities per PO item.
   * @param excludeGoodsReceiptId when building draft UI, still exclude nothing from posted
   *   (drafts never count). Kept for API symmetry.
   */
  private async aggregatePostedQuantities(
    companyId: string,
    purchaseOrderId: string,
    _excludeGoodsReceiptId?: string,
  ): Promise<Map<string, number>> {
    return this.aggregatePostedQuantitiesTx(
      this.database.client,
      companyId,
      purchaseOrderId,
    );
  }

  private async aggregatePostedQuantitiesTx(
    tx: Prisma.TransactionClient | DatabaseService['client'],
    companyId: string,
    purchaseOrderId: string,
  ): Promise<Map<string, number>> {
    const rows = await tx.goodsReceiptItem.groupBy({
      by: ['purchaseOrderItemId'],
      where: {
        companyId,
        goodsReceipt: {
          companyId,
          purchaseOrderId,
          status: GoodsReceiptStatus.POSTED,
        },
      },
      _sum: { quantity: true },
    });
    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.purchaseOrderItemId, row._sum.quantity ?? 0);
    }
    return map;
  }

  private toDetailView(
    row: DetailRow,
    postedByPoItem: Map<string, number>,
    thisReceiptIsPosted = row.status === GoodsReceiptStatus.POSTED,
  ): GoodsReceiptDetailView {
    const poItemsById = new Map(row.purchaseOrder.items.map((i) => [i.id, i]));

    const items: GoodsReceiptItemView[] = row.items.map((item) => {
      const poItem = poItemsById.get(item.purchaseOrderItemId);
      const ordered = poItem?.quantity ?? 0;
      const totalPosted = postedByPoItem.get(item.purchaseOrderItemId) ?? 0;
      // For draft UI: previously = all posted; remaining after this draft = ordered - posted - this.
      // For posted: previously = posted - this line qty (other receipts); remaining after = ordered - posted.
      const thisQty = item.quantity;
      const previously = thisReceiptIsPosted
        ? Math.max(0, totalPosted - thisQty)
        : totalPosted;
      const remainingAfter = Math.max(
        0,
        ordered - totalPosted - (thisReceiptIsPosted ? 0 : thisQty) - (poItem?.closedUnfulfilledQuantity ?? 0),
      );

      const batchAllocations = (item.batchAllocations ?? []).map((allocation) =>
        this.toBatchAllocationView(allocation),
      );
      const allocatedQuantity = batchAllocations.reduce((sum, a) => sum + a.quantity, 0);

      return {
        id: item.id,
        purchaseOrderItemId: item.purchaseOrderItemId,
        skuId: item.skuId,
        skuCode: poItem?.skuCodeSnapshot ?? poItem?.sku.code ?? null,
        productName:
          poItem?.productNameSnapshot ?? poItem?.sku.product.name ?? poItem?.sku.name ?? null,
        quantity: item.quantity,
        notes: item.notes,
        orderedQuantity: ordered,
        previouslyReceivedQuantity: previously,
        remainingQuantity: remainingAfter,
        batchAllocations,
        allocatedQuantity,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      };
    });

    return {
      id: row.id,
      number: row.number,
      status: row.status,
      warehouseId: row.warehouseId,
      warehouseCode: row.warehouse.code,
      warehouseName: row.warehouse.name,
      purchaseOrderId: row.purchaseOrderId,
      purchaseOrderNumber: row.purchaseOrder.number,
      purchaseOrderStatus: row.purchaseOrder.status,
      supplierId: row.supplierId,
      supplierName: row.supplier.name,
      receivedAt: row.receivedAt?.toISOString() ?? null,
      postedAt: row.postedAt?.toISOString() ?? null,
      notes: row.notes,
      cancellationReason: row.cancellationReason,
      version: row.version,
      items,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
    };
  }

  private snapshot(row: DetailRow) {
    return {
      id: row.id,
      number: row.number,
      status: row.status,
      warehouseId: row.warehouseId,
      purchaseOrderId: row.purchaseOrderId,
      supplierId: row.supplierId,
      receivedAt: row.receivedAt?.toISOString() ?? null,
      notes: row.notes,
      version: row.version,
      itemCount: row.items.length,
      items: row.items.map((i) => ({
        id: i.id,
        purchaseOrderItemId: i.purchaseOrderItemId,
        skuId: i.skuId,
        quantity: i.quantity,
      })),
    };
  }

  private requireActorUserId(): string {
    const userId = getRequestContext()?.userId;
    if (!userId) {
      throw new AppError({
        code: ERROR_CODES.UNAUTHENTICATED,
        message: 'Authenticated user is required.',
        statusCode: 401,
      });
    }
    return userId;
  }
}

function normalizeSearch(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().slice(0, GOODS_RECEIPT_SEARCH_MAX_LENGTH);
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeOptionalText(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Text must be at most ${maxLength} characters.`,
      statusCode: 400,
    });
  }
  return trimmed;
}
