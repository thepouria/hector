import { apiRequest } from '../api/client';
import type {
  AuditDetail,
  AuditListItem,
  AuthorizationSnapshot,
  Company,
  Member,
  PaginationMeta,
  PermissionCatalogItem,
  Role,
} from '@/types/api';
import type {
  AttributeDefinition,
  AttributeOption,
  Brand,
  CatalogLookupHit,
  CatalogStats,
  Category,
  CategoryAttributeAssignment,
  CategoryAttributeSuggestion,
  CategoryTreeNode,
  EntityAttributeValue,
  Product,
  PutEntityAttributeItem,
  Sku,
  VariantOption,
  VariantOptionValue,
  Barcode,
  BarcodeResolveResult,
  BarcodeType,
  AttributeScope,
  AttributeType,
} from '@/types/catalog';
import type {
  AddPurchaseOrderItemBody,
  CancelPurchaseOrderBody,
  CreatePurchaseOrderBody,
  PurchaseOrder,
  PurchaseOrderListItem,
  PurchaseOrderTransitionBody,
  SupplierContact,
  SupplierDetail,
  SupplierListItem,
  SupplierNote,
  SupplierOffer,
  SupplierOption,
  UpdatePurchaseOrderBody,
  UpdatePurchaseOrderItemBody,
} from '@/types/purchasing';
import type {
  EligiblePurchaseOrder,
  GoodsReceiptDetail,
  GoodsReceiptListItem,
  PurchaseOrderReceivingProgress,
  ScanApplyResult,
  ScanResolveResult,
} from '@/types/goods-receipt';
import type { BatchDetail, BatchListItem } from '@/types/batch';
import type { Warehouse } from '@/types/warehouse';
import type { WarehouseLocation } from '@/types/warehouse-location';
import type {
  PendingPutawayLine,
  PutawayDetail,
  PutawayListItem,
  PutawayLocationRef,
  PutawayScanApplyResult,
} from '@/types/putaway';
import type {
  InventoryBalanceListItem,
  InventoryLocationSummary,
  InventoryMovementDetail,
  InventoryMovementListItem,
  InventorySkuSummary,
} from '@/types/inventory';
import type {
  StockTransferDetail,
  StockTransferItemInput,
  StockTransferListItem,
  StockTransferScanApplyResult,
} from '@/types/stock-transfer';
import type {
  ChangeStockClassificationBody,
  StockClassificationChange,
} from '@/types/stock-classification';
import type {
  StockIssueDetail,
  StockIssueItemInput,
  StockIssueListItem,
  StockIssueScanApplyResult,
} from '@/types/stock-issue';
import type {
  InventoryAdjustmentDetail,
  InventoryAdjustmentItemInput,
  InventoryAdjustmentListItem,
} from '@/types/inventory-adjustment';
import type {
  StockCountDetail,
  StockCountListItem,
  StockCountReview,
  StockCountScanApplyResult,
} from '@/types/stock-count';
import type {
  SupplierReturnExecutionDetail,
  SupplierReturnExecutionItemInput,
  SupplierReturnExecutionListItem,
  SupplierReturnExecutionScanApplyResult,
  SupplierReturnWarehouseDetail,
  SupplierReturnWarehouseListItem,
} from '@/types/supplier-return-execution';

export async function fetchCompanies(): Promise<Company[]> {
  const result = await apiRequest<{ data: Company[] }>('/api/v1/companies');
  return result.data;
}

export async function fetchCompany(companyId: string): Promise<Company> {
  const result = await apiRequest<{ data: Company }>(`/api/v1/companies/${companyId}`, {
    companyId,
  });
  return result.data;
}

export async function updateCompany(
  companyId: string,
  body: { name?: string; timezone?: string },
): Promise<Company> {
  const result = await apiRequest<{ data: Company }>(`/api/v1/companies/${companyId}`, {
    method: 'PATCH',
    companyId,
    body,
  });
  return result.data;
}

export async function fetchAuthorization(companyId: string): Promise<AuthorizationSnapshot> {
  const result = await apiRequest<{ data: AuthorizationSnapshot }>('/api/v1/me/authorization', {
    companyId,
  });
  return result.data;
}

export async function fetchMembers(
  companyId: string,
  query: Record<string, string | number | undefined> = {},
): Promise<{ data: Member[]; meta: PaginationMeta }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return apiRequest(`/api/v1/members${qs ? `?${qs}` : ''}`, { companyId });
}

export async function fetchMember(companyId: string, memberId: string): Promise<Member> {
  const result = await apiRequest<{ data: Member }>(`/api/v1/members/${memberId}`, {
    companyId,
  });
  return result.data;
}

export async function updateMemberStatus(
  companyId: string,
  memberId: string,
  status: 'ACTIVE' | 'SUSPENDED',
): Promise<Member> {
  const result = await apiRequest<{ data: Member }>(`/api/v1/members/${memberId}`, {
    method: 'PATCH',
    companyId,
    body: { status },
  });
  return result.data;
}

export async function removeMember(companyId: string, memberId: string): Promise<Member> {
  const result = await apiRequest<{ data: Member }>(`/api/v1/members/${memberId}`, {
    method: 'DELETE',
    companyId,
  });
  return result.data;
}

export async function createMember(
  companyId: string,
  body: { email: string; roleIds: string[] },
): Promise<Member> {
  const result = await apiRequest<{ data: Member }>('/api/v1/members', {
    method: 'POST',
    companyId,
    body,
  });
  return result.data;
}

export async function replaceMemberRoles(
  companyId: string,
  memberId: string,
  roleIds: string[],
): Promise<Member> {
  const result = await apiRequest<{ data: Member }>(`/api/v1/members/${memberId}/roles`, {
    method: 'PUT',
    companyId,
    body: { roleIds },
  });
  return result.data;
}

export async function fetchRoles(
  companyId: string,
  query: Record<string, string | number | undefined> = {},
): Promise<{ data: Role[]; meta: PaginationMeta }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return apiRequest(`/api/v1/roles${qs ? `?${qs}` : ''}`, { companyId });
}

export async function fetchRole(companyId: string, roleId: string): Promise<Role> {
  const result = await apiRequest<{ data: Role }>(`/api/v1/roles/${roleId}`, { companyId });
  return result.data;
}

export async function createRole(
  companyId: string,
  body: { name: string; key: string; description?: string; permissionIds?: string[] },
): Promise<Role> {
  const result = await apiRequest<{ data: Role }>('/api/v1/roles', {
    method: 'POST',
    companyId,
    body,
  });
  return result.data;
}

export async function updateRole(
  companyId: string,
  roleId: string,
  body: { name?: string; description?: string | null },
): Promise<Role> {
  const result = await apiRequest<{ data: Role }>(`/api/v1/roles/${roleId}`, {
    method: 'PATCH',
    companyId,
    body,
  });
  return result.data;
}

export async function replaceRolePermissions(
  companyId: string,
  roleId: string,
  permissionIds: string[],
): Promise<Role> {
  const result = await apiRequest<{ data: Role }>(`/api/v1/roles/${roleId}/permissions`, {
    method: 'PUT',
    companyId,
    body: { permissionIds },
  });
  return result.data;
}

export async function deleteRole(companyId: string, roleId: string): Promise<void> {
  await apiRequest(`/api/v1/roles/${roleId}`, {
    method: 'DELETE',
    companyId,
  });
}

export async function fetchPermissions(companyId: string): Promise<PermissionCatalogItem[]> {
  const result = await apiRequest<{ data: PermissionCatalogItem[] }>('/api/v1/permissions', {
    companyId,
  });
  return result.data;
}

export async function fetchAuditLogs(
  companyId: string,
  query: Record<string, string | number | undefined> = {},
): Promise<{ data: AuditListItem[]; meta: PaginationMeta }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return apiRequest(`/api/v1/audit-logs${qs ? `?${qs}` : ''}`, { companyId });
}

export async function fetchAuditLog(companyId: string, auditLogId: string): Promise<AuditDetail> {
  const result = await apiRequest<{ data: AuditDetail }>(`/api/v1/audit-logs/${auditLogId}`, {
    companyId,
  });
  return result.data;
}

// --- Catalog: cross-entity queries ---

/** Max hits returned by GET /catalog/lookup. */
export const CATALOG_LOOKUP_MAX_LIMIT = 20;

export async function fetchCatalogLookup(
  companyId: string,
  search: string,
  limit?: number,
): Promise<CatalogLookupHit[]> {
  const result = await apiRequest<{ data: CatalogLookupHit[] }>(
    `/api/v1/catalog/lookup${toQueryString({ search, limit })}`,
    { companyId },
  );
  return result.data;
}

export async function fetchCatalogStats(companyId: string): Promise<CatalogStats> {
  const result = await apiRequest<{ data: CatalogStats }>('/api/v1/catalog/stats', { companyId });
  return result.data;
}

// --- Catalog: Brands ---

export async function fetchBrands(
  companyId: string,
  query: Record<string, string | number | undefined> = {},
): Promise<{ data: Brand[]; meta: PaginationMeta }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return apiRequest(`/api/v1/catalog/brands${qs ? `?${qs}` : ''}`, { companyId });
}

export async function createBrand(
  companyId: string,
  body: { name: string; code?: string },
): Promise<Brand> {
  const result = await apiRequest<{ data: Brand }>('/api/v1/catalog/brands', {
    method: 'POST',
    companyId,
    body,
  });
  return result.data;
}

export async function updateBrand(
  companyId: string,
  brandId: string,
  body: { name?: string; code?: string | null },
): Promise<Brand> {
  const result = await apiRequest<{ data: Brand }>(`/api/v1/catalog/brands/${brandId}`, {
    method: 'PATCH',
    companyId,
    body,
  });
  return result.data;
}

export async function archiveBrand(companyId: string, brandId: string): Promise<Brand> {
  const result = await apiRequest<{ data: Brand }>(
    `/api/v1/catalog/brands/${brandId}/archive`,
    { method: 'POST', companyId },
  );
  return result.data;
}

export async function activateBrand(companyId: string, brandId: string): Promise<Brand> {
  const result = await apiRequest<{ data: Brand }>(
    `/api/v1/catalog/brands/${brandId}/activate`,
    { method: 'POST', companyId },
  );
  return result.data;
}

// --- Purchasing: Suppliers ---

export async function fetchSuppliers(
  companyId: string,
  query: Record<string, string | number | undefined> = {},
): Promise<{ data: SupplierListItem[]; meta: PaginationMeta }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return apiRequest(`/api/v1/purchasing/suppliers${qs ? `?${qs}` : ''}`, { companyId });
}

export async function fetchSupplier(
  companyId: string,
  supplierId: string,
): Promise<SupplierDetail> {
  const result = await apiRequest<{ data: SupplierDetail }>(
    `/api/v1/purchasing/suppliers/${supplierId}`,
    { companyId },
  );
  return result.data;
}

export async function createSupplier(
  companyId: string,
  body: {
    name: string;
    legalName?: string;
    code?: string;
    phone?: string;
    email?: string;
    address?: string;
  },
): Promise<SupplierListItem> {
  const result = await apiRequest<{ data: SupplierListItem }>('/api/v1/purchasing/suppliers', {
    method: 'POST',
    companyId,
    body,
  });
  return result.data;
}

export async function updateSupplier(
  companyId: string,
  supplierId: string,
  body: {
    name?: string;
    legalName?: string | null;
    code?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
  },
): Promise<SupplierListItem> {
  const result = await apiRequest<{ data: SupplierListItem }>(
    `/api/v1/purchasing/suppliers/${supplierId}`,
    { method: 'PATCH', companyId, body },
  );
  return result.data;
}

export async function activateSupplier(
  companyId: string,
  supplierId: string,
): Promise<SupplierListItem> {
  const result = await apiRequest<{ data: SupplierListItem }>(
    `/api/v1/purchasing/suppliers/${supplierId}/activate`,
    { method: 'POST', companyId },
  );
  return result.data;
}

export async function deactivateSupplier(
  companyId: string,
  supplierId: string,
): Promise<SupplierListItem> {
  const result = await apiRequest<{ data: SupplierListItem }>(
    `/api/v1/purchasing/suppliers/${supplierId}/deactivate`,
    { method: 'POST', companyId },
  );
  return result.data;
}

export async function archiveSupplier(
  companyId: string,
  supplierId: string,
): Promise<SupplierListItem> {
  const result = await apiRequest<{ data: SupplierListItem }>(
    `/api/v1/purchasing/suppliers/${supplierId}/archive`,
    { method: 'POST', companyId },
  );
  return result.data;
}

export async function fetchSupplierContacts(
  companyId: string,
  supplierId: string,
): Promise<SupplierContact[]> {
  const result = await apiRequest<{ data: SupplierContact[] }>(
    `/api/v1/purchasing/suppliers/${supplierId}/contacts`,
    { companyId },
  );
  return result.data;
}

export async function createSupplierContact(
  companyId: string,
  supplierId: string,
  body: {
    name: string;
    role?: string;
    phone?: string;
    mobile?: string;
    email?: string;
    notes?: string;
    isPrimary?: boolean;
  },
): Promise<SupplierContact> {
  const result = await apiRequest<{ data: SupplierContact }>(
    `/api/v1/purchasing/suppliers/${supplierId}/contacts`,
    { method: 'POST', companyId, body },
  );
  return result.data;
}

export async function updateSupplierContact(
  companyId: string,
  supplierId: string,
  contactId: string,
  body: {
    name?: string;
    role?: string | null;
    phone?: string | null;
    mobile?: string | null;
    email?: string | null;
    notes?: string | null;
  },
): Promise<SupplierContact> {
  const result = await apiRequest<{ data: SupplierContact }>(
    `/api/v1/purchasing/suppliers/${supplierId}/contacts/${contactId}`,
    { method: 'PATCH', companyId, body },
  );
  return result.data;
}

export async function setPrimarySupplierContact(
  companyId: string,
  supplierId: string,
  contactId: string,
): Promise<SupplierContact> {
  const result = await apiRequest<{ data: SupplierContact }>(
    `/api/v1/purchasing/suppliers/${supplierId}/contacts/${contactId}/set-primary`,
    { method: 'POST', companyId },
  );
  return result.data;
}

export async function archiveSupplierContact(
  companyId: string,
  supplierId: string,
  contactId: string,
): Promise<SupplierContact> {
  const result = await apiRequest<{ data: SupplierContact }>(
    `/api/v1/purchasing/suppliers/${supplierId}/contacts/${contactId}/archive`,
    { method: 'POST', companyId },
  );
  return result.data;
}

export async function fetchSupplierNotes(
  companyId: string,
  supplierId: string,
  query: Record<string, string | number | undefined> = {},
): Promise<{ data: SupplierNote[]; meta: PaginationMeta }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return apiRequest(
    `/api/v1/purchasing/suppliers/${supplierId}/notes${qs ? `?${qs}` : ''}`,
    { companyId },
  );
}

export async function createSupplierNote(
  companyId: string,
  supplierId: string,
  body: { body: string },
): Promise<SupplierNote> {
  const result = await apiRequest<{ data: SupplierNote }>(
    `/api/v1/purchasing/suppliers/${supplierId}/notes`,
    { method: 'POST', companyId, body },
  );
  return result.data;
}

