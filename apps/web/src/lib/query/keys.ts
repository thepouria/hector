export const companyKeys = {
  all: ['companies'] as const,
  detail: (companyId: string) => ['company', companyId] as const,
};

export const memberKeys = {
  all: (companyId: string) => ['members', companyId] as const,
  list: (companyId: string, filters: Record<string, unknown> = {}) =>
    ['members', companyId, 'list', filters] as const,
  detail: (companyId: string, memberId: string) =>
    ['members', companyId, 'detail', memberId] as const,
};

export const roleKeys = {
  all: (companyId: string) => ['roles', companyId] as const,
  list: (companyId: string, filters: Record<string, unknown> = {}) =>
    ['roles', companyId, 'list', filters] as const,
  detail: (companyId: string, roleId: string) =>
    ['roles', companyId, 'detail', roleId] as const,
  permissionsCatalog: (companyId: string) => ['permissions', companyId] as const,
};

export const sessionKeys = {
  list: () => ['sessions'] as const,
};

export const settingsKeys = {
  company: (companyId: string) => companyKeys.detail(companyId),
};

export const auditKeys = {
  list: (companyId: string, filters: Record<string, unknown> = {}) =>
    ['audit-logs', companyId, filters] as const,
  detail: (companyId: string, auditLogId: string) =>
    ['audit-log', companyId, auditLogId] as const,
};

export const catalogKeys = {
  all: (companyId: string) => ['catalog', companyId] as const,
  stats: (companyId: string) => ['catalog', companyId, 'stats'] as const,
  lookup: (companyId: string, search: string, limit?: number) =>
    ['catalog', companyId, 'lookup', search, limit ?? null] as const,
};

export const brandKeys = {
  all: (companyId: string) => ['brands', companyId] as const,
  list: (companyId: string, filters: Record<string, unknown> = {}) =>
    ['brands', companyId, 'list', filters] as const,
};

export const categoryKeys = {
  all: (companyId: string) => ['categories', companyId] as const,
  tree: (companyId: string) => ['categories', companyId, 'tree'] as const,
  list: (companyId: string, filters: Record<string, unknown> = {}) =>
    ['categories', companyId, 'list', filters] as const,
};

export const productKeys = {
  all: (companyId: string) => ['products', companyId] as const,
  list: (companyId: string, filters: Record<string, unknown> = {}) =>
    ['products', companyId, 'list', filters] as const,
  detail: (companyId: string, productId: string) =>
    ['products', companyId, 'detail', productId] as const,
};

export const skuKeys = {
  all: (companyId: string) => ['skus', companyId] as const,
  byProduct: (companyId: string, productId: string) =>
    ['skus', companyId, 'product', productId] as const,
  list: (companyId: string, productId: string, filters: Record<string, unknown> = {}) =>
    ['skus', companyId, 'product', productId, 'list', filters] as const,
  /** Company-wide SKU list (no product scope). */
  listAll: (companyId: string, filters: Record<string, unknown> = {}) =>
    ['skus', companyId, 'list', filters] as const,
  detail: (companyId: string, skuId: string) => ['skus', companyId, 'detail', skuId] as const,
};

export const variantKeys = {
  all: (companyId: string) => ['variants', companyId] as const,
  options: (companyId: string, productId: string) =>
    ['variants', companyId, 'product', productId, 'options'] as const,
};

export const barcodeKeys = {
  all: (companyId: string) => ['barcodes', companyId] as const,
  bySku: (companyId: string, skuId: string) =>
    ['barcodes', companyId, 'sku', skuId] as const,
};

export const supplierKeys = {
  all: (companyId: string) => ['suppliers', companyId] as const,
  list: (companyId: string, filters: Record<string, unknown> = {}) =>
    ['suppliers', companyId, 'list', filters] as const,
  detail: (companyId: string, supplierId: string) =>
    ['suppliers', companyId, 'detail', supplierId] as const,
  contacts: (companyId: string, supplierId: string) =>
    ['suppliers', companyId, supplierId, 'contacts'] as const,
  notes: (companyId: string, supplierId: string, filters: Record<string, unknown> = {}) =>
    ['suppliers', companyId, supplierId, 'notes', filters] as const,
};

