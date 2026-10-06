import type { PurchaseOrderStatus } from '@/types/purchasing';
import type { GoodsReceiptItemBatchAllocation } from '@/types/batch';

export type GoodsReceiptStatus = 'DRAFT' | 'POSTED' | 'CANCELLED';

export type GoodsReceiptItem = {
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
  batchAllocations: GoodsReceiptItemBatchAllocation[];
  allocatedQuantity: number;
  createdAt: string;
  updatedAt: string;
};

export type GoodsReceiptListItem = {
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

export type GoodsReceiptDetail = {
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
  items: GoodsReceiptItem[];
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
};

export type PurchaseItemReceivingStatus =
  | 'NOT_RECEIVED'
  | 'PARTIAL'
  | 'COMPLETE'
  | 'SHORT_CLOSED';

export type PurchaseReceivingOutcome =
  | 'AWAITING'
  | 'PARTIAL'
  | 'FULLY_RECEIVED'
  | 'CLOSED_WITH_SHORTAGE';

export type PurchaseOrderReceivingProgressItem = {
  purchaseOrderItemId: string;
  skuId: string;
  skuCode: string | null;
  productName: string | null;
  orderedQuantity: number;
  receivedQuantity: number;
  postedReceivedQuantity: number;
  shortQuantity: number;
  closedUnfulfilledQuantity: number;
  remainingQuantity: number;
  receivingStatus: PurchaseItemReceivingStatus;
};

export type PurchaseOrderReceivingProgress = {
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  status: PurchaseOrderStatus;
  supplierId: string;
  supplierName: string;
  progress: 'OPEN' | 'PARTIAL' | 'COMPLETE';
  receivingOutcome: PurchaseReceivingOutcome;
  hasShortage: boolean;
  totals: {
    orderedQuantity: number;
    receivedQuantity: number;
    shortQuantity: number;
    remainingQuantity: number;
  };
  items: PurchaseOrderReceivingProgressItem[];
  receipts: Array<{
    goodsReceiptId: string;
    number: string;
    status: GoodsReceiptStatus;
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

export type EligiblePurchaseOrder = {
  id: string;
  number: string;
  status: PurchaseOrderStatus;
  supplierId: string;
  supplierName: string;
  orderDate: string;
  itemCount: number;
};

export type ScannerSkuRef = {
  id: string;
  code: string;
  name: string | null;
  productName: string | null;
};

export type ScannerMatchedLine = {
  purchaseOrderItemId: string;
  skuId: string;
  skuCode: string | null;
  productName: string | null;
  orderedQuantity: number;
  remainingQuantity: number;
  draftQuantity: number;
  availableToAdd: number;
};

export type ScanResolveResult =
  | {
      status: 'MATCHED';
      barcode: string;
      sku: ScannerSkuRef;
      line: ScannerMatchedLine;
    }
  | { status: 'UNKNOWN_BARCODE'; barcode: string }
  | { status: 'BARCODE_NOT_ACTIVE'; barcode: string }
  | {
      status: 'SKU_NOT_IN_PURCHASE_ORDER';
      barcode: string;
      sku: ScannerSkuRef;
    }
  | {
      status: 'AMBIGUOUS_PO_ITEM';
      barcode: string;
      sku: ScannerSkuRef;
      purchaseOrderItemIds: string[];
    }
  | {
      status: 'PO_ITEM_ALREADY_FULLY_RECEIVED';
      barcode: string;
      sku: ScannerSkuRef;
      line: ScannerMatchedLine;
    }
  | {
      status: 'PO_ITEM_RECEIVING_CLOSED';
      barcode: string;
      sku: ScannerSkuRef;
      line: ScannerMatchedLine;
    };

export type ScanApplyResult = {
  status: 'APPLIED';
  barcode: string;
  quantityAdded: number;
  draftQuantity: number;
  availableToAdd: number;
  remainingQuantity: number;
  sku: ScannerSkuRef;
  purchaseOrderItemId: string;
  goodsReceiptItemId: string;
  replayed: boolean;
  receipt: GoodsReceiptDetail;
};
