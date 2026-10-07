import { Injectable } from '@nestjs/common';
import {
  InventoryMovementType,
  InventorySourceType,
  Prisma,
  SalesOrderStatus,
  SalesReturnCondition,
  SalesReturnReason,
  SalesReturnStatus,
  StockClassification,
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
import type { AuditSnapshot } from '../audit/types/audit.types';
import type { CompanyContext } from '../companies/types/company.types';
import { CustomerReceivablesService } from '../finance/customer-receivables.service';
import { InventoryLedgerService } from '../warehouse/inventory-ledger.service';
import type { PostMovementInput } from '../warehouse/inventory-ledger.service';
import type {
  CancelSalesReturnDto,
  CreateSalesReturnDto,
} from './dto/create-sales-return.dto';
import type { ListSalesReturnsQueryDto } from './dto/list-sales-returns.query.dto';
import type { ReceiveSalesReturnDto } from './dto/receive-sales-return.dto';
import { fulfilledReturnableQuantity } from './sales-order-quantities';
import { SALES_ORDER_RETURNABLE_STATUSES } from './sales-order-status';
import {
  allocateSalesReturnSequence,
  formatSalesReturnNumber,
} from './sales-return-numbering';
import {
  SALES_ERROR_MESSAGES,
  SALES_RETURN_NOTES_MAX_LENGTH,
} from './sales.constants';
import { normalizeSearchQuery } from './sales.normalization';

const TX_OPTIONS = { maxWait: 5_000, timeout: 45_000 } as const;

/**
 * Phase 5.3 returnable:
 *   fulfilledQuantity − returnedQuantity
 */

const detailInclude = {
  salesOrder: {
    select: { id: true, orderNumber: true, status: true, customerId: true },
  },
  customer: { select: { id: true, code: true, displayName: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
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
      salesOrderItem: {
        select: {
          id: true,
          skuId: true,
          quantity: true,
          cancelledQuantity: true,
          fulfilledQuantity: true,
          returnedQuantity: true,
        },
      },
    },
  },
  warehouse: { select: { id: true, code: true, name: true } },
  receivedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.SalesReturnInclude;

type DetailRow = Prisma.SalesReturnGetPayload<{ include: typeof detailInclude }>;

export type SalesReturnItemView = {
  id: string;
  salesReturnId: string;
  salesOrderItemId: string;
  skuId: string;
  quantity: number;
  reason: SalesReturnReason | null;
  condition: SalesReturnCondition | null;
  sku: {
    id: string;
    code: string;
    name: string | null;
    product: { id: string; name: string; code: string | null };
  };
};

export type SalesReturnView = {
  id: string;
  companyId: string;
  returnNumber: string;
  salesOrderId: string;
  customerId: string | null;
  status: SalesReturnStatus;
  reason: SalesReturnReason | null;
  condition: SalesReturnCondition | null;
  notes: string | null;
  requestId: string | null;
  approvedAt: Date | null;
  cancelledAt: Date | null;
  receivedAt: Date | null;
  warehouseId: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdById: string;
  salesOrder: { id: string; orderNumber: string; status: SalesOrderStatus };
  customer: { id: string; code: string | null; displayName: string } | null;
  createdBy: { id: string; displayName: string };
  items: SalesReturnItemView[];
  physicalExecution: 'DEFERRED_TO_WAREHOUSE' | 'RETURN_IN_POSTED';
  financialResolution: 'DEFERRED_TO_FINANCE' | 'AR_CREDITED';
  returnablePolicy: 'FULFILLED_MINUS_RETURNED';
};

@Injectable()
export class SalesReturnsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventBus: DomainEventBus,
    private readonly eventFactory: DomainEventFactory,
    private readonly inventoryLedger: InventoryLedgerService,
    private readonly customerReceivables: CustomerReceivablesService,
  ) {}

  async list(
    company: CompanyContext,
    query: ListSalesReturnsQueryDto,
  ): Promise<{ data: SalesReturnView[]; meta: PaginationMeta }> {
    const where: Prisma.SalesReturnWhereInput = {
      companyId: company.companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.salesOrderId ? { salesOrderId: query.salesOrderId } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
    };
    const search = normalizeSearchQuery(query.search);
    if (search) {
      where.OR = [
        { returnNumber: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
        { salesOrder: { orderNumber: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [total, rows] = await this.database.client.$transaction([
      this.database.client.salesReturn.count({ where }),
      this.database.client.salesReturn.findMany({
        where,
        include: detailInclude,
        orderBy: [{ [query.sortBy]: query.sortOrder }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      data: rows.map((row) => this.toView(row)),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async get(company: CompanyContext, returnId: string): Promise<SalesReturnView> {
    return this.toView(await this.requireReturn(company.companyId, returnId));
  }

  async create(company: CompanyContext, dto: CreateSalesReturnDto): Promise<SalesReturnView> {
    const actorUserId = this.requireActorUserId();

    if (dto.requestId) {
      const existing = await this.database.client.salesReturn.findFirst({
        where: { companyId: company.companyId, requestId: dto.requestId },
        include: detailInclude,
      });
      if (existing) return this.toView(existing);
    }

    if (!dto.items?.length) {
      throw new AppError({
        code: ERROR_CODES.SALES_RETURN_EMPTY,
        message: SALES_ERROR_MESSAGES.SALES_RETURN_EMPTY,
        statusCode: 400,
      });
    }

    return commitThenPublish(this.eventBus, async (events) => {
      const created = await this.database.client.$transaction(async (tx) => {
        if (dto.requestId) {
          const raced = await tx.salesReturn.findFirst({
            where: { companyId: company.companyId, requestId: dto.requestId },
            include: detailInclude,
          });
          if (raced) return raced;
        }

        const order = await tx.salesOrder.findFirst({
          where: { id: dto.salesOrderId, companyId: company.companyId },
          include: { items: true },
        });
        if (!order) {
          throw new AppError({
            code: ERROR_CODES.SALES_ORDER_NOT_FOUND,
            message: SALES_ERROR_MESSAGES.SALES_ORDER_NOT_FOUND,
            statusCode: 404,
          });
        }
        if (!SALES_ORDER_RETURNABLE_STATUSES.has(order.status)) {
          throw new AppError({
            code: ERROR_CODES.SALES_RETURN_INVALID_ORDER_STATUS,
            message: SALES_ERROR_MESSAGES.SALES_RETURN_INVALID_ORDER_STATUS,
            statusCode: 409,
          });
        }

        // Aggregate pending DRAFT return qty per order item (not yet on returnedQuantity).
        const draftReturns = await tx.salesReturn.findMany({
          where: {
            companyId: company.companyId,
            salesOrderId: order.id,
            status: SalesReturnStatus.DRAFT,
          },
          include: { items: true },
        });
        const pendingByOrderItem = new Map<string, number>();
        for (const draft of draftReturns) {
          for (const line of draft.items) {
            pendingByOrderItem.set(
              line.salesOrderItemId,
              (pendingByOrderItem.get(line.salesOrderItemId) ?? 0) + line.quantity,
            );
          }
        }

        const resolvedItems = dto.items.map((line) => {
          const orderItem = order.items.find((i) => i.id === line.salesOrderItemId);
          if (!orderItem) {
            throw new AppError({
              code: ERROR_CODES.SALES_RETURN_ITEM_INVALID,
              message: SALES_ERROR_MESSAGES.SALES_RETURN_ITEM_INVALID,
              statusCode: 400,
            });
          }
          if (line.skuId !== orderItem.skuId) {
            throw new AppError({
              code: ERROR_CODES.SALES_RETURN_SKU_MISMATCH,
              message: SALES_ERROR_MESSAGES.SALES_RETURN_SKU_MISMATCH,
              statusCode: 400,
            });
          }
          const returnable = fulfilledReturnableQuantity({
            fulfilledQuantity: orderItem.fulfilledQuantity,
            returnedQuantity: orderItem.returnedQuantity,
          });
          const pending = pendingByOrderItem.get(orderItem.id) ?? 0;
          if (line.quantity > returnable - pending) {
            throw new AppError({
              code: ERROR_CODES.SALES_RETURN_QUANTITY_EXCEEDS_RETURNABLE,
              message: SALES_ERROR_MESSAGES.SALES_RETURN_QUANTITY_EXCEEDS_RETURNABLE,
              statusCode: 400,
            });
          }
          pendingByOrderItem.set(orderItem.id, pending + line.quantity);
          return line;
        });

        const sequence = await allocateSalesReturnSequence(tx, company.companyId);
        const returnNumber = formatSalesReturnNumber(sequence);

        const createdReturn = await tx.salesReturn.create({
          data: {
            companyId: company.companyId,
            returnNumber,
            salesOrderId: order.id,
            customerId: order.customerId,
            status: SalesReturnStatus.DRAFT,
            reason: dto.reason ?? null,
            condition: dto.condition ?? null,
            notes: this.normalizeNotes(dto.notes),
            requestId: dto.requestId ?? null,
            createdById: actorUserId,
          },
          select: { id: true },
        });

        const linesBase = Date.now();
        await tx.salesReturnItem.createMany({
          data: resolvedItems.map((line, index) => ({
            createdAt: new Date(linesBase + index),
            companyId: company.companyId,
            salesReturnId: createdReturn.id,
            salesOrderItemId: line.salesOrderItemId,
            skuId: line.skuId,
            quantity: line.quantity,
            reason: line.reason ?? dto.reason ?? null,
            condition: line.condition ?? dto.condition ?? null,
          })),
        });

        const row = await this.requireReturn(company.companyId, createdReturn.id, tx);
        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.SALES_RETURN_CREATED,
          entityType: AUDIT_ENTITY_TYPES.SALES_RETURN,
          entityId: row.id,
          before: null,
          after: this.snapshot(row),
        });
        return row;
      }, TX_OPTIONS);

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.SALES_RETURN_CREATED,
          payload: {
            companyId: company.companyId,
            salesReturnId: created.id,
            returnNumber: created.returnNumber,
            salesOrderId: created.salesOrderId,
            status: created.status,
          },
        }),
      );
      return this.toView(created);
    });
  }

  async approve(company: CompanyContext, returnId: string): Promise<SalesReturnView> {
    return commitThenPublish(this.eventBus, async (events) => {
      const approved = await this.database.client.$transaction(async (tx) => {
        const current = await this.requireReturn(company.companyId, returnId, tx);
        if (current.status !== SalesReturnStatus.DRAFT) {
          throw new AppError({
            code: ERROR_CODES.SALES_RETURN_INVALID_STATUS,
            message: SALES_ERROR_MESSAGES.SALES_RETURN_INVALID_STATUS,
            statusCode: 409,
          });
        }

        // Re-validate commercial returnable against current order item trackers.
        for (const line of current.items) {
          const orderItem = await tx.salesOrderItem.findFirst({
            where: { id: line.salesOrderItemId, companyId: company.companyId },
          });
          if (!orderItem || orderItem.skuId !== line.skuId) {
            throw new AppError({
              code: ERROR_CODES.SALES_RETURN_ITEM_INVALID,
              message: SALES_ERROR_MESSAGES.SALES_RETURN_ITEM_INVALID,
              statusCode: 400,
            });
          }
          const returnable = fulfilledReturnableQuantity({
            fulfilledQuantity: orderItem.fulfilledQuantity,
            returnedQuantity: orderItem.returnedQuantity,
          });
          if (line.quantity > returnable) {
            throw new AppError({
              code: ERROR_CODES.SALES_RETURN_QUANTITY_EXCEEDS_RETURNABLE,
              message: SALES_ERROR_MESSAGES.SALES_RETURN_QUANTITY_EXCEEDS_RETURNABLE,
              statusCode: 400,
            });
          }
          await tx.salesOrderItem.update({
            where: { id: orderItem.id },
            data: { returnedQuantity: orderItem.returnedQuantity + line.quantity },
          });
        }

        await tx.salesReturn.update({
          where: { id: current.id },
          data: {
            status: SalesReturnStatus.APPROVED,
            approvedAt: new Date(),
          },
        });

        const row = await this.requireReturn(company.companyId, current.id, tx);
        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.SALES_RETURN_APPROVED,
          entityType: AUDIT_ENTITY_TYPES.SALES_RETURN,
          entityId: row.id,
          before: this.snapshot(current),
          after: this.snapshot(row),
        });
        return row;
      }, TX_OPTIONS);

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.SALES_RETURN_APPROVED,
          payload: {
            companyId: company.companyId,
            salesReturnId: approved.id,
            returnNumber: approved.returnNumber,
            salesOrderId: approved.salesOrderId,
            status: approved.status,
          },
        }),
      );
      return this.toView(approved);
    });
  }

  /**
   * Physical receive: APPROVED → RECEIVED.
   * Posts Warehouse RETURN_IN + Finance AR credit in the same TX.
   */
  async receivePhysical(
    company: CompanyContext,
    returnId: string,
    dto: ReceiveSalesReturnDto,
  ): Promise<SalesReturnView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const received = await this.database.client.$transaction(async (tx) => {
        const current = await this.requireReturn(company.companyId, returnId, tx);
        if (current.status === SalesReturnStatus.RECEIVED) {
          return current;
        }
        if (current.status !== SalesReturnStatus.APPROVED) {
          throw new AppError({
            code: ERROR_CODES.SALES_RETURN_INVALID_STATUS,
            message: SALES_ERROR_MESSAGES.SALES_RETURN_INVALID_STATUS,
            statusCode: 409,
          });
        }

        const warehouse = await tx.warehouse.findFirst({
          where: { id: dto.warehouseId, companyId: company.companyId },
        });
        if (!warehouse || warehouse.status !== WarehouseStatus.ACTIVE || warehouse.isSystem) {
          throw new AppError({
            code: ERROR_CODES.SALES_RETURN_RECEIVE_INVALID,
            message: SALES_ERROR_MESSAGES.SALES_RETURN_RECEIVE_INVALID,
            statusCode: 409,
          });
        }

        const occurredAt = new Date();
        const posts: PostMovementInput[] = [];

        for (const line of dto.items) {
          const returnItem = current.items.find((i) => i.id === line.salesReturnItemId);
          if (!returnItem) {
            throw new AppError({
              code: ERROR_CODES.SALES_RETURN_ITEM_INVALID,
              message: SALES_ERROR_MESSAGES.SALES_RETURN_ITEM_INVALID,
              statusCode: 400,
            });
          }
          const location = await tx.warehouseLocation.findFirst({
            where: { id: line.locationId, companyId: company.companyId },
          });
          if (!location || location.warehouseId !== dto.warehouseId) {
            throw new AppError({
              code: ERROR_CODES.SALES_RETURN_RECEIVE_INVALID,
              message: 'Receive location must belong to the receive warehouse.',
              statusCode: 400,
            });
          }
          const batch = await tx.batch.findFirst({
            where: { id: line.batchId, companyId: company.companyId },
          });
          if (!batch || batch.skuId !== returnItem.skuId) {
            throw new AppError({
              code: ERROR_CODES.SALES_RETURN_RECEIVE_INVALID,
              message: 'Receive batch must match the return item SKU.',
              statusCode: 400,
            });
          }
          const classification =
            line.classification ??
            this.classificationFromCondition(returnItem.condition ?? current.condition);

          await tx.salesReturnItem.update({
            where: { id: returnItem.id },
            data: {
              locationId: line.locationId,
              batchId: line.batchId,
              classification,
            },
          });

          posts.push({
            warehouseId: dto.warehouseId,
            locationId: line.locationId,
            skuId: returnItem.skuId,
            batchId: line.batchId,
            classification,
            movementType: InventoryMovementType.RETURN_IN,
            quantityDelta: returnItem.quantity,
            sourceType: InventorySourceType.CUSTOMER_RETURN,
            sourceId: current.id,
            sourceLineId: returnItem.id,
            occurredAt,
            actorUserId,
            notes: `SR receive ${current.returnNumber}`,
          });
        }

        // Ensure every return item was included.
        if (dto.items.length !== current.items.length) {
          throw new AppError({
            code: ERROR_CODES.SALES_RETURN_RECEIVE_INVALID,
            message: 'All sales return items must be included in physical receive.',
            statusCode: 400,
          });
        }

        await this.inventoryLedger.postMovementsInTx(tx, company.companyId, posts, {
          recordAudit: true,
        });

        await tx.salesReturn.update({
          where: { id: current.id },
          data: {
            status: SalesReturnStatus.RECEIVED,
            receivedAt: occurredAt,
            warehouseId: dto.warehouseId,
            receivedById: actorUserId,
            ...(dto.notes !== undefined
              ? { notes: this.normalizeNotes(dto.notes) ?? current.notes }
              : {}),
          },
        });

        await this.customerReceivables.creditFromReturnInTx(
          tx,
          {
            companyId: company.companyId,
            actorUserId,
            salesReturnId: current.id,
            requestId: dto.requestId ?? null,
          },
          events,
        );

        const row = await this.requireReturn(company.companyId, current.id, tx);
        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.SALES_RETURN_RECEIVED,
          entityType: AUDIT_ENTITY_TYPES.SALES_RETURN,
          entityId: row.id,
          before: this.snapshot(current),
          after: this.snapshot(row),
        });
        return row;
      }, TX_OPTIONS);

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.SALES_RETURN_RECEIVED,
          payload: {
            companyId: company.companyId,
            salesReturnId: received.id,
            returnNumber: received.returnNumber,
            salesOrderId: received.salesOrderId,
            status: received.status,
            warehouseId: received.warehouseId,
          },
        }),
      );
      return this.toView(received);
    });
  }

  async cancel(
    company: CompanyContext,
    returnId: string,
    dto: CancelSalesReturnDto,
  ): Promise<SalesReturnView> {
    return commitThenPublish(this.eventBus, async (events) => {
      const cancelled = await this.database.client.$transaction(async (tx) => {
        const current = await this.requireReturn(company.companyId, returnId, tx);
        if (
          current.status !== SalesReturnStatus.DRAFT &&
          current.status !== SalesReturnStatus.APPROVED
        ) {
          throw new AppError({
            code: ERROR_CODES.SALES_RETURN_INVALID_STATUS,
            message: SALES_ERROR_MESSAGES.SALES_RETURN_INVALID_STATUS,
            statusCode: 409,
          });
        }

        if (current.status === SalesReturnStatus.APPROVED) {
          for (const line of current.items) {
            const orderItem = await tx.salesOrderItem.findFirst({
              where: { id: line.salesOrderItemId, companyId: company.companyId },
            });
            if (!orderItem) continue;
            const next = Math.max(0, orderItem.returnedQuantity - line.quantity);
            await tx.salesOrderItem.update({
              where: { id: orderItem.id },
              data: { returnedQuantity: next },
            });
          }
        }

        await tx.salesReturn.update({
          where: { id: current.id },
          data: {
            status: SalesReturnStatus.CANCELLED,
            cancelledAt: new Date(),
            ...(dto.notes !== undefined
              ? { notes: this.normalizeNotes(dto.notes) ?? current.notes }
              : {}),
          },
        });

        const row = await this.requireReturn(company.companyId, current.id, tx);
        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.SALES_RETURN_CANCELLED,
          entityType: AUDIT_ENTITY_TYPES.SALES_RETURN,
          entityId: row.id,
          before: this.snapshot(current),
          after: this.snapshot(row),
        });
        return row;
      }, TX_OPTIONS);

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.SALES_RETURN_CANCELLED,
          payload: {
            companyId: company.companyId,
            salesReturnId: cancelled.id,
            returnNumber: cancelled.returnNumber,
            salesOrderId: cancelled.salesOrderId,
            status: cancelled.status,
          },
        }),
      );
      return this.toView(cancelled);
    });
  }

  private async requireReturn(
    companyId: string,
    returnId: string,
    client: Prisma.TransactionClient | DatabaseService['client'] = this.database.client,
  ): Promise<DetailRow> {
    const row = await client.salesReturn.findFirst({
      where: { id: returnId, companyId },
      include: detailInclude,
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.SALES_RETURN_NOT_FOUND,
        message: SALES_ERROR_MESSAGES.SALES_RETURN_NOT_FOUND,
        statusCode: 404,
      });
    }
    return row;
  }

  private classificationFromCondition(
    condition: SalesReturnCondition | null,
  ): StockClassification {
    switch (condition) {
      case SalesReturnCondition.DAMAGED:
        return StockClassification.DAMAGED;
      case SalesReturnCondition.QUARANTINE:
        return StockClassification.QUARANTINE;
      case SalesReturnCondition.SELLABLE:
        return StockClassification.SELLABLE;
      case SalesReturnCondition.UNKNOWN:
      default:
        return StockClassification.QUARANTINE;
    }
  }

  private toView(row: DetailRow): SalesReturnView {
    const received = row.status === SalesReturnStatus.RECEIVED;
    return {
      id: row.id,
      companyId: row.companyId,
      returnNumber: row.returnNumber,
      salesOrderId: row.salesOrderId,
      customerId: row.customerId,
      status: row.status,
      reason: row.reason,
      condition: row.condition,
      notes: row.notes,
      requestId: row.requestId,
      approvedAt: row.approvedAt,
      cancelledAt: row.cancelledAt,
      receivedAt: row.receivedAt,
      warehouseId: row.warehouseId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      createdById: row.createdById,
      salesOrder: row.salesOrder,
      customer: row.customer,
      createdBy: {
        id: row.createdBy.id,
        displayName: `${row.createdBy.firstName} ${row.createdBy.lastName}`.trim(),
      },
      items: row.items.map((item) => ({
        id: item.id,
        salesReturnId: item.salesReturnId,
        salesOrderItemId: item.salesOrderItemId,
        skuId: item.skuId,
        quantity: item.quantity,
        reason: item.reason,
        condition: item.condition,
        sku: item.sku,
      })),
      physicalExecution: received ? 'RETURN_IN_POSTED' : 'DEFERRED_TO_WAREHOUSE',
      financialResolution: received ? 'AR_CREDITED' : 'DEFERRED_TO_FINANCE',
      returnablePolicy: 'FULFILLED_MINUS_RETURNED',
    };
  }

  private snapshot(row: DetailRow): AuditSnapshot {
    return {
      id: row.id,
      returnNumber: row.returnNumber,
      status: row.status,
      salesOrderId: row.salesOrderId,
      itemCount: row.items.length,
      items: row.items.map((item) => ({
        id: item.id,
        salesOrderItemId: item.salesOrderItemId,
        skuId: item.skuId,
        quantity: item.quantity,
      })),
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

  private normalizeNotes(value: string | null | undefined): string | null {
    if (value === undefined || value === null) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed.slice(0, SALES_RETURN_NOTES_MAX_LENGTH);
  }
}
