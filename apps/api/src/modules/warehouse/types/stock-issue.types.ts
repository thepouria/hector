import type { StockClassification, StockIssueReason, StockIssueStatus } from '@hector/database';

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

export type StockIssueItemView = {
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

export type StockIssueListItemView = {
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

export type StockIssueDetailView = {
  id: string;
  number: string;
  status: StockIssueStatus;
  reason: StockIssueReason;
  reasonText: string | null;
  warehouse: StockIssueWarehouseRef;
  notes: string | null;
  version: number;
  items: StockIssueItemView[];
  createdBy: StockIssueActorRef;
  postedBy: StockIssueActorRef | null;
  cancelledBy: StockIssueActorRef | null;
  postedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StockIssueScanApplyResultView = {
  issue: StockIssueDetailView;
  item: StockIssueItemView;
  incremented: boolean;
};
