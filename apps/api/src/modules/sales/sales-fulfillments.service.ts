import { Injectable } from '@nestjs/common';
import {
  InventoryMovementType,
  InventoryReservationSourceType,
  InventoryReservationStatus,
  InventorySourceType,
  Prisma,
  SalesFulfillmentStatus,
  SalesOrderStatus,
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
import type { CompanyContext } from '../companies/types/company.types';
import { CustomerReceivablesService } from '../finance/customer-receivables.service';
import { InventoryLedgerService } from '../warehouse/inventory-ledger.service';
import type { PostMovementInput } from '../warehouse/inventory-ledger.service';
import { InventoryReservationsService } from '../warehouse/inventory-reservations.service';
import type { CreateSalesFulfillmentDto } from './dto/create-sales-fulfillment.dto';
import type { ListSalesFulfillmentsQueryDto } from './dto/list-sales-fulfillments.query.dto';
import {
  allocateSalesFulfillmentSequence,
  formatSalesFulfillmentNumber,
} from './sales-fulfillment-numbering';
import {
  deriveFulfillmentLifecycleStatus,
  fulfillableQuantity,
} from './sales-order-quantities';
import { assertSalesOrderTransition } from './sales-order-status';
import {
  SALES_ERROR_MESSAGES,
  SALES_FULFILLMENT_NOTES_MAX_LENGTH,
} from './sales.constants';
import { normalizeSearchQuery } from './sales.normalization';

const TX_OPTIONS = { maxWait: 5_000, timeout: 45_000 } as const;

const detailInclude = {
  warehouse: { select: { id: true, code: true, name: true } },
  salesOrder: {
    select: { id: true, orderNumber: true, status: true, currency: true },
  },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  completedBy: { select: { id: true, firstName: true, lastName: true } },
  items: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    include: {
      sku: { select: { id: true, code: true, name: true } },
      location: { select: { id: true, code: true, name: true } },
      batch: { select: { id: true, batchNumber: true } },
      salesOrderItem: {
        select: {
          id: true,
          quantity: true,
          cancelledQuantity: true,
          fulfilledQuantity: true,
        },
      },
    },
  },
} satisfies Prisma.SalesFulfillmentInclude;

type DetailRow = Prisma.SalesFulfillmentGetPayload<{ include: typeof detailInclude }>;

export type SalesFulfillmentView = {
  id: string;
  companyId: string;
  fulfillmentNumber: string;
  salesOrderId: string;
  warehouseId: string;
  status: SalesFulfillmentStatus;
  notes: string | null;
  requestId: string | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdById: string;
  version: number;
  warehouse: { id: string; code: string; name: string };
  salesOrder: { id: string; orderNumber: string; status: SalesOrderStatus; currency: string };
  createdBy: { id: string; displayName: string };
  completedBy: { id: string; displayName: string } | null;
  items: Array<{
    id: string;
    salesOrderItemId: string;
    skuId: string;
    warehouseId: string;
    locationId: string;
    batchId: string;
    classification: StockClassification;
    quantity: number;
    notes: string | null;
    sku: { id: string; code: string; name: string | null };
    location: { id: string; code: string; name: string | null };
    batch: { id: string; batchNumber: string };
  }>;
};

