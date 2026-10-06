export type PutawayStatus = 'DRAFT' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export type ReceiptPutawayProgress = 'NOT_PUT_AWAY' | 'PARTIALLY_PUT_AWAY' | 'FULLY_PUT_AWAY';

export type PutawayListItem = {
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
  type: string;
  status: string;
  path: string[];
};

export type PutawayItem = {
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

export type PutawaySourceLine = {
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
  alreadyPutAway: number;
  draftAllocated: number;
  availableToAllocate: number;
  remainingToPutAway: number;
};

export type PutawayDetail = {
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
  items: PutawayItem[];
  sources: PutawaySourceLine[];
  totals: {
    itemCount: number;
    totalQuantity: number;
  };
};

export type PendingPutawayLine = {
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

export type PutawayScanApplyResult = {
  status: 'APPLIED';
  quantity: number;
  receiptBatchAllocationId: string;
  warehouseLocationId: string;
  location: PutawayLocationRef;
  replayed: boolean;
  putaway: PutawayDetail;
};
