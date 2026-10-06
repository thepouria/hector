import type {
  PurchaseReturnReason,
  PurchaseReturnResolution,
  PurchaseReturnStatus,
  StockClassification,
  SupplierReturnExecutionStatus,
} from '@hector/database';
import type { SupplierReturnFulfillmentStatus } from '../supplier-return-execution.constants';

export type SupplierReturnExecutionActorRef = {
  id: string;
  firstName: string | null;
  lastName: string | null;
};

export type SupplierReturnExecutionWarehouseRef = {
  id: string;
  code: string;
  name: string;
  status: string;
  isSystem: boolean;
};

export type SupplierReturnExecutionLocationRef = {
  id: string;
  code: string;
  name: string | null;
  barcode: string;
  status: string;
  type: string;
  warehouseId: string;
};

export type SupplierReturnExecutionItemView = {
  id: string;
  purchaseReturnItemId: string;
  skuId: string;
  skuCode: string;
  skuName: string | null;
  productName: string | null;
  batchId: string;
  batchNumber: string;
  supplierBatchNumber: string | null;
  location: SupplierReturnExecutionLocationRef;
  classification: StockClassification;
  quantity: number;
  notes: string | null;
  sourceOnHand: number;
  createdAt: string;
  updatedAt: string;
};

export type SupplierReturnExecutionListItemView = {
  id: string;
  number: string;
  status: SupplierReturnExecutionStatus;
  purchaseReturnId: string;
  purchaseReturnNumber: string;
  supplierId: string;
  supplierName: string;
  warehouse: SupplierReturnExecutionWarehouseRef;
  itemCount: number;
  totalQuantity: number;
  notes: string | null;
  createdBy: SupplierReturnExecutionActorRef;
  dispatchedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SupplierReturnExecutionDetailView = {
  id: string;
  number: string;
  status: SupplierReturnExecutionStatus;
  purchaseReturnId: string;
  purchaseReturnNumber: string;
  supplierId: string;
  warehouse: SupplierReturnExecutionWarehouseRef;
  notes: string | null;
  version: number;
  items: SupplierReturnExecutionItemView[];
  createdBy: SupplierReturnExecutionActorRef;
  dispatchedBy: SupplierReturnExecutionActorRef | null;
  cancelledBy: SupplierReturnExecutionActorRef | null;
  dispatchedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SupplierReturnExecutionSummaryView = {
  id: string;
  number: string;
  status: SupplierReturnExecutionStatus;
  warehouseId: string;
  warehouseCode: string;
  itemCount: number;
  totalQuantity: number;
  dispatchedAt: string | null;
  createdAt: string;
};

export type SupplierReturnExecutionProgressView = {
  approvedQuantity: number;
  dispatchedQuantity: number;
  remainingQuantity: number;
  fulfillmentStatus: SupplierReturnFulfillmentStatus;
};

export type SupplierReturnCommercialItemView = {
  id: string;
  skuId: string;
  quantity: number;
  reason: PurchaseReturnReason | null;
  notes: string | null;
  sku: {
    id: string;
    code: string;
    name: string | null;
    product: { id: string; name: string; code: string | null };
  };
};

export type SupplierReturnWarehouseDetailView = {
  id: string;
  number: string;
  status: PurchaseReturnStatus;
  supplierId: string;
  supplier: { id: string; name: string; code: string | null };
  purchaseOrderId: string | null;
  purchaseOrderNumber: string | null;
  reason: PurchaseReturnReason;
  expectedResolution: PurchaseReturnResolution;
  notes: string | null;
  approvedAt: string | null;
  items: SupplierReturnCommercialItemView[];
  progress: SupplierReturnExecutionProgressView;
  executions: SupplierReturnExecutionSummaryView[];
};

export type SupplierReturnWarehouseListItemView = {
  id: string;
  number: string;
  supplierId: string;
  supplierName: string;
  supplierCode: string | null;
  purchaseOrderNumber: string | null;
  approvedAt: string | null;
  progress: SupplierReturnExecutionProgressView;
};

export type SupplierReturnExecutionScanApplyResultView = {
  execution: SupplierReturnExecutionDetailView;
  item: SupplierReturnExecutionItemView;
  incremented: boolean;
};
