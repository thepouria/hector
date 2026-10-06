export type WarehouseStatus = 'ACTIVE' | 'INACTIVE';

export type Warehouse = {
  id: string;
  companyId: string;
  code: string;
  name: string;
  status: WarehouseStatus;
  isDefault: boolean;
  address: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};
