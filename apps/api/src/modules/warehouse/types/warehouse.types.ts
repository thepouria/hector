import type { WarehouseStatus } from '@hector/database';

export type WarehouseView = {
  id: string;
  companyId: string;
  code: string;
  name: string;
  status: WarehouseStatus;
  isDefault: boolean;
  address: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type WarehouseOptionView = {
  id: string;
  code: string;
  name: string;
  status: WarehouseStatus;
  isDefault: boolean;
};
