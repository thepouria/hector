import { Injectable } from '@nestjs/common';
import {
  InventoryReservationSourceType,
  InventoryReservationStatus,
  Prisma,
  SalesOrderStatus,
  WarehouseStatus,
} from '@hector/database';
import { randomUUID } from 'node:crypto';
import { ERROR_CODES } from '../../common/constants';
import { getRequestContext } from '../../common/context/request-context';
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
import { InventoryReservationsService } from '../warehouse/inventory-reservations.service';
import { reservableQuantity } from './sales-order-quantities';
import { assertSalesOrderTransition } from './sales-order-status';
import { SALES_ERROR_MESSAGES } from './sales.constants';

const TX_OPTIONS = { maxWait: 5_000, timeout: 30_000 } as const;

export type SalesReservationLineResult = {
  salesOrderItemId: string;
  skuId: string;
  requestedQuantity: number;
  reservedQuantity: number;
  reservationId: string | null;
  skippedReason: string | null;
};

export type SalesReserveOrderResult = {
  salesOrderId: string;
  warehouseId: string;
  orderStatus: SalesOrderStatus;
  lines: SalesReservationLineResult[];
  reservedLineCount: number;
  partial: boolean;
};

/**
 * Sales-order reservation orchestration (Phase 5.3).
 * Uses Warehouse InventoryReservationsService.createInTx / releaseInTx.
 * Partial reserve is allowed when available < requested.
 */
