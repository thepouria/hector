import type { PutawayStatus, WarehouseLocationType, WarehouseStatus } from '@hector/database';

export type ReceiptPutawayProgress = 'NOT_PUT_AWAY' | 'PARTIALLY_PUT_AWAY' | 'FULLY_PUT_AWAY';

export type PutawayListItemView = {
  id: string;
  number: string;
  status: PutawayStatus;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  goodsReceiptId: string;
  goodsReceiptNumber: string;
  itemCount: number;
  totalQuantity: number;
  createdAt: string;
  completedAt: string | null;
  createdBy: { id: string; displayName: string } | null;
  completedBy: { id: string; displayName: string } | null;
};

export type PutawayLocationRef = {
  id: string;
  code: string;
  name: string | null;
  barcode: string;
  type: WarehouseLocationType;
  status: WarehouseStatus;
  path: string[];
};

export type PutawayItemView = {
  id: string;
  receiptBatchAllocationId: string;
  goodsReceiptItemId: string;
  skuId: string;
  skuCode: string | null;
  productName: string | null;
  batchId: string;
  batchNumber: string;
  supplierBatchNumber: string | null;
  expiresAt: string | null;
  warehouseLocationId: string;
  location: PutawayLocationRef;
  quantity: number;
  createdAt: string;
  updatedAt: string;
};

export type PutawaySourceLineView = {
  receiptBatchAllocationId: string;
  goodsReceiptItemId: string;
  skuId: string;
  skuCode: string | null;
  productName: string | null;
  batchId: string;
  batchNumber: string;
  supplierBatchNumber: string | null;
  expiresAt: string | null;
  receivedQuantity: number;
  /** COMPLETED putaway qty only (canonical placed). */
  alreadyPutAway: number;
  /** Qty on THIS putaway (draft/in-progress/completed). */
  draftAllocated: number;
  /** remaining after completed elsewhere and this putaway's draft. */
  availableToAllocate: number;
  /** received - completed elsewhere (ignores other drafts). */
  remainingToPutAway: number;
};

export type PutawayDetailView = {
  id: string;
  number: string;
  status: PutawayStatus;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  goodsReceiptId: string;
  goodsReceiptNumber: string;
  goodsReceiptStatus: string;
  version: number;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; displayName: string } | null;
  completedBy: { id: string; displayName: string } | null;
  items: PutawayItemView[];
  sources: PutawaySourceLineView[];
  totals: {
    itemCount: number;
    totalQuantity: number;
  };
};

export type PendingPutawayLineView = {
  receiptBatchAllocationId: string;
  goodsReceiptId: string;
  goodsReceiptNumber: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  skuId: string;
  skuCode: string | null;
  productName: string | null;
  batchId: string;
  batchNumber: string;
  supplierBatchNumber: string | null;
  expiresAt: string | null;
  receivedQuantity: number;
  alreadyPutAway: number;
  remainingToPutAway: number;
  receiptPutawayProgress: ReceiptPutawayProgress;
  postedAt: string | null;
  receivedAt: string | null;
};

export type PutawayScanApplyResultView = {
  status: 'APPLIED';
  quantity: number;
  receiptBatchAllocationId: string;
  warehouseLocationId: string;
  location: PutawayLocationRef;
  replayed: boolean;
  putaway: PutawayDetailView;
};
