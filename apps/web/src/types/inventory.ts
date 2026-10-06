export type InventoryMovementType =
  | 'RECEIVE'
  | 'ISSUE'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'RECLASSIFY_OUT'
  | 'RECLASSIFY_IN'
  | 'ADJUSTMENT_IN'
  | 'ADJUSTMENT_OUT'
  | 'RETURN_IN'
  | 'RETURN_OUT'
  | 'STOCK_COUNT_ADJUSTMENT_IN'
  | 'STOCK_COUNT_ADJUSTMENT_OUT'
  | 'OPENING_BALANCE'
  | 'SYSTEM_CORRECTION';

export type InventorySourceType =
  | 'PUTAWAY'
  | 'MANUAL_ADJUSTMENT'
  | 'TRANSFER'
  | 'CLASSIFICATION_CHANGE'
  | 'STOCK_ISSUE'
  | 'SALES_FULFILLMENT'
  | 'CUSTOMER_RETURN'
  | 'SUPPLIER_RETURN'
  | 'STOCK_COUNT'
  | 'OPENING_BALANCE'
  | 'SYSTEM_CORRECTION'
  | 'SEED';

export type StockClassification = 'SELLABLE' | 'TESTER' | 'DAMAGED' | 'QUARANTINE';

export type InventoryActorRef = {
  id: string;
  displayName: string;
};

export type InventoryBalanceWarnings = {
  archivedSku: boolean;
  inactiveWarehouse: boolean;
  inactiveLocation: boolean;
  negativeOnHand: boolean;
};

export type InventoryBalanceListItem = {
  id: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  warehouseStatus: 'ACTIVE' | 'INACTIVE';
  locationId: string;
  locationCode: string;
  locationName: string | null;
  locationBarcode: string;
  locationStatus: 'ACTIVE' | 'INACTIVE';
  skuId: string;
  skuCode: string;
  skuStatus: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  productName: string | null;
  productCode: string | null;
  batchId: string;
  batchNumber: string;
  supplierBatchNumber: string | null;
  expiresAt: string | null;
  classification: StockClassification;
  /** Physical On Hand — not Available-to-Sell. */
  onHandQuantity: number;
  updatedAt: string;
  warnings: InventoryBalanceWarnings;
};

export type InventorySkuSummary = {
  skuId: string;
  skuCode: string;
  skuName: string | null;
  skuStatus: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  productId: string;
  productName: string | null;
  productCode: string | null;
  totalOnHand: number;
  storageOnHand?: number;
  inTransitOnHand?: number;
  sellableOnHand: number;
  reservedQuantity: number;
  availableQuantity: number;
  testerOnHand: number;
  damagedOnHand: number;
  quarantineOnHand: number;
  byWarehouse: Array<{
    id: string;
    code: string;
    name: string;
    status: 'ACTIVE' | 'INACTIVE';
    onHandQuantity: number;
  }>;
  byBatch: Array<{
    id: string;
    code: string;
    name: string | null;
    expiresAt: string | null;
    onHandQuantity: number;
  }>;
  byLocation: Array<{
    id: string;
    code: string;
    name: string | null;
    barcode: string;
    warehouseId: string;
    warehouseCode: string;
    status: 'ACTIVE' | 'INACTIVE';
    onHandQuantity: number;
  }>;
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
    warehouseStatus: 'ACTIVE' | 'INACTIVE';
    locationId: string;
    locationCode: string;
    locationName: string | null;
    locationBarcode: string;
    locationStatus: 'ACTIVE' | 'INACTIVE';
    batchId: string;
    batchNumber: string;
    classification: StockClassification;
    onHandQuantity: number;
  }>;
};

export type InventoryLocationSummary = {
  locationId: string;
  locationCode: string;
  locationName: string | null;
  locationBarcode: string;
  locationStatus: 'ACTIVE' | 'INACTIVE';
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  warehouseStatus: 'ACTIVE' | 'INACTIVE';
  totalOnHand: number;
  note: string;
  inactiveWithStock: boolean;
  positions: InventoryBalanceListItem[];
};

export type InventoryMovementListItem = {
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
  classification?: StockClassification;
  sourceType: InventorySourceType;
  sourceId: string;
  sourceLineId: string;
  operationId: string | null;
  reasonCode: string | null;
  notes: string | null;
  reversalOfMovementId: string | null;
  occurredAt: string;
  createdAt: string;
  createdBy: InventoryActorRef | null;
};

export type InventoryMovementDetail = InventoryMovementListItem;
