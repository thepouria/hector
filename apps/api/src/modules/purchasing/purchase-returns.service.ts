import { Injectable } from '@nestjs/common';
import {
  Prisma,
  PurchaseOrderStatus,
  PurchaseReturnReason,
  PurchaseReturnResolution,
  PurchaseReturnStatus,
  SupplierReturnExecutionStatus,
} from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
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
import type {
  CancelPurchaseReturnDto,
  CreatePurchaseReturnDto,
  UpdatePurchaseReturnDto,
} from './dto/create-purchase-return.dto';
import type { ListPurchaseReturnsQueryDto } from './dto/list-purchase-returns.query.dto';
import {
  allocatePurchaseReturnSequence,
  formatPurchaseReturnNumber,
} from './purchase-return-numbering';
import {
  PURCHASE_ORDER_ERROR_MESSAGES,
  PURCHASE_RETURN_ERROR_MESSAGES,
} from './purchasing.constants';
import { normalizeSearchQuery } from './purchasing.normalization';
import { SuppliersService } from './suppliers.service';
import {
  buildProgressView,
  toExecutionSummary,
} from '../warehouse/supplier-return-execution.progress';
import type { SupplierReturnExecutionProgressView } from '../warehouse/types/supplier-return-execution.types';

const TX_OPTIONS = { maxWait: 5_000, timeout: 20_000 } as const;

const itemInclude = {
  sku: {
    select: {
      id: true,
      code: true,
      name: true,
      product: { select: { id: true, name: true, code: true } },
    },
  },
} satisfies Prisma.PurchaseReturnItemInclude;

