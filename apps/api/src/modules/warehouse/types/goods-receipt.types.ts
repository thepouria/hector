import type { GoodsReceiptStatus, PurchaseOrderStatus } from '@hector/database';
import type { GoodsReceiptItemBatchView } from './batch.types';

export type GoodsReceiptItemView = {
  id: string;
  purchaseOrderItemId: string;
  skuId: string;
  skuCode: string | null;
  productName: string | null;
  quantity: number;
  notes: string | null;
  orderedQuantity: number;
  previouslyReceivedQuantity: number;
  remainingQuantity: number;
  /** Draft or posted batch allocations for this line (not current stock). */
  batchAllocations: GoodsReceiptItemBatchView[];
  /** SUM(batchAllocations.quantity). Must equal quantity before POST. */
  allocatedQuantity: number;
  createdAt: string;
  updatedAt: string;
};

export type GoodsReceiptListItemView = {
  id: string;
  number: string;
  status: GoodsReceiptStatus;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  supplierId: string;
  supplierName: string;
  receivedAt: string | null;
  postedAt: string | null;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
};

export type GoodsReceiptDetailView = {
  id: string;
  number: string;
  status: GoodsReceiptStatus;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  purchaseOrderStatus: PurchaseOrderStatus;
  supplierId: string;
  supplierName: string;
  receivedAt: string | null;
  postedAt: string | null;
  notes: string | null;
  cancellationReason: string | null;
  version: number;
  items: GoodsReceiptItemView[];
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
};

export type PurchaseOrderReceivingProgressItemView = {
  purchaseOrderItemId: string;
  skuId: string;
  skuCode: string | null;
  productName: string | null;
  orderedQuantity: number;
  /** POSTED GRN quantities only. */
  receivedQuantity: number;
  postedReceivedQuantity: number;
  shortQuantity: number;
  closedUnfulfilledQuantity: number;
  remainingQuantity: number;
  receivingStatus: 'NOT_RECEIVED' | 'PARTIAL' | 'COMPLETE' | 'SHORT_CLOSED';
};

export type PurchaseOrderReceivingProgressView = {
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  status: PurchaseOrderStatus;
  supplierId: string;
  supplierName: string;
  progress: 'OPEN' | 'PARTIAL' | 'COMPLETE';
  receivingOutcome: 'AWAITING' | 'PARTIAL' | 'FULLY_RECEIVED' | 'CLOSED_WITH_SHORTAGE';
  hasShortage: boolean;
  totals: {
    orderedQuantity: number;
    receivedQuantity: number;
    shortQuantity: number;
    remainingQuantity: number;
  };
  items: PurchaseOrderReceivingProgressItemView[];
  receipts: Array<{
    goodsReceiptId: string;
    number: string;
    status: string;
    receivedAt: string | null;
    postedAt: string | null;
    totalQuantity: number;
    itemCount: number;
  }>;
  shortages: Array<{
    discrepancyId: string;
    purchaseOrderItemId: string;
    quantity: number;
    reason: string;
    notes: string | null;
    confirmedBy: { id: string; displayName: string } | null;
    confirmedAt: string | null;
  }>;
};

export type EligiblePurchaseOrderView = {
  id: string;
  number: string;
  status: PurchaseOrderStatus;
  supplierId: string;
  supplierName: string;
  orderDate: string;
  itemCount: number;
};

/** Scanner-facing SKU identity (derived server-side from barcode). */
export type ScannerSkuRef = {
  id: string;
  code: string;
  name: string | null;
  productName: string | null;
};

export type ScannerMatchedLineView = {
  purchaseOrderItemId: string;
  skuId: string;
  skuCode: string | null;
  productName: string | null;
  orderedQuantity: number;
  /** Canonical remaining from Phase 3.5 (POSTED only; drafts do not reserve). */
  remainingQuantity: number;
  /** Quantity already on this DRAFT GRN for the PO item. */
  draftQuantity: number;
  /** remainingQuantity - draftQuantity (workflow helper; POST still revalidates). */
  availableToAdd: number;
};

export type ScanResolveMatchedView = {
  status: 'MATCHED';
  barcode: string;
  sku: ScannerSkuRef;
  line: ScannerMatchedLineView;
};

export type ScanResolveUnknownView = {
  status: 'UNKNOWN_BARCODE';
  barcode: string;
};

export type ScanResolveInactiveBarcodeView = {
  status: 'BARCODE_NOT_ACTIVE';
  barcode: string;
};

export type ScanResolveWrongSkuView = {
  status: 'SKU_NOT_IN_PURCHASE_ORDER';
  barcode: string;
  sku: ScannerSkuRef;
};

export type ScanResolveAmbiguousView = {
  status: 'AMBIGUOUS_PO_ITEM';
  barcode: string;
  sku: ScannerSkuRef;
  purchaseOrderItemIds: string[];
};

export type ScanResolveFullyReceivedView = {
  status: 'PO_ITEM_ALREADY_FULLY_RECEIVED';
  barcode: string;
  sku: ScannerSkuRef;
  line: Omit<ScannerMatchedLineView, 'availableToAdd'> & { availableToAdd: 0 };
};

export type ScanResolveReceivingClosedView = {
  status: 'PO_ITEM_RECEIVING_CLOSED';
  barcode: string;
  sku: ScannerSkuRef;
  line: Omit<ScannerMatchedLineView, 'availableToAdd'> & { availableToAdd: 0 };
};

export type ScanResolveResultView =
  | ScanResolveMatchedView
  | ScanResolveUnknownView
  | ScanResolveInactiveBarcodeView
  | ScanResolveWrongSkuView
  | ScanResolveAmbiguousView
  | ScanResolveFullyReceivedView
  | ScanResolveReceivingClosedView;

export type ScanApplyResultView = {
  status: 'APPLIED';
  barcode: string;
  quantityAdded: number;
  draftQuantity: number;
  availableToAdd: number;
  remainingQuantity: number;
  sku: ScannerSkuRef;
  purchaseOrderItemId: string;
  goodsReceiptItemId: string;
  /** True when this response was served from idempotency store (no second mutation). */
  replayed: boolean;
  receipt: GoodsReceiptDetailView;
};
