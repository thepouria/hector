import { Injectable } from '@nestjs/common';
import {
  InventoryAdjustmentDirection,
  InventoryAdjustmentReason,
  InventoryAdjustmentStatus,
  InventoryMovementType,
  InventorySourceType,
  Prisma,
  StockClassification,
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
import type { CompanyContext } from '../companies/types/company.types';
import { InventoryLedgerService, type PostMovementInput } from './inventory-ledger.service';
import {
  allocateInventoryAdjustmentSequence,
  formatInventoryAdjustmentNumber,
} from './inventory-adjustment-numbering';
import {
  INVENTORY_ADJUSTMENT_ERROR_MESSAGES,
  INVENTORY_ADJUSTMENT_SEARCH_MAX_LENGTH,
} from './inventory-adjustment.constants';
import type {
  CreateInventoryAdjustmentDto,
  InventoryAdjustmentItemInputDto,
  ListInventoryAdjustmentsQueryDto,
  UpdateInventoryAdjustmentDto,
  UpsertInventoryAdjustmentItemDto,
} from './dto/inventory-adjustment.dto';
import type {
  InventoryAdjustmentDetailView,
  InventoryAdjustmentItemView,
  InventoryAdjustmentListItemView,
} from './types/inventory-adjustment.types';

const detailInclude = {
  warehouse: {
    select: { id: true, code: true, name: true, status: true, isSystem: true },
  },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  approvedBy: { select: { id: true, firstName: true, lastName: true } },
  rejectedBy: { select: { id: true, firstName: true, lastName: true } },
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
} satisfies Prisma.InventoryAdjustmentInclude;

type DetailRow = Prisma.InventoryAdjustmentGetPayload<{ include: typeof detailInclude }>;
type Tx = Prisma.TransactionClient;

@Injectable()
export class InventoryAdjustmentsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
    private readonly inventoryLedger: InventoryLedgerService,
  ) {}

  async list(
    company: CompanyContext,
    query: ListInventoryAdjustmentsQueryDto,
  ): Promise<{ data: InventoryAdjustmentListItemView[]; meta: PaginationMeta }> {
    const search = normalizeSearch(query.q);
    const where: Prisma.InventoryAdjustmentWhereInput = {
      companyId: company.companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.reason ? { reason: query.reason } : {}),
      ...(query.createdById ? { createdById: query.createdById } : {}),
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
              { reasonText: { contains: search, mode: 'insensitive' } },
              { notes: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.database.client.inventoryAdjustment.count({ where }),
      this.database.client.inventoryAdjustment.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          warehouse: {
            select: { id: true, code: true, name: true, status: true, isSystem: true },
          },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          approvedBy: { select: { id: true, firstName: true, lastName: true } },
          items: { select: { direction: true, quantity: true } },
        },
      }),
    ]);

    return {
      data: rows.map((row) => {
        const netUnits = row.items.reduce(
          (sum, item) =>
            sum +
            (item.direction === InventoryAdjustmentDirection.IN
              ? item.quantity
              : -item.quantity),
          0,
        );
        return {
          id: row.id,
          number: row.number,
          status: row.status,
          reason: row.reason,
          reasonText: row.reasonText,
          warehouse: row.warehouse,
          itemCount: row.items.length,
          netUnits,
          notes: row.notes,
          createdBy: row.createdBy,
          approvedBy: row.approvedBy,
          createdAt: row.createdAt.toISOString(),
          postedAt: row.postedAt?.toISOString() ?? null,
          updatedAt: row.updatedAt.toISOString(),
        };
      }),
      meta: buildPaginationMeta(total, query.page, query.pageSize),
    };
  }

  async get(
    company: CompanyContext,
    adjustmentId: string,
  ): Promise<InventoryAdjustmentDetailView> {
    const detail = await this.requireDetail(company.companyId, adjustmentId);
    return this.toDetailView(detail);
  }

  async create(
    company: CompanyContext,
    dto: CreateInventoryAdjustmentDto,
  ): Promise<InventoryAdjustmentDetailView> {
    const actorUserId = this.requireActorUserId();
    this.assertReasonText(dto.reason, dto.reasonText);

    return commitThenPublish(this.eventBus, async (events) => {
      const detail = await this.database.client.$transaction(async (tx) => {
        await this.assertOperationalWarehouse(tx, company.companyId, dto.warehouseId);
        const sequence = await allocateInventoryAdjustmentSequence(tx, company.companyId);
        const number = formatInventoryAdjustmentNumber(sequence);

        const adjustment = await tx.inventoryAdjustment.create({
          data: {
            companyId: company.companyId,
            number,
            warehouseId: dto.warehouseId,
            reason: dto.reason,
            reasonText: dto.reasonText?.trim() || null,
            notes: dto.notes?.trim() || null,
            status: InventoryAdjustmentStatus.DRAFT,
            createdById: actorUserId,
          },
        });

        for (const item of dto.items ?? []) {
          await this.insertItem(tx, company.companyId, adjustment, item);
        }

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.INVENTORY_ADJUSTMENT_CREATED,
          entityType: AUDIT_ENTITY_TYPES.INVENTORY_ADJUSTMENT,
          entityId: adjustment.id,
          after: {
            status: InventoryAdjustmentStatus.DRAFT,
            number,
            reason: dto.reason,
            warehouseId: dto.warehouseId,
            itemCount: dto.items?.length ?? 0,
          },
          metadata: {
            adjustmentId: adjustment.id,
            adjustmentNumber: number,
            warehouseId: dto.warehouseId,
            reason: dto.reason,
            status: InventoryAdjustmentStatus.DRAFT,
          },
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_INVENTORY_ADJUSTMENT_CREATED,
            payload: {
              companyId: company.companyId,
              adjustmentId: adjustment.id,
              adjustmentNumber: number,
              warehouseId: dto.warehouseId,
              reason: dto.reason,
              status: InventoryAdjustmentStatus.DRAFT,
            },
          }),
        );

        return this.loadDetailInTx(tx, company.companyId, adjustment.id);
      });
      return this.toDetailView(detail);
    });
  }

  async update(
    company: CompanyContext,
    adjustmentId: string,
    dto: UpdateInventoryAdjustmentDto,
  ): Promise<InventoryAdjustmentDetailView> {
    this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const detail = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockAdjustment(tx, company.companyId, adjustmentId);
        this.assertDraft(locked.status);

        const reason = dto.reason ?? locked.reason;
        const reasonText =
          dto.reasonText !== undefined ? dto.reasonText : locked.reasonText;
        this.assertReasonText(reason, reasonText);

        if (dto.warehouseId && dto.warehouseId !== locked.warehouseId) {
          await this.assertOperationalWarehouse(tx, company.companyId, dto.warehouseId);
        }

        await tx.inventoryAdjustment.update({
          where: { id: adjustmentId },
          data: {
            ...(dto.warehouseId ? { warehouseId: dto.warehouseId } : {}),
            ...(dto.reason ? { reason: dto.reason } : {}),
            ...(dto.reasonText !== undefined
              ? { reasonText: dto.reasonText?.trim() || null }
              : {}),
            ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
            version: { increment: 1 },
          },
        });

        const warehouseId = dto.warehouseId ?? locked.warehouseId;

        if (dto.items) {
          await tx.inventoryAdjustmentItem.deleteMany({
            where: { inventoryAdjustmentId: adjustmentId, companyId: company.companyId },
          });
          for (const item of dto.items) {
            await this.insertItem(tx, company.companyId, { id: adjustmentId, warehouseId }, item);
          }
        }

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.INVENTORY_ADJUSTMENT_UPDATED,
          entityType: AUDIT_ENTITY_TYPES.INVENTORY_ADJUSTMENT,
          entityId: adjustmentId,
          before: { status: InventoryAdjustmentStatus.DRAFT },
          after: { status: InventoryAdjustmentStatus.DRAFT },
          metadata: {
            adjustmentId,
            adjustmentNumber: locked.number,
            warehouseId,
            status: InventoryAdjustmentStatus.DRAFT,
          },
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_INVENTORY_ADJUSTMENT_CREATED,
            payload: {
              companyId: company.companyId,
              adjustmentId,
              adjustmentNumber: locked.number,
              warehouseId,
              reason,
              status: InventoryAdjustmentStatus.DRAFT,
              updated: true,
            },
          }),
        );

        return this.loadDetailInTx(tx, company.companyId, adjustmentId);
      });
      return this.toDetailView(detail);
    });
  }

  async upsertItem(
    company: CompanyContext,
    adjustmentId: string,
    dto: UpsertInventoryAdjustmentItemDto,
  ): Promise<InventoryAdjustmentDetailView> {
    this.requireActorUserId();
    return commitThenPublish(this.eventBus, async () => {
      const detail = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockAdjustment(tx, company.companyId, adjustmentId);
        this.assertDraft(locked.status);
        const classification = dto.classification ?? StockClassification.SELLABLE;
        await this.validateItemDimensions(tx, company.companyId, locked, {
          ...dto,
          classification,
        });

        const existing = await tx.inventoryAdjustmentItem.findUnique({
          where: {
            inventoryAdjustmentId_locationId_skuId_batchId_classification_direction: {
              inventoryAdjustmentId: adjustmentId,
              locationId: dto.locationId,
              skuId: dto.skuId,
              batchId: dto.batchId,
              classification,
              direction: dto.direction,
            },
          },
        });

        if (existing) {
          await tx.inventoryAdjustmentItem.update({
            where: { id: existing.id },
            data: {
              quantity: dto.quantity,
              notes: dto.notes ?? null,
            },
          });
        } else {
          await this.insertItem(tx, company.companyId, locked, dto);
        }

        await tx.inventoryAdjustment.update({
          where: { id: adjustmentId },
          data: { version: { increment: 1 } },
        });

        return this.loadDetailInTx(tx, company.companyId, adjustmentId);
      });
      return this.toDetailView(detail);
    });
  }

  async removeItem(
    company: CompanyContext,
    adjustmentId: string,
    itemId: string,
  ): Promise<InventoryAdjustmentDetailView> {
    this.requireActorUserId();
    return commitThenPublish(this.eventBus, async () => {
      const detail = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockAdjustment(tx, company.companyId, adjustmentId);
        this.assertDraft(locked.status);
        const deleted = await tx.inventoryAdjustmentItem.deleteMany({
          where: {
            id: itemId,
            inventoryAdjustmentId: adjustmentId,
            companyId: company.companyId,
          },
        });
        if (deleted.count === 0) {
          throw new AppError({
            code: ERROR_CODES.INVENTORY_ADJUSTMENT_ITEM_NOT_FOUND,
            message: INVENTORY_ADJUSTMENT_ERROR_MESSAGES.ITEM_NOT_FOUND,
            statusCode: 404,
          });
        }
        await tx.inventoryAdjustment.update({
          where: { id: adjustmentId },
          data: { version: { increment: 1 } },
        });
        return this.loadDetailInTx(tx, company.companyId, adjustmentId);
      });
      return this.toDetailView(detail);
    });
  }

  async submit(
    company: CompanyContext,
    adjustmentId: string,
  ): Promise<InventoryAdjustmentDetailView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const detail = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockAdjustment(tx, company.companyId, adjustmentId);
        if (locked.status === InventoryAdjustmentStatus.PENDING_APPROVAL) {
          return this.loadDetailInTx(tx, company.companyId, adjustmentId);
        }
        if (locked.status !== InventoryAdjustmentStatus.DRAFT) {
          throw new AppError({
            code: ERROR_CODES.INVENTORY_ADJUSTMENT_NOT_SUBMITTABLE,
            message: INVENTORY_ADJUSTMENT_ERROR_MESSAGES.NOT_SUBMITTABLE,
            statusCode: 409,
          });
        }
        this.assertReasonText(locked.reason, locked.reasonText);
        const itemCount = await tx.inventoryAdjustmentItem.count({
          where: { inventoryAdjustmentId: adjustmentId, companyId: company.companyId },
        });
        if (itemCount === 0) {
          throw new AppError({
            code: ERROR_CODES.INVENTORY_ADJUSTMENT_EMPTY,
            message: INVENTORY_ADJUSTMENT_ERROR_MESSAGES.EMPTY,
            statusCode: 409,
          });
        }

        const now = new Date();
        await tx.inventoryAdjustment.update({
          where: { id: adjustmentId },
          data: {
            status: InventoryAdjustmentStatus.PENDING_APPROVAL,
            submittedAt: now,
            version: { increment: 1 },
          },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.INVENTORY_ADJUSTMENT_UPDATED,
          entityType: AUDIT_ENTITY_TYPES.INVENTORY_ADJUSTMENT,
          entityId: adjustmentId,
          before: { status: InventoryAdjustmentStatus.DRAFT },
          after: { status: InventoryAdjustmentStatus.PENDING_APPROVAL },
          metadata: {
            adjustmentId,
            adjustmentNumber: locked.number,
            status: InventoryAdjustmentStatus.PENDING_APPROVAL,
            submittedById: actorUserId,
          },
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_INVENTORY_ADJUSTMENT_CREATED,
            payload: {
              companyId: company.companyId,
              adjustmentId,
              adjustmentNumber: locked.number,
              warehouseId: locked.warehouseId,
              reason: locked.reason,
              status: InventoryAdjustmentStatus.PENDING_APPROVAL,
            },
          }),
        );

        return this.loadDetailInTx(tx, company.companyId, adjustmentId);
      });
      return this.toDetailView(detail);
    });
  }

  async approve(
    company: CompanyContext,
    adjustmentId: string,
  ): Promise<InventoryAdjustmentDetailView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const detail = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockAdjustment(tx, company.companyId, adjustmentId);
        if (locked.status === InventoryAdjustmentStatus.APPROVED) {
          return this.loadDetailInTx(tx, company.companyId, adjustmentId);
        }
        if (locked.status !== InventoryAdjustmentStatus.PENDING_APPROVAL) {
          throw new AppError({
            code: ERROR_CODES.INVENTORY_ADJUSTMENT_NOT_APPROVABLE,
            message: INVENTORY_ADJUSTMENT_ERROR_MESSAGES.NOT_APPROVABLE,
            statusCode: 409,
          });
        }

        const now = new Date();
        await tx.inventoryAdjustment.update({
          where: { id: adjustmentId },
          data: {
            status: InventoryAdjustmentStatus.APPROVED,
            approvedAt: now,
            approvedById: actorUserId,
            version: { increment: 1 },
          },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.INVENTORY_ADJUSTMENT_APPROVED,
          entityType: AUDIT_ENTITY_TYPES.INVENTORY_ADJUSTMENT,
          entityId: adjustmentId,
          before: { status: InventoryAdjustmentStatus.PENDING_APPROVAL },
          after: { status: InventoryAdjustmentStatus.APPROVED },
          metadata: {
            adjustmentId,
            adjustmentNumber: locked.number,
            warehouseId: locked.warehouseId,
            status: InventoryAdjustmentStatus.APPROVED,
          },
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_INVENTORY_ADJUSTMENT_APPROVED,
            payload: {
              companyId: company.companyId,
              adjustmentId,
              adjustmentNumber: locked.number,
              warehouseId: locked.warehouseId,
              reason: locked.reason,
              status: InventoryAdjustmentStatus.APPROVED,
            },
          }),
        );

        return this.loadDetailInTx(tx, company.companyId, adjustmentId);
      });
      return this.toDetailView(detail);
    });
  }

  async reject(
    company: CompanyContext,
    adjustmentId: string,
  ): Promise<InventoryAdjustmentDetailView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const detail = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockAdjustment(tx, company.companyId, adjustmentId);
        if (locked.status === InventoryAdjustmentStatus.REJECTED) {
          return this.loadDetailInTx(tx, company.companyId, adjustmentId);
        }
        if (locked.status !== InventoryAdjustmentStatus.PENDING_APPROVAL) {
          throw new AppError({
            code: ERROR_CODES.INVENTORY_ADJUSTMENT_NOT_APPROVABLE,
            message: INVENTORY_ADJUSTMENT_ERROR_MESSAGES.NOT_APPROVABLE,
            statusCode: 409,
          });
        }

        const now = new Date();
        await tx.inventoryAdjustment.update({
          where: { id: adjustmentId },
          data: {
            status: InventoryAdjustmentStatus.REJECTED,
            rejectedAt: now,
            rejectedById: actorUserId,
            version: { increment: 1 },
          },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.INVENTORY_ADJUSTMENT_REJECTED,
          entityType: AUDIT_ENTITY_TYPES.INVENTORY_ADJUSTMENT,
          entityId: adjustmentId,
          before: { status: InventoryAdjustmentStatus.PENDING_APPROVAL },
          after: { status: InventoryAdjustmentStatus.REJECTED },
          metadata: {
            adjustmentId,
            adjustmentNumber: locked.number,
            status: InventoryAdjustmentStatus.REJECTED,
          },
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_INVENTORY_ADJUSTMENT_CANCELLED,
            payload: {
              companyId: company.companyId,
              adjustmentId,
              adjustmentNumber: locked.number,
              warehouseId: locked.warehouseId,
              status: InventoryAdjustmentStatus.REJECTED,
            },
          }),
        );

        return this.loadDetailInTx(tx, company.companyId, adjustmentId);
      });
      return this.toDetailView(detail);
    });
  }

  async post(
    company: CompanyContext,
    adjustmentId: string,
  ): Promise<InventoryAdjustmentDetailView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const detail = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockAdjustment(tx, company.companyId, adjustmentId);
        if (locked.status === InventoryAdjustmentStatus.POSTED) {
          return this.loadDetailInTx(tx, company.companyId, adjustmentId);
        }
        if (locked.status !== InventoryAdjustmentStatus.APPROVED) {
          throw new AppError({
            code: ERROR_CODES.INVENTORY_ADJUSTMENT_NOT_POSTABLE,
            message: INVENTORY_ADJUSTMENT_ERROR_MESSAGES.NOT_POSTABLE,
            statusCode: 409,
          });
        }

        const items = await tx.inventoryAdjustmentItem.findMany({
          where: { inventoryAdjustmentId: adjustmentId, companyId: company.companyId },
          orderBy: { id: 'asc' },
        });
        if (items.length === 0) {
          throw new AppError({
            code: ERROR_CODES.INVENTORY_ADJUSTMENT_EMPTY,
            message: INVENTORY_ADJUSTMENT_ERROR_MESSAGES.EMPTY,
            statusCode: 409,
          });
        }

        await this.assertOperationalWarehouse(tx, company.companyId, locked.warehouseId);
        const occurredAt = new Date();
        const posts: PostMovementInput[] = [];

        for (const item of items) {
          await this.validateItemDimensions(tx, company.companyId, locked, {
            skuId: item.skuId,
            batchId: item.batchId,
            locationId: item.locationId,
            classification: item.classification,
            direction: item.direction,
            quantity: item.quantity,
          });

          const signed =
            item.direction === InventoryAdjustmentDirection.IN
              ? item.quantity
              : -item.quantity;

          posts.push({
            warehouseId: locked.warehouseId,
            locationId: item.locationId,
            skuId: item.skuId,
            batchId: item.batchId,
            classification: item.classification,
            movementType:
              signed > 0
                ? InventoryMovementType.ADJUSTMENT_IN
                : InventoryMovementType.ADJUSTMENT_OUT,
            quantityDelta: signed,
            sourceType: InventorySourceType.MANUAL_ADJUSTMENT,
            sourceId: adjustmentId,
            sourceLineId: item.id,
            occurredAt,
            actorUserId,
            reasonCode: locked.reason,
            notes: `ADJ post ${locked.number}`,
          });
        }

        await this.inventoryLedger.postMovementsInTx(tx, company.companyId, posts, {
          recordAudit: true,
        });

        await tx.inventoryAdjustment.update({
          where: { id: adjustmentId },
          data: {
            status: InventoryAdjustmentStatus.POSTED,
            postedAt: occurredAt,
            postedById: actorUserId,
            version: { increment: 1 },
          },
        });

        const netUnits = items.reduce(
          (sum, item) =>
            sum +
            (item.direction === InventoryAdjustmentDirection.IN
              ? item.quantity
              : -item.quantity),
          0,
        );

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.INVENTORY_ADJUSTMENT_POSTED,
          entityType: AUDIT_ENTITY_TYPES.INVENTORY_ADJUSTMENT,
          entityId: adjustmentId,
          before: { status: InventoryAdjustmentStatus.APPROVED },
          after: {
            status: InventoryAdjustmentStatus.POSTED,
            itemCount: items.length,
            netUnits,
          },
          metadata: {
            adjustmentId,
            adjustmentNumber: locked.number,
            warehouseId: locked.warehouseId,
            reason: locked.reason,
            itemCount: items.length,
            netUnits,
            status: InventoryAdjustmentStatus.POSTED,
          },
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_INVENTORY_ADJUSTMENT_POSTED,
            payload: {
              companyId: company.companyId,
              adjustmentId,
              adjustmentNumber: locked.number,
              warehouseId: locked.warehouseId,
              reason: locked.reason,
              itemCount: items.length,
              netUnits,
              status: InventoryAdjustmentStatus.POSTED,
            },
          }),
        );

        return this.loadDetailInTx(tx, company.companyId, adjustmentId);
      });
      return this.toDetailView(detail);
    });
  }

  async cancel(
    company: CompanyContext,
    adjustmentId: string,
  ): Promise<InventoryAdjustmentDetailView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const detail = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockAdjustment(tx, company.companyId, adjustmentId);
        if (locked.status === InventoryAdjustmentStatus.CANCELLED) {
          return this.loadDetailInTx(tx, company.companyId, adjustmentId);
        }
        if (locked.status === InventoryAdjustmentStatus.POSTED) {
          throw new AppError({
            code: ERROR_CODES.INVENTORY_ADJUSTMENT_CANCEL_NOT_ALLOWED,
            message: INVENTORY_ADJUSTMENT_ERROR_MESSAGES.CANCEL_NOT_ALLOWED,
            statusCode: 409,
          });
        }
        if (
          locked.status !== InventoryAdjustmentStatus.DRAFT &&
          locked.status !== InventoryAdjustmentStatus.PENDING_APPROVAL
        ) {
          throw new AppError({
            code: ERROR_CODES.INVENTORY_ADJUSTMENT_CANCEL_NOT_ALLOWED,
            message: INVENTORY_ADJUSTMENT_ERROR_MESSAGES.CANCEL_NOT_ALLOWED,
            statusCode: 409,
          });
        }

        const beforeStatus = locked.status;
        const now = new Date();
        await tx.inventoryAdjustment.update({
          where: { id: adjustmentId },
          data: {
            status: InventoryAdjustmentStatus.CANCELLED,
            cancelledAt: now,
            cancelledById: actorUserId,
            version: { increment: 1 },
          },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.INVENTORY_ADJUSTMENT_CANCELLED,
          entityType: AUDIT_ENTITY_TYPES.INVENTORY_ADJUSTMENT,
          entityId: adjustmentId,
          before: { status: beforeStatus },
          after: { status: InventoryAdjustmentStatus.CANCELLED },
          metadata: {
            adjustmentId,
            adjustmentNumber: locked.number,
            warehouseId: locked.warehouseId,
            status: InventoryAdjustmentStatus.CANCELLED,
          },
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.WAREHOUSE_INVENTORY_ADJUSTMENT_CANCELLED,
            payload: {
              companyId: company.companyId,
              adjustmentId,
              adjustmentNumber: locked.number,
              warehouseId: locked.warehouseId,
              status: InventoryAdjustmentStatus.CANCELLED,
            },
          }),
        );

        return this.loadDetailInTx(tx, company.companyId, adjustmentId);
      });
      return this.toDetailView(detail);
    });
  }

  private async insertItem(
    tx: Tx,
    companyId: string,
    adjustment: { id: string; warehouseId: string },
    item: InventoryAdjustmentItemInputDto,
  ): Promise<void> {
    const classification = item.classification ?? StockClassification.SELLABLE;
    await this.validateItemDimensions(tx, companyId, adjustment, {
      ...item,
      classification,
    });
    await tx.inventoryAdjustmentItem.create({
      data: {
        companyId,
        inventoryAdjustmentId: adjustment.id,
        locationId: item.locationId,
        skuId: item.skuId,
        batchId: item.batchId,
        classification,
        direction: item.direction,
        quantity: item.quantity,
        notes: item.notes ?? null,
      },
    });
  }

  private async validateItemDimensions(
    tx: Tx,
    companyId: string,
    adjustment: { warehouseId: string },
    item: InventoryAdjustmentItemInputDto & { classification: StockClassification },
  ): Promise<void> {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new AppError({
        code: ERROR_CODES.INVENTORY_ADJUSTMENT_INVALID_QUANTITY,
        message: INVENTORY_ADJUSTMENT_ERROR_MESSAGES.INVALID_QUANTITY,
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
        code: ERROR_CODES.INVENTORY_ADJUSTMENT_BATCH_SKU_MISMATCH,
        message: INVENTORY_ADJUSTMENT_ERROR_MESSAGES.BATCH_SKU_MISMATCH,
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
    if (location.warehouseId !== adjustment.warehouseId) {
      throw new AppError({
        code: ERROR_CODES.INVENTORY_ADJUSTMENT_LOCATION_WAREHOUSE_MISMATCH,
        message: INVENTORY_ADJUSTMENT_ERROR_MESSAGES.LOCATION_WAREHOUSE_MISMATCH,
        statusCode: 409,
      });
    }
    if (location.type === WarehouseLocationType.TRANSIT) {
      throw new AppError({
        code: ERROR_CODES.INVENTORY_ADJUSTMENT_SYSTEM_WAREHOUSE,
        message: INVENTORY_ADJUSTMENT_ERROR_MESSAGES.SYSTEM_WAREHOUSE,
        statusCode: 409,
      });
    }
    if (location.status !== WarehouseStatus.ACTIVE) {
      throw new AppError({
        code: ERROR_CODES.INVENTORY_ADJUSTMENT_LOCATION_INACTIVE,
        message: INVENTORY_ADJUSTMENT_ERROR_MESSAGES.LOCATION_INACTIVE,
        statusCode: 409,
      });
    }
  }

  private assertReasonText(
    reason: InventoryAdjustmentReason,
    reasonText?: string | null,
  ): void {
    if (
      (reason === InventoryAdjustmentReason.REGISTRATION_ERROR ||
        reason === InventoryAdjustmentReason.CORRECTION ||
        reason === InventoryAdjustmentReason.OTHER) &&
      !reasonText?.trim()
    ) {
      throw new AppError({
        code: ERROR_CODES.INVENTORY_ADJUSTMENT_REASON_TEXT_REQUIRED,
        message: INVENTORY_ADJUSTMENT_ERROR_MESSAGES.REASON_TEXT_REQUIRED,
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
        code: ERROR_CODES.INVENTORY_ADJUSTMENT_SYSTEM_WAREHOUSE,
        message: INVENTORY_ADJUSTMENT_ERROR_MESSAGES.SYSTEM_WAREHOUSE,
        statusCode: 409,
      });
    }
    if (warehouse.status !== WarehouseStatus.ACTIVE) {
      throw new AppError({
        code: ERROR_CODES.INVENTORY_ADJUSTMENT_WAREHOUSE_INACTIVE,
        message: INVENTORY_ADJUSTMENT_ERROR_MESSAGES.WAREHOUSE_INACTIVE,
        statusCode: 409,
      });
    }
  }

  private assertDraft(status: InventoryAdjustmentStatus): void {
    if (status !== InventoryAdjustmentStatus.DRAFT) {
      throw new AppError({
        code: ERROR_CODES.INVENTORY_ADJUSTMENT_NOT_EDITABLE,
        message: INVENTORY_ADJUSTMENT_ERROR_MESSAGES.NOT_EDITABLE,
        statusCode: 409,
      });
    }
  }

  private async lockAdjustment(
    tx: Tx,
    companyId: string,
    adjustmentId: string,
  ): Promise<{
    id: string;
    number: string;
    status: InventoryAdjustmentStatus;
    warehouseId: string;
    reason: InventoryAdjustmentReason;
    reasonText: string | null;
    version: number;
  }> {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        number: string;
        status: InventoryAdjustmentStatus;
        warehouse_id: string;
        reason: InventoryAdjustmentReason;
        reason_text: string | null;
        version: number;
      }>
    >(Prisma.sql`
      SELECT id, number, status, warehouse_id, reason, reason_text, version
      FROM inventory_adjustments
      WHERE id = ${adjustmentId}::uuid
        AND company_id = ${companyId}::uuid
      FOR UPDATE
    `);
    const row = rows[0];
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.INVENTORY_ADJUSTMENT_NOT_FOUND,
        message: INVENTORY_ADJUSTMENT_ERROR_MESSAGES.NOT_FOUND,
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

  private async requireDetail(companyId: string, adjustmentId: string): Promise<DetailRow> {
    const row = await this.database.client.inventoryAdjustment.findFirst({
      where: { id: adjustmentId, companyId },
      include: detailInclude,
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.INVENTORY_ADJUSTMENT_NOT_FOUND,
        message: INVENTORY_ADJUSTMENT_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return row;
  }

  private async loadDetailInTx(
    tx: Tx,
    companyId: string,
    adjustmentId: string,
  ): Promise<DetailRow> {
    const row = await tx.inventoryAdjustment.findFirst({
      where: { id: adjustmentId, companyId },
      include: detailInclude,
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.INVENTORY_ADJUSTMENT_NOT_FOUND,
        message: INVENTORY_ADJUSTMENT_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return row;
  }

  private async toDetailView(row: DetailRow): Promise<InventoryAdjustmentDetailView> {
    const balanceKeys = row.items.map((item) => ({
      warehouseId: row.warehouseId,
      locationId: item.locationId,
      skuId: item.skuId,
      batchId: item.batchId,
      classification: item.classification,
    }));

    const balances =
      balanceKeys.length === 0
        ? []
        : await this.database.client.inventoryBalance.findMany({
            where: {
              companyId: row.companyId,
              OR: balanceKeys,
            },
          });

    const balanceMap = new Map(
      balances.map((b) => [
        `${b.warehouseId}|${b.locationId}|${b.skuId}|${b.batchId}|${b.classification}`,
        b.onHandQuantity,
      ]),
    );

    const items: InventoryAdjustmentItemView[] = row.items.map((item) => {
      const signedDelta =
        item.direction === InventoryAdjustmentDirection.IN ? item.quantity : -item.quantity;
      const key = `${row.warehouseId}|${item.locationId}|${item.skuId}|${item.batchId}|${item.classification}`;
      const currentOnHand = balanceMap.get(key) ?? 0;
      return {
        id: item.id,
        location: {
          id: item.location.id,
          code: item.location.code,
          name: item.location.name,
          barcode: item.location.barcode,
          status: item.location.status,
          type: item.location.type,
          warehouseId: item.location.warehouseId,
        },
        skuId: item.sku.id,
        skuCode: item.sku.code,
        skuName: item.sku.name,
        productName: item.sku.product?.name ?? null,
        batchId: item.batch.id,
        batchNumber: item.batch.batchNumber,
        supplierBatchNumber: item.batch.supplierBatchNumber,
        classification: item.classification,
        direction: item.direction,
        quantity: item.quantity,
        signedDelta,
        currentOnHand,
        resultOnHand: currentOnHand + signedDelta,
        notes: item.notes,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      };
    });

    return {
      id: row.id,
      number: row.number,
      status: row.status,
      reason: row.reason,
      reasonText: row.reasonText,
      warehouse: row.warehouse,
      notes: row.notes,
      version: row.version,
      items,
      createdBy: row.createdBy,
      approvedBy: row.approvedBy,
      rejectedBy: row.rejectedBy,
      postedBy: row.postedBy,
      cancelledBy: row.cancelledBy,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      rejectedAt: row.rejectedAt?.toISOString() ?? null,
      postedAt: row.postedAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
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
  return trimmed.slice(0, INVENTORY_ADJUSTMENT_SEARCH_MAX_LENGTH);
}
