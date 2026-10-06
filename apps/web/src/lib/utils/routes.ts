export const ROUTES = {
  login: '/login',
  app: '/app',
  dashboard: '/app/dashboard',
  products: '/app/products',
  catalog: '/app/catalog',
  catalogProducts: '/app/catalog/products',
  catalogSkus: '/app/catalog/skus',
  catalogBrands: '/app/catalog/brands',
  catalogCategories: '/app/catalog/categories',
  catalogAttributes: '/app/catalog/attributes',
  catalogBarcodeScan: '/app/catalog/barcodes/scan',
  warehouse: '/app/warehouse',
  warehouseDashboard: '/app/warehouse/dashboard',
  warehouseScanner: '/app/warehouse/scanner',
  warehouseLocations: '/app/warehouse/locations',
  warehouseGoodsReceipts: '/app/warehouse/goods-receipts',
  warehouseGoodsReceiptNew: '/app/warehouse/goods-receipts/new',
  warehousePutaways: '/app/warehouse/putaways',
  warehouseTransfers: '/app/warehouse/transfers',
  warehouseTransferNew: '/app/warehouse/transfers/new',
  warehouseIssues: '/app/warehouse/issues',
  warehouseIssueNew: '/app/warehouse/issues/new',
  warehouseAdjustments: '/app/warehouse/adjustments',
  warehouseAdjustmentNew: '/app/warehouse/adjustments/new',
  warehouseCounts: '/app/warehouse/counts',
  warehouseCountNew: '/app/warehouse/counts/new',
  warehouseSupplierReturns: '/app/warehouse/supplier-returns',
  warehouseInventory: '/app/warehouse/inventory',
  warehouseInventoryMovements: '/app/warehouse/inventory/movements',
  warehouseReservations: '/app/warehouse/reservations',
  warehouseValuation: '/app/warehouse/valuation',
  warehouseCostLayers: '/app/warehouse/cost-layers',
  warehouseBatches: '/app/warehouse/batches',
  purchasing: '/app/purchasing',
  purchasingSuppliers: '/app/purchasing/suppliers',
  purchasingOffers: '/app/purchasing/offers',
  purchasingOfferCompare: '/app/purchasing/offers/compare',
  purchasingOfferNew: '/app/purchasing/offers/new',
  purchasingOrders: '/app/purchasing/orders',
  purchasingOrderNew: '/app/purchasing/orders/new',
  purchasingReturns: '/app/purchasing/returns',
  purchasingReturnNew: '/app/purchasing/returns/new',
  sales: '/app/sales',
  finance: '/app/finance',
  financeAccounts: '/app/finance/accounts',
  financeAccountNew: '/app/finance/accounts/new',
  financeAccountTransfers: '/app/finance/account-transfers',
  financeAccountTransferNew: '/app/finance/account-transfers/new',
  financeCapital: '/app/finance/capital',
  financeCapitalNew: '/app/finance/capital/new',
  financeLoans: '/app/finance/loans',
  financeLoanNew: '/app/finance/loans/new',
  financePayables: '/app/finance/payables',
  financePayments: '/app/finance/payments',
  financePaymentNew: '/app/finance/payments/new',
  financeReceipts: '/app/finance/receipts',
  financeReceiptNew: '/app/finance/receipts/new',
  financeFx: '/app/finance/fx',
  financeFxRates: '/app/finance/fx/rates',
  financeFxRateNew: '/app/finance/fx/rates/new',
  financeFxConversions: '/app/finance/fx/conversions',
  financeFxConversionNew: '/app/finance/fx/conversions/new',
  financeFxPositions: '/app/finance/fx/positions',
  settlements: '/app/settlements',
  audit: '/app/audit',
  settings: '/app/settings',
  settingsCompany: '/app/settings/company',
  settingsMembers: '/app/settings/members',
  settingsRoles: '/app/settings/roles',
  settingsRolesNew: '/app/settings/roles/new',
  settingsSecurity: '/app/settings/security',
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];

export function catalogProductPath(productId: string): string {
  return `${ROUTES.catalogProducts}/${productId}`;
}

export function financeAccountPath(accountId: string): string {
  return `${ROUTES.financeAccounts}/${accountId}`;
}

export function financeAccountTransferPath(transferId: string): string {
  return `${ROUTES.financeAccountTransfers}/${transferId}`;
}

export function financeCapitalPath(contributionId: string): string {
  return `${ROUTES.financeCapital}/${contributionId}`;
}

export function financePaymentPath(paymentId: string): string {
  return `${ROUTES.financePayments}/${paymentId}`;
}

export function financeReceiptPath(receiptId: string): string {
  return `${ROUTES.financeReceipts}/${receiptId}`;
}

export function financeLoanPath(loanId: string): string {
  return `${ROUTES.financeLoans}/${loanId}`;
}

export function financePayablePath(payableId: string): string {
  return `${ROUTES.financePayables}/${payableId}`;
}

export function financeFxConversionPath(conversionId: string): string {
  return `${ROUTES.financeFxConversions}/${conversionId}`;
}

export function financeSupplierStatementPath(supplierId: string): string {
  return `/app/finance/suppliers/${supplierId}/statement`;
}

export function catalogAttributePath(attributeId: string): string {
  return `${ROUTES.catalogAttributes}/${attributeId}`;
}