export const offerKeys = {
  all: (companyId: string) => ['supplier-offers', companyId] as const,
  list: (companyId: string, filters: Record<string, unknown> = {}) =>
    ['supplier-offers', companyId, 'list', filters] as const,
  detail: (companyId: string, offerId: string) =>
    ['supplier-offers', companyId, 'detail', offerId] as const,
  compare: (companyId: string, skuId: string, excludeExpired: boolean) =>
    ['supplier-offers', companyId, 'compare', skuId, excludeExpired] as const,
  latest: (companyId: string, supplierId: string, skuId: string) =>
    ['supplier-offers', companyId, 'latest', supplierId, skuId] as const,
};

export const purchaseOrderKeys = {
  all: (companyId: string) => ['purchase-orders', companyId] as const,
  list: (companyId: string, filters: Record<string, unknown> = {}) =>
    ['purchase-orders', companyId, 'list', filters] as const,
  detail: (companyId: string, purchaseOrderId: string) =>
    ['purchase-orders', companyId, 'detail', purchaseOrderId] as const,
  receiving: (companyId: string, purchaseOrderId: string) =>
    ['purchase-orders', companyId, 'detail', purchaseOrderId, 'receiving'] as const,
  corrections: (companyId: string, purchaseOrderId: string) =>
    ['purchase-orders', companyId, 'detail', purchaseOrderId, 'corrections'] as const,
  discrepancies: (companyId: string, purchaseOrderId: string) =>
    ['purchase-orders', companyId, 'detail', purchaseOrderId, 'discrepancies'] as const,
  activity: (companyId: string, purchaseOrderId: string, page = 1) =>
    ['purchase-orders', companyId, 'detail', purchaseOrderId, 'activity', page] as const,
};

export const purchaseReturnKeys = {
  all: (companyId: string) => ['purchase-returns', companyId] as const,
  list: (companyId: string, filters: Record<string, unknown> = {}) =>
    ['purchase-returns', companyId, 'list', filters] as const,
  detail: (companyId: string, purchaseReturnId: string) =>
    ['purchase-returns', companyId, 'detail', purchaseReturnId] as const,
};

