import type {
  CatalogLifecycleStatus,
  InventoryMovementType,
  InventorySourceType,
  StockClassification,
  WarehouseStatus,
} from '@hector/database';

export type InventoryMovementView = {
  id: string;
  movementType: InventoryMovementType;
  quantityDelta: number;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  locationId: string;
  locationCode: string;
  locationName: string | null;
  locationBarcode: string;
  skuId: string;
  skuCode: string;
  productName: string | null;
  batchId: string;
  batchNumber: string;
  supplierBatchNumber: string | null;
  expiresAt: string | null;
  classification: StockClassification;
  sourceType: InventorySourceType;
  sourceId: string;
  sourceLineId: string;
  operationId: string | null;
  reasonCode: string | null;
  notes: string | null;
  reversalOfMovementId: string | null;
  occurredAt: string;
  createdAt: string;
  createdBy: { id: string; displayName: string } | null;
};

export type InventoryBalanceWarnings = {
  archivedSku: boolean;
  inactiveWarehouse: boolean;
  inactiveLocation: boolean;
  negativeOnHand: boolean;
};

export type InventoryBalanceView = {
  id: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  warehouseStatus: WarehouseStatus;
  locationId: string;
  locationCode: string;
  locationName: string | null;
  locationBarcode: string;
  locationStatus: WarehouseStatus;
  skuId: string;
  skuCode: string;
  skuStatus: CatalogLifecycleStatus;
  productName: string | null;
  productCode: string | null;
  batchId: string;
  batchNumber: string;
  supplierBatchNumber: string | null;
  expiresAt: string | null;
  classification: StockClassification;
  /** Physical On Hand only — not Available-to-Sell. */
  onHandQuantity: number;
  updatedAt: string;
  warnings: InventoryBalanceWarnings;
};

export type ClassificationQuantityBreakdown = {
  sellableOnHand: number;
  testerOnHand: number;
  damagedOnHand: number;
  quarantineOnHand: number;
  /** Company-owned classified inventory (all classifications; includes transit positions). */
  totalOnHand: number;
};

export type QuantityBucket = {
  onHandQuantity: number;
};

export type InventorySkuSummaryView = {
  skuId: string;
  skuCode: string;
  skuName: string | null;
  skuStatus: CatalogLifecycleStatus;
  productId: string;
  productName: string | null;
  productCode: string | null;
  /** Company-owned On Hand including in-transit. */
  totalOnHand: number;
  /** Physical storage On Hand (excludes TRANSIT). */
  storageOnHand: number;
  /** In-transit On Hand (system TRANSIT positions). */
  inTransitOnHand: number;
  /** SELLABLE On Hand only. */
  sellableOnHand: number;
  /** ACTIVE reservation remaining across warehouses (SELLABLE scope). */
  reservedQuantity: number;
  /** Sum of per-warehouse (SELLABLE On Hand − Active Reserved). */
  availableQuantity: number;
  testerOnHand: number;
  damagedOnHand: number;
  quarantineOnHand: number;
  byWarehouse: Array<
    QuantityBucket & {
      id: string;
      code: string;
      name: string;
      status: WarehouseStatus;
    }
  >;
  byBatch: Array<
    QuantityBucket & {
      id: string;
      code: string;
      name: string | null;
      expiresAt: string | null;
    }
  >;
  byLocation: Array<
    QuantityBucket & {
      id: string;
      code: string;
      name: string | null;
      barcode: string;
      warehouseId: string;
      warehouseCode: string;
      status: WarehouseStatus;
    }
  >;
  hierarchy: Array<{
    warehouseId: string;
    warehouseCode: string;
    warehouseName: string;
    onHandQuantity: number;
    batches: Array<{
      batchId: string;
      batchNumber: string;
      onHandQuantity: number;
      locations: Array<{
        locationId: string;
        locationCode: string;
        locationName: string | null;
        onHandQuantity: number;
      }>;
    }>;
  }>;
  positions: Array<{
    warehouseId: string;
    warehouseCode: string;
    warehouseName: string;
    warehouseStatus: WarehouseStatus;
    locationId: string;
    locationCode: string;
    locationName: string | null;
    locationBarcode: string;
    locationStatus: WarehouseStatus;
    batchId: string;
    batchNumber: string;
    classification: StockClassification;
    onHandQuantity: number;
  }>;
};

export type InventoryWarehouseSummaryView = {
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  warehouseStatus: WarehouseStatus;
  totalOnHand: number;
  note: string;
  bySku: Array<{
    id: string;
    code: string;
    name: string | null;
    status: CatalogLifecycleStatus;
    onHandQuantity: number;
  }>;
  positions: {
    data: InventoryBalanceView[];
    meta: { page: number; pageSize: number; total: number; totalPages: number };
  };
};

export type InventoryLocationSummaryView = {
  locationId: string;
  locationCode: string;
  locationName: string | null;
  locationBarcode: string;
  locationStatus: WarehouseStatus;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  warehouseStatus: WarehouseStatus;
  totalOnHand: number;
  note: string;
  inactiveWithStock: boolean;
  positions: InventoryBalanceView[];
};

export type InventoryBatchSummaryView = {
  batchId: string;
  batchNumber: string;
  supplierBatchNumber: string | null;
  expiresAt: string | null;
  skuId: string;
  skuCode: string;
  skuStatus: CatalogLifecycleStatus;
  productName: string | null;
  totalOnHand: number;
  byWarehouse: Array<
    QuantityBucket & {
      id: string;
      code: string;
      name: string;
      status: WarehouseStatus;
    }
  >;
  byLocation: Array<
    QuantityBucket & {
      id: string;
      code: string;
      name: string | null;
      barcode: string;
      warehouseId: string;
      warehouseCode: string;
      status: WarehouseStatus;
    }
  >;
  positions: InventoryBalanceView[];
};

export type InventoryLookupView =
  | {
      kind: 'PRODUCT_BARCODE';
      scannedValue: string;
      normalizedValue: string;
      sku: InventorySkuSummaryView;
    }
  | {
      kind: 'LOCATION_BARCODE';
      scannedValue: string;
      normalizedValue: string;
      location: InventoryLocationSummaryView;
    };

export type PointInTimeStockResult = {
  warehouseId: string;
  locationId: string;
  skuId: string;
  batchId: string;
  classification: StockClassification;
  asOf: string;
  onHand: number;
};
