import type { StockClassification } from '@/types/stock-classification';

export type StockIssueStatus = 'DRAFT' | 'POSTED' | 'CANCELLED';
export type StockIssueReason = 'COMPANY_USE' | 'SAMPLE' | 'DAMAGE' | 'MANUAL' | 'OTHER';

export type StockIssueActorRef = {
  id: string;
  firstName: string | null;
  lastName: string | null;
};

export type StockIssueWarehouseRef = {
  id: string;
  code: string;
  name: string;
  status: string;
  isSystem: boolean;
};

export type StockIssueLocationRef = {
  id: string;
  code: string;
  name: string | null;
  barcode: string;
  status: string;
  type: string;
  warehouseId: string;
};

export type StockIssueItem = {
  id: string;
  skuId: string;
  skuCode: string;
  skuName: string | null;
  productName: string | null;
  batchId: string;
  batchNumber: string;
  supplierBatchNumber: string | null;
  location: StockIssueLocationRef;
  classification: StockClassification;
  quantity: number;
  notes: string | null;
  sourceOnHand: number | null;
  createdAt: string;
  updatedAt: string;
};

export type StockIssueListItem = {
  id: string;
  number: string;
  status: StockIssueStatus;
  reason: StockIssueReason;
  reasonText: string | null;
  warehouse: StockIssueWarehouseRef;
  itemCount: number;
  totalQuantity: number;
  notes: string | null;
  createdBy: StockIssueActorRef;
  postedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StockIssueDetail = {
  id: string;
  number: string;
  status: StockIssueStatus;
  reason: StockIssueReason;
  reasonText: string | null;
  warehouse: StockIssueWarehouseRef;
  notes: string | null;
  version: number;
  items: StockIssueItem[];
  createdBy: StockIssueActorRef;
  postedBy: StockIssueActorRef | null;
  cancelledBy: StockIssueActorRef | null;
  postedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StockIssueScanApplyResult = {
  issue: StockIssueDetail;
  item: StockIssueItem;
  incremented: boolean;
};

export type StockIssueItemInput = {
  skuId: string;
  batchId: string;
  locationId: string;
  classification: StockClassification;
  quantity: number;
  notes?: string;
};