// --- Purchasing: Supplier offers ---

export async function fetchSupplierOffers(
  companyId: string,
  query: Record<string, string | number | boolean | undefined> = {},
): Promise<{ data: SupplierOffer[]; meta: PaginationMeta }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return apiRequest(`/api/v1/purchasing/offers${qs ? `?${qs}` : ''}`, { companyId });
}

export async function fetchSupplierOffer(
  companyId: string,
  offerId: string,
): Promise<SupplierOffer> {
  const result = await apiRequest<{ data: SupplierOffer }>(
    `/api/v1/purchasing/offers/${offerId}`,
    { companyId },
  );
  return result.data;
}

export async function compareSupplierOffers(
  companyId: string,
  skuId: string,
  excludeExpired = false,
): Promise<SupplierOffer[]> {
  const params = new URLSearchParams({ skuId });
  if (excludeExpired) params.set('excludeExpired', 'true');
  const result = await apiRequest<{ data: SupplierOffer[] }>(
    `/api/v1/purchasing/offers/compare?${params.toString()}`,
    { companyId },
  );
  return result.data;
}

export async function fetchLatestSupplierOffer(
  companyId: string,
  supplierId: string,
  skuId: string,
): Promise<SupplierOffer | null> {
  const params = new URLSearchParams({ supplierId, skuId });
  const result = await apiRequest<{ data: SupplierOffer | null }>(
    `/api/v1/purchasing/offers/latest?${params.toString()}`,
    { companyId },
  );
  return result.data;
}

export async function createSupplierOffer(
  companyId: string,
  body: {
    supplierId: string;
    skuId: string;
    unitPrice: string;
    currency: 'IRR' | 'USD';
    quotedAt: string;
    purchaseType?: 'CASH' | 'TERM_CREDIT' | 'FX_CREDIT';
    paymentTermType?: 'IMMEDIATE' | 'NET_DAYS' | 'FIXED_DATE';
    netDays?: number;
    quotedQuantity?: number;
    minimumQuantity?: number;
    availableQuantity?: number;
    referenceFxRate?: string;
    referenceFxBaseCurrency?: 'IRR' | 'USD';
    referenceFxQuoteCurrency?: 'IRR' | 'USD';
    validUntil?: string;
    supplierContactId?: string;
    notes?: string;
  },
): Promise<SupplierOffer> {
  const result = await apiRequest<{ data: SupplierOffer }>('/api/v1/purchasing/offers', {
    method: 'POST',
    companyId,
    body,
  });
  return result.data;
}

export async function updateSupplierOffer(
  companyId: string,
  offerId: string,
  body: Record<string, unknown>,
): Promise<SupplierOffer> {
  const result = await apiRequest<{ data: SupplierOffer }>(
    `/api/v1/purchasing/offers/${offerId}`,
    { method: 'PATCH', companyId, body },
  );
  return result.data;
}

export async function archiveSupplierOffer(
  companyId: string,
  offerId: string,
): Promise<SupplierOffer> {
  const result = await apiRequest<{ data: SupplierOffer }>(
    `/api/v1/purchasing/offers/${offerId}/archive`,
    { method: 'POST', companyId },
  );
  return result.data;
}

export async function fetchSupplierOptions(
  companyId: string,
  query: Record<string, string | number | undefined> = {},
): Promise<{ data: SupplierOption[]; meta: PaginationMeta }> {
  const params = new URLSearchParams({ view: 'options' });
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return apiRequest(`/api/v1/purchasing/suppliers?${params.toString()}`, { companyId });
}

// --- Purchasing: Purchase orders ---

export async function fetchPurchaseOrders(
  companyId: string,
  query: Record<string, string | number | boolean | undefined> = {},
): Promise<{ data: PurchaseOrderListItem[]; meta: PaginationMeta }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return apiRequest(`/api/v1/purchasing/purchase-orders${qs ? `?${qs}` : ''}`, { companyId });
}

export async function fetchPurchaseOrder(
  companyId: string,
  purchaseOrderId: string,
): Promise<PurchaseOrder> {
  const result = await apiRequest<{ data: PurchaseOrder }>(
    `/api/v1/purchasing/purchase-orders/${purchaseOrderId}`,
    { companyId },
  );
  return result.data;
}

export type PurchaseOrderActivityItem = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
  actor: { id: string | null; displayName: string };
  summary: string;
  reason: string | null;
  changes: Array<{ field: string; before: string | null; after: string | null }>;
};

export async function fetchPurchaseOrderActivity(
  companyId: string,
  purchaseOrderId: string,
  query: { page?: number; pageSize?: number } = {},
): Promise<{ data: PurchaseOrderActivityItem[]; meta: PaginationMeta }> {
  const params = new URLSearchParams();
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));
  const qs = params.toString();
  return apiRequest(
    `/api/v1/purchasing/purchase-orders/${purchaseOrderId}/activity${qs ? `?${qs}` : ''}`,
    { companyId },
  );
}

export async function createPurchaseOrder(
  companyId: string,
  body: CreatePurchaseOrderBody,
): Promise<PurchaseOrder> {
  const result = await apiRequest<{ data: PurchaseOrder }>('/api/v1/purchasing/purchase-orders', {
    method: 'POST',
    companyId,
    body,
  });
  return result.data;
}

export async function updatePurchaseOrder(
  companyId: string,
  purchaseOrderId: string,
  body: UpdatePurchaseOrderBody,
): Promise<PurchaseOrder> {
  const result = await apiRequest<{ data: PurchaseOrder }>(
    `/api/v1/purchasing/purchase-orders/${purchaseOrderId}`,
    { method: 'PATCH', companyId, body },
  );
  return result.data;
}

export async function addPurchaseOrderItem(
  companyId: string,
  purchaseOrderId: string,
  body: AddPurchaseOrderItemBody,
): Promise<PurchaseOrder> {
  const result = await apiRequest<{ data: PurchaseOrder }>(
    `/api/v1/purchasing/purchase-orders/${purchaseOrderId}/items`,
    { method: 'POST', companyId, body },
  );
  return result.data;
}

export async function updatePurchaseOrderItem(
  companyId: string,
  purchaseOrderId: string,
  itemId: string,
  body: UpdatePurchaseOrderItemBody,
): Promise<PurchaseOrder> {
  const result = await apiRequest<{ data: PurchaseOrder }>(
    `/api/v1/purchasing/purchase-orders/${purchaseOrderId}/items/${itemId}`,
    { method: 'PATCH', companyId, body },
  );
  return result.data;
}

export async function removePurchaseOrderItem(
  companyId: string,
  purchaseOrderId: string,
  itemId: string,
): Promise<PurchaseOrder> {
  const result = await apiRequest<{ data: PurchaseOrder }>(
    `/api/v1/purchasing/purchase-orders/${purchaseOrderId}/items/${itemId}`,
    { method: 'DELETE', companyId },
  );
  return result.data;
}

export async function approvePurchaseOrder(
  companyId: string,
  purchaseOrderId: string,
  body: PurchaseOrderTransitionBody = {},
): Promise<PurchaseOrder> {
  const result = await apiRequest<{ data: PurchaseOrder }>(
    `/api/v1/purchasing/purchase-orders/${purchaseOrderId}/approve`,
    { method: 'POST', companyId, body },
  );
  return result.data;
}

export async function markPurchaseOrderOrdered(
  companyId: string,
  purchaseOrderId: string,
  body: PurchaseOrderTransitionBody & {
    orderDate?: string;
    supplierOrderReference?: string;
  } = {},
): Promise<PurchaseOrder> {
  const result = await apiRequest<{ data: PurchaseOrder }>(
    `/api/v1/purchasing/purchase-orders/${purchaseOrderId}/order`,
    { method: 'POST', companyId, body },
  );
  return result.data;
}

export async function cancelPurchaseOrder(
  companyId: string,
  purchaseOrderId: string,
  body: CancelPurchaseOrderBody = {},
): Promise<PurchaseOrder> {
  const result = await apiRequest<{ data: PurchaseOrder }>(
    `/api/v1/purchasing/purchase-orders/${purchaseOrderId}/cancel`,
    { method: 'POST', companyId, body },
  );
  return result.data;
}

export async function fetchPurchaseOrderCosts(
  companyId: string,
  purchaseOrderId: string,
  query: Record<string, string | undefined> = {},
): Promise<{
  data: import('@/types/purchasing').PurchaseOrderCost[];
  summary: {
    purchaseCostTotalsByCurrency: import('@/types/purchasing').PurchaseCostTotalsByCurrency;
    referenceAcquisitionTotal: {
      amount: string;
      currency: import('@/types/purchasing').OfferCurrency;
    } | null;
  };
}> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return apiRequest(
    `/api/v1/purchasing/purchase-orders/${purchaseOrderId}/costs${qs ? `?${qs}` : ''}`,
    { companyId },
  );
}

export async function createPurchaseOrderCost(
  companyId: string,
  purchaseOrderId: string,
  body: import('@/types/purchasing').CreatePurchaseOrderCostBody,
): Promise<import('@/types/purchasing').PurchaseOrderCost> {
  const result = await apiRequest<{ data: import('@/types/purchasing').PurchaseOrderCost }>(
    `/api/v1/purchasing/purchase-orders/${purchaseOrderId}/costs`,
    { method: 'POST', companyId, body },
  );
  return result.data;
}

export async function updatePurchaseOrderCost(
  companyId: string,
  purchaseOrderId: string,
  costId: string,
  body: import('@/types/purchasing').UpdatePurchaseOrderCostBody,
): Promise<import('@/types/purchasing').PurchaseOrderCost> {
  const result = await apiRequest<{ data: import('@/types/purchasing').PurchaseOrderCost }>(
    `/api/v1/purchasing/purchase-orders/${purchaseOrderId}/costs/${costId}`,
    { method: 'PATCH', companyId, body },
  );
  return result.data;
}

export async function removePurchaseOrderCost(
  companyId: string,
  purchaseOrderId: string,
  costId: string,
): Promise<{ deleted: true }> {
  const result = await apiRequest<{ data: { deleted: true } }>(
    `/api/v1/purchasing/purchase-orders/${purchaseOrderId}/costs/${costId}`,
    { method: 'DELETE', companyId },
  );
  return result.data;
}

export async function voidPurchaseOrderCost(
  companyId: string,
  purchaseOrderId: string,
  costId: string,
  reason: string,
): Promise<import('@/types/purchasing').PurchaseOrderCost> {
  const result = await apiRequest<{ data: import('@/types/purchasing').PurchaseOrderCost }>(
    `/api/v1/purchasing/purchase-orders/${purchaseOrderId}/costs/${costId}/void`,
    { method: 'POST', companyId, body: { reason } },
  );
  return result.data;
}

export async function fetchPurchasingSummary(
  companyId: string,
): Promise<import('@/types/purchasing').PurchasingSummary> {
  const result = await apiRequest<{ data: import('@/types/purchasing').PurchasingSummary }>(
    '/api/v1/purchasing/summary',
    { companyId },
  );
  return result.data;
}

export async function fetchPurchasingDashboard(
  companyId: string,
  query: Record<string, string | undefined> = {},
): Promise<import('@/types/purchasing').PurchasingDashboard> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  const result = await apiRequest<{ data: import('@/types/purchasing').PurchasingDashboard }>(
    `/api/v1/purchasing/dashboard${qs ? `?${qs}` : ''}`,
    { companyId },
  );
  return result.data;
}

export async function fetchPurchaseOrderCorrections(
  companyId: string,
  purchaseOrderId: string,
): Promise<import('@/types/purchasing').PurchaseOrderCorrection[]> {
  const result = await apiRequest<{ data: import('@/types/purchasing').PurchaseOrderCorrection[] }>(
    `/api/v1/purchasing/purchase-orders/${purchaseOrderId}/corrections`,
    { companyId },
  );
  return result.data;
}

export async function fetchPurchaseOrderDiscrepancies(
  companyId: string,
  purchaseOrderId: string,
): Promise<import('@/types/purchasing').PurchaseDiscrepancy[]> {
  const result = await apiRequest<{ data: import('@/types/purchasing').PurchaseDiscrepancy[] }>(
    `/api/v1/purchasing/purchase-orders/${purchaseOrderId}/discrepancies`,
    { companyId },
  );
  return result.data;
}

export async function createPurchaseOrderDiscrepancy(
  companyId: string,
  purchaseOrderId: string,
  body: {
    purchaseOrderItemId: string;
    type: import('@/types/purchasing').PurchaseDiscrepancyType;
    source: import('@/types/purchasing').PurchaseDiscrepancySource;
    quantity: number;
    reason: string;
    notes?: string;
  },
): Promise<import('@/types/purchasing').PurchaseDiscrepancy> {
  const result = await apiRequest<{ data: import('@/types/purchasing').PurchaseDiscrepancy }>(
    `/api/v1/purchasing/purchase-orders/${purchaseOrderId}/discrepancies`,
    { method: 'POST', companyId, body },
  );
  return result.data;
}

export async function createPurchaseOrderCorrection(
  companyId: string,
  purchaseOrderId: string,
  body: {
    type: import('@/types/purchasing').PurchaseCorrectionType;
    reason: string;
    version: number;
    purchaseOrderItemId?: string;
    quantity?: number;
    unitPrice?: string;
    paymentTermType?: import('@/types/purchasing').PaymentTermType;
    netDays?: number;
    dueDate?: string;
    obligationAmount?: string;
    referenceFxRate?: string;
    referenceFxRateAt?: string;
  },
): Promise<import('@/types/purchasing').PurchaseOrderCorrection> {
  const result = await apiRequest<{ data: import('@/types/purchasing').PurchaseOrderCorrection }>(
    `/api/v1/purchasing/purchase-orders/${purchaseOrderId}/corrections`,
    { method: 'POST', companyId, body },
  );
  return result.data;
}

export async function shortClosePurchaseOrderItem(
  companyId: string,
  purchaseOrderId: string,
  itemId: string,
  body: { quantity?: number; reason: string; notes?: string; version?: number },
): Promise<{
  item: {
    purchaseOrderItemId: string;
    orderedQuantity: number;
    receivedQuantity: number;
    shortQuantity: number;
    closedUnfulfilledQuantity: number;
    remainingQuantity: number;
  };
  purchaseOrderStatus: string;
  receivingOutcome: string;
}> {
  const result = await apiRequest<{
    data: {
      item: {
        purchaseOrderItemId: string;
        orderedQuantity: number;
        receivedQuantity: number;
        shortQuantity: number;
        closedUnfulfilledQuantity: number;
        remainingQuantity: number;
      };
      purchaseOrderStatus: string;
      receivingOutcome: string;
    };
  }>(`/api/v1/purchasing/purchase-orders/${purchaseOrderId}/items/${itemId}/short-close`, {
    method: 'POST',
    companyId,
    body,
  });
  return result.data;
}

