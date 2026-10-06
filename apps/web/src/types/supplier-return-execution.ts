import type { StockClassification } from '@/types/stock-classification';
import type { PurchaseReturnReason, PurchaseReturnResolution, PurchaseReturnStatus } from '@/types/purchasing';

export type SupplierReturnExecutionStatus = 'DRAFT' | 'DISPATCHED' | 'CANCELLED';

export type SupplierReturnFulfillmentStatus =
  | 'NOT_DISPATCHED'
  | 'PARTIALLY_DISPATCHED'
  | 'FULLY_DISPATCHED';

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

export type SupplierReturnExecutionItem = {
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

export type SupplierReturnExecutionListItem = {
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

export type SupplierReturnExecutionDetail = {
  id: string;
  number: string;
  status: SupplierReturnExecutionStatus;
  purchaseReturnId: string;
  purchaseReturnNumber: string;
  supplierId: string;
  warehouse: SupplierReturnExecutionWarehouseRef;
  notes: string | null;
  version: number;
  items: SupplierReturnExecutionItem[];
  createdBy: SupplierReturnExecutionActorRef;
  dispatchedBy: SupplierReturnExecutionActorRef | null;
  cancelledBy: SupplierReturnExecutionActorRef | null;
  dispatchedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SupplierReturnExecutionSummary = {
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

export type SupplierReturnExecutionProgress = {
  approvedQuantity: number;
  dispatchedQuantity: number;
  remainingQuantity: number;
  fulfillmentStatus: SupplierReturnFulfillmentStatus;
};

export type SupplierReturnCommercialItem = {
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

export type SupplierReturnWarehouseDetail = {
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
  items: SupplierReturnCommercialItem[];
  progress: SupplierReturnExecutionProgress;
  executions: SupplierReturnExecutionSummary[];
};

export type SupplierReturnWarehouseListItem = {
  id: string;
  number: string;
  supplierId: string;
  supplierName: string;
  supplierCode: string | null;
  purchaseOrderNumber: string | null;
  approvedAt: string | null;
  progress: SupplierReturnExecutionProgress;
};

export type SupplierReturnExecutionItemInput = {
  purchaseReturnItemId: string;
  skuId: string;
  batchId: string;
  locationId: string;
  classification?: StockClassification;
  quantity: number;
  notes?: string;
};

export type SupplierReturnExecutionScanApplyResult = {
  execution: SupplierReturnExecutionDetail;
  item: SupplierReturnExecutionItem;
  incremented: boolean;
};
