export type BatchExpiryState = 'NO_EXPIRY' | 'VALID' | 'EXPIRED';

export type BatchListItem = {
  id: string;
  batchNumber: string;
  supplierBatchNumber: string | null;
  skuId: string;
  skuCode: string;
  productName: string | null;
  manufacturedAt: string | null;
  expiresAt: string | null;
  expiryState: BatchExpiryState;
  /** SUM of allocations on POSTED GRNs only — not current stock. */
  totalReceived: number;
  firstReceivedAt: string | null;
  lastReceivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BatchReceiptHistoryItem = {
  goodsReceiptId: string;
  goodsReceiptNumber: string;
  goodsReceiptStatus: string;
  goodsReceiptItemId: string;
  quantity: number;
  receivedAt: string | null;
  postedAt: string | null;
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  supplierId: string;
  supplierName: string;
};

export type BatchDetail = BatchListItem & {
  notes: string | null;
  receipts: BatchReceiptHistoryItem[];
};

export type GoodsReceiptItemBatchAllocation = {
  id: string;
  batchId: string;
  batchNumber: string;
  supplierBatchNumber: string | null;
  skuId: string;
  quantity: number;
  manufacturedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};