export async function closeRemainingPurchaseOrderItem(
  companyId: string,
  purchaseOrderId: string,
  itemId: string,
  body: { reason: string; notes?: string; version?: number },
): Promise<{
  item: {
    purchaseOrderItemId: string;
    orderedQuantity: number;
    receivedQuantity: number;
    shortQuantity: number;
    closedUnfulfilledQuantity: number;
    remainingQuantity: number;
  };
  purchaseOrderStatus: string;
  receivingOutcome: string;
}> {
  const result = await apiRequest<{
    data: {
      item: {
        purchaseOrderItemId: string;
        orderedQuantity: number;
        receivedQuantity: number;
        shortQuantity: number;
        closedUnfulfilledQuantity: number;
        remainingQuantity: number;
      };
      purchaseOrderStatus: string;
      receivingOutcome: string;
    };
  }>(`/api/v1/purchasing/purchase-orders/${purchaseOrderId}/items/${itemId}/close-remaining`, {
    method: 'POST',
    companyId,
    body,
  });
  return result.data;
}

export async function fetchPurchaseOrderReceiving(
  companyId: string,
  purchaseOrderId: string,
): Promise<import('@/types/goods-receipt').PurchaseOrderReceivingProgress> {
  const result = await apiRequest<{
    data: import('@/types/goods-receipt').PurchaseOrderReceivingProgress;
  }>(`/api/v1/purchasing/purchase-orders/${purchaseOrderId}/receiving`, { companyId });
  return result.data;
}

export async function fetchPurchaseReturns(
  companyId: string,
  query: Record<string, string | undefined> = {},
): Promise<{ data: import('@/types/purchasing').PurchaseReturn[]; meta: PaginationMeta }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return apiRequest(`/api/v1/purchasing/purchase-returns${qs ? `?${qs}` : ''}`, { companyId });
}

export async function fetchPurchaseReturn(
  companyId: string,
  purchaseReturnId: string,
): Promise<import('@/types/purchasing').PurchaseReturn> {
  const result = await apiRequest<{ data: import('@/types/purchasing').PurchaseReturn }>(
    `/api/v1/purchasing/purchase-returns/${purchaseReturnId}`,
    { companyId },
  );
  return result.data;
}

export async function createPurchaseReturn(
  companyId: string,
  body: {
    purchaseOrderId: string;
    reason: import('@/types/purchasing').PurchaseReturnReason;
    expectedResolution?: import('@/types/purchasing').PurchaseReturnResolution;
    notes?: string;
    items: Array<{
      purchaseOrderItemId?: string;
      skuId?: string;
      quantity: number;
      reason?: import('@/types/purchasing').PurchaseReturnReason;
      notes?: string;
    }>;
  },
): Promise<import('@/types/purchasing').PurchaseReturn> {
  const result = await apiRequest<{ data: import('@/types/purchasing').PurchaseReturn }>(
    '/api/v1/purchasing/purchase-returns',
    { method: 'POST', companyId, body },
  );
  return result.data;
}

export async function approvePurchaseReturn(
  companyId: string,
  purchaseReturnId: string,
): Promise<import('@/types/purchasing').PurchaseReturn> {
  const result = await apiRequest<{ data: import('@/types/purchasing').PurchaseReturn }>(
    `/api/v1/purchasing/purchase-returns/${purchaseReturnId}/approve`,
    { method: 'POST', companyId },
  );
  return result.data;
}

export async function cancelPurchaseReturn(
  companyId: string,
  purchaseReturnId: string,
  reason: string,
): Promise<import('@/types/purchasing').PurchaseReturn> {
  const result = await apiRequest<{ data: import('@/types/purchasing').PurchaseReturn }>(
    `/api/v1/purchasing/purchase-returns/${purchaseReturnId}/cancel`,
    { method: 'POST', companyId, body: { reason } },
  );
  return result.data;
}

// --- Catalog: Categories ---

export async function fetchCategoryTree(companyId: string): Promise<CategoryTreeNode[]> {
  const result = await apiRequest<{ data: CategoryTreeNode[] }>('/api/v1/catalog/categories/tree', {
    companyId,
  });
  return result.data;
}

export async function fetchCategories(
  companyId: string,
  query: Record<string, string | number | boolean | undefined> = {},
): Promise<{ data: Category[]; meta: PaginationMeta }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return apiRequest(`/api/v1/catalog/categories${qs ? `?${qs}` : ''}`, { companyId });
}

export async function createCategory(
  companyId: string,
  body: { name: string; code?: string; parentId?: string; sortOrder?: number },
): Promise<Category> {
  const result = await apiRequest<{ data: Category }>('/api/v1/catalog/categories', {
    method: 'POST',
    companyId,
    body,
  });
  return result.data;
}

export async function updateCategory(
  companyId: string,
  categoryId: string,
  body: { name?: string; code?: string | null; sortOrder?: number },
): Promise<Category> {
  const result = await apiRequest<{ data: Category }>(
    `/api/v1/catalog/categories/${categoryId}`,
    { method: 'PATCH', companyId, body },
  );
  return result.data;
}

export async function moveCategory(
  companyId: string,
  categoryId: string,
  parentId: string | null,
): Promise<Category> {
  const result = await apiRequest<{ data: Category }>(
    `/api/v1/catalog/categories/${categoryId}/move`,
    { method: 'POST', companyId, body: { parentId } },
  );
  return result.data;
}

export async function archiveCategory(companyId: string, categoryId: string): Promise<Category> {
  const result = await apiRequest<{ data: Category }>(
    `/api/v1/catalog/categories/${categoryId}/archive`,
    { method: 'POST', companyId },
  );
  return result.data;
}

export async function activateCategory(companyId: string, categoryId: string): Promise<Category> {
  const result = await apiRequest<{ data: Category }>(
    `/api/v1/catalog/categories/${categoryId}/activate`,
    { method: 'POST', companyId },
  );
  return result.data;
}

// --- Catalog: Products ---

export async function fetchProducts(
  companyId: string,
  query: Record<string, string | number | boolean | undefined> = {},
): Promise<{ data: Product[]; meta: PaginationMeta }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return apiRequest(`/api/v1/catalog/products${qs ? `?${qs}` : ''}`, { companyId });
}

export async function fetchProduct(companyId: string, productId: string): Promise<Product> {
  const result = await apiRequest<{ data: Product }>(`/api/v1/catalog/products/${productId}`, {
    companyId,
  });
  return result.data;
}

export async function createProduct(
  companyId: string,
  body: {
    name: string;
    code?: string;
    description?: string;
    brandId?: string;
    categoryId?: string;
  },
): Promise<Product> {
  const result = await apiRequest<{ data: Product }>('/api/v1/catalog/products', {
    method: 'POST',
    companyId,
    body,
  });
  return result.data;
}

export async function updateProduct(
  companyId: string,
  productId: string,
  body: {
    name?: string;
    code?: string | null;
    description?: string | null;
    brandId?: string | null;
    categoryId?: string | null;
  },
): Promise<Product> {
  const result = await apiRequest<{ data: Product }>(`/api/v1/catalog/products/${productId}`, {
    method: 'PATCH',
    companyId,
    body,
  });
  return result.data;
}

export async function deactivateProduct(companyId: string, productId: string): Promise<Product> {
  const result = await apiRequest<{ data: Product }>(
    `/api/v1/catalog/products/${productId}/deactivate`,
    { method: 'POST', companyId },
  );
  return result.data;
}

export async function activateProduct(companyId: string, productId: string): Promise<Product> {
  const result = await apiRequest<{ data: Product }>(
    `/api/v1/catalog/products/${productId}/activate`,
    { method: 'POST', companyId },
  );
  return result.data;
}

export async function archiveProduct(companyId: string, productId: string): Promise<Product> {
  const result = await apiRequest<{ data: Product }>(
    `/api/v1/catalog/products/${productId}/archive`,
    { method: 'POST', companyId },
  );
  return result.data;
}

// --- Catalog: SKUs ---

function toQueryString(query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export async function fetchSkus(
  companyId: string,
  query: Record<string, string | number | undefined> = {},
): Promise<{ data: Sku[]; meta: PaginationMeta }> {
  return apiRequest(`/api/v1/catalog/skus${toQueryString(query)}`, { companyId });
}

export async function fetchProductSkus(
  companyId: string,
  productId: string,
  query: Record<string, string | number | undefined> = {},
): Promise<{ data: Sku[]; meta: PaginationMeta }> {
  return apiRequest(`/api/v1/catalog/products/${productId}/skus${toQueryString(query)}`, {
    companyId,
  });
}

/** Loads every SKU of a product (pages of 100). Used by the bulk generator duplicate check. */
export async function fetchAllProductSkus(companyId: string, productId: string): Promise<Sku[]> {
  const all: Sku[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const result = await fetchProductSkus(companyId, productId, { page, pageSize: 100 });
    all.push(...result.data);
    if (all.length >= result.meta.total) break;
  }
  return all;
}

export async function fetchSku(companyId: string, skuId: string): Promise<Sku> {
  const result = await apiRequest<{ data: Sku }>(`/api/v1/catalog/skus/${skuId}`, { companyId });
  return result.data;
}

export type SkuInput = { code: string; name?: string; optionValueIds?: string[] };

export async function createSku(
  companyId: string,
  productId: string,
  body: SkuInput,
): Promise<Sku> {
  const result = await apiRequest<{ data: Sku }>(`/api/v1/catalog/products/${productId}/skus`, {
    method: 'POST',
    companyId,
    body,
  });
  return result.data;
}

export async function bulkCreateSkus(
  companyId: string,
  productId: string,
  items: SkuInput[],
): Promise<{ data: Sku[]; meta: { created: number } }> {
  return apiRequest(`/api/v1/catalog/products/${productId}/skus/bulk`, {
    method: 'POST',
    companyId,
    body: { items },
  });
}

export async function updateSku(
  companyId: string,
  skuId: string,
  body: { code?: string; name?: string | null; optionValueIds?: string[] },
): Promise<Sku> {
  const result = await apiRequest<{ data: Sku }>(`/api/v1/catalog/skus/${skuId}`, {
    method: 'PATCH',
    companyId,
    body,
  });
  return result.data;
}

async function skuLifecycle(
  companyId: string,
  skuId: string,
  action: 'deactivate' | 'activate' | 'archive',
): Promise<Sku> {
  const result = await apiRequest<{ data: Sku }>(`/api/v1/catalog/skus/${skuId}/${action}`, {
    method: 'POST',
    companyId,
  });
  return result.data;
}

export const deactivateSku = (companyId: string, skuId: string) =>
  skuLifecycle(companyId, skuId, 'deactivate');
export const activateSku = (companyId: string, skuId: string) =>
  skuLifecycle(companyId, skuId, 'activate');
export const archiveSku = (companyId: string, skuId: string) =>
  skuLifecycle(companyId, skuId, 'archive');

// --- Catalog: Variant options ---

export async function fetchVariantOptions(
  companyId: string,
  productId: string,
): Promise<VariantOption[]> {
  const result = await apiRequest<{ data: VariantOption[] }>(
    `/api/v1/catalog/products/${productId}/variant-options`,
    { companyId },
  );
  return result.data;
}

export async function createVariantOption(
  companyId: string,
  productId: string,
  body: { name: string; position?: number },
): Promise<VariantOption> {
  const result = await apiRequest<{ data: VariantOption }>(
    `/api/v1/catalog/products/${productId}/variant-options`,
    { method: 'POST', companyId, body },
  );
  return result.data;
}

export async function updateVariantOption(
  companyId: string,
  optionId: string,
  body: { name?: string; position?: number },
): Promise<VariantOption> {
  const result = await apiRequest<{ data: VariantOption }>(
    `/api/v1/catalog/variant-options/${optionId}`,
    { method: 'PATCH', companyId, body },
  );
  return result.data;
}

export async function createVariantValues(
  companyId: string,
  optionId: string,
  values: string[],
): Promise<VariantOption> {
  const result = await apiRequest<{ data: VariantOption }>(
    `/api/v1/catalog/variant-options/${optionId}/values`,
    { method: 'POST', companyId, body: { values } },
  );
  return result.data;
}

export async function updateVariantValue(
  companyId: string,
  valueId: string,
  body: { value?: string; position?: number },
): Promise<VariantOptionValue> {
  const result = await apiRequest<{ data: VariantOptionValue }>(
    `/api/v1/catalog/variant-option-values/${valueId}`,
    { method: 'PATCH', companyId, body },
  );
  return result.data;
}

export async function setVariantValueActive(
  companyId: string,
  valueId: string,
  active: boolean,
): Promise<VariantOptionValue> {
  const result = await apiRequest<{ data: VariantOptionValue }>(
    `/api/v1/catalog/variant-option-values/${valueId}/${active ? 'activate' : 'deactivate'}`,
    { method: 'POST', companyId },
  );
  return result.data;
}

// --- Catalog: Barcodes (Phase 1.5) ---

export async function fetchSkuBarcodes(companyId: string, skuId: string): Promise<Barcode[]> {
  const result = await apiRequest<{ data: Barcode[] }>(
    `/api/v1/catalog/skus/${skuId}/barcodes`,
    { companyId },
  );
  return result.data;
}

export async function createSkuBarcode(
  companyId: string,
  skuId: string,
  body: { value: string; type?: BarcodeType; isPrimary?: boolean },
): Promise<Barcode> {
  const result = await apiRequest<{ data: Barcode }>(
    `/api/v1/catalog/skus/${skuId}/barcodes`,
    { method: 'POST', companyId, body },
  );
  return result.data;
}

export async function generateInternalBarcode(
  companyId: string,
  skuId: string,
): Promise<Barcode> {
  const result = await apiRequest<{ data: Barcode }>(
    `/api/v1/catalog/skus/${skuId}/barcodes/generate-internal`,
    { method: 'POST', companyId },
  );
  return result.data;
}

export async function setPrimaryBarcode(companyId: string, barcodeId: string): Promise<Barcode> {
  const result = await apiRequest<{ data: Barcode }>(
    `/api/v1/catalog/barcodes/${barcodeId}/set-primary`,
    { method: 'POST', companyId },
  );
  return result.data;
}

export async function archiveBarcode(companyId: string, barcodeId: string): Promise<Barcode> {
  const result = await apiRequest<{ data: Barcode }>(
    `/api/v1/catalog/barcodes/${barcodeId}/archive`,
    { method: 'POST', companyId },
  );
  return result.data;
}

export async function resolveBarcode(
  companyId: string,
  value: string,
): Promise<BarcodeResolveResult> {
  const result = await apiRequest<{ data: BarcodeResolveResult }>(
    '/api/v1/catalog/barcodes/resolve',
    { method: 'POST', companyId, body: { value } },
  );
  return result.data;
}

export async function detectBarcodeType(
  companyId: string,
  value: string,
): Promise<{ suggested: BarcodeType | null; candidates: BarcodeType[] }> {
  const params = new URLSearchParams({ value });
  const result = await apiRequest<{
    data: { suggested: BarcodeType | null; candidates: BarcodeType[] };
  }>(`/api/v1/catalog/barcodes/detect-type?${params.toString()}`, { companyId });
  return result.data;
}

// --- Catalog: Attribute definitions ---

export async function fetchAttributes(
  companyId: string,
  query: Record<string, string | number | undefined> = {},
): Promise<{ data: AttributeDefinition[]; meta: PaginationMeta }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return apiRequest(`/api/v1/catalog/attributes${qs ? `?${qs}` : ''}`, { companyId });
}

