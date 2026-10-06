import type { StockClassification } from '@/types/stock-classification';

export type StockTransferStatus = 'DRAFT' | 'IN_TRANSIT' | 'COMPLETED' | 'CANCELLED';

export type StockTransferActorRef = {
  id: string;
  firstName: string | null;
  lastName: string | null;
};

export type StockTransferWarehouseRef = {
  id: string;
  code: string;
  name: string;
  status: string;
  isSystem: boolean;
};

export type StockTransferLocationRef = {
  id: string;
  code: string;
  name: string | null;
  barcode: string;
  status: string;
  type: string;
  warehouseId: string;
};

export type StockTransferItem = {
  id: string;
  skuId: string;
  skuCode: string;
  skuName: string | null;
  productName: string | null;
  batchId: string;
  batchNumber: string;
  supplierBatchNumber: string | null;
  classification: StockClassification;
  sourceLocation: StockTransferLocationRef;
  destinationLocation: StockTransferLocationRef;
  quantity: number;
  notes: string | null;
  /** Physical on hand at source when viewed — not a reservation. */
  sourceOnHand: number | null;
  dispatchOperationId: string | null;
  completeOperationId: string | null;
  cancelOperationId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StockTransferListItem = {
  id: string;
  number: string;
  status: StockTransferStatus;
  sourceWarehouse: StockTransferWarehouseRef;
  destinationWarehouse: StockTransferWarehouseRef;
  itemCount: number;
  totalQuantity: number;
  notes: string | null;
  externalReference: string | null;
  createdBy: StockTransferActorRef;
  dispatchedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StockTransferDetail = {
  id: string;
  number: string;
  status: StockTransferStatus;
  sourceWarehouse: StockTransferWarehouseRef;
  destinationWarehouse: StockTransferWarehouseRef;
  notes: string | null;
  externalReference: string | null;
  version: number;
  items: StockTransferItem[];
  createdBy: StockTransferActorRef;
  dispatchedBy: StockTransferActorRef | null;
  completedBy: StockTransferActorRef | null;
  cancelledBy: StockTransferActorRef | null;
  dispatchedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StockTransferScanApplyResult = {
  transfer: StockTransferDetail;
  item: StockTransferItem;
  incremented: boolean;
};

export type StockTransferItemInput = {
  skuId: string;
  batchId: string;
  classification?: StockClassification;
  sourceLocationId: string;
  destinationLocationId: string;
  quantity: number;
  notes?: string;
};
