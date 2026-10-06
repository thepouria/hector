import type {
  InventoryAdjustmentDirection,
  InventoryAdjustmentReason,
  InventoryAdjustmentStatus,
  StockClassification,
} from '@hector/database';

export type InventoryAdjustmentActorRef = {
  id: string;
  firstName: string | null;
  lastName: string | null;
};

export type InventoryAdjustmentWarehouseRef = {
  id: string;
  code: string;
  name: string;
  status: string;
  isSystem: boolean;
};

export type InventoryAdjustmentLocationRef = {
  id: string;
  code: string;
  name: string | null;
  barcode: string;
  status: string;
  type: string;
  warehouseId: string;
};

export type InventoryAdjustmentItemView = {
  id: string;
  location: InventoryAdjustmentLocationRef;
  skuId: string;
  skuCode: string;
  skuName: string | null;
  productName: string | null;
  batchId: string;
  batchNumber: string;
  supplierBatchNumber: string | null;
  classification: StockClassification;
  direction: InventoryAdjustmentDirection;
  quantity: number;
  /** Signed delta preview: IN → +qty, OUT → −qty */
  signedDelta: number;
  currentOnHand: number | null;
  resultOnHand: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InventoryAdjustmentListItemView = {
  id: string;
  number: string;
  status: InventoryAdjustmentStatus;
  reason: InventoryAdjustmentReason;
  reasonText: string | null;
  warehouse: InventoryAdjustmentWarehouseRef;
  itemCount: number;
  netUnits: number;
  notes: string | null;
  createdBy: InventoryAdjustmentActorRef;
  approvedBy: InventoryAdjustmentActorRef | null;
  createdAt: string;
  postedAt: string | null;
  updatedAt: string;
};

export type InventoryAdjustmentDetailView = {
  id: string;
  number: string;
  status: InventoryAdjustmentStatus;
  reason: InventoryAdjustmentReason;
  reasonText: string | null;
  warehouse: InventoryAdjustmentWarehouseRef;
  notes: string | null;
  version: number;
  items: InventoryAdjustmentItemView[];
  createdBy: InventoryAdjustmentActorRef;
  approvedBy: InventoryAdjustmentActorRef | null;
  rejectedBy: InventoryAdjustmentActorRef | null;
  postedBy: InventoryAdjustmentActorRef | null;
  cancelledBy: InventoryAdjustmentActorRef | null;
  submittedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  postedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};
