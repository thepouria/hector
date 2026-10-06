import { Injectable } from '@nestjs/common';
import {
  GoodsReceiptStatus,
  Prisma,
  PurchaseDiscrepancyStatus,
  PurchaseOrderStatus,
} from '@hector/database';
import { ERROR_CODES } from '../../../common/constants';
import { AppError } from '../../../common/exceptions/app.error';
import { DatabaseService } from '../../../infrastructure/database/database.service';
import type { CompanyContext } from '../../companies/types/company.types';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../../audit/audit.constants';
import { AuditService } from '../../audit/audit.service';
import { PURCHASE_ORDER_ERROR_MESSAGES } from '../purchasing.constants';
import { PurchaseReceivingContract } from './purchase-receiving.contract';
import {
  assertCanApplyReceivingSummaryTransition,
  assertPurchaseReceivingAllowed,
  derivePurchaseReceivingStatus,
} from './purchase-receiving.policy';
import type {
  AcceptedReceivedLine,
  OrderedReceivingLine,
  PurchaseReceivingContext,
  PurchaseReceivingProgressItem,
  PurchaseReceivingProgressView,
  PurchaseReceivingSummaryStatus,
} from './purchase-receiving.types';
import {
  deriveItemReceivingStatus,
  deriveReceivingOutcome,
} from './purchase-receiving.types';

/**
 * Purchasing-side receiving contract implementation (Phase 2.10 + 3.4 apply + 3.5 progress).
 *
 * Not exposed on any HTTP controller directly — Warehouse / discrepancies inject this port.
 */
