import { Injectable } from '@nestjs/common';
import {
  Prisma,
  PurchaseDiscrepancySource,
  PurchaseDiscrepancyStatus,
  PurchaseDiscrepancyType,
  PurchaseOrderStatus,
} from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
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
import { PurchaseReceivingContract } from './contracts/purchase-receiving.contract';
import type { CreatePurchaseDiscrepancyDto } from './dto/create-purchase-discrepancy.dto';
import type { CloseRemainingPurchaseOrderItemDto } from './dto/close-remaining-purchase-order-item.dto';
import type { ShortClosePurchaseOrderItemDto } from './dto/short-close-purchase-order-item.dto';
import {
  PURCHASE_DISCREPANCY_ERROR_MESSAGES,
  PURCHASE_ORDER_ERROR_MESSAGES,
  PURCHASE_SHORT_CLOSE_ERROR_MESSAGES,
} from './purchasing.constants';
import { SuppliersService } from './suppliers.service';

const TX_OPTIONS = { maxWait: 5_000, timeout: 20_000 } as const;

const SHORT_CLOSE_ELIGIBLE: readonly PurchaseOrderStatus[] = [
  PurchaseOrderStatus.ORDERED,
  PurchaseOrderStatus.PARTIALLY_RECEIVED,
];

export type PurchaseDiscrepancyView = {
  id: string;
  companyId: string;
  purchaseOrderId: string;
  purchaseOrderItemId: string;
  type: PurchaseDiscrepancyType;
  source: PurchaseDiscrepancySource;
  status: PurchaseDiscrepancyStatus;
  quantity: number;
  reason: string;
  notes: string | null;
  createdBy: { id: string; displayName: string };
  resolvedBy: { id: string; displayName: string } | null;
  createdAt: Date;
  resolvedAt: Date | null;
};

