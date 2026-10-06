import { GoodsReceiptStatus, PurchaseOrderStatus } from '@hector/database';

/**
 * Narrow read-safe PO shape for Warehouse (Phase 3).
 * Not a Prisma entity — Warehouse must not mutate Purchasing persistence directly.
 *
 * docs/purchase-receiving-contract.md
 * docs/purchase-receiving.md
 */
export type PurchaseReceivingContextItem = {
  purchaseOrderItemId: string;
  skuId: string;
  /** Ordered quantity (integer units). Never rewritten by receipts. */
  orderedQuantity: number;
  /**
   * Confirmed short quantity (Phase 2.11 / 3.5).
   * Alias of closedUnfulfilledQuantity. Not physical stock.
   * remaining = ordered − received − short.
   */
  closedUnfulfilledQuantity: number;
};

export type PurchaseReceivingContext = {
  purchaseOrderId: string;
  companyId: string;
  status: PurchaseOrderStatus;
  supplierId: string;
  items: PurchaseReceivingContextItem[];
};

/**
 * Finalized accepted receipt projection supplied by Warehouse (or tests).
 * Purchasing does not understand draft/reversed Warehouse tables —
 * only normalized accepted quantities per PO line.
 */
export type AcceptedReceivedLine = {
  purchaseOrderItemId: string;
  acceptedReceivedQuantity: number;
};

export type OrderedReceivingLine = {
  purchaseOrderItemId: string;
  orderedQuantity: number;
  /** Defaults to 0 when omitted. */
  closedUnfulfilledQuantity?: number;
};

/** Summary statuses Warehouse evidence may project onto an ORDERED-or-later PO. */
export type PurchaseReceivingSummaryStatus =
  | typeof PurchaseOrderStatus.ORDERED
  | typeof PurchaseOrderStatus.PARTIALLY_RECEIVED
  | typeof PurchaseOrderStatus.RECEIVED;

/** Derived per-item receiving status (not persisted). */
export type PurchaseItemReceivingStatus =
  | 'NOT_RECEIVED'
  | 'PARTIAL'
  | 'COMPLETE'
  | 'SHORT_CLOSED';

/**
 * Receiving outcome distinguishing fully received vs closed-with-shortage.
 * PO.status remains RECEIVED for both when remaining=0 (no RECEIVED_WITH_SHORTAGE enum).
 */
export type PurchaseReceivingOutcome =
  | 'AWAITING'
  | 'PARTIAL'
  | 'FULLY_RECEIVED'
  | 'CLOSED_WITH_SHORTAGE';

export type PurchaseReceivingProgressItem = {
  purchaseOrderItemId: string;
  skuId: string;
  skuCode: string | null;
  productName: string | null;
  orderedQuantity: number;
  /** POSTED GRN quantities only. */
  receivedQuantity: number;
  /** Alias of receivedQuantity for warehouse GRN clients. */
  postedReceivedQuantity: number;
  /** Confirmed shortage (closedUnfulfilledQuantity). */
  shortQuantity: number;
  /** Alias of shortQuantity. */
  closedUnfulfilledQuantity: number;
  remainingQuantity: number;
  receivingStatus: PurchaseItemReceivingStatus;
};

export type PurchaseReceivingReceiptHistoryItem = {
  goodsReceiptId: string;
  number: string;
  status: GoodsReceiptStatus;
  receivedAt: string | null;
  postedAt: string | null;
  totalQuantity: number;
  itemCount: number;
};

export type PurchaseReceivingShortageHistoryItem = {
  discrepancyId: string;
  purchaseOrderItemId: string;
  quantity: number;
  reason: string;
  notes: string | null;
  confirmedBy: { id: string; displayName: string } | null;
  confirmedAt: string | null;
};

export type PurchaseReceivingProgressView = {
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  status: PurchaseOrderStatus;
  supplierId: string;
  supplierName: string;
  /** Coarse OPEN/PARTIAL/COMPLETE for warehouse clients. */
  progress: 'OPEN' | 'PARTIAL' | 'COMPLETE';
  /** Precise outcome; CLOSED_WITH_SHORTAGE when remaining=0 and any short>0. */
  receivingOutcome: PurchaseReceivingOutcome;
  hasShortage: boolean;
  totals: {
    orderedQuantity: number;
    receivedQuantity: number;
    shortQuantity: number;
    remainingQuantity: number;
  };
  items: PurchaseReceivingProgressItem[];
  receipts: PurchaseReceivingReceiptHistoryItem[];
  shortages: PurchaseReceivingShortageHistoryItem[];
};

export function deriveItemReceivingStatus(input: {
  orderedQuantity: number;
  receivedQuantity: number;
  shortQuantity: number;
  remainingQuantity: number;
}): PurchaseItemReceivingStatus {
  if (input.remainingQuantity > 0) {
    if (input.receivedQuantity <= 0 && input.shortQuantity <= 0) return 'NOT_RECEIVED';
    return 'PARTIAL';
  }
  if (input.shortQuantity > 0) return 'SHORT_CLOSED';
  return 'COMPLETE';
}

export function deriveReceivingOutcome(items: readonly PurchaseReceivingProgressItem[]): {
  progress: 'OPEN' | 'PARTIAL' | 'COMPLETE';
  receivingOutcome: PurchaseReceivingOutcome;
  hasShortage: boolean;
} {
  const hasShortage = items.some((i) => i.shortQuantity > 0);
  const anyRemaining = items.some((i) => i.remainingQuantity > 0);
  const anyReceived = items.some((i) => i.receivedQuantity > 0);

  if (!anyRemaining) {
    return {
      progress: 'COMPLETE',
      receivingOutcome: hasShortage ? 'CLOSED_WITH_SHORTAGE' : 'FULLY_RECEIVED',
      hasShortage,
    };
  }
  if (anyReceived || hasShortage) {
    return { progress: 'PARTIAL', receivingOutcome: 'PARTIAL', hasShortage };
  }
  return { progress: 'OPEN', receivingOutcome: 'AWAITING', hasShortage };
}