const detailInclude = {
  supplier: { select: { id: true, name: true, code: true, status: true } },
  purchaseOrder: { select: { id: true, number: true, status: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  approvedBy: { select: { id: true, firstName: true, lastName: true } },
  cancelledBy: { select: { id: true, firstName: true, lastName: true } },
  items: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: itemInclude },
} satisfies Prisma.PurchaseReturnInclude;

type DetailRow = Prisma.PurchaseReturnGetPayload<{ include: typeof detailInclude }>;

export type PurchaseReturnItemView = {
  id: string;
  purchaseReturnId: string;
  purchaseOrderItemId: string | null;
  skuId: string;
  quantity: number;
  reason: PurchaseReturnReason | null;
  notes: string | null;
  sku: {
    id: string;
    code: string;
    name: string | null;
    product: { id: string; name: string; code: string | null };
  };
};

export type PurchaseReturnView = {
  id: string;
  companyId: string;
  number: string;
  supplierId: string;
  purchaseOrderId: string | null;
  status: PurchaseReturnStatus;
  reason: PurchaseReturnReason;
  expectedResolution: PurchaseReturnResolution;
  notes: string | null;
  cancellationReason: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  approvedAt: Date | null;
  cancelledAt: Date | null;
  supplier: { id: string; name: string; code: string | null; status: string };
  purchaseOrder: { id: string; number: string; status: PurchaseOrderStatus } | null;
  createdBy: { id: string; displayName: string };
  approvedBy: { id: string; displayName: string } | null;
  cancelledBy: { id: string; displayName: string } | null;
  items: PurchaseReturnItemView[];
  /**
   * Phase 2.11: APPROVED means commercial intent only.
   * Physical warehouse return / Finance refund are future phases.
   */
  physicalExecution: 'DEFERRED_TO_WAREHOUSE';
  financialResolution: 'DEFERRED_TO_FINANCE';
  warehouseExecution?: WarehouseExecutionProjection;
};

export type WarehouseExecutionSummary = {
  id: string;
  number: string;
  status: SupplierReturnExecutionStatus;
  warehouseId: string;
  warehouseCode: string;
  itemCount: number;
  totalQuantity: number;
  dispatchedAt: string | null;
  createdAt: string;
};

export type WarehouseExecutionProjection = SupplierReturnExecutionProgressView & {
  executions: WarehouseExecutionSummary[];
};

@Injectable()
export class PurchaseReturnsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventBus: DomainEventBus,
    private readonly eventFactory: DomainEventFactory,
    private readonly suppliersService: SuppliersService,
  ) {}

  async list(
    company: CompanyContext,
    query: ListPurchaseReturnsQueryDto,
  ): Promise<{ data: PurchaseReturnView[]; meta: PaginationMeta }> {
    const where: Prisma.PurchaseReturnWhereInput = {
      companyId: company.companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.purchaseOrderId ? { purchaseOrderId: query.purchaseOrderId } : {}),
    };
    const search = normalizeSearchQuery(query.search);
    if (search) {
      where.OR = [
        { number: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
        { supplier: { name: { contains: search, mode: 'insensitive' } } },
        { purchaseOrder: { number: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const orderBy: Prisma.PurchaseReturnOrderByWithRelationInput[] = [
      { [query.sortBy]: query.sortOrder },
      { createdAt: 'desc' },
      { id: 'desc' },
    ];
    const [total, rows] = await this.database.client.$transaction([
      this.database.client.purchaseReturn.count({ where }),
      this.database.client.purchaseReturn.findMany({
        where,
        include: detailInclude,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const warehouseByReturnId = await this.loadWarehouseExecutionProjections(
      company.companyId,
      rows.map((r) => r.id),
      rows.map((r) => ({ id: r.id, approvedQuantity: r.items.reduce((s, i) => s + i.quantity, 0) })),
    );

    return {
      data: rows.map((row) =>
        this.toView(row, warehouseByReturnId.get(row.id)),
      ),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async getById(company: CompanyContext, id: string): Promise<PurchaseReturnView> {
    const row = await this.database.client.purchaseReturn.findFirst({
      where: { id, companyId: company.companyId },
      include: detailInclude,
    });
    if (!row) this.notFound();
    const warehouseMap = await this.loadWarehouseExecutionProjections(company.companyId, [id], [
      { id, approvedQuantity: row.items.reduce((s, i) => s + i.quantity, 0) },
    ]);
    return this.toView(row, warehouseMap.get(id));
  }

  async create(company: CompanyContext, dto: CreatePurchaseReturnDto): Promise<PurchaseReturnView> {
    const actorUserId = this.suppliersService.requireActorUserId();

    return commitThenPublish(this.eventBus, async (events) => {
      const created = await this.database.client.$transaction(async (tx) => {
        const po = await tx.purchaseOrder.findFirst({
          where: { id: dto.purchaseOrderId, companyId: company.companyId },
          include: { items: true },
        });
        if (!po) {
          throw new AppError({
            code: ERROR_CODES.PURCHASE_ORDER_NOT_FOUND,
            message: PURCHASE_ORDER_ERROR_MESSAGES.NOT_FOUND,
            statusCode: 404,
          });
        }
        if (po.status === PurchaseOrderStatus.CANCELLED || po.status === PurchaseOrderStatus.DRAFT) {
          throw new AppError({
            code: ERROR_CODES.PURCHASE_RETURN_INVALID_STATUS,
            message: `Purchase returns cannot be created against ${po.status} purchase orders.`,
            statusCode: 409,
          });
        }

        const resolvedItems = dto.items.map((line) => {
          if (line.purchaseOrderItemId) {
            const poItem = po.items.find((i) => i.id === line.purchaseOrderItemId);
            if (!poItem) {
              throw new AppError({
                code: ERROR_CODES.PURCHASE_RETURN_ITEM_INVALID,
                message: PURCHASE_RETURN_ERROR_MESSAGES.ITEM_INVALID,
                statusCode: 400,
              });
            }
            if (line.skuId && line.skuId !== poItem.skuId) {
              throw new AppError({
                code: ERROR_CODES.PURCHASE_RETURN_SKU_MISMATCH,
                message: PURCHASE_RETURN_ERROR_MESSAGES.SKU_MISMATCH,
                statusCode: 400,
              });
            }
            return {
              purchaseOrderItemId: poItem.id,
              skuId: poItem.skuId,
              quantity: line.quantity,
              reason: line.reason ?? null,
              notes: line.notes?.trim() || null,
            };
          }
          if (!line.skuId) {
            throw new AppError({
              code: ERROR_CODES.PURCHASE_RETURN_ITEM_INVALID,
              message: 'Each return item requires purchaseOrderItemId or skuId.',
              statusCode: 400,
            });
          }
          const poItem = po.items.find((i) => i.skuId === line.skuId);
          if (!poItem) {
            throw new AppError({
              code: ERROR_CODES.PURCHASE_RETURN_ITEM_INVALID,
              message: PURCHASE_RETURN_ERROR_MESSAGES.ITEM_INVALID,
              statusCode: 400,
            });
          }
          return {
            purchaseOrderItemId: poItem.id,
            skuId: poItem.skuId,
            quantity: line.quantity,
            reason: line.reason ?? null,
            notes: line.notes?.trim() || null,
          };
        });

        const seq = await allocatePurchaseReturnSequence(tx, company.companyId);
        const number = formatPurchaseReturnNumber(new Date(), seq);

        const createdReturn = await tx.purchaseReturn.create({
          data: {
            companyId: company.companyId,
            number,
            supplierId: po.supplierId,
            purchaseOrderId: po.id,
            status: PurchaseReturnStatus.DRAFT,
            reason: dto.reason,
            expectedResolution: dto.expectedResolution ?? PurchaseReturnResolution.UNKNOWN,
            notes: dto.notes?.trim() || null,
            createdById: actorUserId,
          },
        });

        await tx.purchaseReturnItem.createMany({
          data: resolvedItems.map((item) => ({
            companyId: company.companyId,
            purchaseReturnId: createdReturn.id,
            purchaseOrderItemId: item.purchaseOrderItemId,
            skuId: item.skuId,
            quantity: item.quantity,
            reason: item.reason,
            notes: item.notes,
          })),
        });

        const row = await tx.purchaseReturn.findFirstOrThrow({
          where: { id: createdReturn.id, companyId: company.companyId },
          include: detailInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.PURCHASE_RETURN_CREATED,
          entityType: AUDIT_ENTITY_TYPES.PURCHASE_RETURN,
          entityId: row.id,
          before: null,
          after: this.auditSnapshot(row),
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.PURCHASING_PURCHASE_RETURN_CREATED,
            payload: {
              companyId: company.companyId,
              purchaseReturnId: row.id,
              purchaseOrderId: po.id,
              number: row.number,
              status: row.status,
            },
          }),
        );

        return row;
      }, TX_OPTIONS);

      return this.toView(created);
    });
  }

  async update(
    company: CompanyContext,
    id: string,
    dto: UpdatePurchaseReturnDto,
  ): Promise<PurchaseReturnView> {
    return commitThenPublish(this.eventBus, async (events) => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const current = await tx.purchaseReturn.findFirst({
          where: { id, companyId: company.companyId },
          include: detailInclude,
        });
        if (!current) this.notFound();
        if (current.status !== PurchaseReturnStatus.DRAFT) {
          throw new AppError({
            code: ERROR_CODES.PURCHASE_RETURN_INVALID_STATUS,
            message: 'Only DRAFT purchase returns can be edited.',
            statusCode: 409,
          });
        }
        if (dto.version !== undefined && current.version !== dto.version) {
          throw new AppError({
            code: ERROR_CODES.PURCHASE_RETURN_VERSION_CONFLICT,
            message: PURCHASE_RETURN_ERROR_MESSAGES.VERSION_CONFLICT,
            statusCode: 409,
          });
        }

        const before = this.auditSnapshot(current);
        const row = await tx.purchaseReturn.update({
          where: { id: current.id },
          data: {
            ...(dto.reason !== undefined ? { reason: dto.reason } : {}),
            ...(dto.expectedResolution !== undefined
              ? { expectedResolution: dto.expectedResolution }
              : {}),
            ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
            version: { increment: 1 },
          },
          include: detailInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.PURCHASE_RETURN_UPDATED,
          entityType: AUDIT_ENTITY_TYPES.PURCHASE_RETURN,
          entityId: row.id,
          before,
          after: this.auditSnapshot(row),
        });

        // No domain event for draft metadata edits (keep event surface for lifecycle).
        void events;
        return row;
      }, TX_OPTIONS);

      return this.toView(updated);
    });
  }

  async approve(company: CompanyContext, id: string): Promise<PurchaseReturnView> {
    const actorUserId = this.suppliersService.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const approved = await this.runLocked(company.companyId, id, async (tx, current) => {
        // Row locked FOR UPDATE: concurrent approves serialize; loser sees non-DRAFT.
        if (current.status !== PurchaseReturnStatus.DRAFT) {
          throw new AppError({
            code: ERROR_CODES.PURCHASE_RETURN_INVALID_STATUS,
            message: PURCHASE_RETURN_ERROR_MESSAGES.INVALID_STATUS,
            statusCode: 409,
          });
        }
        if (current.items.length === 0) {
          throw new AppError({
            code: ERROR_CODES.PURCHASE_RETURN_EMPTY,
            message: PURCHASE_RETURN_ERROR_MESSAGES.EMPTY,
            statusCode: 409,
          });
        }

        const before = this.auditSnapshot(current);
        const row = await tx.purchaseReturn.update({
          where: { id: current.id },
          data: {
            status: PurchaseReturnStatus.APPROVED,
            approvedById: actorUserId,
            approvedAt: new Date(),
            version: { increment: 1 },
          },
          include: detailInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.PURCHASE_RETURN_APPROVED,
          entityType: AUDIT_ENTITY_TYPES.PURCHASE_RETURN,
          entityId: row.id,
          before,
          after: this.auditSnapshot(row),
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.PURCHASING_PURCHASE_RETURN_APPROVED,
            payload: {
              companyId: company.companyId,
              purchaseReturnId: row.id,
              purchaseOrderId: row.purchaseOrderId,
              number: row.number,
              // Explicit: approval is commercial intent, not stock/finance.
              physicalExecution: 'DEFERRED_TO_WAREHOUSE',
              financialResolution: 'DEFERRED_TO_FINANCE',
            },
          }),
        );

        return row;
      });

      return this.toView(approved);
    });
  }

  async cancel(
    company: CompanyContext,
    id: string,
    dto: CancelPurchaseReturnDto,
  ): Promise<PurchaseReturnView> {
    const actorUserId = this.suppliersService.requireActorUserId();
    const reason = dto.reason.trim();
    return commitThenPublish(this.eventBus, async (events) => {
      const cancelled = await this.runLocked(company.companyId, id, async (tx, current) => {
        if (
          current.status !== PurchaseReturnStatus.DRAFT &&
          current.status !== PurchaseReturnStatus.APPROVED
        ) {
          throw new AppError({
            code: ERROR_CODES.PURCHASE_RETURN_INVALID_STATUS,
            message: PURCHASE_RETURN_ERROR_MESSAGES.INVALID_STATUS,
            statusCode: 409,
          });
        }
        if (dto.version !== undefined && current.version !== dto.version) {
          throw new AppError({
            code: ERROR_CODES.PURCHASE_RETURN_VERSION_CONFLICT,
            message: PURCHASE_RETURN_ERROR_MESSAGES.VERSION_CONFLICT,
            statusCode: 409,
          });
        }

        const dispatchedCount = await tx.supplierReturnExecution.count({
          where: {
            companyId: company.companyId,
            purchaseReturnId: current.id,
            status: SupplierReturnExecutionStatus.DISPATCHED,
          },
        });
        if (dispatchedCount > 0) {
          throw new AppError({
            code: ERROR_CODES.PURCHASE_RETURN_HAS_DISPATCHED_EXECUTION,
            message: PURCHASE_RETURN_ERROR_MESSAGES.HAS_DISPATCHED_EXECUTION,
            statusCode: 409,
          });
        }

        const before = this.auditSnapshot(current);
        const row = await tx.purchaseReturn.update({
          where: { id: current.id },
          data: {
            status: PurchaseReturnStatus.CANCELLED,
            cancelledById: actorUserId,
            cancelledAt: new Date(),
            cancellationReason: reason,
            version: { increment: 1 },
          },
          include: detailInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.PURCHASE_RETURN_CANCELLED,
          entityType: AUDIT_ENTITY_TYPES.PURCHASE_RETURN,
          entityId: row.id,
          before,
          after: this.auditSnapshot(row),
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.PURCHASING_PURCHASE_RETURN_CANCELLED,
            payload: {
              companyId: company.companyId,
              purchaseReturnId: row.id,
              purchaseOrderId: row.purchaseOrderId,
              number: row.number,
            },
          }),
        );

        return row;
      });

      return this.toView(cancelled);
    });
  }

  /** Runs `work` holding a row lock so concurrent approve/cancel cannot double-succeed. */
  private async runLocked<T>(
    companyId: string,
    purchaseReturnId: string,
    work: (tx: Prisma.TransactionClient, current: DetailRow) => Promise<T>,
  ): Promise<T> {
    return this.database.client.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "purchase_returns"
        WHERE "id" = ${purchaseReturnId}::uuid AND "company_id" = ${companyId}::uuid
        FOR UPDATE
      `);
      if (locked.length === 0) {
        this.notFound();
      }
      const current = await tx.purchaseReturn.findFirst({
        where: { id: purchaseReturnId, companyId },
        include: detailInclude,
      });
      if (!current) this.notFound();
      return work(tx, current);
    }, TX_OPTIONS);
  }

  private auditSnapshot(row: DetailRow): AuditSnapshot {
    return {
      id: row.id,
      number: row.number,
      status: row.status,
      supplierId: row.supplierId,
      purchaseOrderId: row.purchaseOrderId,
      reason: row.reason,
      expectedResolution: row.expectedResolution,
      itemCount: row.items.length,
      version: row.version,
    };
  }

  private async loadWarehouseExecutionProjections(
    companyId: string,
    purchaseReturnIds: string[],
    approvedByReturn: { id: string; approvedQuantity: number }[],
  ): Promise<Map<string, WarehouseExecutionProjection>> {
    const result = new Map<string, WarehouseExecutionProjection>();
    if (purchaseReturnIds.length === 0) {
      return result;
    }

    const approvedMap = new Map(approvedByReturn.map((r) => [r.id, r.approvedQuantity]));

    const dispatchedRows = await this.database.client.supplierReturnExecutionItem.groupBy({
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

    const returnItems = await this.database.client.purchaseReturnItem.findMany({
      where: { companyId, purchaseReturnId: { in: purchaseReturnIds } },
      select: { id: true, purchaseReturnId: true },
    });
    const returnIdByItemId = new Map(returnItems.map((i) => [i.id, i.purchaseReturnId]));
    const dispatchedByReturn = new Map<string, number>();
    for (const row of dispatchedRows) {
      const returnId = returnIdByItemId.get(row.purchaseReturnItemId);
      if (!returnId) continue;
      dispatchedByReturn.set(
        returnId,
        (dispatchedByReturn.get(returnId) ?? 0) + (row._sum.quantity ?? 0),
      );
    }

    const executions = await this.database.client.supplierReturnExecution.findMany({
      where: { companyId, purchaseReturnId: { in: purchaseReturnIds } },
      orderBy: { createdAt: 'asc' },
      include: {
        warehouse: { select: { code: true } },
        items: { select: { quantity: true } },
      },
    });
    const executionsByReturn = new Map<string, typeof executions>();
    for (const execution of executions) {
      const list = executionsByReturn.get(execution.purchaseReturnId) ?? [];
      list.push(execution);
      executionsByReturn.set(execution.purchaseReturnId, list);
    }

    for (const returnId of purchaseReturnIds) {
      const approvedQuantity = approvedMap.get(returnId) ?? 0;
      const dispatchedQuantity = dispatchedByReturn.get(returnId) ?? 0;
      const progress = buildProgressView(approvedQuantity, dispatchedQuantity);
      const execRows = executionsByReturn.get(returnId) ?? [];
      result.set(returnId, {
        ...progress,
        executions: execRows.map(toExecutionSummary),
      });
    }

    return result;
  }

  private toView(row: DetailRow, warehouseExecution?: WarehouseExecutionProjection): PurchaseReturnView {
    const user = (u: { id: string; firstName: string; lastName: string } | null) =>
      u
        ? { id: u.id, displayName: `${u.firstName} ${u.lastName}`.trim() }
        : null;

    return {
      id: row.id,
      companyId: row.companyId,
      number: row.number,
      supplierId: row.supplierId,
      purchaseOrderId: row.purchaseOrderId,
      status: row.status,
      reason: row.reason,
      expectedResolution: row.expectedResolution,
      notes: row.notes,
      cancellationReason: row.cancellationReason,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      approvedAt: row.approvedAt,
      cancelledAt: row.cancelledAt,
      supplier: row.supplier,
      purchaseOrder: row.purchaseOrder,
      createdBy: user(row.createdBy)!,
      approvedBy: user(row.approvedBy),
      cancelledBy: user(row.cancelledBy),
      items: row.items.map((item) => ({
        id: item.id,
        purchaseReturnId: item.purchaseReturnId,
        purchaseOrderItemId: item.purchaseOrderItemId,
        skuId: item.skuId,
        quantity: item.quantity,
        reason: item.reason,
        notes: item.notes,
        sku: item.sku,
      })),
      physicalExecution: 'DEFERRED_TO_WAREHOUSE',
      financialResolution: 'DEFERRED_TO_FINANCE',
      ...(warehouseExecution ? { warehouseExecution } : {}),
    };
  }

  private notFound(): never {
    throw new AppError({
      code: ERROR_CODES.PURCHASE_RETURN_NOT_FOUND,
      message: PURCHASE_RETURN_ERROR_MESSAGES.NOT_FOUND,
      statusCode: 404,
    });
  }
}