export async function fetchAttribute(
  companyId: string,
  attributeId: string,
): Promise<AttributeDefinition> {
  const result = await apiRequest<{ data: AttributeDefinition }>(
    `/api/v1/catalog/attributes/${attributeId}`,
    { companyId },
  );
  return result.data;
}

export async function createAttribute(
  companyId: string,
  body: {
    name: string;
    code: string;
    type: AttributeType;
    scope: AttributeScope;
    unit?: string;
    description?: string;
  },
): Promise<AttributeDefinition> {
  const result = await apiRequest<{ data: AttributeDefinition }>('/api/v1/catalog/attributes', {
    method: 'POST',
    companyId,
    body,
  });
  return result.data;
}

export async function updateAttribute(
  companyId: string,
  attributeId: string,
  body: { name?: string; unit?: string | null; description?: string | null },
): Promise<AttributeDefinition> {
  const result = await apiRequest<{ data: AttributeDefinition }>(
    `/api/v1/catalog/attributes/${attributeId}`,
    { method: 'PATCH', companyId, body },
  );
  return result.data;
}

export async function archiveAttributeDefinition(
  companyId: string,
  attributeId: string,
): Promise<AttributeDefinition> {
  const result = await apiRequest<{ data: AttributeDefinition }>(
    `/api/v1/catalog/attributes/${attributeId}/archive`,
    { method: 'POST', companyId },
  );
  return result.data;
}

export async function createAttributeOption(
  companyId: string,
  attributeId: string,
  body: { value: string; position?: number },
): Promise<AttributeOption> {
  const result = await apiRequest<{ data: AttributeOption }>(
    `/api/v1/catalog/attributes/${attributeId}/options`,
    { method: 'POST', companyId, body },
  );
  return result.data;
}

export async function updateAttributeOption(
  companyId: string,
  optionId: string,
  body: { value?: string; position?: number },
): Promise<AttributeOption> {
  const result = await apiRequest<{ data: AttributeOption }>(
    `/api/v1/catalog/attribute-options/${optionId}`,
    { method: 'PATCH', companyId, body },
  );
  return result.data;
}

export async function setAttributeOptionActive(
  companyId: string,
  optionId: string,
  active: boolean,
): Promise<AttributeOption> {
  const result = await apiRequest<{ data: AttributeOption }>(
    `/api/v1/catalog/attribute-options/${optionId}/${active ? 'activate' : 'deactivate'}`,
    { method: 'POST', companyId },
  );
  return result.data;
}

export async function fetchCategoryAttributes(
  companyId: string,
  categoryId: string,
): Promise<CategoryAttributeAssignment[]> {
  const result = await apiRequest<{ data: CategoryAttributeAssignment[] }>(
    `/api/v1/catalog/categories/${categoryId}/attributes`,
    { companyId },
  );
  return result.data;
}

export async function fetchCategorySuggestedAttributes(
  companyId: string,
  categoryId: string,
): Promise<CategoryAttributeSuggestion[]> {
  const result = await apiRequest<{ data: CategoryAttributeSuggestion[] }>(
    `/api/v1/catalog/categories/${categoryId}/suggested-attributes`,
    { companyId },
  );
  return result.data;
}

export async function replaceCategoryAttributes(
  companyId: string,
  categoryId: string,
  attributes: Array<{ attributeId: string; position?: number; isVisible?: boolean }>,
): Promise<CategoryAttributeAssignment[]> {
  const result = await apiRequest<{ data: CategoryAttributeAssignment[] }>(
    `/api/v1/catalog/categories/${categoryId}/attributes`,
    { method: 'PUT', companyId, body: { attributes } },
  );
  return result.data;
}

export async function fetchProductAttributes(
  companyId: string,
  productId: string,
): Promise<EntityAttributeValue[]> {
  const result = await apiRequest<{ data: EntityAttributeValue[] }>(
    `/api/v1/catalog/products/${productId}/attributes`,
    { companyId },
  );
  return result.data;
}

export async function putProductAttributes(
  companyId: string,
  productId: string,
  attributes: PutEntityAttributeItem[],
): Promise<EntityAttributeValue[]> {
  const result = await apiRequest<{ data: EntityAttributeValue[] }>(
    `/api/v1/catalog/products/${productId}/attributes`,
    { method: 'PUT', companyId, body: { attributes } },
  );
  return result.data;
}

export async function fetchSkuAttributes(
  companyId: string,
  skuId: string,
): Promise<EntityAttributeValue[]> {
  const result = await apiRequest<{ data: EntityAttributeValue[] }>(
    `/api/v1/catalog/skus/${skuId}/attributes`,
    { companyId },
  );
  return result.data;
}

export async function putSkuAttributes(
  companyId: string,
  skuId: string,
  attributes: PutEntityAttributeItem[],
): Promise<EntityAttributeValue[]> {
  const result = await apiRequest<{ data: EntityAttributeValue[] }>(
    `/api/v1/catalog/skus/${skuId}/attributes`,
    { method: 'PUT', companyId, body: { attributes } },
  );
  return result.data;
}

// --- Catalog: Bulk operations (Phase 1.10) ---

export type CatalogBulkSelection =
  | { mode: 'IDS'; ids: string[] }
  | {
      mode: 'QUERY';
      query: Record<string, string | number | boolean | undefined>;
      excludedIds?: string[];
      selectAll?: boolean;
    };

export type CatalogBulkCommand = {
  operation: string;
  selection: CatalogBulkSelection;
  payload?: Record<string, unknown>;
};

export type CatalogBulkPreviewResult = {
  matched: number;
  eligible: number;
  ineligible: number;
  warnings: string[];
  sample: Array<{ id: string; label: string; eligible: boolean; reason?: string }>;
};

export type CatalogBulkExecuteResult = {
  operationId: string;
  matched: number;
  succeeded: number;
  failed: number;
  skipped: number;
  failures: Array<{ id: string; code: string; message: string }>;
};

export async function previewCatalogBulk(
  companyId: string,
  body: CatalogBulkCommand,
): Promise<CatalogBulkPreviewResult> {
  const result = await apiRequest<{ data: CatalogBulkPreviewResult }>('/api/v1/catalog/bulk/preview', {
    method: 'POST',
    companyId,
    body,
  });
  return result.data;
}

export async function executeCatalogBulk(
  companyId: string,
  body: CatalogBulkCommand,
): Promise<CatalogBulkExecuteResult> {
  const result = await apiRequest<{ data: CatalogBulkExecuteResult }>('/api/v1/catalog/bulk/execute', {
    method: 'POST',
    companyId,
    body,
  });
  return result.data;
}

// --- Warehouse Master (Phase 3.2) ---

export async function fetchWarehouses(
  companyId: string,
  query: Record<string, string | number | boolean | undefined> = {},
): Promise<{ data: Warehouse[]; meta: PaginationMeta }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return apiRequest(`/api/v1/warehouses${qs ? `?${qs}` : ''}`, { companyId });
}

export async function fetchWarehouse(companyId: string, warehouseId: string): Promise<Warehouse> {
  const result = await apiRequest<{ data: Warehouse }>(`/api/v1/warehouses/${warehouseId}`, {
    companyId,
  });
  return result.data;
}

export async function createWarehouse(
  companyId: string,
  body: {
    code: string;
    name: string;
    address?: string;
    notes?: string;
    isDefault?: boolean;
  },
): Promise<Warehouse> {
  const result = await apiRequest<{ data: Warehouse }>('/api/v1/warehouses', {
    method: 'POST',
    companyId,
    body,
  });
  return result.data;
}

export async function updateWarehouse(
  companyId: string,
  warehouseId: string,
  body: {
    code?: string;
    name?: string;
    address?: string | null;
    notes?: string | null;
  },
): Promise<Warehouse> {
  const result = await apiRequest<{ data: Warehouse }>(`/api/v1/warehouses/${warehouseId}`, {
    method: 'PATCH',
    companyId,
    body,
  });
  return result.data;
}

export async function activateWarehouse(companyId: string, warehouseId: string): Promise<Warehouse> {
  const result = await apiRequest<{ data: Warehouse }>(
    `/api/v1/warehouses/${warehouseId}/activate`,
    { method: 'POST', companyId },
  );
  return result.data;
}

export async function deactivateWarehouse(
  companyId: string,
  warehouseId: string,
  body: { replacementWarehouseId?: string } = {},
): Promise<Warehouse> {
  const result = await apiRequest<{ data: Warehouse }>(
    `/api/v1/warehouses/${warehouseId}/deactivate`,
    { method: 'POST', companyId, body },
  );
  return result.data;
}

export async function setDefaultWarehouse(
  companyId: string,
  warehouseId: string,
): Promise<Warehouse> {
  const result = await apiRequest<{ data: Warehouse }>(
    `/api/v1/warehouses/${warehouseId}/set-default`,
    { method: 'POST', companyId },
  );
  return result.data;
}

// --- Warehouse Locations (Phase 3.3) ---

export async function fetchWarehouseLocations(
  companyId: string,
  warehouseId: string,
  query: Record<string, string | number | boolean | undefined | null> = {},
): Promise<{ data: WarehouseLocation[]; meta: PaginationMeta }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null) params.set(key, 'null');
    else if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return apiRequest(`/api/v1/warehouses/${warehouseId}/locations${qs ? `?${qs}` : ''}`, {
    companyId,
  });
}

export async function fetchWarehouseLocation(
  companyId: string,
  warehouseId: string,
  locationId: string,
): Promise<WarehouseLocation> {
  const result = await apiRequest<{ data: WarehouseLocation }>(
    `/api/v1/warehouses/${warehouseId}/locations/${locationId}`,
    { companyId },
  );
  return result.data;
}

export async function createWarehouseLocation(
  companyId: string,
  warehouseId: string,
  body: {
    parentId?: string | null;
    type: string;
    code: string;
    name?: string;
    notes?: string;
    sortOrder?: number;
  },
): Promise<WarehouseLocation> {
  const result = await apiRequest<{ data: WarehouseLocation }>(
    `/api/v1/warehouses/${warehouseId}/locations`,
    { method: 'POST', companyId, body },
  );
  return result.data;
}

export async function updateWarehouseLocation(
  companyId: string,
  warehouseId: string,
  locationId: string,
  body: {
    parentId?: string | null;
    type?: string;
    code?: string;
    name?: string | null;
    notes?: string | null;
    sortOrder?: number;
  },
): Promise<WarehouseLocation> {
  const result = await apiRequest<{ data: WarehouseLocation }>(
    `/api/v1/warehouses/${warehouseId}/locations/${locationId}`,
    { method: 'PATCH', companyId, body },
  );
  return result.data;
}

export async function activateWarehouseLocation(
  companyId: string,
  warehouseId: string,
  locationId: string,
): Promise<WarehouseLocation> {
  const result = await apiRequest<{ data: WarehouseLocation }>(
    `/api/v1/warehouses/${warehouseId}/locations/${locationId}/activate`,
    { method: 'POST', companyId },
  );
  return result.data;
}

export async function deactivateWarehouseLocation(
  companyId: string,
  warehouseId: string,
  locationId: string,
): Promise<WarehouseLocation> {
  const result = await apiRequest<{ data: WarehouseLocation }>(
    `/api/v1/warehouses/${warehouseId}/locations/${locationId}/deactivate`,
    { method: 'POST', companyId },
  );
  return result.data;
}

export async function resolveLocationBarcode(
  companyId: string,
  value: string,
): Promise<WarehouseLocation> {
  const result = await apiRequest<{ data: WarehouseLocation }>(
    '/api/v1/warehouse-locations/resolve-barcode',
    { method: 'POST', companyId, body: { value } },
  );
  return result.data;
}

// --- Goods Receipts (Phase 3.4) ---

export async function fetchGoodsReceipts(
  companyId: string,
  query: Record<string, string | number | boolean | undefined> = {},
): Promise<{ data: GoodsReceiptListItem[]; meta: PaginationMeta }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return apiRequest(`/api/v1/goods-receipts${qs ? `?${qs}` : ''}`, { companyId });
}

export async function fetchGoodsReceipt(
  companyId: string,
  goodsReceiptId: string,
): Promise<GoodsReceiptDetail> {
  const result = await apiRequest<{ data: GoodsReceiptDetail }>(
    `/api/v1/goods-receipts/${goodsReceiptId}`,
    { companyId },
  );
  return result.data;
}

export async function fetchEligiblePurchaseOrdersForReceipt(
  companyId: string,
): Promise<EligiblePurchaseOrder[]> {
  const result = await apiRequest<{ data: EligiblePurchaseOrder[] }>(
    '/api/v1/goods-receipts/eligible-purchase-orders',
    { companyId },
  );
  return result.data;
}

export async function fetchPurchaseOrderReceivingProgress(
  companyId: string,
  purchaseOrderId: string,
): Promise<PurchaseOrderReceivingProgress> {
  const result = await apiRequest<{ data: PurchaseOrderReceivingProgress }>(
    `/api/v1/goods-receipts/purchase-orders/${purchaseOrderId}/progress`,
    { companyId },
  );
  return result.data;
}

export async function createGoodsReceipt(
  companyId: string,
  body: {
    purchaseOrderId: string;
    warehouseId: string;
    receivedAt?: string;
    notes?: string;
    items?: Array<{
      purchaseOrderItemId: string;
      quantity: number;
      notes?: string;
    }>;
  },
): Promise<GoodsReceiptDetail> {
  const result = await apiRequest<{ data: GoodsReceiptDetail }>('/api/v1/goods-receipts', {
    method: 'POST',
    companyId,
    body,
  });
  return result.data;
}

export async function updateGoodsReceipt(
  companyId: string,
  goodsReceiptId: string,
  body: {
    receivedAt?: string | null;
    notes?: string | null;
  },
): Promise<GoodsReceiptDetail> {
  const result = await apiRequest<{ data: GoodsReceiptDetail }>(
    `/api/v1/goods-receipts/${goodsReceiptId}`,
    { method: 'PATCH', companyId, body },
  );
  return result.data;
}

export async function addGoodsReceiptItem(
  companyId: string,
  goodsReceiptId: string,
  body: {
    purchaseOrderItemId: string;
    quantity: number;
    notes?: string;
  },
): Promise<GoodsReceiptDetail> {
  const result = await apiRequest<{ data: GoodsReceiptDetail }>(
    `/api/v1/goods-receipts/${goodsReceiptId}/items`,
    { method: 'POST', companyId, body },
  );
  return result.data;
}

export async function updateGoodsReceiptItem(
  companyId: string,
  goodsReceiptId: string,
  itemId: string,
  body: {
    quantity?: number;
    notes?: string | null;
  },
): Promise<GoodsReceiptDetail> {
  const result = await apiRequest<{ data: GoodsReceiptDetail }>(
    `/api/v1/goods-receipts/${goodsReceiptId}/items/${itemId}`,
    { method: 'PATCH', companyId, body },
  );
  return result.data;
}

