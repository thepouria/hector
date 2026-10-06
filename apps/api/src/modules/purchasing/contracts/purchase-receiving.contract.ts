import type { Prisma, PurchaseOrderStatus } from '@hector/database';
import type { CompanyContext } from '../../companies/types/company.types';
import type {
  AcceptedReceivedLine,
  OrderedReceivingLine,
  PurchaseReceivingContext,
  PurchaseReceivingProgressView,
  PurchaseReceivingSummaryStatus,
} from './purchase-receiving.types';

/**
 * Purchasing application port for Warehouse (Phase 3).
 *
 * Warehouse → Purchasing (one-way). Warehouse must not Prisma-update PO status
 * outside this contract. Purchasing must not import Warehouse implementation.
 *
 * docs/purchase-receiving-contract.md
 * docs/warehouse-purchasing-contract.md
 */
export abstract class PurchaseReceivingContract {
  /**
   * Narrow receiving context for an ORDERED / PARTIALLY_RECEIVED PO.
   * Company-scoped; never returns another company's PO.
   */
  abstract getReceivingContext(
    company: CompanyContext,
    purchaseOrderId: string,
  ): Promise<PurchaseReceivingContext>;

  /** Throws unless status is ORDERED or PARTIALLY_RECEIVED. */
  abstract assertReceivingAllowed(
    company: CompanyContext,
    purchaseOrderId: string,
  ): Promise<PurchaseReceivingContext>;

  /**
   * Pure projection: ordered lines + finalized accepted quantities → summary status.
   * Does not touch the database or emit events.
   */
  abstract recalculateReceivingStatus(
    orderedLines: readonly OrderedReceivingLine[],
    acceptedReceived: readonly AcceptedReceivedLine[],
  ): PurchaseReceivingSummaryStatus;

  /**
   * Apply finalized accepted receiving evidence inside an open transaction.
   *
   * Caller (Warehouse post) must:
   * 1. Lock relevant rows / serialize with this method's PO FOR UPDATE
   * 2. Aggregate ALL posted GRN quantities (including the GRN being posted)
   * 3. Pass that aggregate as acceptedReceived
   *
   * Purchasing validates over-receipt, derives ORDERED|PARTIALLY_RECEIVED|RECEIVED,
   * and updates PurchaseOrder.status. Does not touch GoodsReceipt tables.
   */
  abstract applyPostedReceivingEvidence(
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
  }>;

  /**
   * True when any POSTED goods receipt exists for the PO (company-scoped).
   * Used to tighten ORDERED → CANCELLED once Warehouse evidence exists.
   */
  abstract hasPostedReceivingEvidence(
    companyId: string,
    purchaseOrderId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean>;

  /**
   * Canonical receiving progress (Phase 3.5).
   * Single source of truth for ordered / received / short / remaining.
   */
  abstract getReceivingProgress(
    company: CompanyContext,
    purchaseOrderId: string,
  ): Promise<PurchaseReceivingProgressView>;

  /**
   * Aggregate POSTED GoodsReceiptItem quantities per PO item (company-scoped).
   * Usable inside transactions for short-close / post concurrency.
   */
  abstract aggregatePostedReceivedQuantities(
    companyId: string,
    purchaseOrderId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Map<string, number>>;
}