@Injectable()
export class PurchaseDiscrepanciesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventBus: DomainEventBus,
    private readonly eventFactory: DomainEventFactory,
    private readonly suppliersService: SuppliersService,
    private readonly purchaseReceiving: PurchaseReceivingContract,
  ) {}

  async list(company: CompanyContext, purchaseOrderId: string): Promise<PurchaseDiscrepancyView[]> {
    const po = await this.database.client.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, companyId: company.companyId },
      select: { id: true },
    });
    if (!po) this.poNotFound();

    const rows = await this.database.client.purchaseDiscrepancy.findMany({
      where: { companyId: company.companyId, purchaseOrderId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        resolvedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    return rows.map((row) => this.toView(row));
  }

  async record(
    company: CompanyContext,
    purchaseOrderId: string,
    dto: CreatePurchaseDiscrepancyDto,
  ): Promise<PurchaseDiscrepancyView> {
    const actorUserId = this.suppliersService.requireActorUserId();
    const reason = dto.reason.trim();
    if (!reason) {
      throw new AppError({
        code: ERROR_CODES.PURCHASE_DISCREPANCY_INVALID,
        message: PURCHASE_DISCREPANCY_ERROR_MESSAGES.INVALID,
        statusCode: 400,
      });
    }

    return commitThenPublish(this.eventBus, async (events) => {
      const created = await this.database.client.$transaction(async (tx) => {
        const po = await tx.purchaseOrder.findFirst({
          where: { id: purchaseOrderId, companyId: company.companyId },
          select: { id: true, status: true },
        });
        if (!po) this.poNotFound();
        if (po.status === PurchaseOrderStatus.CANCELLED || po.status === PurchaseOrderStatus.DRAFT) {
          throw new AppError({
            code: ERROR_CODES.PURCHASE_DISCREPANCY_INVALID,
            message: `Discrepancies cannot be recorded for ${po.status} purchase orders.`,
            statusCode: 409,
          });
        }

        const item = await tx.purchaseOrderItem.findFirst({
          where: {
            id: dto.purchaseOrderItemId,
            purchaseOrderId,
            companyId: company.companyId,
          },
        });
        if (!item) {
          throw new AppError({
            code: ERROR_CODES.PURCHASE_ORDER_ITEM_NOT_FOUND,
            message: PURCHASE_ORDER_ERROR_MESSAGES.ITEM_NOT_FOUND,
            statusCode: 404,
          });
        }

        // Short shipment does NOT rewrite ordered quantity — record only.
        if (dto.type === PurchaseDiscrepancyType.SHORT_SHIPMENT && dto.quantity > item.quantity) {
          throw new AppError({
            code: ERROR_CODES.PURCHASE_DISCREPANCY_INVALID,
            message: 'Short-shipment quantity cannot exceed ordered quantity.',
            statusCode: 400,
          });
        }

        const row = await tx.purchaseDiscrepancy.create({
          data: {
            companyId: company.companyId,
            purchaseOrderId,
            purchaseOrderItemId: item.id,
            type: dto.type,
            source: dto.source,
            status: PurchaseDiscrepancyStatus.OPEN,
            quantity: dto.quantity,
            reason,
            notes: dto.notes?.trim() || null,
            createdById: actorUserId,
          },
          include: {
            createdBy: { select: { id: true, firstName: true, lastName: true } },
            resolvedBy: { select: { id: true, firstName: true, lastName: true } },
          },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.PURCHASE_DISCREPANCY_RECORDED,
          entityType: AUDIT_ENTITY_TYPES.PURCHASE_DISCREPANCY,
          entityId: row.id,
          before: null,
          after: this.snapshot(row) as AuditSnapshot,
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.PURCHASING_PURCHASE_DISCREPANCY_RECORDED,
            payload: {
              companyId: company.companyId,
              purchaseOrderId,
              discrepancyId: row.id,
              type: row.type,
              purchaseOrderItemId: item.id,
              quantity: row.quantity,
            },
          }),
        );

        return row;
      }, TX_OPTIONS);

      return this.toView(created);
    });
  }

  /**
   * Close all remaining expected quantity as short (server-computed under lock).
   */
  async closeRemaining(
    company: CompanyContext,
    purchaseOrderId: string,
    itemId: string,
    dto: CloseRemainingPurchaseOrderItemDto,
  ) {
    return this.shortClose(company, purchaseOrderId, itemId, {
      reason: dto.reason,
      notes: dto.notes,
      version: dto.version,
      // quantity omitted → close all remaining
    });
  }

  /**
   * Short-close remaining expected quantity on a PO line (Phase 3.5).
   *
   * Caps by ordered − POSTED received − already short.
   * Serializes with GRN post via PO FOR UPDATE.
   * Does NOT rewrite ordered quantity. Does NOT invent received quantity / stock.
   */
  async shortClose(
    company: CompanyContext,
    purchaseOrderId: string,
    itemId: string,
    dto: ShortClosePurchaseOrderItemDto,
  ): Promise<{
    item: {
      purchaseOrderItemId: string;
      orderedQuantity: number;
      receivedQuantity: number;
      shortQuantity: number;
      closedUnfulfilledQuantity: number;
      remainingQuantity: number;
    };
    discrepancy: PurchaseDiscrepancyView;
    purchaseOrderStatus: PurchaseOrderStatus;
    receivingOutcome: 'AWAITING' | 'PARTIAL' | 'FULLY_RECEIVED' | 'CLOSED_WITH_SHORTAGE';
  }> {
    const actorUserId = this.suppliersService.requireActorUserId();
    const reason = dto.reason.trim();
    if (!reason) {
      throw new AppError({
        code: ERROR_CODES.PURCHASE_SHORT_CLOSE_INVALID,
        message: PURCHASE_SHORT_CLOSE_ERROR_MESSAGES.INVALID,
        statusCode: 400,
      });
    }

    return commitThenPublish(this.eventBus, async (events) => {
      const result = await this.database.client.$transaction(async (tx) => {
        // Same serialization point as GRN post (WH-RECV-012).
        const locked = await tx.$queryRaw<
          Array<{ id: string; status: PurchaseOrderStatus; version: number }>
        >(Prisma.sql`
          SELECT id, status, version
          FROM purchase_orders
          WHERE id = ${purchaseOrderId}::uuid
            AND company_id = ${company.companyId}::uuid
          FOR UPDATE
        `);
        const po = locked[0];
        if (!po) this.poNotFound();
        if (dto.version !== undefined && po.version !== dto.version) {
          throw new AppError({
            code: ERROR_CODES.PURCHASE_ORDER_VERSION_CONFLICT,
            message: PURCHASE_ORDER_ERROR_MESSAGES.VERSION_CONFLICT,
            statusCode: 409,
          });
        }
        if (!SHORT_CLOSE_ELIGIBLE.includes(po.status)) {
          throw new AppError({
            code: ERROR_CODES.PURCHASE_SHORT_CLOSE_NOT_ALLOWED,
            message: `${PURCHASE_SHORT_CLOSE_ERROR_MESSAGES.NOT_ALLOWED} (status=${po.status})`,
            statusCode: 409,
          });
        }

        const item = await tx.purchaseOrderItem.findFirst({
          where: { id: itemId, purchaseOrderId, companyId: company.companyId },
        });
        if (!item) {
          throw new AppError({
            code: ERROR_CODES.PURCHASE_ORDER_ITEM_NOT_FOUND,
            message: PURCHASE_ORDER_ERROR_MESSAGES.ITEM_NOT_FOUND,
            statusCode: 404,
          });
        }

        const postedByItem = await this.purchaseReceiving.aggregatePostedReceivedQuantities(
          company.companyId,
          purchaseOrderId,
          tx,
        );
        const postedReceived = postedByItem.get(item.id) ?? 0;
        const remainingExpected = item.quantity - postedReceived - item.closedUnfulfilledQuantity;
        if (remainingExpected <= 0) {
          throw new AppError({
            code: ERROR_CODES.PURCHASE_SHORT_CLOSE_INVALID,
            message: `${PURCHASE_SHORT_CLOSE_ERROR_MESSAGES.INVALID} (remainingExpected=0)`,
            statusCode: 400,
          });
        }

        const closeQty = dto.quantity ?? remainingExpected;
        if (closeQty < 1 || closeQty > remainingExpected) {
          throw new AppError({
            code: ERROR_CODES.PURCHASE_SHORT_CLOSE_INVALID,
            message: `${PURCHASE_SHORT_CLOSE_ERROR_MESSAGES.INVALID} (remainingExpected=${remainingExpected})`,
            statusCode: 400,
          });
        }

        const nextClosed = item.closedUnfulfilledQuantity + closeQty;
        const updatedItem = await tx.purchaseOrderItem.update({
          where: { id: item.id },
          data: { closedUnfulfilledQuantity: nextClosed },
        });

        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: { version: { increment: 1 } },
        });

        const source =
          postedReceived > 0
            ? PurchaseDiscrepancySource.AT_RECEIPT
            : PurchaseDiscrepancySource.BEFORE_RECEIPT;

        const discrepancy = await tx.purchaseDiscrepancy.create({
          data: {
            companyId: company.companyId,
            purchaseOrderId,
            purchaseOrderItemId: item.id,
            type: PurchaseDiscrepancyType.SHORT_SHIPMENT,
            source,
            status: PurchaseDiscrepancyStatus.SHORT_CLOSED,
            quantity: closeQty,
            reason,
            notes: dto.notes?.trim() || null,
            createdById: actorUserId,
            resolvedById: actorUserId,
            resolvedAt: new Date(),
          },
          include: {
            createdBy: { select: { id: true, firstName: true, lastName: true } },
            resolvedBy: { select: { id: true, firstName: true, lastName: true } },
          },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.PURCHASE_ORDER_SHORT_CLOSED,
          entityType: AUDIT_ENTITY_TYPES.PURCHASE_DISCREPANCY,
          entityId: discrepancy.id,
          before: {
            purchaseOrderItemId: item.id,
            orderedQuantity: item.quantity,
            receivedQuantity: postedReceived,
            closedUnfulfilledQuantity: item.closedUnfulfilledQuantity,
          } as AuditSnapshot,
          after: {
            purchaseOrderItemId: item.id,
            orderedQuantity: item.quantity,
            receivedQuantity: postedReceived,
            closedUnfulfilledQuantity: updatedItem.closedUnfulfilledQuantity,
            shortClosedDelta: closeQty,
            remainingQuantity: item.quantity - postedReceived - updatedItem.closedUnfulfilledQuantity,
            reason,
          } as AuditSnapshot,
        });

        // Recalculate PO receiving status from posted evidence + updated short.
        // applyPostedReceivingEvidence re-locks the same PO row (safe in this tx).
        const acceptedReceived = [...postedByItem.entries()].map(
          ([purchaseOrderItemId, acceptedReceivedQuantity]) => ({
            purchaseOrderItemId,
            acceptedReceivedQuantity,
          }),
        );
        // Include zero-receipt lines so derivation sees all items via ordered load.
        const receivingResult = await this.purchaseReceiving.applyPostedReceivingEvidence(tx, {
          companyId: company.companyId,
          purchaseOrderId,
          acceptedReceived,
          source: 'purchase_short_close',
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_SHORT_CLOSED,
            payload: {
              companyId: company.companyId,
              purchaseOrderId,
              purchaseOrderItemId: item.id,
              discrepancyId: discrepancy.id,
              shortClosedQuantity: closeQty,
              closedUnfulfilledQuantity: updatedItem.closedUnfulfilledQuantity,
              orderedQuantity: item.quantity,
            },
          }),
        );

        if (receivingResult.previousStatus !== receivingResult.newStatus) {
          const poMeta = await tx.purchaseOrder.findFirstOrThrow({
            where: { id: purchaseOrderId, companyId: company.companyId },
            select: {
              number: true,
              supplierId: true,
              currency: true,
              purchaseType: true,
              total: true,
              version: true,
              _count: { select: { items: true } },
            },
          });
          const transitionPayload = {
            companyId: company.companyId,
            purchaseOrderId,
            number: poMeta.number,
            supplierId: poMeta.supplierId,
            status: receivingResult.newStatus,
            currency: poMeta.currency,
            previousStatus: receivingResult.previousStatus,
            purchaseType: poMeta.purchaseType,
            total: poMeta.total.toString(),
            itemCount: poMeta._count.items,
            version: receivingResult.purchaseOrderVersion,
          };
          if (receivingResult.newStatus === PurchaseOrderStatus.PARTIALLY_RECEIVED) {
            events.push(
              this.eventFactory.create({
                type: DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_PARTIALLY_RECEIVED,
                payload: transitionPayload,
              }),
            );
          }
          if (receivingResult.newStatus === PurchaseOrderStatus.RECEIVED) {
            events.push(
              this.eventFactory.create({
                type: DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_RECEIVED,
                payload: transitionPayload,
              }),
            );
          }
        }

        const remainingAfter =
          item.quantity - postedReceived - updatedItem.closedUnfulfilledQuantity;

        // Determine outcome after this close (item-level + PO).
        const allItems = await tx.purchaseOrderItem.findMany({
          where: { purchaseOrderId, companyId: company.companyId },
          select: { id: true, quantity: true, closedUnfulfilledQuantity: true },
        });
        let anyRemaining = false;
        let anyShort = false;
        for (const line of allItems) {
          const recv = postedByItem.get(line.id) ?? 0;
          const short = line.closedUnfulfilledQuantity;
          if (short > 0) anyShort = true;
          if (line.quantity - recv - short > 0) anyRemaining = true;
        }
        let receivingOutcome: 'AWAITING' | 'PARTIAL' | 'FULLY_RECEIVED' | 'CLOSED_WITH_SHORTAGE' =
          'AWAITING';
        if (!anyRemaining) {
          receivingOutcome = anyShort ? 'CLOSED_WITH_SHORTAGE' : 'FULLY_RECEIVED';
        } else if (postedReceived > 0 || anyShort || closeQty > 0) {
          receivingOutcome = 'PARTIAL';
        }

        return {
          item: {
            purchaseOrderItemId: updatedItem.id,
            orderedQuantity: updatedItem.quantity,
            receivedQuantity: postedReceived,
            shortQuantity: updatedItem.closedUnfulfilledQuantity,
            closedUnfulfilledQuantity: updatedItem.closedUnfulfilledQuantity,
            remainingQuantity: remainingAfter,
          },
          discrepancy: this.toView(discrepancy),
          purchaseOrderStatus: receivingResult.newStatus,
          receivingOutcome,
        };
      }, TX_OPTIONS);

      return result;
    });
  }

  private snapshot(row: {
    id: string;
    purchaseOrderId: string;
    purchaseOrderItemId: string;
    type: PurchaseDiscrepancyType;
    source: PurchaseDiscrepancySource;
    status: PurchaseDiscrepancyStatus;
    quantity: number;
    reason: string;
  }): Record<string, unknown> {
    return {
      id: row.id,
      purchaseOrderId: row.purchaseOrderId,
      purchaseOrderItemId: row.purchaseOrderItemId,
      type: row.type,
      source: row.source,
      status: row.status,
      quantity: row.quantity,
      reason: row.reason,
    };
  }

  private toView(row: {
    id: string;
    companyId: string;
    purchaseOrderId: string;
    purchaseOrderItemId: string;
    type: PurchaseDiscrepancyType;
    source: PurchaseDiscrepancySource;
    status: PurchaseDiscrepancyStatus;
    quantity: number;
    reason: string;
    notes: string | null;
    createdAt: Date;
    resolvedAt: Date | null;
    createdBy: { id: string; firstName: string; lastName: string };
    resolvedBy: { id: string; firstName: string; lastName: string } | null;
  }): PurchaseDiscrepancyView {
    const user = (u: { id: string; firstName: string; lastName: string }) => ({
      id: u.id,
      displayName: `${u.firstName} ${u.lastName}`.trim(),
    });
    return {
      id: row.id,
      companyId: row.companyId,
      purchaseOrderId: row.purchaseOrderId,
      purchaseOrderItemId: row.purchaseOrderItemId,
      type: row.type,
      source: row.source,
      status: row.status,
      quantity: row.quantity,
      reason: row.reason,
      notes: row.notes,
      createdBy: user(row.createdBy),
      resolvedBy: row.resolvedBy ? user(row.resolvedBy) : null,
      createdAt: row.createdAt,
      resolvedAt: row.resolvedAt,
    };
  }

  private poNotFound(): never {
    throw new AppError({
      code: ERROR_CODES.PURCHASE_ORDER_NOT_FOUND,
      message: PURCHASE_ORDER_ERROR_MESSAGES.NOT_FOUND,
      statusCode: 404,
    });
  }
}