export async function removeGoodsReceiptItem(
  companyId: string,
  goodsReceiptId: string,
  itemId: string,
): Promise<GoodsReceiptDetail> {
  const result = await apiRequest<{ data: GoodsReceiptDetail }>(
    `/api/v1/goods-receipts/${goodsReceiptId}/items/${itemId}`,
    { method: 'DELETE', companyId },
  );
  return result.data;
}

export async function postGoodsReceipt(
  companyId: string,
  goodsReceiptId: string,
): Promise<GoodsReceiptDetail> {
  const result = await apiRequest<{ data: GoodsReceiptDetail }>(
    `/api/v1/goods-receipts/${goodsReceiptId}/post`,
    { method: 'POST', companyId },
  );
  return result.data;
}

export async function cancelGoodsReceipt(
  companyId: string,
  goodsReceiptId: string,
  body: { reason?: string } = {},
): Promise<GoodsReceiptDetail> {
  const result = await apiRequest<{ data: GoodsReceiptDetail }>(
    `/api/v1/goods-receipts/${goodsReceiptId}/cancel`,
    { method: 'POST', companyId, body },
  );
  return result.data;
}

export async function resolveGoodsReceiptScan(
  companyId: string,
  goodsReceiptId: string,
  body: { barcode: string },
): Promise<ScanResolveResult> {
  const result = await apiRequest<{ data: ScanResolveResult }>(
    `/api/v1/goods-receipts/${goodsReceiptId}/scan/resolve`,
    { method: 'POST', companyId, body },
  );
  return result.data;
}

export async function applyGoodsReceiptScan(
  companyId: string,
  goodsReceiptId: string,
  body: {
    barcode: string;
    quantity: number;
    requestId?: string;
    batchId?: string;
    supplierBatchNumber?: string | null;
    manufacturedAt?: string | null;
    expiresAt?: string | null;
  },
): Promise<ScanApplyResult> {
  const result = await apiRequest<{ data: ScanApplyResult }>(
    `/api/v1/goods-receipts/${goodsReceiptId}/scan/apply`,
    { method: 'POST', companyId, body },
  );
  return result.data;
}

// --- Batches / lots (Phase 3.7) ---

export async function fetchBatches(
  companyId: string,
  query: Record<string, string | number | boolean | undefined> = {},
): Promise<{ data: BatchListItem[]; meta: PaginationMeta }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return apiRequest(`/api/v1/warehouse/batches${qs ? `?${qs}` : ''}`, { companyId });
}

export async function fetchBatch(companyId: string, batchId: string): Promise<BatchDetail> {
  const result = await apiRequest<{ data: BatchDetail }>(
    `/api/v1/warehouse/batches/${batchId}`,
    { companyId },
  );
  return result.data;
}

export async function createBatch(
  companyId: string,
  body: {
    skuId: string;
    supplierBatchNumber?: string | null;
    manufacturedAt?: string | null;
    expiresAt?: string | null;
    notes?: string | null;
  },
): Promise<BatchDetail> {
  const result = await apiRequest<{ data: BatchDetail }>('/api/v1/warehouse/batches', {
    method: 'POST',
    companyId,
    body,
  });
  return result.data;
}

export async function updateBatchMetadata(
  companyId: string,
  batchId: string,
  body: {
    supplierBatchNumber?: string | null;
    manufacturedAt?: string | null;
    expiresAt?: string | null;
    notes?: string | null;
  },
): Promise<BatchDetail> {
  const result = await apiRequest<{ data: BatchDetail }>(
    `/api/v1/warehouse/batches/${batchId}`,
    { method: 'PATCH', companyId, body },
  );
  return result.data;
}

export async function upsertGoodsReceiptItemBatch(
  companyId: string,
  goodsReceiptId: string,
  itemId: string,
  body: {
    batchId?: string;
    supplierBatchNumber?: string | null;
    manufacturedAt?: string | null;
    expiresAt?: string | null;
    quantity: number;
  },
): Promise<GoodsReceiptDetail> {
  const result = await apiRequest<{ data: GoodsReceiptDetail }>(
    `/api/v1/goods-receipts/${goodsReceiptId}/items/${itemId}/batches`,
    { method: 'POST', companyId, body },
  );
  return result.data;
}

export async function updateGoodsReceiptItemBatch(
  companyId: string,
  goodsReceiptId: string,
  itemId: string,
  allocationId: string,
  body: { quantity: number },
): Promise<GoodsReceiptDetail> {
  const result = await apiRequest<{ data: GoodsReceiptDetail }>(
    `/api/v1/goods-receipts/${goodsReceiptId}/items/${itemId}/batches/${allocationId}`,
    { method: 'PATCH', companyId, body },
  );
  return result.data;
}

export async function removeGoodsReceiptItemBatch(
  companyId: string,
  goodsReceiptId: string,
  itemId: string,
  allocationId: string,
): Promise<GoodsReceiptDetail> {
  const result = await apiRequest<{ data: GoodsReceiptDetail }>(
    `/api/v1/goods-receipts/${goodsReceiptId}/items/${itemId}/batches/${allocationId}`,
    { method: 'DELETE', companyId },
  );
  return result.data;
}

// --- Putaways (Phase 3.8) ---

