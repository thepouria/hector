import type { WarehouseLocationType, WarehouseStatus } from '@hector/database';

export type WarehouseLocationView = {
  id: string;
  companyId: string;
  warehouseId: string;
  parentId: string | null;
  type: WarehouseLocationType;
  code: string;
  name: string | null;
  barcode: string;
  status: WarehouseStatus;
  sortOrder: number;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  breadcrumb?: Array<{ id: string; code: string; name: string | null }>;
};

export type WarehouseLocationTreeNode = WarehouseLocationView & {
  children: WarehouseLocationTreeNode[];
};
