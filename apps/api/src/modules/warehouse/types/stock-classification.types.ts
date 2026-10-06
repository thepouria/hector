import type { StockClassification } from '@hector/database';

export type StockClassificationChangeActorRef = {
  id: string;
  firstName: string | null;
  lastName: string | null;
};

export type StockClassificationChangeView = {
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
  createdBy: StockClassificationChangeActorRef;
  createdAt: string;
};