@Injectable()
export class SalesFulfillmentsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventBus: DomainEventBus,
    private readonly eventFactory: DomainEventFactory,
    private readonly inventoryLedger: InventoryLedgerService,
    private readonly inventoryReservations: InventoryReservationsService,
    private readonly customerReceivables: CustomerReceivablesService,
  ) {}

  async list(
    company: CompanyContext,
    query: ListSalesFulfillmentsQueryDto,
  ): Promise<{ data: SalesFulfillmentView[]; meta: PaginationMeta }> {
    const where: Prisma.SalesFulfillmentWhereInput = {
      companyId: company.companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.salesOrderId ? { salesOrderId: query.salesOrderId } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
    };
    const search = normalizeSearchQuery(query.search);
    if (search) {
      where.OR = [
        { fulfillmentNumber: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [total, rows] = await this.database.client.$transaction([
      this.database.client.salesFulfillment.count({ where }),
      this.database.client.salesFulfillment.findMany({
        where,
        include: detailInclude,
        orderBy: [{ [query.sortBy]: query.sortOrder }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      data: rows.map((r) => this.toView(r)),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async get(company: CompanyContext, id: string): Promise<SalesFulfillmentView> {
    const row = await this.requireFulfillment(company.companyId, id);
    return this.toView(row);
  }

  async create(
    company: CompanyContext,
    dto: CreateSalesFulfillmentDto,
  ): Promise<SalesFulfillmentView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const created = await this.database.client.$transaction(async (tx) => {
        if (dto.requestId) {
          const raced = await tx.salesFulfillment.findUnique({
            where: {
              companyId_requestId: {
                companyId: company.companyId,
                requestId: dto.requestId,
              },
            },
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
        if (
          order.status === SalesOrderStatus.DRAFT ||
          order.status === SalesOrderStatus.CANCELLED ||
          order.status === SalesOrderStatus.FULFILLED
        ) {
          throw new AppError({
            code: ERROR_CODES.SALES_FULFILLMENT_ORDER_NOT_EXECUTABLE,
            message: SALES_ERROR_MESSAGES.SALES_FULFILLMENT_ORDER_NOT_EXECUTABLE,
            statusCode: 409,
          });
        }

        await this.assertWarehouse(tx, company.companyId, dto.warehouseId);
        if (!dto.items?.length) {
          throw new AppError({
            code: ERROR_CODES.SALES_FULFILLMENT_EMPTY,
            message: SALES_ERROR_MESSAGES.SALES_FULFILLMENT_EMPTY,
            statusCode: 400,
          });
        }

        // Pending DRAFT fulfillment qty counts against fulfillable.
        const draftFuls = await tx.salesFulfillment.findMany({
          where: {
            companyId: company.companyId,
            salesOrderId: order.id,
            status: SalesFulfillmentStatus.DRAFT,
          },
          include: { items: true },
        });
        const pendingByItem = new Map<string, number>();
        for (const draft of draftFuls) {
          for (const line of draft.items) {
            pendingByItem.set(
              line.salesOrderItemId,
              (pendingByItem.get(line.salesOrderItemId) ?? 0) + line.quantity,
            );
          }
        }

        const resolved = [];
        for (const line of dto.items) {
          const orderItem = order.items.find((i) => i.id === line.salesOrderItemId);
          if (!orderItem || orderItem.skuId !== line.skuId) {
            throw new AppError({
              code: ERROR_CODES.SALES_FULFILLMENT_ITEM_INVALID,
              message: SALES_ERROR_MESSAGES.SALES_FULFILLMENT_ITEM_INVALID,
              statusCode: 400,
            });
          }
          if (line.classification && line.classification !== StockClassification.SELLABLE) {
            throw new AppError({
              code: ERROR_CODES.SALES_FULFILLMENT_ITEM_INVALID,
              message: 'Sales fulfillment items must be SELLABLE.',
              statusCode: 400,
            });
          }
          await this.validatePickDimensions(
            tx,
            company.companyId,
            dto.warehouseId,
            line,
          );
          const fulfillable = fulfillableQuantity(orderItem);
          const pending = pendingByItem.get(orderItem.id) ?? 0;
          if (line.quantity > fulfillable - pending) {
            throw new AppError({
              code: ERROR_CODES.SALES_FULFILLMENT_QUANTITY_EXCEEDS_FULFILLABLE,
              message: SALES_ERROR_MESSAGES.SALES_FULFILLMENT_QUANTITY_EXCEEDS_FULFILLABLE,
              statusCode: 400,
            });
          }
          pendingByItem.set(orderItem.id, pending + line.quantity);
          resolved.push(line);
        }

        const seq = await allocateSalesFulfillmentSequence(tx, company.companyId);
        const fulfillmentNumber = formatSalesFulfillmentNumber(seq);
        const header = await tx.salesFulfillment.create({
          data: {
            companyId: company.companyId,
            fulfillmentNumber,
            salesOrderId: order.id,
            warehouseId: dto.warehouseId,
            status: SalesFulfillmentStatus.DRAFT,
            notes: this.normalizeNotes(dto.notes),
            requestId: dto.requestId ?? null,
            createdById: actorUserId,
          },
          select: { id: true },
        });

        const base = Date.now();
        await tx.salesFulfillmentItem.createMany({
          data: resolved.map((line, index) => ({
            createdAt: new Date(base + index),
            companyId: company.companyId,
            salesFulfillmentId: header.id,
            salesOrderItemId: line.salesOrderItemId,
            skuId: line.skuId,
            warehouseId: dto.warehouseId,
            locationId: line.locationId,
            batchId: line.batchId,
            classification: StockClassification.SELLABLE,
            quantity: line.quantity,
            notes: line.notes?.trim() || null,
          })),
        });

        const row = await this.requireFulfillment(company.companyId, header.id, tx);
        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.SALES_FULFILLMENT_CREATED,
          entityType: AUDIT_ENTITY_TYPES.SALES_FULFILLMENT,
          entityId: row.id,
          before: null,
          after: {
            fulfillmentNumber: row.fulfillmentNumber,
            salesOrderId: row.salesOrderId,
            status: row.status,
          },
        });
        return row;
      }, TX_OPTIONS);

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.SALES_FULFILLMENT_CREATED,
          payload: {
            companyId: company.companyId,
            salesFulfillmentId: created.id,
            fulfillmentNumber: created.fulfillmentNumber,
            salesOrderId: created.salesOrderId,
            status: created.status,
          },
        }),
      );
      return this.toView(created);
    });
  }

  async complete(company: CompanyContext, fulfillmentId: string): Promise<SalesFulfillmentView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const completed = await this.database.client.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT id FROM sales_fulfillments
          WHERE id = ${fulfillmentId}::uuid AND company_id = ${company.companyId}::uuid
          FOR UPDATE
        `;
        const current = await this.requireFulfillment(company.companyId, fulfillmentId, tx);
        if (current.status === SalesFulfillmentStatus.COMPLETED) {
          return current;
        }
        if (current.status !== SalesFulfillmentStatus.DRAFT) {
          throw new AppError({
            code: ERROR_CODES.SALES_FULFILLMENT_INVALID_STATUS,
            message: SALES_ERROR_MESSAGES.SALES_FULFILLMENT_INVALID_STATUS,
            statusCode: 409,
          });
        }
        if (current.items.length === 0) {
          throw new AppError({
            code: ERROR_CODES.SALES_FULFILLMENT_EMPTY,
            message: SALES_ERROR_MESSAGES.SALES_FULFILLMENT_EMPTY,
            statusCode: 409,
          });
        }

        const order = await tx.salesOrder.findFirst({
          where: { id: current.salesOrderId, companyId: company.companyId },
          include: { items: true },
        });
        if (!order) {
          throw new AppError({
            code: ERROR_CODES.SALES_ORDER_NOT_FOUND,
            message: SALES_ERROR_MESSAGES.SALES_ORDER_NOT_FOUND,
            statusCode: 404,
          });
        }

        // Re-validate fulfillable against current trackers.
        const qtyByItem = new Map<string, number>();
        for (const item of current.items) {
          qtyByItem.set(
            item.salesOrderItemId,
            (qtyByItem.get(item.salesOrderItemId) ?? 0) + item.quantity,
          );
        }
        for (const [orderItemId, qty] of qtyByItem) {
          const orderItem = order.items.find((i) => i.id === orderItemId);
          if (!orderItem) {
            throw new AppError({
              code: ERROR_CODES.SALES_FULFILLMENT_ITEM_INVALID,
              message: SALES_ERROR_MESSAGES.SALES_FULFILLMENT_ITEM_INVALID,
              statusCode: 400,
            });
          }
          if (qty > fulfillableQuantity(orderItem)) {
            throw new AppError({
              code: ERROR_CODES.SALES_FULFILLMENT_QUANTITY_EXCEEDS_FULFILLABLE,
              message: SALES_ERROR_MESSAGES.SALES_FULFILLMENT_QUANTITY_EXCEEDS_FULFILLABLE,
              statusCode: 409,
            });
          }
        }

        const occurredAt = new Date();
        const posts: PostMovementInput[] = current.items.map((item) => ({
          warehouseId: current.warehouseId,
          locationId: item.locationId,
          skuId: item.skuId,
          batchId: item.batchId,
          classification: StockClassification.SELLABLE,
          movementType: InventoryMovementType.ISSUE,
          quantityDelta: -item.quantity,
          sourceType: InventorySourceType.SALES_FULFILLMENT,
          sourceId: current.id,
          sourceLineId: item.id,
          occurredAt,
          actorUserId,
          notes: `FUL complete ${current.fulfillmentNumber}`,
        }));

        // Consume reservations first (frees availability accounting), then post ISSUE.
        // Prefer reservations whose sourceLineId matches the fulfillment line.
        const byLine = new Map<string, { skuId: string; qty: number }>();
        for (const item of current.items) {
          const prev = byLine.get(item.salesOrderItemId);
          byLine.set(item.salesOrderItemId, {
            skuId: item.skuId,
            qty: (prev?.qty ?? 0) + item.quantity,
          });
        }

        const unreservedBySku = new Map<string, number>();
        for (const [orderItemId, { skuId, qty }] of byLine) {
          const reservations = await tx.inventoryReservation.findMany({
            where: {
              companyId: company.companyId,
              skuId,
              sourceType: InventoryReservationSourceType.SALES_ORDER,
              sourceId: order.id,
              sourceLineId: orderItemId,
              status: InventoryReservationStatus.ACTIVE,
            },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          });
          reservations.sort((a, b) => {
            const aSame = a.warehouseId === current.warehouseId ? 0 : 1;
            const bSame = b.warehouseId === current.warehouseId ? 0 : 1;
            return aSame - bSame;
          });
          let remaining = qty;
          for (const reservation of reservations) {
            if (remaining <= 0) break;
            const consumeQty = Math.min(remaining, reservation.remainingQuantity);
            if (consumeQty > 0) {
              await this.inventoryReservations.consumeInTx(
                tx,
                company.companyId,
                { reservationId: reservation.id, quantity: consumeQty },
                events,
              );
              remaining -= consumeQty;
            }
          }
          if (remaining > 0) {
            unreservedBySku.set(skuId, (unreservedBySku.get(skuId) ?? 0) + remaining);
          }
        }
        for (const [skuId, qty] of unreservedBySku) {
          await this.inventoryReservations.assertUnreservedSellableOutboundInTx(
            tx,
            company.companyId,
            current.warehouseId,
            [{ skuId, quantity: qty }],
          );
        }

        await this.inventoryLedger.postMovementsInTx(tx, company.companyId, posts, {
          recordAudit: true,
        });

        for (const [orderItemId, qty] of qtyByItem) {
          const orderItem = order.items.find((i) => i.id === orderItemId)!;
          await tx.salesOrderItem.update({
            where: { id: orderItemId },
            data: { fulfilledQuantity: orderItem.fulfilledQuantity + qty },
          });
        }

        // Trim ACTIVE reservations that now exceed open remaining on each line.
        const itemsAfterFulfill = await tx.salesOrderItem.findMany({
          where: { salesOrderId: order.id, companyId: company.companyId },
        });
        for (const item of itemsAfterFulfill) {
          const open = Math.max(
            0,
            item.quantity - item.cancelledQuantity - item.fulfilledQuantity,
          );
          const active = await tx.inventoryReservation.findMany({
            where: {
              companyId: company.companyId,
              sourceType: InventoryReservationSourceType.SALES_ORDER,
              sourceId: order.id,
              sourceLineId: item.id,
              status: InventoryReservationStatus.ACTIVE,
            },
          });
          let reserved = active.reduce((s, r) => s + r.remainingQuantity, 0);
          for (const reservation of active) {
            if (reserved <= open) break;
            const excess = reserved - open;
            const releaseQty = Math.min(excess, reservation.remainingQuantity);
            if (releaseQty > 0) {
              await this.inventoryReservations.releaseInTx(
                tx,
                company.companyId,
                { reservationId: reservation.id, quantity: releaseQty },
                events,
              );
              reserved -= releaseQty;
            }
          }
        }

        await tx.salesFulfillment.update({
          where: { id: current.id },
          data: {
            status: SalesFulfillmentStatus.COMPLETED,
            completedAt: occurredAt,
            completedById: actorUserId,
            version: { increment: 1 },
          },
        });

        const refreshedItems = await tx.salesOrderItem.findMany({
          where: { salesOrderId: order.id, companyId: company.companyId },
        });
        const nextLifecycle = deriveFulfillmentLifecycleStatus(refreshedItems);
        if (nextLifecycle === 'FULFILLED' || nextLifecycle === 'PARTIALLY_FULFILLED' || nextLifecycle === 'PROCESSING') {
          const target =
            nextLifecycle === 'FULFILLED'
              ? SalesOrderStatus.FULFILLED
              : nextLifecycle === 'PARTIALLY_FULFILLED'
                ? SalesOrderStatus.PARTIALLY_FULFILLED
                : SalesOrderStatus.PROCESSING;
          if (order.status !== target) {
            assertSalesOrderTransition(order.status, target);
            await tx.salesOrder.update({
              where: { id: order.id },
              data: { status: target },
            });
          }
          if (target === SalesOrderStatus.FULFILLED) {
            // Safety net: no ACTIVE reservation may remain on a fully fulfilled order.
            const leftover = await tx.inventoryReservation.findMany({
              where: {
                companyId: company.companyId,
                sourceType: InventoryReservationSourceType.SALES_ORDER,
                sourceId: order.id,
                status: InventoryReservationStatus.ACTIVE,
              },
              select: { id: true },
            });
            for (const reservation of leftover) {
              await this.inventoryReservations.releaseInTx(
                tx,
                company.companyId,
                { reservationId: reservation.id },
                events,
              );
            }
          }
        }

        await this.customerReceivables.recognizeFromFulfillmentInTx(
          tx,
          {
            companyId: company.companyId,
            actorUserId,
            salesFulfillmentId: current.id,
          },
          events,
        );

        const row = await this.requireFulfillment(company.companyId, current.id, tx);
        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.SALES_FULFILLMENT_COMPLETED,
          entityType: AUDIT_ENTITY_TYPES.SALES_FULFILLMENT,
          entityId: row.id,
          before: { status: SalesFulfillmentStatus.DRAFT },
          after: { status: SalesFulfillmentStatus.COMPLETED, itemCount: row.items.length },
        });
        return row;
      }, TX_OPTIONS);

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.SALES_FULFILLMENT_COMPLETED,
          payload: {
            companyId: company.companyId,
            salesFulfillmentId: completed.id,
            fulfillmentNumber: completed.fulfillmentNumber,
            salesOrderId: completed.salesOrderId,
            status: completed.status,
          },
        }),
      );
      return this.toView(completed);
    });
  }

  async cancel(company: CompanyContext, fulfillmentId: string): Promise<SalesFulfillmentView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const cancelled = await this.database.client.$transaction(async (tx) => {
        const current = await this.requireFulfillment(company.companyId, fulfillmentId, tx);
        if (current.status === SalesFulfillmentStatus.CANCELLED) return current;
        if (current.status !== SalesFulfillmentStatus.DRAFT) {
          throw new AppError({
            code: ERROR_CODES.SALES_FULFILLMENT_NOT_EDITABLE,
            message: SALES_ERROR_MESSAGES.SALES_FULFILLMENT_NOT_EDITABLE,
            statusCode: 409,
          });
        }
        await tx.salesFulfillment.update({
          where: { id: current.id },
          data: {
            status: SalesFulfillmentStatus.CANCELLED,
            cancelledAt: new Date(),
            cancelledById: actorUserId,
            version: { increment: 1 },
          },
        });
        const row = await this.requireFulfillment(company.companyId, current.id, tx);
        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.SALES_FULFILLMENT_CANCELLED,
          entityType: AUDIT_ENTITY_TYPES.SALES_FULFILLMENT,
          entityId: row.id,
          before: { status: SalesFulfillmentStatus.DRAFT },
          after: { status: SalesFulfillmentStatus.CANCELLED },
        });
        return row;
      }, TX_OPTIONS);

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.SALES_FULFILLMENT_CANCELLED,
          payload: {
            companyId: company.companyId,
            salesFulfillmentId: cancelled.id,
            fulfillmentNumber: cancelled.fulfillmentNumber,
            salesOrderId: cancelled.salesOrderId,
            status: cancelled.status,
          },
        }),
      );
      return this.toView(cancelled);
    });
  }

  private async validatePickDimensions(
    tx: Prisma.TransactionClient,
    companyId: string,
    warehouseId: string,
    line: { skuId: string; locationId: string; batchId: string; quantity: number },
  ): Promise<void> {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new AppError({
        code: ERROR_CODES.SALES_FULFILLMENT_ITEM_INVALID,
        message: SALES_ERROR_MESSAGES.SALES_FULFILLMENT_ITEM_INVALID,
        statusCode: 400,
      });
    }
    const location = await tx.warehouseLocation.findFirst({
      where: { id: line.locationId, companyId },
    });
    if (!location || location.warehouseId !== warehouseId) {
      throw new AppError({
        code: ERROR_CODES.SALES_FULFILLMENT_ITEM_INVALID,
        message: 'Fulfillment location must belong to the fulfillment warehouse.',
        statusCode: 400,
      });
    }
    const batch = await tx.batch.findFirst({
      where: { id: line.batchId, companyId },
    });
    if (!batch || batch.skuId !== line.skuId) {
      throw new AppError({
        code: ERROR_CODES.SALES_FULFILLMENT_ITEM_INVALID,
        message: 'Fulfillment batch must match the SKU.',
        statusCode: 400,
      });
    }
  }

  private async assertWarehouse(
    tx: Prisma.TransactionClient,
    companyId: string,
    warehouseId: string,
  ): Promise<void> {
    const wh = await tx.warehouse.findFirst({ where: { id: warehouseId, companyId } });
    if (!wh || wh.status !== WarehouseStatus.ACTIVE || wh.isSystem) {
      throw new AppError({
        code: ERROR_CODES.SALES_FULFILLMENT_WAREHOUSE_INVALID,
        message: SALES_ERROR_MESSAGES.SALES_FULFILLMENT_WAREHOUSE_INVALID,
        statusCode: 409,
      });
    }
  }

  private async requireFulfillment(
    companyId: string,
    id: string,
    client: Prisma.TransactionClient | DatabaseService['client'] = this.database.client,
  ): Promise<DetailRow> {
    const row = await client.salesFulfillment.findFirst({
      where: { id, companyId },
      include: detailInclude,
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.SALES_FULFILLMENT_NOT_FOUND,
        message: SALES_ERROR_MESSAGES.SALES_FULFILLMENT_NOT_FOUND,
        statusCode: 404,
      });
    }
    return row;
  }

  private toView(row: DetailRow): SalesFulfillmentView {
    return {
      id: row.id,
      companyId: row.companyId,
      fulfillmentNumber: row.fulfillmentNumber,
      salesOrderId: row.salesOrderId,
      warehouseId: row.warehouseId,
      status: row.status,
      notes: row.notes,
      requestId: row.requestId,
      completedAt: row.completedAt,
      cancelledAt: row.cancelledAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      createdById: row.createdById,
      version: row.version,
      warehouse: row.warehouse,
      salesOrder: row.salesOrder,
      createdBy: {
        id: row.createdBy.id,
        displayName: `${row.createdBy.firstName} ${row.createdBy.lastName}`.trim(),
      },
      completedBy: row.completedBy
        ? {
            id: row.completedBy.id,
            displayName: `${row.completedBy.firstName} ${row.completedBy.lastName}`.trim(),
          }
        : null,
      items: row.items.map((item) => ({
        id: item.id,
        salesOrderItemId: item.salesOrderItemId,
        skuId: item.skuId,
        warehouseId: item.warehouseId,
        locationId: item.locationId,
        batchId: item.batchId,
        classification: item.classification,
        quantity: item.quantity,
        notes: item.notes,
        sku: item.sku,
        location: item.location,
        batch: item.batch,
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
    return trimmed.slice(0, SALES_FULFILLMENT_NOTES_MAX_LENGTH);
  }
}
