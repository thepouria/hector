import type { StockClassification } from '@/types/stock-classification';

export type InventoryAdjustmentStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'POSTED'
  | 'REJECTED'
  | 'CANCELLED';

export type InventoryAdjustmentReason =
  | 'FOUND'
  | 'MISSING'
  | 'REGISTRATION_ERROR'
  | 'CORRECTION'
  | 'OTHER';

export type InventoryAdjustmentDirection = 'IN' | 'OUT';

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

export type InventoryAdjustmentItem = {
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
  signedDelta: number;
  currentOnHand: number | null;
  resultOnHand: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InventoryAdjustmentListItem = {
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

export type InventoryAdjustmentDetail = {
  id: string;
  number: string;
  status: InventoryAdjustmentStatus;
  reason: InventoryAdjustmentReason;
  reasonText: string | null;
  warehouse: InventoryAdjustmentWarehouseRef;
  notes: string | null;
  version: number;
  items: InventoryAdjustmentItem[];
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

export type InventoryAdjustmentItemInput = {
  locationId: string;
  skuId: string;
  batchId: string;
  classification: StockClassification;
  direction: InventoryAdjustmentDirection;
  quantity: number;
  notes?: string;
};