export const warehouseKeys = {
  all: (companyId: string) => ['warehouses', companyId] as const,
  dashboard: (companyId: string, filters: Record<string, unknown> = {}) =>
    ['warehouses', companyId, 'dashboard', filters] as const,
  activity: (companyId: string, kind: string, entityId: string, page = 1) =>
    ['warehouses', companyId, 'activity', kind, entityId, page] as const,
  scanner: {
    product: (companyId: string, barcode: string) =>
      ['warehouses', companyId, 'scanner', 'product', barcode] as const,
    location: (companyId: string, barcode: string) =>
      ['warehouses', companyId, 'scanner', 'location', barcode] as const,
  },
  list: (companyId: string, filters: Record<string, unknown> = {}) =>
    ['warehouses', companyId, 'list', filters] as const,
  detail: (companyId: string, warehouseId: string) =>
    ['warehouses', companyId, 'detail', warehouseId] as const,
  locations: (
    companyId: string,
    warehouseId: string,
    filters: Record<string, unknown> = {},
  ) => ['warehouses', companyId, warehouseId, 'locations', filters] as const,
  locationDetail: (companyId: string, warehouseId: string, locationId: string) =>
    ['warehouses', companyId, warehouseId, 'locations', 'detail', locationId] as const,
  goodsReceipts: {
    all: (companyId: string) => ['warehouses', companyId, 'goods-receipts'] as const,
    list: (companyId: string, filters: Record<string, unknown> = {}) =>
      ['warehouses', companyId, 'goods-receipts', 'list', filters] as const,
    detail: (companyId: string, goodsReceiptId: string) =>
      ['warehouses', companyId, 'goods-receipts', 'detail', goodsReceiptId] as const,
    eligiblePurchaseOrders: (companyId: string) =>
      ['warehouses', companyId, 'goods-receipts', 'eligible-purchase-orders'] as const,
    purchaseOrderProgress: (companyId: string, purchaseOrderId: string) =>
      ['warehouses', companyId, 'goods-receipts', 'purchase-order-progress', purchaseOrderId] as const,
  },
  batches: {
    all: (companyId: string) => ['warehouses', companyId, 'batches'] as const,
    list: (companyId: string, filters: Record<string, unknown> = {}) =>
      ['warehouses', companyId, 'batches', 'list', filters] as const,
    detail: (companyId: string, batchId: string) =>
      ['warehouses', companyId, 'batches', 'detail', batchId] as const,
  },
  putaways: {
    all: (companyId: string) => ['warehouses', companyId, 'putaways'] as const,
    list: (companyId: string, filters: Record<string, unknown> = {}) =>
      ['warehouses', companyId, 'putaways', 'list', filters] as const,
    pending: (companyId: string, filters: Record<string, unknown> = {}) =>
      ['warehouses', companyId, 'putaways', 'pending', filters] as const,
    detail: (companyId: string, putawayId: string) =>
      ['warehouses', companyId, 'putaways', 'detail', putawayId] as const,
  },
  transfers: {
    all: (companyId: string) => ['warehouses', companyId, 'transfers'] as const,
    list: (companyId: string, filters: Record<string, unknown> = {}) =>
      ['warehouses', companyId, 'transfers', 'list', filters] as const,
    detail: (companyId: string, transferId: string) =>
      ['warehouses', companyId, 'transfers', 'detail', transferId] as const,
  },
  issues: {
    all: (companyId: string) => ['warehouses', companyId, 'issues'] as const,
    list: (companyId: string, filters: Record<string, unknown> = {}) =>
      ['warehouses', companyId, 'issues', 'list', filters] as const,
    detail: (companyId: string, issueId: string) =>
      ['warehouses', companyId, 'issues', 'detail', issueId] as const,
  },
  adjustments: {
    all: (companyId: string) => ['warehouses', companyId, 'adjustments'] as const,
    list: (companyId: string, filters: Record<string, unknown> = {}) =>
      ['warehouses', companyId, 'adjustments', 'list', filters] as const,
    detail: (companyId: string, adjustmentId: string) =>
      ['warehouses', companyId, 'adjustments', 'detail', adjustmentId] as const,
  },
  counts: {
    all: (companyId: string) => ['warehouses', companyId, 'counts'] as const,
    list: (companyId: string, filters: Record<string, unknown> = {}) =>
      ['warehouses', companyId, 'counts', 'list', filters] as const,
    detail: (companyId: string, countId: string) =>
      ['warehouses', companyId, 'counts', 'detail', countId] as const,
    review: (companyId: string, countId: string) =>
      ['warehouses', companyId, 'counts', 'review', countId] as const,
  },
  supplierReturns: {
    all: (companyId: string) => ['warehouses', companyId, 'supplier-returns'] as const,
    list: (companyId: string, filters: Record<string, unknown> = {}) =>
      ['warehouses', companyId, 'supplier-returns', 'list', filters] as const,
    detail: (companyId: string, purchaseReturnId: string) =>
      ['warehouses', companyId, 'supplier-returns', 'detail', purchaseReturnId] as const,
  },
  supplierReturnExecutions: {
    all: (companyId: string) => ['warehouses', companyId, 'supplier-return-executions'] as const,
    list: (companyId: string, filters: Record<string, unknown> = {}) =>
      ['warehouses', companyId, 'supplier-return-executions', 'list', filters] as const,
    detail: (companyId: string, executionId: string) =>
      ['warehouses', companyId, 'supplier-return-executions', 'detail', executionId] as const,
  },
  inventory: {
    all: (companyId: string) => ['warehouses', companyId, 'inventory'] as const,
    balances: (companyId: string, filters: Record<string, unknown> = {}) =>
      ['warehouses', companyId, 'inventory', 'balances', filters] as const,
    sku: (companyId: string, skuId: string) =>
      ['warehouses', companyId, 'inventory', 'sku', skuId] as const,
    location: (companyId: string, locationId: string) =>
      ['warehouses', companyId, 'inventory', 'location', locationId] as const,
    movements: {
      all: (companyId: string) => ['warehouses', companyId, 'inventory', 'movements'] as const,
      list: (companyId: string, filters: Record<string, unknown> = {}) =>
        ['warehouses', companyId, 'inventory', 'movements', 'list', filters] as const,
      detail: (companyId: string, movementId: string) =>
        ['warehouses', companyId, 'inventory', 'movements', 'detail', movementId] as const,
    },
  },
};