@Injectable()
export class PurchaseReceivingService extends PurchaseReceivingContract {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
  ) {
    super();
  }

  async getReceivingContext(
    company: CompanyContext,
    purchaseOrderId: string,
  ): Promise<PurchaseReceivingContext> {
    return this.loadContext(company.companyId, purchaseOrderId);
  }

  async assertReceivingAllowed(
    company: CompanyContext,
    purchaseOrderId: string,
  ): Promise<PurchaseReceivingContext> {
    const context = await this.loadContext(company.companyId, purchaseOrderId);
    assertPurchaseReceivingAllowed(context.status);
    return context;
  }

  recalculateReceivingStatus(
    orderedLines: readonly OrderedReceivingLine[],
    acceptedReceived: readonly AcceptedReceivedLine[],
  ): PurchaseReceivingSummaryStatus {
    return derivePurchaseReceivingStatus(orderedLines, acceptedReceived);
  }

  async applyPostedReceivingEvidence(
    tx: Prisma.TransactionClient,
    input: {
      companyId: string;
      purchaseOrderId: string;
      acceptedReceived: readonly AcceptedReceivedLine[];
      /** Audit metadata source (default goods_receipt_post). */
      source?: string;
    },
  ): Promise<{
    previousStatus: PurchaseOrderStatus;
    newStatus: PurchaseReceivingSummaryStatus;
    purchaseOrderVersion: number;
  }> {
    // Serialize concurrent posts / short-close / cancel against the same PO.
    const locked = await tx.$queryRaw<
      Array<{
        id: string;
        status: PurchaseOrderStatus;
        version: number;
      }>
    >(Prisma.sql`
      SELECT id, status, version
      FROM purchase_orders
      WHERE id = ${input.purchaseOrderId}::uuid
        AND company_id = ${input.companyId}::uuid
      FOR UPDATE
    `);

    const po = locked[0];
    if (!po) {
      throw new AppError({
        code: ERROR_CODES.PURCHASE_ORDER_NOT_FOUND,
        message: PURCHASE_ORDER_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }

    assertPurchaseReceivingAllowed(po.status);

    const items = await tx.purchaseOrderItem.findMany({
      where: { purchaseOrderId: po.id, companyId: input.companyId },
      select: {
        id: true,
        quantity: true,
        closedUnfulfilledQuantity: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    const orderedLines: OrderedReceivingLine[] = items.map((item) => ({
      purchaseOrderItemId: item.id,
      orderedQuantity: item.quantity,
      closedUnfulfilledQuantity: item.closedUnfulfilledQuantity,
    }));

    const newStatus = derivePurchaseReceivingStatus(orderedLines, input.acceptedReceived);
    assertCanApplyReceivingSummaryTransition(po.status, newStatus);

    if (po.status === newStatus) {
      return {
        previousStatus: po.status,
        newStatus,
        purchaseOrderVersion: po.version,
      };
    }

    const updated = await tx.purchaseOrder.update({
      where: { id: po.id },
      data: {
        status: newStatus,
        version: { increment: 1 },
      },
      select: { id: true, status: true, version: true, number: true },
    });

    const auditAction =
      newStatus === PurchaseOrderStatus.RECEIVED
        ? AUDIT_ACTIONS.PURCHASE_ORDER_RECEIVED
        : AUDIT_ACTIONS.PURCHASE_ORDER_PARTIALLY_RECEIVED;

    await this.auditService.record(tx, {
      action: auditAction,
      entityType: AUDIT_ENTITY_TYPES.PURCHASE_ORDER,
      entityId: updated.id,
      before: { status: po.status, version: po.version },
      after: { status: updated.status, version: updated.version },
      metadata: {
        companyId: input.companyId,
        purchaseOrderNumber: updated.number,
        source: input.source ?? 'goods_receipt_post',
      },
    });

    return {
      previousStatus: po.status,
      newStatus: updated.status as PurchaseReceivingSummaryStatus,
      purchaseOrderVersion: updated.version,
    };
  }

  async hasPostedReceivingEvidence(
    companyId: string,
    purchaseOrderId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const client = tx ?? this.database.client;
    const count = await client.goodsReceipt.count({
      where: {
        companyId,
        purchaseOrderId,
        status: 'POSTED',
      },
    });
    return count > 0;
  }

  async aggregatePostedReceivedQuantities(
    companyId: string,
    purchaseOrderId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Map<string, number>> {
    const client = tx ?? this.database.client;
    const rows = await client.goodsReceiptItem.groupBy({
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

  async getReceivingProgress(
    company: CompanyContext,
    purchaseOrderId: string,
  ): Promise<PurchaseReceivingProgressView> {
    const po = await this.database.client.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, companyId: company.companyId },
      select: {
        id: true,
        number: true,
        status: true,
        supplierId: true,
        supplier: { select: { name: true } },
        items: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            skuId: true,
            quantity: true,
            closedUnfulfilledQuantity: true,
            skuCodeSnapshot: true,
            productNameSnapshot: true,
            sku: { select: { code: true, product: { select: { name: true } } } },
          },
        },
      },
    });
    if (!po) {
      throw new AppError({
        code: ERROR_CODES.PURCHASE_ORDER_NOT_FOUND,
        message: PURCHASE_ORDER_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }

    const [postedByPoItem, receipts, shortageRows] = await Promise.all([
      this.aggregatePostedReceivedQuantities(company.companyId, purchaseOrderId),
      this.database.client.goodsReceipt.findMany({
        where: { companyId: company.companyId, purchaseOrderId },
        orderBy: [{ createdAt: 'desc' }, { number: 'desc' }],
        select: {
          id: true,
          number: true,
          status: true,
          receivedAt: true,
          postedAt: true,
          items: { select: { quantity: true } },
        },
      }),
      this.database.client.purchaseDiscrepancy.findMany({
        where: {
          companyId: company.companyId,
          purchaseOrderId,
          status: PurchaseDiscrepancyStatus.SHORT_CLOSED,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          purchaseOrderItemId: true,
          quantity: true,
          reason: true,
          notes: true,
          resolvedAt: true,
          resolvedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
    ]);

    const items: PurchaseReceivingProgressItem[] = po.items.map((item) => {
      const received = postedByPoItem.get(item.id) ?? 0;
      const short = item.closedUnfulfilledQuantity;
      const remaining = Math.max(0, item.quantity - received - short);
      return {
        purchaseOrderItemId: item.id,
        skuId: item.skuId,
        skuCode: item.skuCodeSnapshot ?? item.sku.code,
        productName: item.productNameSnapshot ?? item.sku.product.name,
        orderedQuantity: item.quantity,
        receivedQuantity: received,
        postedReceivedQuantity: received,
        shortQuantity: short,
        closedUnfulfilledQuantity: short,
        remainingQuantity: remaining,
        receivingStatus: deriveItemReceivingStatus({
          orderedQuantity: item.quantity,
          receivedQuantity: received,
          shortQuantity: short,
          remainingQuantity: remaining,
        }),
      };
    });

    const { progress, receivingOutcome, hasShortage } = deriveReceivingOutcome(items);
    const totals = items.reduce(
      (acc, item) => {
        acc.orderedQuantity += item.orderedQuantity;
        acc.receivedQuantity += item.receivedQuantity;
        acc.shortQuantity += item.shortQuantity;
        acc.remainingQuantity += item.remainingQuantity;
        return acc;
      },
      { orderedQuantity: 0, receivedQuantity: 0, shortQuantity: 0, remainingQuantity: 0 },
    );

    return {
      purchaseOrderId: po.id,
      purchaseOrderNumber: po.number,
      status: po.status,
      supplierId: po.supplierId,
      supplierName: po.supplier.name,
      progress,
      receivingOutcome,
      hasShortage,
      totals,
      items,
      receipts: receipts.map((r) => ({
        goodsReceiptId: r.id,
        number: r.number,
        status: r.status,
        receivedAt: r.receivedAt?.toISOString() ?? null,
        postedAt: r.postedAt?.toISOString() ?? null,
        totalQuantity: r.items.reduce((sum, i) => sum + i.quantity, 0),
        itemCount: r.items.length,
      })),
      shortages: shortageRows.map((row) => ({
        discrepancyId: row.id,
        purchaseOrderItemId: row.purchaseOrderItemId,
        quantity: row.quantity,
        reason: row.reason,
        notes: row.notes,
        confirmedBy: row.resolvedBy
          ? {
              id: row.resolvedBy.id,
              displayName: `${row.resolvedBy.firstName} ${row.resolvedBy.lastName}`.trim(),
            }
          : null,
        confirmedAt: row.resolvedAt?.toISOString() ?? null,
      })),
    };
  }

  private async loadContext(
    companyId: string,
    purchaseOrderId: string,
  ): Promise<PurchaseReceivingContext> {
    const row = await this.database.client.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, companyId },
      select: {
        id: true,
        companyId: true,
        status: true,
        supplierId: true,
        items: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            skuId: true,
            quantity: true,
            closedUnfulfilledQuantity: true,
          },
        },
      },
    });

    if (!row) {
      throw new AppError({
        code: ERROR_CODES.PURCHASE_ORDER_NOT_FOUND,
        message: PURCHASE_ORDER_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }

    return {
      purchaseOrderId: row.id,
      companyId: row.companyId,
      status: row.status as PurchaseOrderStatus,
      supplierId: row.supplierId,
      items: row.items.map((item) => ({
        purchaseOrderItemId: item.id,
        skuId: item.skuId,
        orderedQuantity: item.quantity,
        closedUnfulfilledQuantity: item.closedUnfulfilledQuantity,
      })),
    };
  }
}
