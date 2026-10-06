import type { PurchasingLifecycleStatus } from '@hector/database';

export type SupplierContactView = {
  id: string;
  companyId: string;
  supplierId: string;
  name: string;
  role: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  isPrimary: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
};

export type SupplierNoteAuthorView = {
  id: string;
  displayName: string;
};

export type SupplierNoteView = {
  id: string;
  companyId: string;
  supplierId: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  author: SupplierNoteAuthorView;
};

export type SupplierListItemView = {
  id: string;
  companyId: string;
  name: string;
  legalName: string | null;
  code: string | null;
  status: PurchasingLifecycleStatus;
  phone: string | null;
  email: string | null;
  address: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  primaryContact: Pick<SupplierContactView, 'id' | 'name' | 'phone' | 'mobile' | 'email'> | null;
};

export type SupplierDetailView = SupplierListItemView & {
  contacts: SupplierContactView[];
};

export type SupplierOptionView = {
  id: string;
  name: string;
  code: string | null;
  status: PurchasingLifecycleStatus;
};