/** Company-scoped Purchasing workspace keys (Phase 2.13–2.14). */
export const purchasingKeys = {
  all: (companyId: string) => ['purchasing', companyId] as const,
  summary: (companyId: string) => ['purchasing', companyId, 'summary'] as const,
  dashboard: (companyId: string, filters: Record<string, unknown> = {}) =>
    ['purchasing', companyId, 'dashboard', filters] as const,
  suppliers: supplierKeys,
  offers: offerKeys,
  orders: purchaseOrderKeys,
  returns: purchaseReturnKeys,
};

export const attributeKeys = {
  all: (companyId: string) => ['attributes', companyId] as const,
  list: (companyId: string, filters: Record<string, unknown> = {}) =>
    ['attributes', companyId, 'list', filters] as const,
  detail: (companyId: string, attributeId: string) =>
    ['attributes', companyId, 'detail', attributeId] as const,
  categoryAssigned: (companyId: string, categoryId: string) =>
    ['attributes', companyId, 'category', categoryId, 'assigned'] as const,
  categorySuggested: (companyId: string, categoryId: string) =>
    ['attributes', companyId, 'category', categoryId, 'suggested'] as const,
  productValues: (companyId: string, productId: string) =>
    ['attributes', companyId, 'product', productId, 'values'] as const,
  skuValues: (companyId: string, skuId: string) =>
    ['attributes', companyId, 'sku', skuId, 'values'] as const,
};

export const financeAccountKeys = {
  all: (companyId: string) => ['finance-accounts', companyId] as const,
  list: (companyId: string, filters: Record<string, unknown> = {}) =>
    ['finance-accounts', companyId, 'list', filters] as const,
  detail: (companyId: string, accountId: string) =>
    ['finance-accounts', companyId, 'detail', accountId] as const,
  movements: (companyId: string, accountId: string, filters: Record<string, unknown> = {}) =>
    ['finance-accounts', companyId, 'movements', accountId, filters] as const,
  summary: (companyId: string) => ['finance-accounts', companyId, 'summary'] as const,
};

export const financeCapitalKeys = {
  all: (companyId: string) => ['finance-capital', companyId] as const,
  list: (companyId: string, filters: Record<string, unknown> = {}) =>
    ['finance-capital', companyId, 'list', filters] as const,
  detail: (companyId: string, id: string) => ['finance-capital', companyId, 'detail', id] as const,
};

export const financeLoanKeys = {
  all: (companyId: string) => ['finance-loans', companyId] as const,
  list: (companyId: string, filters: Record<string, unknown> = {}) =>
    ['finance-loans', companyId, 'list', filters] as const,
  detail: (companyId: string, id: string) => ['finance-loans', companyId, 'detail', id] as const,
};

export const financePayableKeys = {
  all: (companyId: string) => ['finance-payables', companyId] as const,
  list: (companyId: string, filters: Record<string, unknown> = {}) =>
    ['finance-payables', companyId, 'list', filters] as const,
  detail: (companyId: string, id: string) => ['finance-payables', companyId, 'detail', id] as const,
  summary: (companyId: string) => ['finance-payables', companyId, 'summary'] as const,
  statement: (companyId: string, supplierId: string) =>
    ['finance-payables', companyId, 'statement', supplierId] as const,
};

export const financeFxKeys = {
  all: (companyId: string) => ['finance-fx', companyId] as const,
  rates: (companyId: string, filters: Record<string, unknown> = {}) =>
    ['finance-fx', companyId, 'rates', filters] as const,
  conversions: (companyId: string, filters: Record<string, unknown> = {}) =>
    ['finance-fx', companyId, 'conversions', filters] as const,
  conversion: (companyId: string, id: string) =>
    ['finance-fx', companyId, 'conversion', id] as const,
  positions: (companyId: string) => ['finance-fx', companyId, 'positions'] as const,
  valuation: (companyId: string, filters: Record<string, unknown> = {}) =>
    ['finance-fx', companyId, 'valuation', filters] as const,
};
