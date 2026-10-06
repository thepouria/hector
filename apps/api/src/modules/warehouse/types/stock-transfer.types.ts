import type { StockClassification, StockTransferStatus } from '@hector/database';

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

export type StockTransferItemView = {
  id: string;
  skuId: string;
  skuCode: string;
  skuName: string | null;
  productName: string | null;
  batchId: string;
  batchNumber: string;
  supplierBatchNumber: string | null;
  sourceLocation: StockTransferLocationRef;
  destinationLocation: StockTransferLocationRef;
  classification: StockClassification;
  quantity: number;
  notes: string | null;
  sourceOnHand: number | null;
  dispatchOperationId: string | null;
  completeOperationId: string | null;
  cancelOperationId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StockTransferListItemView = {
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

export type StockTransferDetailView = {
  id: string;
  number: string;
  status: StockTransferStatus;
  sourceWarehouse: StockTransferWarehouseRef;
  destinationWarehouse: StockTransferWarehouseRef;
  notes: string | null;
  externalReference: string | null;
  version: number;
  items: StockTransferItemView[];
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

export type StockTransferScanApplyResultView = {
  transfer: StockTransferDetailView;
  item: StockTransferItemView;
  incremented: boolean;
};
