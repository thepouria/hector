import { Injectable } from '@nestjs/common';
import {
  PurchaseOrderStatus,
  PurchaseReturnStatus,
  PurchasingLifecycleStatus,
} from '@hector/database';
import { DatabaseService } from '../../infrastructure/database/database.service';
import type { CompanyContext } from '../companies/types/company.types';
import { PURCHASE_ORDER_DUE_SOON_DAYS } from './purchasing.constants';
import { toUtcBusinessDate } from './purchase-order-due';

export type PurchasingSummaryView = {
  supplierCount: number;
  activeSupplierCount: number;
  currentOfferCount: number;
  draftPOCount: number;
  approvedPOCount: number;
  orderedPOCount: number;
  partiallyReceivedPOCount: number;
  receivedPOCount: number;
  cancelledPOCount: number;
  /** Contractual dueDate in the past (not payment/unpaid). */
  dueDatePassedCount: number;
  /** Contractual due within DUE_SOON window (inclusive of today). */
  upcomingDueCount: number;
  draftReturnCount: number;
  approvedReturnCount: number;
  /** Explicit boundary: no finance/inventory KPIs. */
  financeKpis: 'DEFERRED_TO_FINANCE';
  inventoryKpis: 'DEFERRED_TO_WAREHOUSE';
};

/**
 * Compact Purchasing operational summary (Phase 2.12).
 * Company-scoped aggregates only — no Finance payable / Warehouse stock.
 */
@Injectable()
export class PurchasingSummaryService {
  constructor(private readonly database: DatabaseService) {}

  async getSummary(company: CompanyContext): Promise<PurchasingSummaryView> {
    const companyId = company.companyId;
    const now = new Date();
    const today = toUtcBusinessDate(now);
    const todayStart = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 0, 0, 0, 0),
    );
    const dueSoonEnd = new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() + PURCHASE_ORDER_DUE_SOON_DAYS,
        23,
        59,
        59,
        999,
      ),
    );

    const openDueStatuses = [
      PurchaseOrderStatus.APPROVED,
      PurchaseOrderStatus.ORDERED,
      PurchaseOrderStatus.PARTIALLY_RECEIVED,
    ] as const;

    const countPo = (status: PurchaseOrderStatus) =>
      this.database.client.purchaseOrder.count({ where: { companyId, status } });

    const [
      supplierCount,
      activeSupplierCount,
      currentOfferCount,
      draftPOCount,
      approvedPOCount,
      orderedPOCount,
      partiallyReceivedPOCount,
      receivedPOCount,
      cancelledPOCount,
      dueDatePassedCount,
      upcomingDueCount,
      draftReturnCount,
      approvedReturnCount,
    ] = await this.database.client.$transaction([
      this.database.client.supplier.count({ where: { companyId } }),
      this.database.client.supplier.count({
        where: { companyId, status: PurchasingLifecycleStatus.ACTIVE },
      }),
      this.database.client.supplierOffer.count({
        where: {
          companyId,
          archivedAt: null,
          OR: [{ validUntil: null }, { validUntil: { gte: now } }],
        },
      }),
      countPo(PurchaseOrderStatus.DRAFT),
      countPo(PurchaseOrderStatus.APPROVED),
      countPo(PurchaseOrderStatus.ORDERED),
      countPo(PurchaseOrderStatus.PARTIALLY_RECEIVED),
      countPo(PurchaseOrderStatus.RECEIVED),
      countPo(PurchaseOrderStatus.CANCELLED),
      this.database.client.purchaseOrder.count({
        where: {
          companyId,
          dueDate: { lt: todayStart },
          status: { in: [...openDueStatuses] },
        },
      }),
      this.database.client.purchaseOrder.count({
        where: {
          companyId,
          dueDate: { gte: todayStart, lte: dueSoonEnd },
          status: { in: [...openDueStatuses] },
        },
      }),
      this.database.client.purchaseReturn.count({
        where: { companyId, status: PurchaseReturnStatus.DRAFT },
      }),
      this.database.client.purchaseReturn.count({
        where: { companyId, status: PurchaseReturnStatus.APPROVED },
      }),
    ]);

    return {
      supplierCount,
      activeSupplierCount,
      currentOfferCount,
      draftPOCount,
      approvedPOCount,
      orderedPOCount,
      partiallyReceivedPOCount,
      receivedPOCount,
      cancelledPOCount,
      dueDatePassedCount,
      upcomingDueCount,
      draftReturnCount,
      approvedReturnCount,
      financeKpis: 'DEFERRED_TO_FINANCE',
      inventoryKpis: 'DEFERRED_TO_WAREHOUSE',
    };
  }
}