@Injectable()
export class SalesReservationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventBus: DomainEventBus,
    private readonly eventFactory: DomainEventFactory,
    private readonly inventoryReservations: InventoryReservationsService,
  ) {}

  async reserveOrder(
    company: CompanyContext,
    orderId: string,
    input?: { warehouseId?: string },
  ): Promise<SalesReserveOrderResult> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      return this.database.client.$transaction(async (tx) => {
        const order = await tx.salesOrder.findFirst({
          where: { id: orderId, companyId: company.companyId },
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
          order.status !== SalesOrderStatus.CONFIRMED &&
          order.status !== SalesOrderStatus.PROCESSING &&
          order.status !== SalesOrderStatus.PARTIALLY_FULFILLED
        ) {
          throw new AppError({
            code: ERROR_CODES.SALES_RESERVATION_ORDER_NOT_RESERVABLE,
            message: SALES_ERROR_MESSAGES.SALES_RESERVATION_ORDER_NOT_RESERVABLE,
            statusCode: 409,
          });
        }

        const warehouseId = await this.resolveWarehouseId(
          tx,
          company.companyId,
          input?.warehouseId,
        );

        const activeReservations = await tx.inventoryReservation.findMany({
          where: {
            companyId: company.companyId,
            sourceType: InventoryReservationSourceType.SALES_ORDER,
            sourceId: order.id,
            status: InventoryReservationStatus.ACTIVE,
          },
        });
        const reservedByLine = new Map<string, number>();
        for (const r of activeReservations) {
          reservedByLine.set(
            r.sourceLineId,
            (reservedByLine.get(r.sourceLineId) ?? 0) + r.remainingQuantity,
          );
        }

        const lines: SalesReservationLineResult[] = [];
        let reservedLineCount = 0;
        let anyShortfall = false;

        for (const item of order.items) {
          const need = reservableQuantity({
            quantity: item.quantity,
            cancelledQuantity: item.cancelledQuantity,
            fulfilledQuantity: item.fulfilledQuantity,
            returnedQuantity: item.returnedQuantity,
            reservedRemaining: reservedByLine.get(item.id) ?? 0,
          });
          if (need <= 0) {
            lines.push({
              salesOrderItemId: item.id,
              skuId: item.skuId,
              requestedQuantity: 0,
              reservedQuantity: 0,
              reservationId: null,
              skippedReason: 'NOTHING_TO_RESERVE',
            });
            continue;
          }

          // Lock availability before reading Available so concurrent reserveOrders
          // cannot oversubscribe the same SELLABLE pool.
          await this.inventoryReservations.lockAvailabilityScope(
            tx,
            company.companyId,
            warehouseId,
            item.skuId,
          );
          const availability = await this.inventoryReservations.computeAvailabilityInTx(
            tx,
            company.companyId,
            warehouseId,
            item.skuId,
          );
          const reserveQty = Math.min(need, availability.available);
          if (reserveQty <= 0) {
            anyShortfall = true;
            lines.push({
              salesOrderItemId: item.id,
              skuId: item.skuId,
              requestedQuantity: need,
              reservedQuantity: 0,
              reservationId: null,
              skippedReason: 'INSUFFICIENT_AVAILABLE',
            });
            continue;
          }
          if (reserveQty < need) anyShortfall = true;

          const existing = activeReservations.find((r) => r.sourceLineId === item.id);
          if (existing) {
            await tx.$queryRaw`
              SELECT id FROM inventory_reservations
              WHERE id = ${existing.id}::uuid AND company_id = ${company.companyId}::uuid
              FOR UPDATE
            `;
            const locked = await tx.inventoryReservation.findUniqueOrThrow({
              where: { id: existing.id },
            });
            const avail2 = await this.inventoryReservations.computeAvailabilityInTx(
              tx,
              company.companyId,
              warehouseId,
              item.skuId,
            );
            const delta = Math.min(reserveQty, avail2.available);
            if (delta > 0) {
              await tx.inventoryReservation.update({
                where: { id: existing.id },
                data: {
                  quantity: locked.quantity + delta,
                  remainingQuantity: locked.remainingQuantity + delta,
                  version: { increment: 1 },
                },
              });
              reservedLineCount += 1;
            }
            if (delta < need) anyShortfall = true;
            lines.push({
              salesOrderItemId: item.id,
              skuId: item.skuId,
              requestedQuantity: need,
              reservedQuantity: delta,
              reservationId: existing.id,
              skippedReason: delta < need ? (delta === 0 ? 'INSUFFICIENT_AVAILABLE' : 'PARTIAL') : null,
            });
            continue;
          }

          const created = await this.inventoryReservations.createInTx(
            tx,
            company.companyId,
            actorUserId,
            {
              warehouseId,
              skuId: item.skuId,
              quantity: reserveQty,
              sourceType: InventoryReservationSourceType.SALES_ORDER,
              sourceId: order.id,
              sourceLineId: item.id,
              requestId: randomUUID(),
            },
            events,
          );
          reservedLineCount += 1;
          lines.push({
            salesOrderItemId: item.id,
            skuId: item.skuId,
            requestedQuantity: need,
            reservedQuantity: reserveQty,
            reservationId: created.id,
            skippedReason: reserveQty < need ? 'PARTIAL' : null,
          });
        }

        let orderStatus = order.status;
        if (
          order.status === SalesOrderStatus.CONFIRMED &&
          reservedLineCount > 0
        ) {
          assertSalesOrderTransition(order.status, SalesOrderStatus.PROCESSING);
          await tx.salesOrder.update({
            where: { id: order.id },
            data: { status: SalesOrderStatus.PROCESSING },
          });
          orderStatus = SalesOrderStatus.PROCESSING;
        }

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.SALES_ORDER_RESERVED,
          entityType: AUDIT_ENTITY_TYPES.SALES_ORDER,
          entityId: order.id,
          before: { status: order.status },
          after: { status: orderStatus, warehouseId, reservedLineCount, partial: anyShortfall },
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.SALES_ORDER_RESERVED,
            payload: {
              companyId: company.companyId,
              salesOrderId: order.id,
              warehouseId,
              reservedLineCount,
              partial: anyShortfall,
              status: orderStatus,
            },
          }),
        );

        return {
          salesOrderId: order.id,
          warehouseId,
          orderStatus,
          lines,
          reservedLineCount,
          partial: anyShortfall,
        };
      }, TX_OPTIONS);
    });
  }

  async list(company: CompanyContext, orderId: string) {
    const order = await this.database.client.salesOrder.findFirst({
      where: { id: orderId, companyId: company.companyId },
      select: { id: true },
    });
    if (!order) {
      throw new AppError({
        code: ERROR_CODES.SALES_ORDER_NOT_FOUND,
        message: SALES_ERROR_MESSAGES.SALES_ORDER_NOT_FOUND,
        statusCode: 404,
      });
    }
    const rows = await this.database.client.inventoryReservation.findMany({
      where: {
        companyId: company.companyId,
        sourceType: InventoryReservationSourceType.SALES_ORDER,
        sourceId: orderId,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        warehouse: { select: { id: true, code: true, name: true } },
        sku: { select: { id: true, code: true, name: true } },
      },
    });
    return {
      data: rows.map((r) => ({
        id: r.id,
        warehouseId: r.warehouseId,
        skuId: r.skuId,
        sourceLineId: r.sourceLineId,
        quantity: r.quantity,
        remainingQuantity: r.remainingQuantity,
        status: r.status,
        requestId: r.requestId,
        createdAt: r.createdAt.toISOString(),
        warehouse: r.warehouse,
        sku: r.sku,
      })),
    };
  }

  async releaseAll(company: CompanyContext, orderId: string): Promise<{ releasedCount: number }> {
    return commitThenPublish(this.eventBus, async (events) => {
      return this.database.client.$transaction(async (tx) => {
        const count = await this.releaseAllInTx(tx, company.companyId, orderId, events);
        return { releasedCount: count };
      }, TX_OPTIONS);
    });
  }

  /** Used by cancel hooks inside an outer TX. */
  async releaseAllInTx(
    tx: Prisma.TransactionClient,
    companyId: string,
    salesOrderId: string,
    events: Array<ReturnType<DomainEventFactory['create']>>,
  ): Promise<number> {
    const active = await tx.inventoryReservation.findMany({
      where: {
        companyId,
        sourceType: InventoryReservationSourceType.SALES_ORDER,
        sourceId: salesOrderId,
        status: InventoryReservationStatus.ACTIVE,
      },
      select: { id: true },
    });
    for (const reservation of active) {
      await this.inventoryReservations.releaseInTx(
        tx,
        companyId,
        { reservationId: reservation.id },
        events,
      );
    }
    if (active.length > 0) {
      await this.auditService.record(tx, {
        action: AUDIT_ACTIONS.SALES_ORDER_RESERVATIONS_RELEASED,
        entityType: AUDIT_ENTITY_TYPES.SALES_ORDER,
        entityId: salesOrderId,
        before: null,
        after: { releasedCount: active.length },
      });
      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.SALES_ORDER_RESERVATIONS_RELEASED,
          payload: {
            companyId,
            salesOrderId,
            releasedCount: active.length,
          },
        }),
      );
    }
    return active.length;
  }

  /**
   * After partial item cancel: release excess ACTIVE reservation so
   * reservedRemaining ≤ openRemaining (ordered − cancelled − fulfilled).
   */
  async trimLineReservationsInTx(
    tx: Prisma.TransactionClient,
    companyId: string,
    salesOrderId: string,
    salesOrderItemId: string,
    maxRemaining: number,
    events: Array<ReturnType<DomainEventFactory['create']>>,
  ): Promise<void> {
    const active = await tx.inventoryReservation.findMany({
      where: {
        companyId,
        sourceType: InventoryReservationSourceType.SALES_ORDER,
        sourceId: salesOrderId,
        sourceLineId: salesOrderItemId,
        status: InventoryReservationStatus.ACTIVE,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const reserved = active.reduce((sum, row) => sum + row.remainingQuantity, 0);
    let excess = reserved - Math.max(0, maxRemaining);
    for (const reservation of active) {
      if (excess <= 0) break;
      const releaseQty = Math.min(excess, reservation.remainingQuantity);
      if (releaseQty <= 0) continue;
      await this.inventoryReservations.releaseInTx(
        tx,
        companyId,
        { reservationId: reservation.id, quantity: releaseQty },
        events,
      );
      excess -= releaseQty;
    }
  }

  private async resolveWarehouseId(
    tx: Prisma.TransactionClient,
    companyId: string,
    warehouseId?: string,
  ): Promise<string> {
    if (warehouseId) {
      const wh = await tx.warehouse.findFirst({
        where: { id: warehouseId, companyId },
      });
      if (!wh || wh.status !== WarehouseStatus.ACTIVE || wh.isSystem) {
        throw new AppError({
          code: ERROR_CODES.SALES_FULFILLMENT_WAREHOUSE_INVALID,
          message: SALES_ERROR_MESSAGES.SALES_FULFILLMENT_WAREHOUSE_INVALID,
          statusCode: 409,
        });
      }
      return wh.id;
    }
    const defaultWh = await tx.warehouse.findFirst({
      where: { companyId, status: WarehouseStatus.ACTIVE, isSystem: false },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (!defaultWh) {
      throw new AppError({
        code: ERROR_CODES.SALES_RESERVATION_WAREHOUSE_REQUIRED,
        message: SALES_ERROR_MESSAGES.SALES_RESERVATION_WAREHOUSE_REQUIRED,
        statusCode: 409,
      });
    }
    return defaultWh.id;
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