function putawayQueryString(query: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export async function fetchPutaways(
  companyId: string,
  query: Record<string, string | number | boolean | undefined> = {},
): Promise<{ data: PutawayListItem[]; meta: PaginationMeta }> {
  return apiRequest(`/api/v1/warehouse/putaways${putawayQueryString(query)}`, { companyId });
}

export async function fetchPendingPutaways(
  companyId: string,
  query: Record<string, string | number | boolean | undefined> = {},
): Promise<{ data: PendingPutawayLine[]; meta: PaginationMeta }> {
  return apiRequest(`/api/v1/warehouse/putaways/pending${putawayQueryString(query)}`, {
    companyId,
  });
}

export async function fetchPutaway(
  companyId: string,
  putawayId: string,
): Promise<PutawayDetail> {
  const result = await apiRequest<{ data: PutawayDetail }>(
    `/api/v1/warehouse/putaways/${putawayId}`,
    { companyId },
  );
  return result.data;
}

export async function createPutaway(
  companyId: string,
  body: { goodsReceiptId: string },
): Promise<PutawayDetail> {
  const result = await apiRequest<{ data: PutawayDetail }>('/api/v1/warehouse/putaways', {
    method: 'POST',
    companyId,
    body,
  });
  return result.data;
}

export async function upsertPutawayItem(
  companyId: string,
  putawayId: string,
  body: {
    receiptBatchAllocationId: string;
    warehouseLocationId: string;
    quantity: number;
  },
): Promise<PutawayDetail> {
  const result = await apiRequest<{ data: PutawayDetail }>(
    `/api/v1/warehouse/putaways/${putawayId}/items`,
    { method: 'POST', companyId, body },
  );
  return result.data;
}

export async function updatePutawayItem(
  companyId: string,
  putawayId: string,
  itemId: string,
  body: { warehouseLocationId?: string; quantity?: number },
): Promise<PutawayDetail> {
  const result = await apiRequest<{ data: PutawayDetail }>(
    `/api/v1/warehouse/putaways/${putawayId}/items/${itemId}`,
    { method: 'PATCH', companyId, body },
  );
  return result.data;
}

export async function removePutawayItem(
  companyId: string,
  putawayId: string,
  itemId: string,
): Promise<PutawayDetail> {
  const result = await apiRequest<{ data: PutawayDetail }>(
    `/api/v1/warehouse/putaways/${putawayId}/items/${itemId}`,
    { method: 'DELETE', companyId },
  );
  return result.data;
}

export async function resolvePutawayLocation(
  companyId: string,
  putawayId: string,
  body: { barcode: string },
): Promise<PutawayLocationRef> {
  const result = await apiRequest<{ data: PutawayLocationRef }>(
    `/api/v1/warehouse/putaways/${putawayId}/location/resolve`,
    { method: 'POST', companyId, body },
  );
  return result.data;
}

export async function applyPutawayScan(
  companyId: string,
  putawayId: string,
  body: {
    receiptBatchAllocationId: string;
    locationBarcode: string;
    quantity: number;
    requestId?: string;
  },
): Promise<PutawayScanApplyResult> {
  const result = await apiRequest<{ data: PutawayScanApplyResult }>(
    `/api/v1/warehouse/putaways/${putawayId}/scan/apply`,
    { method: 'POST', companyId, body },
  );
  return result.data;
}

export async function completePutaway(
  companyId: string,
  putawayId: string,
): Promise<PutawayDetail> {
  const result = await apiRequest<{ data: PutawayDetail }>(
    `/api/v1/warehouse/putaways/${putawayId}/complete`,
    { method: 'POST', companyId },
  );
  return result.data;
}

export async function cancelPutaway(
  companyId: string,
  putawayId: string,
): Promise<PutawayDetail> {
  const result = await apiRequest<{ data: PutawayDetail }>(
    `/api/v1/warehouse/putaways/${putawayId}/cancel`,
    { method: 'POST', companyId },
  );
  return result.data;
}

// --- Stock transfers (Phase 3.11) ---

function stockTransferQueryString(
  query: Record<string, string | number | boolean | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export async function fetchStockTransfers(
  companyId: string,
  query: Record<string, string | number | boolean | undefined> = {},
): Promise<{ data: StockTransferListItem[]; meta: PaginationMeta }> {
  return apiRequest(`/api/v1/warehouse/transfers${stockTransferQueryString(query)}`, {
    companyId,
  });
}

export async function fetchStockTransfer(
  companyId: string,
  transferId: string,
): Promise<StockTransferDetail> {
  const result = await apiRequest<{ data: StockTransferDetail }>(
    `/api/v1/warehouse/transfers/${transferId}`,
    { companyId },
  );
  return result.data;
}

export async function createStockTransfer(
  companyId: string,
  body: {
    sourceWarehouseId: string;
    destinationWarehouseId: string;
    notes?: string;
    externalReference?: string;
    items?: StockTransferItemInput[];
  },
): Promise<StockTransferDetail> {
  const result = await apiRequest<{ data: StockTransferDetail }>('/api/v1/warehouse/transfers', {
    method: 'POST',
    companyId,
    body,
  });
  return result.data;
}

export async function updateStockTransfer(
  companyId: string,
  transferId: string,
  body: {
    sourceWarehouseId?: string;
    destinationWarehouseId?: string;
    notes?: string | null;
    externalReference?: string | null;
    items?: StockTransferItemInput[];
  },
): Promise<StockTransferDetail> {
  const result = await apiRequest<{ data: StockTransferDetail }>(
    `/api/v1/warehouse/transfers/${transferId}`,
    { method: 'PATCH', companyId, body },
  );
  return result.data;
}

export async function upsertStockTransferItem(
  companyId: string,
  transferId: string,
  body: StockTransferItemInput & { increment?: boolean },
): Promise<StockTransferDetail> {
  const result = await apiRequest<{ data: StockTransferDetail }>(
    `/api/v1/warehouse/transfers/${transferId}/items`,
    { method: 'POST', companyId, body },
  );
  return result.data;
}

export async function removeStockTransferItem(
  companyId: string,
  transferId: string,
  itemId: string,
): Promise<StockTransferDetail> {
  const result = await apiRequest<{ data: StockTransferDetail }>(
    `/api/v1/warehouse/transfers/${transferId}/items/${itemId}`,
    { method: 'DELETE', companyId },
  );
  return result.data;
}

export async function applyStockTransferScan(
  companyId: string,
  transferId: string,
  body: {
    requestId: string;
    sourceLocationBarcode?: string;
    destinationLocationBarcode?: string;
    productBarcode?: string;
    batchId?: string;
    quantity?: number;
  },
): Promise<StockTransferScanApplyResult> {
  const result = await apiRequest<{ data: StockTransferScanApplyResult }>(
    `/api/v1/warehouse/transfers/${transferId}/scan-apply`,
    { method: 'POST', companyId, body },
  );
  return result.data;
}

export async function dispatchStockTransfer(
  companyId: string,
  transferId: string,
): Promise<StockTransferDetail> {
  const result = await apiRequest<{ data: StockTransferDetail }>(
    `/api/v1/warehouse/transfers/${transferId}/dispatch`,
    { method: 'POST', companyId },
  );
  return result.data;
}

export async function completeStockTransfer(
  companyId: string,
  transferId: string,
): Promise<StockTransferDetail> {
  const result = await apiRequest<{ data: StockTransferDetail }>(
    `/api/v1/warehouse/transfers/${transferId}/complete`,
    { method: 'POST', companyId },
  );
  return result.data;
}

export async function cancelStockTransfer(
  companyId: string,
  transferId: string,
): Promise<StockTransferDetail> {
  const result = await apiRequest<{ data: StockTransferDetail }>(
    `/api/v1/warehouse/transfers/${transferId}/cancel`,
    { method: 'POST', companyId },
  );
  return result.data;
}

// --- Stock Classification + Issues (Phase 3.12) ---

export async function changeStockClassification(
  companyId: string,
  body: ChangeStockClassificationBody,
): Promise<StockClassificationChange> {
  const result = await apiRequest<{ data: StockClassificationChange }>(
    '/api/v1/warehouse/stock/classification-change',
    { method: 'POST', companyId, body },
  );
  return result.data;
}

export async function fetchStockClassificationChanges(
  companyId: string,
  query: Record<string, string | number | boolean | undefined> = {},
): Promise<{ data: StockClassificationChange[]; meta: PaginationMeta }> {
  return apiRequest(
    `/api/v1/warehouse/stock/classification-changes${stockTransferQueryString(query)}`,
    { companyId },
  );
}

export async function fetchStockIssues(
  companyId: string,
  query: Record<string, string | number | boolean | undefined> = {},
): Promise<{ data: StockIssueListItem[]; meta: PaginationMeta }> {
  return apiRequest(`/api/v1/warehouse/issues${stockTransferQueryString(query)}`, {
    companyId,
  });
}

export async function fetchStockIssue(
  companyId: string,
  issueId: string,
): Promise<StockIssueDetail> {
  const result = await apiRequest<{ data: StockIssueDetail }>(
    `/api/v1/warehouse/issues/${issueId}`,
    { companyId },
  );
  return result.data;
}

export async function createStockIssue(
  companyId: string,
  body: {
    warehouseId: string;
    reason: string;
    reasonText?: string;
    notes?: string;
    items?: StockIssueItemInput[];
  },
): Promise<StockIssueDetail> {
  const result = await apiRequest<{ data: StockIssueDetail }>('/api/v1/warehouse/issues', {
    method: 'POST',
    companyId,
    body,
  });
  return result.data;
}

export async function updateStockIssue(
  companyId: string,
  issueId: string,
  body: {
    reason?: string;
    reasonText?: string | null;
    notes?: string | null;
    items?: StockIssueItemInput[];
  },
): Promise<StockIssueDetail> {
  const result = await apiRequest<{ data: StockIssueDetail }>(
    `/api/v1/warehouse/issues/${issueId}`,
    { method: 'PATCH', companyId, body },
  );
  return result.data;
}

export async function upsertStockIssueItem(
  companyId: string,
  issueId: string,
  body: StockIssueItemInput & { increment?: boolean },
): Promise<StockIssueDetail> {
  const result = await apiRequest<{ data: StockIssueDetail }>(
    `/api/v1/warehouse/issues/${issueId}/items`,
    { method: 'POST', companyId, body },
  );
  return result.data;
}

export async function removeStockIssueItem(
  companyId: string,
  issueId: string,
  itemId: string,
): Promise<StockIssueDetail> {
  const result = await apiRequest<{ data: StockIssueDetail }>(
    `/api/v1/warehouse/issues/${issueId}/items/${itemId}`,
    { method: 'DELETE', companyId },
  );
  return result.data;
}

export async function applyStockIssueScan(
  companyId: string,
  issueId: string,
  body: {
    requestId: string;
    locationBarcode?: string;
    productBarcode?: string;
    batchId?: string;
    classification?: string;
    quantity?: number;
  },
): Promise<StockIssueScanApplyResult> {
  const result = await apiRequest<{ data: StockIssueScanApplyResult }>(
    `/api/v1/warehouse/issues/${issueId}/scan-apply`,
    { method: 'POST', companyId, body },
  );
  return result.data;
}

export async function postStockIssue(
  companyId: string,
  issueId: string,
): Promise<StockIssueDetail> {
  const result = await apiRequest<{ data: StockIssueDetail }>(
    `/api/v1/warehouse/issues/${issueId}/post`,
    { method: 'POST', companyId },
  );
  return result.data;
}

export async function cancelStockIssue(
  companyId: string,
  issueId: string,
): Promise<StockIssueDetail> {
  const result = await apiRequest<{ data: StockIssueDetail }>(
    `/api/v1/warehouse/issues/${issueId}/cancel`,
    { method: 'POST', companyId },
  );
  return result.data;
}

// --- Inventory adjustments (Phase 3.13) ---

export async function fetchInventoryAdjustments(
  companyId: string,
  query: Record<string, string | number | boolean | undefined> = {},
): Promise<{ data: InventoryAdjustmentListItem[]; meta: PaginationMeta }> {
  return apiRequest(`/api/v1/warehouse/adjustments${stockTransferQueryString(query)}`, {
    companyId,
  });
}

export async function fetchInventoryAdjustment(
  companyId: string,
  adjustmentId: string,
): Promise<InventoryAdjustmentDetail> {
  const result = await apiRequest<{ data: InventoryAdjustmentDetail }>(
    `/api/v1/warehouse/adjustments/${adjustmentId}`,
    { companyId },
  );
  return result.data;
}

export async function createInventoryAdjustment(
  companyId: string,
  body: {
    warehouseId: string;
    reason: string;
    reasonText?: string;
    notes?: string;
    items?: InventoryAdjustmentItemInput[];
  },
): Promise<InventoryAdjustmentDetail> {
  const result = await apiRequest<{ data: InventoryAdjustmentDetail }>(
    '/api/v1/warehouse/adjustments',
    { method: 'POST', companyId, body },
  );
  return result.data;
}

export async function updateInventoryAdjustment(
  companyId: string,
  adjustmentId: string,
  body: {
    warehouseId?: string;
    reason?: string;
    reasonText?: string | null;
    notes?: string | null;
    items?: InventoryAdjustmentItemInput[];
  },
): Promise<InventoryAdjustmentDetail> {
  const result = await apiRequest<{ data: InventoryAdjustmentDetail }>(
    `/api/v1/warehouse/adjustments/${adjustmentId}`,
    { method: 'PATCH', companyId, body },
  );
  return result.data;
}

export async function upsertInventoryAdjustmentItem(
  companyId: string,
  adjustmentId: string,
  body: InventoryAdjustmentItemInput,
): Promise<InventoryAdjustmentDetail> {
  const result = await apiRequest<{ data: InventoryAdjustmentDetail }>(
    `/api/v1/warehouse/adjustments/${adjustmentId}/items`,
    { method: 'POST', companyId, body },
  );
  return result.data;
}

export async function removeInventoryAdjustmentItem(
  companyId: string,
  adjustmentId: string,
  itemId: string,
): Promise<InventoryAdjustmentDetail> {
  const result = await apiRequest<{ data: InventoryAdjustmentDetail }>(
    `/api/v1/warehouse/adjustments/${adjustmentId}/items/${itemId}`,
    { method: 'DELETE', companyId },
  );
  return result.data;
}

export async function submitInventoryAdjustment(
  companyId: string,
  adjustmentId: string,
): Promise<InventoryAdjustmentDetail> {
  const result = await apiRequest<{ data: InventoryAdjustmentDetail }>(
    `/api/v1/warehouse/adjustments/${adjustmentId}/submit`,
    { method: 'POST', companyId },
  );
  return result.data;
}

export async function approveInventoryAdjustment(
  companyId: string,
  adjustmentId: string,
): Promise<InventoryAdjustmentDetail> {
  const result = await apiRequest<{ data: InventoryAdjustmentDetail }>(
    `/api/v1/warehouse/adjustments/${adjustmentId}/approve`,
    { method: 'POST', companyId },
  );
  return result.data;
}

export async function rejectInventoryAdjustment(
  companyId: string,
  adjustmentId: string,
): Promise<InventoryAdjustmentDetail> {
  const result = await apiRequest<{ data: InventoryAdjustmentDetail }>(
    `/api/v1/warehouse/adjustments/${adjustmentId}/reject`,
    { method: 'POST', companyId },
  );
  return result.data;
}

export async function postInventoryAdjustment(
  companyId: string,
  adjustmentId: string,
): Promise<InventoryAdjustmentDetail> {
  const result = await apiRequest<{ data: InventoryAdjustmentDetail }>(
    `/api/v1/warehouse/adjustments/${adjustmentId}/post`,
    { method: 'POST', companyId },
  );
  return result.data;
}

export async function cancelInventoryAdjustment(
  companyId: string,
  adjustmentId: string,
): Promise<InventoryAdjustmentDetail> {
  const result = await apiRequest<{ data: InventoryAdjustmentDetail }>(
    `/api/v1/warehouse/adjustments/${adjustmentId}/cancel`,
    { method: 'POST', companyId },
  );
  return result.data;
}

// --- Stock counts (Phase 3.13) ---

export async function fetchStockCounts(
  companyId: string,
  query: Record<string, string | number | boolean | undefined> = {},
): Promise<{ data: StockCountListItem[]; meta: PaginationMeta }> {
  return apiRequest(`/api/v1/warehouse/counts${stockTransferQueryString(query)}`, { companyId });
}

export async function fetchStockCount(
  companyId: string,
  countId: string,
): Promise<StockCountDetail> {
  const result = await apiRequest<{ data: StockCountDetail }>(
    `/api/v1/warehouse/counts/${countId}`,
    { companyId },
  );
  return result.data;
}

export async function fetchStockCountReview(
  companyId: string,
  countId: string,
): Promise<StockCountReview> {
  const result = await apiRequest<{ data: StockCountReview }>(
    `/api/v1/warehouse/counts/${countId}/review`,
    { companyId },
  );
  return result.data;
}

export async function createStockCount(
  companyId: string,
  body: {
    warehouseId: string;
    type: string;
    locationIds?: string[];
    skuIds?: string[];
    classifications?: string[];
    blindCount?: boolean;
    allowDiscoveredItems?: boolean;
    highDifferenceThreshold?: number;
    notes?: string;
  },
): Promise<StockCountDetail> {
  const result = await apiRequest<{ data: StockCountDetail }>('/api/v1/warehouse/counts', {
    method: 'POST',
    companyId,
    body,
  });
  return result.data;
}

export async function updateStockCount(
  companyId: string,
  countId: string,
  body: {
    locationIds?: string[];
    skuIds?: string[];
    classifications?: string[];
    blindCount?: boolean;
    allowDiscoveredItems?: boolean;
    highDifferenceThreshold?: number | null;
    notes?: string | null;
  },
): Promise<StockCountDetail> {
  const result = await apiRequest<{ data: StockCountDetail }>(
    `/api/v1/warehouse/counts/${countId}`,
    { method: 'PATCH', companyId, body },
  );
  return result.data;
}

export async function startStockCount(
  companyId: string,
  countId: string,
): Promise<StockCountDetail> {
  const result = await apiRequest<{ data: StockCountDetail }>(
    `/api/v1/warehouse/counts/${countId}/start`,
    { method: 'POST', companyId },
  );
  return result.data;
}

export async function recordStockCountItem(
  companyId: string,
  countId: string,
  itemId: string,
  body: { countedQuantity: number; notes?: string; increment?: boolean },
): Promise<StockCountDetail> {
  const result = await apiRequest<{ data: StockCountDetail }>(
    `/api/v1/warehouse/counts/${countId}/items/${itemId}/record`,
    { method: 'POST', companyId, body: { itemId, ...body } },
  );
  return result.data;
}

export async function skipStockCountItem(
  companyId: string,
  countId: string,
  itemId: string,
  body: { notes?: string } = {},
): Promise<StockCountDetail> {
  const result = await apiRequest<{ data: StockCountDetail }>(
    `/api/v1/warehouse/counts/${countId}/items/${itemId}/skip`,
    { method: 'POST', companyId, body },
  );
  return result.data;
}

export async function addDiscoveredStockCountItem(
  companyId: string,
  countId: string,
  body: {
    locationId: string;
    skuId: string;
    batchId: string;
    classification?: string;
    countedQuantity: number;
    notes?: string;
  },
): Promise<StockCountDetail> {
  const result = await apiRequest<{ data: StockCountDetail }>(
    `/api/v1/warehouse/counts/${countId}/discovered-items`,
    { method: 'POST', companyId, body },
  );
  return result.data;
}

export async function applyStockCountScan(
  companyId: string,
  countId: string,
  body: {
    requestId: string;
    locationBarcode?: string;
    productBarcode?: string;
    locationId?: string;
    skuId?: string;
    batchId?: string;
    classification?: string;
    countedQuantity?: number;
    increment?: boolean;
    notes?: string;
  },
): Promise<StockCountScanApplyResult> {
  const result = await apiRequest<{ data: StockCountScanApplyResult }>(
    `/api/v1/warehouse/counts/${countId}/scan-apply`,
    { method: 'POST', companyId, body },
  );
  return result.data;
}

export async function submitStockCount(
  companyId: string,
  countId: string,
): Promise<StockCountDetail> {
  const result = await apiRequest<{ data: StockCountDetail }>(
    `/api/v1/warehouse/counts/${countId}/submit`,
    { method: 'POST', companyId },
  );
  return result.data;
}

export async function requestStockCountRecount(
  companyId: string,
  countId: string,
  body: { itemIds?: string[]; notes?: string } = {},
): Promise<StockCountDetail> {
  const result = await apiRequest<{ data: StockCountDetail }>(
    `/api/v1/warehouse/counts/${countId}/request-recount`,
    { method: 'POST', companyId, body },
  );
  return result.data;
}

export async function approveStockCount(
  companyId: string,
  countId: string,
): Promise<StockCountDetail> {
  const result = await apiRequest<{ data: StockCountDetail }>(
    `/api/v1/warehouse/counts/${countId}/approve`,
    { method: 'POST', companyId },
  );
  return result.data;
}

export async function rejectStockCount(
  companyId: string,
  countId: string,
): Promise<StockCountDetail> {
  const result = await apiRequest<{ data: StockCountDetail }>(
    `/api/v1/warehouse/counts/${countId}/reject`,
    { method: 'POST', companyId },
  );
  return result.data;
}

export async function postStockCount(
  companyId: string,
  countId: string,
): Promise<StockCountDetail> {
  const result = await apiRequest<{ data: StockCountDetail }>(
    `/api/v1/warehouse/counts/${countId}/post`,
    { method: 'POST', companyId },
  );
  return result.data;
}

export async function cancelStockCount(
  companyId: string,
  countId: string,
): Promise<StockCountDetail> {
  const result = await apiRequest<{ data: StockCountDetail }>(
    `/api/v1/warehouse/counts/${countId}/cancel`,
    { method: 'POST', companyId },
  );
  return result.data;
}

// --- Supplier return executions (Phase 3.14) ---

export async function fetchWarehouseSupplierReturns(
  companyId: string,
  query: Record<string, string | number | boolean | undefined> = {},
): Promise<{ data: SupplierReturnWarehouseListItem[]; meta: PaginationMeta }> {
  return apiRequest(`/api/v1/warehouse/supplier-returns${stockTransferQueryString(query)}`, {
    companyId,
  });
}

export async function fetchWarehouseSupplierReturn(
  companyId: string,
  purchaseReturnId: string,
): Promise<SupplierReturnWarehouseDetail> {
  const result = await apiRequest<{ data: SupplierReturnWarehouseDetail }>(
    `/api/v1/warehouse/supplier-returns/${purchaseReturnId}`,
    { companyId },
  );
  return result.data;
}

export async function createSupplierReturnExecution(
  companyId: string,
  purchaseReturnId: string,
  body: {
    warehouseId: string;
    notes?: string;
    items?: SupplierReturnExecutionItemInput[];
  },
): Promise<SupplierReturnExecutionDetail> {
  const result = await apiRequest<{ data: SupplierReturnExecutionDetail }>(
    `/api/v1/warehouse/supplier-returns/${purchaseReturnId}/executions`,
    { method: 'POST', companyId, body },
  );
  return result.data;
}

export async function fetchSupplierReturnExecutions(
  companyId: string,
  query: Record<string, string | number | boolean | undefined> = {},
): Promise<{ data: SupplierReturnExecutionListItem[]; meta: PaginationMeta }> {
  return apiRequest(
    `/api/v1/warehouse/supplier-return-executions${stockTransferQueryString(query)}`,
    { companyId },
  );
}

export async function fetchSupplierReturnExecution(
  companyId: string,
  executionId: string,
): Promise<SupplierReturnExecutionDetail> {
  const result = await apiRequest<{ data: SupplierReturnExecutionDetail }>(
    `/api/v1/warehouse/supplier-return-executions/${executionId}`,
    { companyId },
  );
  return result.data;
}

export async function updateSupplierReturnExecution(
  companyId: string,
  executionId: string,
  body: {
    notes?: string | null;
    items?: SupplierReturnExecutionItemInput[];
  },
): Promise<SupplierReturnExecutionDetail> {
  const result = await apiRequest<{ data: SupplierReturnExecutionDetail }>(
    `/api/v1/warehouse/supplier-return-executions/${executionId}`,
    { method: 'PATCH', companyId, body },
  );
  return result.data;
}

export async function upsertSupplierReturnExecutionItem(
  companyId: string,
  executionId: string,
  body: SupplierReturnExecutionItemInput & { increment?: boolean },
): Promise<SupplierReturnExecutionDetail> {
  const result = await apiRequest<{ data: SupplierReturnExecutionDetail }>(
    `/api/v1/warehouse/supplier-return-executions/${executionId}/items`,
    { method: 'POST', companyId, body },
  );
  return result.data;
}

export async function removeSupplierReturnExecutionItem(
  companyId: string,
  executionId: string,
  itemId: string,
): Promise<SupplierReturnExecutionDetail> {
  const result = await apiRequest<{ data: SupplierReturnExecutionDetail }>(
    `/api/v1/warehouse/supplier-return-executions/${executionId}/items/${itemId}`,
    { method: 'DELETE', companyId },
  );
  return result.data;
}

export async function applySupplierReturnExecutionScan(
  companyId: string,
  executionId: string,
  body: {
    requestId: string;
    purchaseReturnItemId: string;
    locationBarcode?: string;
    productBarcode?: string;
    batchId?: string;
    classification?: string;
    quantity?: number;
  },
): Promise<SupplierReturnExecutionScanApplyResult> {
  const result = await apiRequest<{ data: SupplierReturnExecutionScanApplyResult }>(
    `/api/v1/warehouse/supplier-return-executions/${executionId}/scan-apply`,
    { method: 'POST', companyId, body },
  );
  return result.data;
}

export async function dispatchSupplierReturnExecution(
  companyId: string,
  executionId: string,
): Promise<SupplierReturnExecutionDetail> {
  const result = await apiRequest<{ data: SupplierReturnExecutionDetail }>(
    `/api/v1/warehouse/supplier-return-executions/${executionId}/dispatch`,
    { method: 'POST', companyId },
  );
  return result.data;
}

export async function cancelSupplierReturnExecution(
  companyId: string,
  executionId: string,
): Promise<SupplierReturnExecutionDetail> {
  const result = await apiRequest<{ data: SupplierReturnExecutionDetail }>(
    `/api/v1/warehouse/supplier-return-executions/${executionId}/cancel`,
    { method: 'POST', companyId },
  );
  return result.data;
}

// --- Inventory (Phase 3.9–3.10) ---

function inventoryQueryString(
  query: Record<string, string | number | boolean | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export async function fetchInventoryBalances(
  companyId: string,
  query: Record<string, string | number | boolean | undefined> = {},
): Promise<{ data: InventoryBalanceListItem[]; meta: PaginationMeta }> {
  return apiRequest(`/api/v1/warehouse/inventory${inventoryQueryString(query)}`, { companyId });
}

export async function fetchInventorySkuSummary(
  companyId: string,
  skuId: string,
): Promise<InventorySkuSummary> {
  const result = await apiRequest<{ data: InventorySkuSummary }>(
    `/api/v1/warehouse/inventory/skus/${skuId}`,
    { companyId },
  );
  return result.data;
}

export async function fetchInventoryLocationSummary(
  companyId: string,
  locationId: string,
): Promise<InventoryLocationSummary> {
  const result = await apiRequest<{ data: InventoryLocationSummary }>(
    `/api/v1/warehouse/inventory/locations/${locationId}`,
    { companyId },
  );
  return result.data;
}

export async function fetchInventoryLookup(
  companyId: string,
  query: { value: string; kind?: 'PRODUCT' | 'LOCATION' | 'AUTO' },
): Promise<unknown> {
  const result = await apiRequest<{ data: unknown }>(
    `/api/v1/warehouse/inventory/lookup${inventoryQueryString(query)}`,
    { companyId },
  );
  return result.data;
}

export async function fetchInventoryMovements(
  companyId: string,
  query: Record<string, string | number | boolean | undefined> = {},
): Promise<{ data: InventoryMovementListItem[]; meta: PaginationMeta }> {
  return apiRequest(
    `/api/v1/warehouse/inventory/movements${inventoryQueryString(query)}`,
    { companyId },
  );
}

export async function fetchInventoryMovement(
  companyId: string,
  movementId: string,
): Promise<InventoryMovementDetail> {
  const result = await apiRequest<{ data: InventoryMovementDetail }>(
    `/api/v1/warehouse/inventory/movements/${movementId}`,
    { companyId },
  );
  return result.data;
}

// --- Reservations + Valuation (Phase 3.15) ---

export type InventoryAvailability = {
  warehouseId: string;
  skuId: string;
  classification: 'SELLABLE';
  onHand: number;
  reserved: number;
  available: number;
};

export type InventoryReservationListItem = {
  id: string;
  warehouseId: string;
  skuId: string;
  sourceType: string;
  sourceId: string;
  quantity: number;
  remainingQuantity: number;
  status: string;
  expiresAt: string | null;
  createdAt: string;
  warehouse?: { id: string; code: string; name: string };
  sku?: { id: string; code: string; name: string | null; product?: { name: string } };
};

export type InventoryValuationSummary = {
  totalInventoryValue: string;
  valuedQuantity: number;
  partiallyValuedQuantity: number;
  unvaluedQuantity: number;
  valuationCompleteness: string;
  note: string;
};

export type InventoryCostLayerListItem = {
  id: string;
  warehouseId: string;
  skuId: string;
  batchId: string | null;
  classification: string;
  sourceType: string;
  receivedAt: string;
  originalQuantity: number;
  remainingQuantity: number;
  valuationStatus: string;
  originalCurrency: string | null;
  baseCurrencyUnitCost: string | null;
  remainingValue: string | null;
  warehouse?: { id: string; code: string; name: string };
  sku?: { id: string; code: string; name: string | null };
  batch?: { id: string; batchNumber: string } | null;
};

export async function fetchInventoryAvailability(
  companyId: string,
  warehouseId: string,
  skuId: string,
): Promise<InventoryAvailability> {
  const result = await apiRequest<{ data: InventoryAvailability }>(
    `/api/v1/warehouse/availability${inventoryQueryString({ warehouseId, skuId })}`,
    { companyId },
  );
  return result.data;
}

export async function fetchInventoryReservations(
  companyId: string,
  query: Record<string, string | number | boolean | undefined> = {},
): Promise<{ data: InventoryReservationListItem[]; meta: PaginationMeta }> {
  return apiRequest(
    `/api/v1/warehouse/reservations${inventoryQueryString(query)}`,
    { companyId },
  );
}

export async function fetchInventoryValuationSummary(
  companyId: string,
): Promise<InventoryValuationSummary> {
  const result = await apiRequest<{ data: InventoryValuationSummary }>(
    `/api/v1/warehouse/valuation`,
    { companyId },
  );
  return result.data;
}

export async function fetchInventoryValuationByWarehouse(
  companyId: string,
): Promise<{ data: Array<{ warehouseId: string; code: string; name: string; valuedQuantity: number; unvaluedQuantity: number; totalValue: string }> }> {
  return apiRequest(`/api/v1/warehouse/valuation/by-warehouse`, { companyId });
}

export async function fetchInventoryValuationByClassification(
  companyId: string,
): Promise<{ data: Array<{ classification: string; valuedQuantity: number; unvaluedQuantity: number; totalValue: string }> }> {
  return apiRequest(`/api/v1/warehouse/valuation/by-classification`, { companyId });
}

export async function fetchInventoryCostLayers(
  companyId: string,
  query: Record<string, string | number | boolean | undefined> = {},
): Promise<{ data: InventoryCostLayerListItem[]; meta: PaginationMeta }> {
  return apiRequest(
    `/api/v1/warehouse/cost-layers${inventoryQueryString(query)}`,
    { companyId },
  );
}

// --- Warehouse Dashboard + Scanner (Phase 3.16) ---

export type WarehouseDashboardSummary = {
  skusWithStock: number;
  totalUnits: number;
  sellableUnits: number;
  reservedUnits: number;
  availableUnits: number;
  testerUnits: number;
  damagedUnits: number;
  quarantineUnits: number;
  pendingReceipts: number;
  pendingPutaways: number;
  openTransfers: number;
  openStockCounts: number;
  countsAwaitingApproval: number;
  draftIssues: number;
  pendingSupplierReturns: number;
  pendingSupplierReturnsOpen: number;
  recentMovements: Array<{
    id: string;
    movementType: string;
    quantityDelta: number;
    occurredAt: string;
    skuCode: string;
    warehouseCode: string;
    classification: string;
    sourceType?: string;
    sourceId?: string;
    actorName?: string | null;
  }>;
  recentReceipts: Array<{
    id: string;
    number: string;
    status: string;
    createdAt: string;
    postedAt?: string | null;
    receivedAt?: string | null;
    warehouseCode: string;
    supplierName?: string;
    supplierCode?: string;
    purchaseOrderNumber?: string;
    receivedQuantity?: number;
    actorName?: string | null;
  }>;
  summary: {
    skusWithStock: number;
    totalUnits: number;
    sellableUnits: number;
    reservedUnits: number;
    availableUnits: number;
    testerUnits: number;
    damagedUnits: number;
    quarantineUnits: number;
  };
  classificationSummary: {
    sellableUnits: number;
    testerUnits: number;
    damagedUnits: number;
    quarantineUnits: number;
  };
  warehouseSummary: Array<{
    warehouseId: string;
    warehouseCode: string;
    warehouseName: string;
    warehouseStatus: string;
    totalUnits: number;
    sellableUnits: number;
    reservedUnits: number;
    availableUnits: number;
    testerUnits: number;
    damagedUnits: number;
    quarantineUnits: number;
  }>;
  operations: {
    pendingReceipts: number;
    pendingPutaways: number;
    openTransfers: number;
    openStockCounts: number;
    countsAwaitingApproval: number;
    draftIssues: number;
    pendingSupplierReturns: number;
    pendingSupplierReturnExecutions: number;
    pendingSupplierReturnsOpen: number;
  };
  recentActivity: {
    recentMovements: WarehouseDashboardSummary['recentMovements'];
    recentReceipts: WarehouseDashboardSummary['recentReceipts'];
    recentTransfers: Array<{
      id: string;
      number: string;
      status: string;
      createdAt: string;
      completedAt: string | null;
      sourceWarehouseCode: string;
      destinationWarehouseCode: string;
      quantity: number;
    }>;
  };
  stockDiscrepancies: Array<{
    stockCountItemId: string;
    stockCountId: string;
    stockCountNumber: string;
    skuCode: string;
    locationCode: string;
    classification: string;
    systemQuantity: number;
    countedQuantity: number;
    difference: number;
  }>;
  valuation: {
    totalInventoryValue: string;
    valuedQuantity: number;
    partiallyValuedQuantity: number;
    unvaluedQuantity: number;
    valuationCompleteness: string;
    note: string;
  } | null;
  definitions?: Record<string, string>;
};

export type WarehouseActivityItem = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
  actor: { id: string | null; displayName: string };
  summary: string;
  reason: string | null;
  changes: Array<{ field: string; before: string | null; after: string | null }>;
  reference: string | null;
};

export type ScannerProductResolve = {
  barcode: string;
  barcodeType: string;
  skuId: string;
  skuCode: string;
  skuName: string | null;
  skuStatus: string;
  productId: string;
  productName: string;
  productCode: string | null;
  variantLabel: string | null;
};

export type ScannerLocationResolve = {
  locationId: string;
  locationCode: string;
  locationName: string | null;
  locationBarcode: string;
  locationType: string;
  locationStatus: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  warehouseStatus: string;
  pathCodes: string[];
};

export async function fetchWarehouseDashboard(
  companyId: string,
  query: { warehouseId?: string } = {},
): Promise<WarehouseDashboardSummary> {
  const result = await apiRequest<{ data: WarehouseDashboardSummary }>(
    `/api/v1/warehouse/dashboard${inventoryQueryString(query)}`,
    { companyId },
  );
  return result.data;
}

export async function fetchWarehouseEntityActivity(
  companyId: string,
  path:
    | `/api/v1/goods-receipts/${string}/activity`
    | `/api/v1/warehouse/transfers/${string}/activity`
    | `/api/v1/warehouse/adjustments/${string}/activity`
    | `/api/v1/warehouse/counts/${string}/activity`
    | `/api/v1/warehouse/issues/${string}/activity`
    | `/api/v1/warehouse/supplier-return-executions/${string}/activity`,
  query: { page?: number; pageSize?: number } = {},
): Promise<{ data: WarehouseActivityItem[]; meta: PaginationMeta }> {
  return apiRequest(`${path}${inventoryQueryString(query)}`, { companyId });
}

export async function resolveScannerProduct(
  companyId: string,
  barcode: string,
): Promise<ScannerProductResolve> {
  const result = await apiRequest<{ data: ScannerProductResolve }>(
    `/api/v1/warehouse/scanner/products/resolve${inventoryQueryString({ barcode })}`,
    { companyId },
  );
  return result.data;
}

export async function resolveScannerLocation(
  companyId: string,
  barcode: string,
): Promise<ScannerLocationResolve> {
  const result = await apiRequest<{ data: ScannerLocationResolve }>(
    `/api/v1/warehouse/scanner/locations/resolve${inventoryQueryString({ barcode })}`,
    { companyId },
  );
  return result.data;
}

// --- Finance Accounts (Phase 4.2) ---

export type FinancialAccount = {
  id: string;
  companyId: string;
  code: string;
  name: string;
  type: 'CASH' | 'BANK' | 'WALLET' | 'OTHER';
  currency: 'IRR' | 'USD';
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  isDefault: boolean;
  description: string | null;
  bankName: string | null;
  accountNumber: string | null;
  iban: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  balance?: { amount: string; currency: 'IRR' | 'USD' };
};

export type FinancialAccountMovement = {
  id: string;
  accountId: string;
  direction: 'IN' | 'OUT';
  amount: string;
  currency: 'IRR' | 'USD';
  type: string;
  sourceType: string;
  sourceId: string | null;
  effectiveAt: string;
  postedAt: string;
  description: string | null;
  requestId: string | null;
  createdAt: string;
};

export type AccountTransfer = {
  id: string;
  number: string;
  status: 'DRAFT' | 'POSTED' | 'CANCELLED' | 'REVERSED';
  amount: string;
  currency: 'IRR' | 'USD';
  sourceAccount: {
    id: string;
    code: string;
    name: string;
    currency: 'IRR' | 'USD';
    status: string;
  };
  destinationAccount: {
    id: string;
    code: string;
    name: string;
    currency: 'IRR' | 'USD';
    status: string;
  };
  effectiveAt: string;
  notes: string | null;
  requestId: string | null;
  postedAt: string | null;
  cancelledAt: string | null;
  reversedAt: string | null;
  reversalOfTransferId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AccountsSummary = {
  byCurrency: Array<{
    currency: 'IRR' | 'USD';
    total: string;
    accounts: Array<{
      id: string;
      code: string;
      name: string;
      type: string;
      status: string;
      isDefault: boolean;
      balance: string;
    }>;
  }>;
};

export async function fetchFinancialAccounts(
  companyId: string,
  query: Record<string, string | number | boolean | undefined> = {},
): Promise<{ data: FinancialAccount[]; meta: PaginationMeta }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return apiRequest(`/api/v1/finance/accounts${qs ? `?${qs}` : ''}`, { companyId });
}

export async function fetchFinancialAccount(
  companyId: string,
  accountId: string,
): Promise<FinancialAccount> {
  const result = await apiRequest<{ data: FinancialAccount }>(
    `/api/v1/finance/accounts/${accountId}`,
    { companyId },
  );
  return result.data;
}

export async function fetchAccountsSummary(companyId: string): Promise<AccountsSummary> {
  const result = await apiRequest<{ data: AccountsSummary }>(
    '/api/v1/finance/accounts/summary',
    { companyId },
  );
  return result.data;
}

export async function createFinancialAccount(
  companyId: string,
  body: {
    code: string;
    name: string;
    type: string;
    currency: string;
    description?: string;
    bankName?: string;
    accountNumber?: string;
    iban?: string;
    isDefault?: boolean;
  },
): Promise<FinancialAccount> {
  const result = await apiRequest<{ data: FinancialAccount }>('/api/v1/finance/accounts', {
    method: 'POST',
    companyId,
    body,
  });
  return result.data;
}

export async function recordOpeningBalance(
  companyId: string,
  accountId: string,
  body: { amount: string; requestId: string; description?: string; effectiveAt?: string },
): Promise<FinancialAccountMovement> {
  const result = await apiRequest<{ data: FinancialAccountMovement }>(
    `/api/v1/finance/accounts/${accountId}/opening-balance`,
    { method: 'POST', companyId, body },
  );
  return result.data;
}

export async function fetchAccountMovements(
  companyId: string,
  accountId: string,
  query: Record<string, string | number | undefined> = {},
): Promise<{ data: FinancialAccountMovement[]; meta: PaginationMeta }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return apiRequest(
    `/api/v1/finance/accounts/${accountId}/movements${qs ? `?${qs}` : ''}`,
    { companyId },
  );
}

export async function archiveFinancialAccount(
  companyId: string,
  accountId: string,
): Promise<FinancialAccount> {
  const result = await apiRequest<{ data: FinancialAccount }>(
    `/api/v1/finance/accounts/${accountId}/archive`,
    { method: 'POST', companyId },
  );
  return result.data;
}

export async function createAccountTransfer(
  companyId: string,
  body: {
    sourceAccountId: string;
    destinationAccountId: string;
    amount: string;
    requestId: string;
    notes?: string;
    effectiveAt?: string;
    postImmediately?: boolean;
  },
): Promise<AccountTransfer> {
  const result = await apiRequest<{ data: AccountTransfer }>(
    '/api/v1/finance/account-transfers',
    { method: 'POST', companyId, body },
  );
  return result.data;
}

// --- Finance Capital + Loans (Phase 4.3) ---

export type CapitalContribution = {
  id: string;
  number: string;
  fundingType: 'OWNER_EQUITY' | 'PARTNER_EQUITY' | 'OTHER_FUNDING';
  contributorType: string;
  contributorId: string | null;
  contributorName: string;
  account: {
    id: string;
    code: string;
    name: string;
    currency: 'IRR' | 'USD';
    status: string;
  };
  amount: string;
  currency: 'IRR' | 'USD';
  status: 'DRAFT' | 'POSTED' | 'CANCELLED' | 'REVERSED';
  effectiveAt: string;
  reference: string | null;
  notes: string | null;
  requestId: string | null;
  postedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Loan = {
  id: string;
  number: string;
  lenderType: string;
  lenderName: string;
  currency: 'IRR' | 'USD';
  contractedPrincipal: string;
  receivedPrincipal: string;
  repaidPrincipal: string;
  outstandingPrincipal: string;
  overdue: boolean;
  referenceFxRate: string | null;
  status: string;
  notes: string | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function fetchCapitalContributions(
  companyId: string,
  params: { page?: number; pageSize?: number; q?: string; status?: string } = {},
): Promise<{ data: CapitalContribution[]; meta: PaginationMeta }> {
  const search = new URLSearchParams();
  if (params.page) search.set('page', String(params.page));
  if (params.pageSize) search.set('pageSize', String(params.pageSize));
  if (params.q) search.set('q', params.q);
  if (params.status) search.set('status', params.status);
  const qs = search.toString();
  return apiRequest(`/api/v1/finance/capital-contributions${qs ? `?${qs}` : ''}`, {
    companyId,
  });
}

export async function fetchCapitalContribution(
  companyId: string,
  contributionId: string,
): Promise<CapitalContribution> {
  const result = await apiRequest<{ data: CapitalContribution }>(
    `/api/v1/finance/capital-contributions/${contributionId}`,
    { companyId },
  );
  return result.data;
}

export async function createCapitalContribution(
  companyId: string,
  body: {
    fundingType: string;
    contributorType: string;
    contributorName: string;
    accountId: string;
    amount: string;
    requestId: string;
    notes?: string;
    postImmediately?: boolean;
  },
): Promise<CapitalContribution> {
  const result = await apiRequest<{ data: CapitalContribution }>(
    '/api/v1/finance/capital-contributions',
    { method: 'POST', companyId, body },
  );
  return result.data;
}

export async function fetchLoans(
  companyId: string,
  params: { page?: number; pageSize?: number; q?: string; status?: string } = {},
): Promise<{ data: Loan[]; meta: PaginationMeta }> {
  const search = new URLSearchParams();
  if (params.page) search.set('page', String(params.page));
  if (params.pageSize) search.set('pageSize', String(params.pageSize));
  if (params.q) search.set('q', params.q);
  if (params.status) search.set('status', params.status);
  const qs = search.toString();
  return apiRequest(`/api/v1/finance/loans${qs ? `?${qs}` : ''}`, { companyId });
}

export async function fetchLoan(companyId: string, loanId: string): Promise<Loan> {
  const result = await apiRequest<{ data: Loan }>(`/api/v1/finance/loans/${loanId}`, {
    companyId,
  });
  return result.data;
}

export async function createLoan(
  companyId: string,
  body: {
    lenderType: string;
    lenderName: string;
    currency: string;
    contractedPrincipal: string;
    requestId: string;
    receivingAccountId?: string;
    referenceFxRate?: string;
    referenceFxBaseCurrency?: string;
    referenceFxQuoteCurrency?: string;
    notes?: string;
    firstDisbursement?: { accountId: string; amount: string };
    postImmediately?: boolean;
  },
): Promise<Loan> {
  const result = await apiRequest<{ data: Loan }>('/api/v1/finance/loans', {
    method: 'POST',
    companyId,
    body,
  });
  return result.data;
}

export async function createLoanRepayment(
  companyId: string,
  loanId: string,
  body: {
    accountId: string;
    principalAmount: string;
    interestAmount?: string;
    feeAmount?: string;
    requestId: string;
    postImmediately?: boolean;
    notes?: string;
  },
): Promise<unknown> {
  const result = await apiRequest<{ data: unknown }>(
    `/api/v1/finance/loans/${loanId}/repayments`,
    { method: 'POST', companyId, body },
  );
  return result.data;
}

// --- Finance Supplier Payables (Phase 4.4) ---

export type SupplierPayable = {
  id: string;
  number: string;
  supplierId: string;
  supplierName: string | null;
  purchaseOrderId: string | null;
  purchaseOrderNumber: string | null;
  purchaseType: string;
  currency: 'IRR' | 'USD';
  referenceFxRate: string | null;
  referenceFxBaseCurrency: string | null;
  referenceFxQuoteCurrency: string | null;
  dueDate: string | null;
  status: 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';
  recognizedAt: string;
  notes: string | null;
  reference: string | null;
  recognizedAmount: string;
  outstandingAmount: string;
  overdue: boolean;
  agingBucket: string;
  lines?: Array<{
    id: string;
    goodsReceiptId: string;
    goodsReceiptItemId: string;
    purchaseOrderItemId: string;
    skuId: string | null;
    quantity: number;
    unitPrice: string;
    lineAmount: string;
    currency: string;
    recognizedAt: string;
  }>;
  movements?: Array<{
    id: string;
    payableId: string | null;
    supplierId: string;
    direction: string;
    type: string;
    amount: string;
    currency: string;
    sourceType: string;
    sourceId: string;
    supplierCreditId: string | null;
    effectiveAt: string;
    notes: string | null;
    createdAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
};

export type SupplierPayableSummary = {
  byCurrency: Array<{
    currency: string;
    payableCount: number;
    outstandingTotal: string;
    overdueTotal: string;
    openCreditTotal: string;
  }>;
};

export type SupplierStatementEntry = {
  effectiveAt: string;
  kind: 'PAYABLE_INCREASE' | 'PAYABLE_DECREASE' | 'CREDIT';
  payableId: string | null;
  payableNumber: string | null;
  creditId: string | null;
  creditNumber: string | null;
  type: string;
  direction: string | null;
  amount: string;
  currency: string;
  notes: string | null;
};

export async function fetchSupplierPayables(
  companyId: string,
  params: {
    page?: number;
    pageSize?: number;
    q?: string;
    status?: string;
    currency?: string;
    supplierId?: string;
  } = {},
): Promise<{ data: SupplierPayable[]; meta: PaginationMeta }> {
  const search = new URLSearchParams();
  if (params.page) search.set('page', String(params.page));
  if (params.pageSize) search.set('pageSize', String(params.pageSize));
  if (params.q) search.set('q', params.q);
  if (params.status) search.set('status', params.status);
  if (params.currency) search.set('currency', params.currency);
  if (params.supplierId) search.set('supplierId', params.supplierId);
  const qs = search.toString();
  return apiRequest(`/api/v1/finance/payables${qs ? `?${qs}` : ''}`, { companyId });
}

export async function fetchSupplierPayable(
  companyId: string,
  payableId: string,
): Promise<SupplierPayable> {
  const result = await apiRequest<{ data: SupplierPayable }>(
    `/api/v1/finance/payables/${payableId}`,
    { companyId },
  );
  return result.data;
}

export async function fetchSupplierPayablesSummary(
  companyId: string,
): Promise<SupplierPayableSummary> {
  const result = await apiRequest<{ data: SupplierPayableSummary }>(
    '/api/v1/finance/payables/summary',
    { companyId },
  );
  return result.data;
}

export async function fetchSupplierStatement(
  companyId: string,
  supplierId: string,
): Promise<{ supplierId: string; entries: SupplierStatementEntry[] }> {
  const result = await apiRequest<{
    data: { supplierId: string; entries: SupplierStatementEntry[] };
  }>(`/api/v1/finance/suppliers/${supplierId}/statement`, { companyId });
  return result.data;
}

export async function allocateSupplierPayment(
  companyId: string,
  payableId: string,
  body: {
    amount: string;
    currency: string;
    requestId: string;
    paymentSourceType?: string;
    paymentSourceId?: string;
    effectiveAt?: string;
  },
): Promise<{ allocationId: string; payable: SupplierPayable }> {
  const result = await apiRequest<{ data: { allocationId: string; payable: SupplierPayable } }>(
    `/api/v1/finance/payables/${payableId}/allocations`,
    { method: 'POST', companyId, body },
  );
  return result.data;
}

// ---------------------------------------------------------------------------
// Finance FX (Phase 4.5)
// ---------------------------------------------------------------------------

export type FxRate = {
  id: string;
  companyId: string;
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  rateDisplay: string;
  rateType: string;
  sourceType: string;
  sourceReference: string | null;
  effectiveAt: string;
  notes: string | null;
  archivedAt: string | null;
  createdAt: string;
};

export type FxConversion = {
  id: string;
  number: string;
  sourceAccountId: string;
  destinationAccountId: string;
  sourceAccount: { id: string; code: string; name: string; currency: string };
  destinationAccount: { id: string; code: string; name: string; currency: string };
  fromAmount: string;
  fromCurrency: string;
  toAmount: string;
  toCurrency: string;
  appliedRate: string;
  rateDisplay: string;
  status: string;
  effectiveAt: string;
  notes: string | null;
  postedAt: string | null;
  createdAt: string;
};

export type FxPositionRow = {
  currency: string;
  cashBalance: string;
  payableOutstanding: string;
  loanOutstanding: string;
  net: string;
};

export async function fetchFxRates(
  companyId: string,
  params?: { page?: number; pageSize?: number; rateType?: string },
): Promise<{ data: FxRate[]; meta: PaginationMeta }> {
  const search = new URLSearchParams();
  if (params?.page) search.set('page', String(params.page));
  if (params?.pageSize) search.set('pageSize', String(params.pageSize));
  if (params?.rateType) search.set('rateType', params.rateType);
  const qs = search.toString();
  return apiRequest(`/api/v1/finance/fx/rates${qs ? `?${qs}` : ''}`, { companyId });
}

export async function createFxRate(
  companyId: string,
  body: {
    baseCurrency: string;
    quoteCurrency: string;
    rate: string;
    rateType: string;
    sourceType?: string;
    sourceReference?: string;
    effectiveAt?: string;
    notes?: string;
  },
): Promise<FxRate> {
  const result = await apiRequest<{ data: FxRate }>('/api/v1/finance/fx/rates', {
    method: 'POST',
    companyId,
    body,
  });
  return result.data;
}

export async function fetchFxConversions(
  companyId: string,
  params?: { page?: number; pageSize?: number; status?: string },
): Promise<{ data: FxConversion[]; meta: PaginationMeta }> {
  const search = new URLSearchParams();
  if (params?.page) search.set('page', String(params.page));
  if (params?.pageSize) search.set('pageSize', String(params.pageSize));
  if (params?.status) search.set('status', params.status);
  const qs = search.toString();
  return apiRequest(`/api/v1/finance/fx/conversions${qs ? `?${qs}` : ''}`, { companyId });
}

export async function fetchFxConversion(
  companyId: string,
  conversionId: string,
): Promise<FxConversion> {
  const result = await apiRequest<{ data: FxConversion }>(
    `/api/v1/finance/fx/conversions/${conversionId}`,
    { companyId },
  );
  return result.data;
}

export async function createFxConversion(
  companyId: string,
  body: Record<string, unknown>,
): Promise<FxConversion> {
  const result = await apiRequest<{ data: FxConversion }>('/api/v1/finance/fx/conversions', {
    method: 'POST',
    companyId,
    body,
  });
  return result.data;
}

export async function postFxConversion(
  companyId: string,
  conversionId: string,
): Promise<FxConversion> {
  const result = await apiRequest<{ data: FxConversion }>(
    `/api/v1/finance/fx/conversions/${conversionId}/post`,
    { method: 'POST', companyId },
  );
  return result.data;
}

export async function reverseFxConversion(
  companyId: string,
  conversionId: string,
): Promise<FxConversion> {
  const result = await apiRequest<{ data: FxConversion }>(
    `/api/v1/finance/fx/conversions/${conversionId}/reverse`,
    { method: 'POST', companyId },
  );
  return result.data;
}

export async function fetchFxPositions(companyId: string): Promise<{
  baseCurrency: string;
  positions: FxPositionRow[];
  signConvention: string;
}> {
  const result = await apiRequest<{
    data: { baseCurrency: string; positions: FxPositionRow[]; signConvention: string };
  }>('/api/v1/finance/fx/positions', { companyId });
  return result.data;
}

export async function previewFxConvert(
  companyId: string,
  body: {
    fromAmount: string;
    fromCurrency: string;
    toCurrency: string;
    appliedRate: string;
    rateBaseCurrency: string;
    rateQuoteCurrency: string;
  },
): Promise<{
  fromAmount: string;
  fromCurrency: string;
  toAmount: string;
  toCurrency: string;
  appliedRate: string;
  rateDisplay: string;
}> {
  const result = await apiRequest<{
    data: {
      fromAmount: string;
      fromCurrency: string;
      toAmount: string;
      toCurrency: string;
      appliedRate: string;
      rateDisplay: string;
    };
  }>('/api/v1/finance/fx/convert/preview', { method: 'POST', companyId, body });
  return result.data;
}

