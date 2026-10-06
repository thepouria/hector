export type StockClassification = 'SELLABLE' | 'TESTER' | 'DAMAGED' | 'QUARANTINE';

export type StockClassificationChange = {
  id: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  locationId: string;
  locationCode: string;
  locationName: string | null;
  locationBarcode: string;
  skuId: string;
  skuCode: string;
  skuName: string | null;
  productName: string | null;
  batchId: string;
  batchNumber: string;
  fromClassification: StockClassification;
  toClassification: StockClassification;
  quantity: number;
  reason: string | null;
  notes: string | null;
  operationId: string;
  createdBy: {
    id: string;
    firstName: string | null;
    lastName: string | null;
  };
  createdAt: string;
};

export type ChangeStockClassificationBody = {
  warehouseId: string;
  locationId: string;
  skuId: string;
  batchId: string;
  fromClassification: StockClassification;
  toClassification: StockClassification;
  quantity: number;
  reason?: string;
  notes?: string;
  requestId?: string;
};
