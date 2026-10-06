export type BatchListItemView = {
  id: string;
  batchNumber: string;
  supplierBatchNumber: string | null;
  skuId: string;
  skuCode: string;
  productName: string | null;
  manufacturedAt: string | null;
  expiresAt: string | null;
  /** Derived visual state only — not an alert engine. */
  expiryState: 'NO_EXPIRY' | 'VALID' | 'EXPIRED';
  /** SUM of allocations on POSTED GRNs only. NOT current stock. */
  totalReceived: number;
  firstReceivedAt: string | null;
  lastReceivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BatchReceiptHistoryItemView = {
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

export type BatchDetailView = BatchListItemView & {
  notes: string | null;
  receipts: BatchReceiptHistoryItemView[];
};

export type GoodsReceiptItemBatchView = {
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
