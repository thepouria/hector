import type {
  StockClassification,
  StockCountLineStatus,
  StockCountStatus,
  StockCountType,
} from '@hector/database';

export type StockCountActorRef = {
  id: string;
  firstName: string | null;
  lastName: string | null;
};

export type StockCountWarehouseRef = {
  id: string;
  code: string;
  name: string;
  status: string;
  isSystem: boolean;
};

export type StockCountLocationRef = {
  id: string;
  code: string;
  name: string | null;
  barcode: string;
  status: string;
  type: string;
  warehouseId: string;
};

export type StockCountItemView = {
  id: string;
  warehouseId: string;
  location: StockCountLocationRef;
  skuId: string;
  skuCode: string;
  skuName: string | null;
  productName: string | null;
  batchId: string;
  batchNumber: string;
  supplierBatchNumber: string | null;
  classification: StockClassification;
  snapshotQuantity: number | null;
  countedQuantity: number | null;
  movementsDuringCount: number | null;
  expectedQuantity: number | null;
  difference: number | null;
  lineStatus: StockCountLineStatus;
  isDiscovered: boolean;
  differenceLabel: string | null;
  countedBy: StockCountActorRef | null;
  countedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StockCountListItemView = {
  id: string;
  number: string;
  type: StockCountType;
  status: StockCountStatus;
  warehouse: StockCountWarehouseRef;
  scopeSummary: string;
  lineCount: number;
  countedLineCount: number;
  differenceLineCount: number;
  blindCount: boolean;
  startedAt: string | null;
  submittedAt: string | null;
  postedAt: string | null;
  createdBy: StockCountActorRef;
  createdAt: string;
  updatedAt: string;
};

export type StockCountDetailView = {
  id: string;
  number: string;
  type: StockCountType;
  status: StockCountStatus;
  warehouse: StockCountWarehouseRef;
  blindCount: boolean;
  allowDiscoveredItems: boolean;
  scopeClassifications: StockClassification[];
  scopeLocationIds: string[];
  scopeSkuIds: string[];
  highDifferenceThreshold: number | null;
  notes: string | null;
  version: number;
  items: StockCountItemView[];
  progress: {
    totalLines: number;
    countedLines: number;
    skippedLines: number;
    pendingLines: number;
    matchLines: number;
    differenceLines: number;
    percentCounted: number;
  };
  createdBy: StockCountActorRef;
  startedBy: StockCountActorRef | null;
  submittedBy: StockCountActorRef | null;
  approvedBy: StockCountActorRef | null;
  rejectedBy: StockCountActorRef | null;
  postedBy: StockCountActorRef | null;
  cancelledBy: StockCountActorRef | null;
  startedAt: string | null;
  submittedAt: string | null;
  recountRequestedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  postedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StockCountReviewView = {
  count: StockCountDetailView;
  summary: {
    totalLines: number;
    countedLines: number;
    skippedLines: number;
    exactMatches: number;
    positiveDifferences: number;
    negativeDifferences: number;
    totalPositiveUnits: number;
    totalNegativeUnits: number;
    highDifferenceWarnings: number;
  };
  potentialClassificationMismatches: Array<{
    skuId: string;
    skuCode: string;
    batchId: string;
    batchNumber: string;
    warehouseId: string;
    lines: Array<{
      itemId: string;
      locationId: string;
      classification: StockClassification;
      difference: number;
    }>;
  }>;
  potentialLocationMismatches: Array<{
    skuId: string;
    skuCode: string;
    batchId: string;
    batchNumber: string;
    classification: StockClassification;
    warehouseId: string;
    lines: Array<{
      itemId: string;
      locationId: string;
      locationCode: string;
      difference: number;
    }>;
  }>;
};

export type StockCountScanApplyResultView = {
  count: StockCountDetailView;
  item: StockCountItemView;
  activeLocationId: string | null;
  incremented: boolean;
};