export function catalogSkuPath(skuId: string): string {
  return `${ROUTES.catalogSkus}/${skuId}`;
}

export function catalogSkuBarcodePrintPath(skuId: string): string {
  return `${ROUTES.catalogSkus}/${skuId}/barcodes/print`;
}

/** SKU list filtered to a single product (used by product detail drill-down). */
export function catalogProductSkusPath(productId: string): string {
  const params = new URLSearchParams({ product: productId });
  return `${ROUTES.catalogSkus}?${params.toString()}`;
}

export function settingsMemberPath(memberId: string): string {
  return `${ROUTES.settingsMembers}/${memberId}`;
}

export function settingsRolePath(roleId: string): string {
  return `${ROUTES.settingsRoles}/${roleId}`;
}

export function purchasingSupplierPath(supplierId: string): string {
  return `${ROUTES.purchasingSuppliers}/${supplierId}`;
}

export function purchasingOfferPath(offerId: string): string {
  return `${ROUTES.purchasingOffers}/${offerId}`;
}

export function purchasingOfferComparePath(skuId?: string): string {
  if (!skuId) return ROUTES.purchasingOfferCompare;
  const params = new URLSearchParams({ skuId });
  return `${ROUTES.purchasingOfferCompare}?${params.toString()}`;
}

export function purchasingReturnPath(purchaseReturnId: string): string {
  return `${ROUTES.purchasingReturns}/${purchaseReturnId}`;
}

export function purchasingReturnNewPath(purchaseOrderId?: string): string {
  if (!purchaseOrderId) return ROUTES.purchasingReturnNew;
  const params = new URLSearchParams({ purchaseOrderId });
  return `${ROUTES.purchasingReturnNew}?${params.toString()}`;
}

export function purchasingOrderPath(purchaseOrderId: string): string {
  return `${ROUTES.purchasingOrders}/${purchaseOrderId}`;
}

export function warehouseLocationsPath(warehouseId: string): string {
  return `${ROUTES.warehouse}/${warehouseId}/locations`;
}

export function warehouseGoodsReceiptPath(goodsReceiptId: string): string {
  return `${ROUTES.warehouseGoodsReceipts}/${goodsReceiptId}`;
}

export function warehousePutawayPath(putawayId: string): string {
  return `${ROUTES.warehousePutaways}/${putawayId}`;
}

export function warehouseTransferPath(transferId: string): string {
  return `${ROUTES.warehouseTransfers}/${transferId}`;
}

export function warehouseIssuePath(issueId: string): string {
  return `${ROUTES.warehouseIssues}/${issueId}`;
}

export function warehouseAdjustmentPath(adjustmentId: string): string {
  return `${ROUTES.warehouseAdjustments}/${adjustmentId}`;
}

export function warehouseCountPath(countId: string): string {
  return `${ROUTES.warehouseCounts}/${countId}`;
}

export function warehouseSupplierReturnPath(purchaseReturnId: string): string {
  return `${ROUTES.warehouseSupplierReturns}/${purchaseReturnId}`;
}

export function warehouseSupplierReturnExecutionNewPath(purchaseReturnId: string): string {
  return `${ROUTES.warehouseSupplierReturns}/${purchaseReturnId}/executions/new`;
}

export function warehouseSupplierReturnExecutionPath(executionId: string): string {
  return `${ROUTES.warehouseSupplierReturns}/executions/${executionId}`;
}

export function warehouseSupplierReturnExecutionMovementsPath(executionId: string): string {
  const params = new URLSearchParams({
    sourceType: 'SUPPLIER_RETURN',
    sourceId: executionId,
  });
  return `${ROUTES.warehouseInventoryMovements}?${params.toString()}`;
}

export function warehouseIssueNewPath(query?: {
  reason?: string;
  classification?: string;
  warehouseId?: string;
  locationId?: string;
  skuId?: string;
  batchId?: string;
}): string {
  if (!query) return ROUTES.warehouseIssueNew;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `${ROUTES.warehouseIssueNew}?${qs}` : ROUTES.warehouseIssueNew;
}

export function warehouseInventoryTransferMovementsPath(transferId: string): string {
  const params = new URLSearchParams({
    sourceType: 'TRANSFER',
    sourceId: transferId,
  });
  return `${ROUTES.warehouseInventoryMovements}?${params.toString()}`;
}

export function warehouseBatchPath(batchId: string): string {
  return `${ROUTES.warehouseBatches}/${batchId}`;
}

export function warehouseInventoryMovementPath(movementId: string): string {
  return `${ROUTES.warehouseInventoryMovements}/${movementId}`;
}

export function warehouseInventorySkuPath(skuId: string): string {
  return `${ROUTES.warehouseInventory}/skus/${skuId}`;
}

export function warehouseInventoryPositionMovementsPath(filters: {
  skuId: string;
  batchId: string;
  warehouseId: string;
  locationId: string;
}): string {
  const params = new URLSearchParams({
    skuId: filters.skuId,
    batchId: filters.batchId,
    warehouseId: filters.warehouseId,
    locationId: filters.locationId,
  });
  return `${ROUTES.warehouseInventoryMovements}?${params.toString()}`;
}

export function auditEntityPath(entityType: string, entityId: string): string {
  const params = new URLSearchParams({ entityType, entityId });
  return `${ROUTES.audit}?${params.toString()}`;
}
