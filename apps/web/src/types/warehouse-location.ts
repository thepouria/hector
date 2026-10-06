export type WarehouseLocationType = 'ZONE' | 'AISLE' | 'RACK' | 'SHELF' | 'BIN';
export type WarehouseLocationStatus = 'ACTIVE' | 'INACTIVE';

export type WarehouseLocation = {
  id: string;
  companyId: string;
  warehouseId: string;
  parentId: string | null;
  type: WarehouseLocationType;
  code: string;
  name: string | null;
  barcode: string;
  status: WarehouseLocationStatus;
  sortOrder: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  breadcrumb?: Array<{ id: string; code: string; name: string | null }>;
  children?: WarehouseLocation[];
};
