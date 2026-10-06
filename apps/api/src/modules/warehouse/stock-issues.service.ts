import { Injectable } from '@nestjs/common';
import {
  InventoryMovementType,
  InventorySourceType,
  Prisma,
  StockClassification,
  StockIssueReason,
  StockIssueStatus,
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
import { InventoryLedgerService, type PostMovementInput } from './inventory-ledger.service';
import { InventoryReservationsService } from './inventory-reservations.service';
import { normalizeLocationBarcodeInput } from './location-barcode.util';
import {
  allocateStockIssueSequence,
  formatStockIssueNumber,
} from './stock-issue-numbering';
import {
  STOCK_ISSUE_ERROR_MESSAGES,
  STOCK_ISSUE_SEARCH_MAX_LENGTH,
} from './stock-issue.constants';
import type {
  CreateStockIssueDto,
  ListStockIssuesQueryDto,
  ScanApplyStockIssueDto,
  StockIssueItemInputDto,
  UpdateStockIssueDto,
  UpsertStockIssueItemDto,
} from './dto/stock-issue.dto';
import type {
  StockIssueDetailView,
  StockIssueItemView,
  StockIssueListItemView,
  StockIssueScanApplyResultView,
} from './types/stock-issue.types';

const detailInclude = {
  warehouse: {
    select: { id: true, code: true, name: true, status: true, isSystem: true },
  },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  postedBy: { select: { id: true, firstName: true, lastName: true } },
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
} satisfies Prisma.StockIssueInclude;

type DetailRow = Prisma.StockIssueGetPayload<{ include: typeof detailInclude }>;
type Tx = Prisma.TransactionClient;

@Injectable()
export class StockIssuesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
    private readonly inventoryLedger: InventoryLedgerService,
    private readonly reservations: InventoryReservationsService,
    private readonly barcodesService: BarcodesService,
  ) {}

  async list(
    company: CompanyContext,
    query: ListStockIssuesQueryDto,
  ): Promise<{ data: StockIssueListItemView[]; meta: PaginationMeta }> {
    const search = normalizeSearch(query.q);
    const where: Prisma.StockIssueWhereInput = {
      companyId: company.companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.reason ? { reason: query.reason } : {}),
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
              { warehouse: { code: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const skip = (query.page - 1) * query.pageSize;
    const [total, rows] = await this.database.client.$transaction([
      this.database.client.stockIssue.count({ where }),
      this.database.client.stockIssue.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.pageSize,
        include: {
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
        reason: row.reason,
        reasonText: row.reasonText,
        warehouse: row.warehouse,
        itemCount: row.items.length,
        totalQuantity: row.items.reduce((sum, i) => sum + i.quantity, 0),
        notes: row.notes,
        createdBy: row.createdBy,
        postedAt: row.postedAt?.toISOString() ?? null,
        cancelledAt: row.cancelledAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async get(company: CompanyContext, issueId: string): Promise<StockIssueDetailView> {
    const row = await this.requireDetail(company.companyId, issueId);
    return this.toDetailView(row);
  }

  async create(
    company: CompanyContext,
    dto: CreateStockIssueDto,
  ): Promise<StockIssueDetailView> {
    const actorUserId = this.requireActorUserId();
    this.assertReasonText(dto.reason, dto.reasonText);

    return commitThenPublish(this.eventBus, async (events) => {
      const created = await this.database.client.$transaction(async (tx) => {
        await this.assertOperationalWarehouse(tx, company.companyId, dto.warehouseId);

        const seq = await allocateStockIssueSequence(tx, company.companyId);
        const number = formatStockIssueNumber(seq);
        const issue = await tx.stockIssue.create({
          data: {
            companyId: company.companyId,
            number,
            warehouseId: dto.warehouseId,
            reason: dto.reason,
            reasonText: dto.reasonText?.trim() ?? null,
            notes: dto.notes ?? null,
            createdById: actorUserId,
            status: StockIssueStatus.DRAFT,
          },
        });

        if (dto.items?.length) {
          for (const item of dto.items) {
            await this.insertItem(tx, company.companyId, issue, item);
          }
        }

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.STOCK_ISSUE_CREATED,
          entityType: AUDIT_ENTITY_TYPES.STOCK_ISSUE,
          entityId: issue.id,
          before: null,
          after: {
            number: issue.number,
            warehouseId: issue.warehouseId,
            reason: issue.reason,
            itemCount: dto.items?.length ?? 0,
            status: StockIssueStatus.DRAFT,
          },
          metadata: {
            issueId: issue.id,
            issueNumber: issue.number,
            warehouseId: issue.warehouseId,
            reason: issue.reason,
            itemCount: dto.items?.length ?? 0,
            status: StockIssueStatus.DRAFT,
          },
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_STOCK_ISSUE_CREATED,
            payload: {
              companyId: company.companyId,
              issueId: issue.id,
              issueNumber: issue.number,
              warehouseId: issue.warehouseId,
              reason: issue.reason,
              itemCount: dto.items?.length ?? 0,
              status: StockIssueStatus.DRAFT,
            },
          }),
        );

        return this.loadDetailInTx(tx, company.companyId, issue.id);
      });
      return this.toDetailView(created);
    });
  }

  async update(
    company: CompanyContext,
    issueId: string,
    dto: UpdateStockIssueDto,
  ): Promise<StockIssueDetailView> {
    return commitThenPublish(this.eventBus, async (events) => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockIssue(tx, company.companyId, issueId);
        if (locked.status !== StockIssueStatus.DRAFT) {
          throw new AppError({
            code: ERROR_CODES.STOCK_ISSUE_NOT_EDITABLE,
            message: STOCK_ISSUE_ERROR_MESSAGES.NOT_EDITABLE,
            statusCode: 409,
          });
        }

        const warehouseId = dto.warehouseId ?? locked.warehouseId;
        const reason = dto.reason ?? locked.reason;
        const reasonText =
          dto.reasonText !== undefined
            ? dto.reasonText
            : locked.reasonText;
        this.assertReasonText(reason, reasonText ?? undefined);

        await this.assertOperationalWarehouse(tx, company.companyId, warehouseId);

        await tx.stockIssue.update({
          where: { id: issueId },
          data: {
            warehouseId,
            reason,
            ...(dto.reasonText !== undefined ? { reasonText: dto.reasonText } : {}),
            ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
            version: { increment: 1 },
          },
        });

        if (dto.items) {
          await tx.stockIssueItem.deleteMany({
            where: { stockIssueId: issueId, companyId: company.companyId },
          });
          const header = { id: issueId, warehouseId };
          for (const item of dto.items) {
            await this.insertItem(tx, company.companyId, header, item);
          }
        }

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.STOCK_ISSUE_UPDATED,
          entityType: AUDIT_ENTITY_TYPES.STOCK_ISSUE,
          entityId: issueId,
          before: {
            warehouseId: locked.warehouseId,
            reason: locked.reason,
            status: locked.status,
          },
          after: {
            warehouseId,
            reason,
            status: StockIssueStatus.DRAFT,
            ...(dto.items ? { itemCount: dto.items.length } : {}),
          },
          metadata: {
            issueId,
            issueNumber: locked.number,
            status: StockIssueStatus.DRAFT,
          },
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_STOCK_ISSUE_UPDATED,
            payload: {
              companyId: company.companyId,
              issueId,
              issueNumber: locked.number,
              warehouseId,
              reason,
              status: StockIssueStatus.DRAFT,
            },
          }),
        );

        return this.loadDetailInTx(tx, company.companyId, issueId);
      });
      return this.toDetailView(updated);
    });
  }

  async upsertItem(
    company: CompanyContext,
    issueId: string,
    dto: UpsertStockIssueItemDto,
  ): Promise<StockIssueDetailView> {
    const classification = dto.classification ?? StockClassification.SELLABLE;

    return commitThenPublish(this.eventBus, async (events) => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockIssue(tx, company.companyId, issueId);
        this.assertDraft(locked.status);

        const existing = await tx.stockIssueItem.findUnique({
          where: {
            stockIssueId_skuId_batchId_locationId_classification: {
              stockIssueId: issueId,
              skuId: dto.skuId,
              batchId: dto.batchId,
              locationId: dto.locationId,
              classification,
            },
          },
        });

        if (existing && dto.increment) {
          await tx.stockIssueItem.update({
            where: { id: existing.id },
            data: { quantity: existing.quantity + dto.quantity, notes: dto.notes ?? existing.notes },
          });
        } else if (existing) {
          await this.validateItemDimensions(tx, company.companyId, locked, {
            ...dto,
            classification,
          });
          await tx.stockIssueItem.update({
            where: { id: existing.id },
            data: { quantity: dto.quantity, notes: dto.notes ?? null },
          });
        } else {
          await this.insertItem(tx, company.companyId, locked, { ...dto, classification });
        }

        await tx.stockIssue.update({
          where: { id: issueId },
          data: { version: { increment: 1 } },
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_STOCK_ISSUE_UPDATED,
            payload: {
              companyId: company.companyId,
              issueId,
              issueNumber: locked.number,
              warehouseId: locked.warehouseId,
              status: StockIssueStatus.DRAFT,
            },
          }),
        );

        return this.loadDetailInTx(tx, company.companyId, issueId);
      });
      return this.toDetailView(updated);
    });
  }

  async removeItem(
    company: CompanyContext,
    issueId: string,
    itemId: string,
  ): Promise<StockIssueDetailView> {
    return commitThenPublish(this.eventBus, async (events) => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockIssue(tx, company.companyId, issueId);
        this.assertDraft(locked.status);
        const deleted = await tx.stockIssueItem.deleteMany({
          where: { id: itemId, stockIssueId: issueId, companyId: company.companyId },
        });
        if (deleted.count === 0) {
          throw new AppError({
            code: ERROR_CODES.STOCK_ISSUE_ITEM_NOT_FOUND,
            message: STOCK_ISSUE_ERROR_MESSAGES.ITEM_NOT_FOUND,
            statusCode: 404,
          });
        }
        await tx.stockIssue.update({
          where: { id: issueId },
          data: { version: { increment: 1 } },
        });
        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_STOCK_ISSUE_UPDATED,
            payload: {
              companyId: company.companyId,
              issueId,
              issueNumber: locked.number,
              warehouseId: locked.warehouseId,
              status: StockIssueStatus.DRAFT,
            },
          }),
        );
        return this.loadDetailInTx(tx, company.companyId, issueId);
      });
      return this.toDetailView(updated);
    });
  }

  async scanApply(
    company: CompanyContext,
    issueId: string,
    dto: ScanApplyStockIssueDto,
  ): Promise<StockIssueScanApplyResultView> {
    const existing = await this.database.client.stockIssueScanRequest.findUnique({
      where: {
        companyId_stockIssueId_requestId: {
          companyId: company.companyId,
          stockIssueId: issueId,
          requestId: dto.requestId,
        },
      },
    });
    if (existing) {
      return existing.responseJson as unknown as StockIssueScanApplyResultView;
    }

    const issue = await this.requireDetail(company.companyId, issueId);
    if (issue.status !== StockIssueStatus.DRAFT) {
      throw new AppError({
        code: ERROR_CODES.STOCK_ISSUE_NOT_EDITABLE,
        message: STOCK_ISSUE_ERROR_MESSAGES.NOT_EDITABLE,
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
        code: ERROR_CODES.UNKNOWN_LOCATION_BARCODE,
        message: STOCK_ISSUE_ERROR_MESSAGES.UNKNOWN_LOCATION_BARCODE,
        statusCode: 404,
      });
    }
    if (location.warehouseId !== issue.warehouseId) {
      throw new AppError({
        code: ERROR_CODES.STOCK_ISSUE_LOCATION_WAREHOUSE_MISMATCH,
        message: STOCK_ISSUE_ERROR_MESSAGES.LOCATION_WAREHOUSE_MISMATCH,
        statusCode: 409,
      });
    }

    const resolved = await this.barcodesService.resolve(company, dto.productBarcode);
    if (!resolved.sku?.id) {
      throw new AppError({
        code: ERROR_CODES.BARCODE_NOT_FOUND,
        message: STOCK_ISSUE_ERROR_MESSAGES.UNKNOWN_PRODUCT_BARCODE,
        statusCode: 404,
      });
    }

    const classification = dto.classification ?? StockClassification.SELLABLE;
    let batchId = dto.batchId;
    if (!batchId) {
      const balances = await this.database.client.inventoryBalance.findMany({
        where: {
          companyId: company.companyId,
          warehouseId: issue.warehouseId,
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
    const beforeIds = new Set(issue.items.map((i) => i.id));
    const detail = await this.upsertItem(company, issueId, {
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
          i.skuId === resolved.sku.id &&
          i.batchId === batchId &&
          i.location.id === location.id &&
          i.classification === classification,
      ) ?? detail.items[detail.items.length - 1]!;
    const result: StockIssueScanApplyResultView = {
      issue: detail,
      item,
      incremented: beforeIds.has(item.id),
    };

    await this.database.client.stockIssueScanRequest.create({
      data: {
        companyId: company.companyId,
        stockIssueId: issueId,
        requestId: dto.requestId,
        responseJson: result as unknown as Prisma.InputJsonValue,
      },
    });
    return result;
  }

  async post(company: CompanyContext, issueId: string): Promise<StockIssueDetailView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const detail = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockIssue(tx, company.companyId, issueId);
        if (locked.status === StockIssueStatus.POSTED) {
          return this.loadDetailInTx(tx, company.companyId, issueId);
        }
        if (locked.status !== StockIssueStatus.DRAFT) {
          throw new AppError({
            code: ERROR_CODES.STOCK_ISSUE_NOT_POSTABLE,
            message: STOCK_ISSUE_ERROR_MESSAGES.NOT_POSTABLE,
            statusCode: 409,
          });
        }

        const items = await tx.stockIssueItem.findMany({
          where: { stockIssueId: issueId, companyId: company.companyId },
          orderBy: { id: 'asc' },
        });
        if (items.length === 0) {
          throw new AppError({
            code: ERROR_CODES.STOCK_ISSUE_EMPTY,
            message: STOCK_ISSUE_ERROR_MESSAGES.EMPTY,
            statusCode: 409,
          });
        }

        await this.assertOperationalWarehouse(tx, company.companyId, locked.warehouseId);
        const occurredAt = new Date();
        const posts: PostMovementInput[] = [];

        // WH-RES-012: unreserved SELLABLE outbound cannot steal reserved stock.
        const sellableReqs = items
          .filter((item) => item.classification === StockClassification.SELLABLE)
          .map((item) => ({ skuId: item.skuId, quantity: item.quantity }));
        if (sellableReqs.length > 0) {
          await this.reservations.assertUnreservedSellableOutboundInTx(
            tx,
            company.companyId,
            locked.warehouseId,
            sellableReqs,
          );
        }

        for (const item of items) {
          await this.validateItemDimensions(tx, company.companyId, locked, {
            skuId: item.skuId,
            batchId: item.batchId,
            locationId: item.locationId,
            classification: item.classification,
            quantity: item.quantity,
          });

          posts.push({
            warehouseId: locked.warehouseId,
            locationId: item.locationId,
            skuId: item.skuId,
            batchId: item.batchId,
            classification: item.classification,
            movementType: InventoryMovementType.ISSUE,
            quantityDelta: -item.quantity,
            sourceType: InventorySourceType.STOCK_ISSUE,
            sourceId: issueId,
            sourceLineId: item.id,
            occurredAt,
            actorUserId,
            reasonCode: locked.reason,
            notes: `ISS post ${locked.number}`,
          });
        }

        await this.inventoryLedger.postMovementsInTx(tx, company.companyId, posts, {
          recordAudit: true,
        });

        await tx.stockIssue.update({
          where: { id: issueId },
          data: {
            status: StockIssueStatus.POSTED,
            postedAt: occurredAt,
            postedById: actorUserId,
            version: { increment: 1 },
          },
        });

        const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.STOCK_ISSUE_POSTED,
          entityType: AUDIT_ENTITY_TYPES.STOCK_ISSUE,
          entityId: issueId,
          before: { status: StockIssueStatus.DRAFT },
          after: { status: StockIssueStatus.POSTED, itemCount: items.length, totalQuantity },
          metadata: {
            issueId,
            issueNumber: locked.number,
            warehouseId: locked.warehouseId,
            reason: locked.reason,
            itemCount: items.length,
            totalQuantity,
            status: StockIssueStatus.POSTED,
          },
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_STOCK_ISSUE_POSTED,
            payload: {
              companyId: company.companyId,
              issueId,
              issueNumber: locked.number,
              warehouseId: locked.warehouseId,
              reason: locked.reason,
              itemCount: items.length,
              totalQuantity,
              status: StockIssueStatus.POSTED,
            },
          }),
        );

        return this.loadDetailInTx(tx, company.companyId, issueId);
      });
      return this.toDetailView(detail);
    });
  }

  async cancel(company: CompanyContext, issueId: string): Promise<StockIssueDetailView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const detail = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockIssue(tx, company.companyId, issueId);
        if (locked.status === StockIssueStatus.CANCELLED) {
          return this.loadDetailInTx(tx, company.companyId, issueId);
        }
        if (locked.status === StockIssueStatus.POSTED) {
          throw new AppError({
            code: ERROR_CODES.STOCK_ISSUE_CANCEL_NOT_ALLOWED,
            message: STOCK_ISSUE_ERROR_MESSAGES.CANCEL_NOT_ALLOWED,
            statusCode: 409,
          });
        }
        if (locked.status !== StockIssueStatus.DRAFT) {
          throw new AppError({
            code: ERROR_CODES.STOCK_ISSUE_CANCEL_NOT_ALLOWED,
            message: STOCK_ISSUE_ERROR_MESSAGES.CANCEL_NOT_ALLOWED,
            statusCode: 409,
          });
        }

        const occurredAt = new Date();
        await tx.stockIssue.update({
          where: { id: issueId },
          data: {
            status: StockIssueStatus.CANCELLED,
            cancelledAt: occurredAt,
            cancelledById: actorUserId,
            version: { increment: 1 },
          },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.STOCK_ISSUE_CANCELLED,
          entityType: AUDIT_ENTITY_TYPES.STOCK_ISSUE,
          entityId: issueId,
          before: { status: StockIssueStatus.DRAFT },
          after: { status: StockIssueStatus.CANCELLED },
          metadata: {
            issueId,
            issueNumber: locked.number,
            warehouseId: locked.warehouseId,
            status: StockIssueStatus.CANCELLED,
          },
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_STOCK_ISSUE_CANCELLED,
            payload: {
              companyId: company.companyId,
              issueId,
              issueNumber: locked.number,
              warehouseId: locked.warehouseId,
              status: StockIssueStatus.CANCELLED,
            },
          }),
        );

        return this.loadDetailInTx(tx, company.companyId, issueId);
      });
      return this.toDetailView(detail);
    });
  }

  private async insertItem(
    tx: Tx,
    companyId: string,
    issue: { id: string; warehouseId: string },
    item: StockIssueItemInputDto,
  ): Promise<void> {
    const classification = item.classification ?? StockClassification.SELLABLE;
    await this.validateItemDimensions(tx, companyId, issue, { ...item, classification });
    await tx.stockIssueItem.create({
      data: {
        companyId,
        stockIssueId: issue.id,
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
    issue: { warehouseId: string },
    item: StockIssueItemInputDto & { classification: StockClassification },
  ): Promise<void> {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new AppError({
        code: ERROR_CODES.STOCK_ISSUE_INVALID_QUANTITY,
        message: STOCK_ISSUE_ERROR_MESSAGES.INVALID_QUANTITY,
        statusCode: 400,
      });
    }

    const [sku, batch, location] = await Promise.all([
      tx.sku.findFirst({ where: { id: item.skuId, companyId } }),
      tx.batch.findFirst({ where: { id: item.batchId, companyId } }),
      tx.warehouseLocation.findFirst({
        where: { id: item.locationId, companyId },
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
        code: ERROR_CODES.STOCK_ISSUE_BATCH_SKU_MISMATCH,
        message: STOCK_ISSUE_ERROR_MESSAGES.BATCH_SKU_MISMATCH,
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
    if (location.warehouseId !== issue.warehouseId) {
      throw new AppError({
        code: ERROR_CODES.STOCK_ISSUE_LOCATION_WAREHOUSE_MISMATCH,
        message: STOCK_ISSUE_ERROR_MESSAGES.LOCATION_WAREHOUSE_MISMATCH,
        statusCode: 409,
      });
    }
    if (location.type === WarehouseLocationType.TRANSIT) {
      throw new AppError({
        code: ERROR_CODES.STOCK_ISSUE_SYSTEM_WAREHOUSE,
        message: STOCK_ISSUE_ERROR_MESSAGES.SYSTEM_WAREHOUSE,
        statusCode: 409,
      });
    }
    if (location.status !== WarehouseStatus.ACTIVE) {
      throw new AppError({
        code: ERROR_CODES.STOCK_ISSUE_LOCATION_INACTIVE,
        message: STOCK_ISSUE_ERROR_MESSAGES.LOCATION_INACTIVE,
        statusCode: 409,
      });
    }
  }

  private assertReasonText(reason: StockIssueReason, reasonText?: string | null): void {
    if (
      (reason === StockIssueReason.MANUAL || reason === StockIssueReason.OTHER) &&
      !reasonText?.trim()
    ) {
      throw new AppError({
        code: ERROR_CODES.STOCK_ISSUE_REASON_TEXT_REQUIRED,
        message: STOCK_ISSUE_ERROR_MESSAGES.REASON_TEXT_REQUIRED,
        statusCode: 400,
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
        code: ERROR_CODES.STOCK_ISSUE_SYSTEM_WAREHOUSE,
        message: STOCK_ISSUE_ERROR_MESSAGES.SYSTEM_WAREHOUSE,
        statusCode: 409,
      });
    }
    if (warehouse.status !== WarehouseStatus.ACTIVE) {
      throw new AppError({
        code: ERROR_CODES.STOCK_ISSUE_WAREHOUSE_INACTIVE,
        message: STOCK_ISSUE_ERROR_MESSAGES.WAREHOUSE_INACTIVE,
        statusCode: 409,
      });
    }
  }

  private assertDraft(status: StockIssueStatus): void {
    if (status !== StockIssueStatus.DRAFT) {
      throw new AppError({
        code: ERROR_CODES.STOCK_ISSUE_NOT_EDITABLE,
        message: STOCK_ISSUE_ERROR_MESSAGES.NOT_EDITABLE,
        statusCode: 409,
      });
    }
  }

  private async lockIssue(
    tx: Tx,
    companyId: string,
    issueId: string,
  ): Promise<{
    id: string;
    number: string;
    status: StockIssueStatus;
    warehouseId: string;
    reason: StockIssueReason;
    reasonText: string | null;
    version: number;
  }> {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        number: string;
        status: StockIssueStatus;
        warehouse_id: string;
        reason: StockIssueReason;
        reason_text: string | null;
        version: number;
      }>
    >(Prisma.sql`
      SELECT id, number, status, warehouse_id, reason, reason_text, version
      FROM stock_issues
      WHERE id = ${issueId}::uuid
        AND company_id = ${companyId}::uuid
      FOR UPDATE
    `);
    const row = rows[0];
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.STOCK_ISSUE_NOT_FOUND,
        message: STOCK_ISSUE_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return {
      id: row.id,
      number: row.number,
      status: row.status,
      warehouseId: row.warehouse_id,
      reason: row.reason,
      reasonText: row.reason_text,
      version: row.version,
    };
  }

  private async requireDetail(companyId: string, issueId: string): Promise<DetailRow> {
    const row = await this.database.client.stockIssue.findFirst({
      where: { id: issueId, companyId },
      include: detailInclude,
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.STOCK_ISSUE_NOT_FOUND,
        message: STOCK_ISSUE_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return row;
  }

  private async loadDetailInTx(
    tx: Tx,
    companyId: string,
    issueId: string,
  ): Promise<DetailRow> {
    return tx.stockIssue.findFirstOrThrow({
      where: { id: issueId, companyId },
      include: detailInclude,
    });
  }

  private async toDetailView(row: DetailRow): Promise<StockIssueDetailView> {
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
      reason: row.reason,
      reasonText: row.reasonText,
      warehouse: row.warehouse,
      notes: row.notes,
      version: row.version,
      items: row.items.map((item) => this.toItemView(item, row.warehouseId, balanceMap)),
      createdBy: row.createdBy,
      postedBy: row.postedBy,
      cancelledBy: row.cancelledBy,
      postedAt: row.postedAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toItemView(
    item: DetailRow['items'][number],
    warehouseId: string,
    balanceMap: Map<string, number>,
  ): StockIssueItemView {
    const key = `${warehouseId}:${item.locationId}:${item.skuId}:${item.batchId}:${item.classification}`;
    return {
      id: item.id,
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
  return trimmed.slice(0, STOCK_ISSUE_SEARCH_MAX_LENGTH);
}
