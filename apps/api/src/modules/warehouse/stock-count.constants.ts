export const STOCK_COUNT_SEARCH_MAX_LENGTH = 100;
export const STOCK_COUNT_NOTES_MAX_LENGTH = 2000;

export const STOCK_COUNT_ERROR_MESSAGES = {
  NOT_FOUND: 'Stock count was not found.',
  NOT_EDITABLE: 'Only DRAFT stock counts can be configured.',
  NOT_STARTABLE: 'Only DRAFT stock counts can be started.',
  NOT_RECORDABLE: 'Physical quantities can only be recorded while the count is IN_PROGRESS or RECOUNT_REQUIRED.',
  NOT_SUBMITTABLE: 'Only IN_PROGRESS or RECOUNT_REQUIRED stock counts can be submitted.',
  NOT_APPROVABLE: 'Only SUBMITTED stock counts can be approved, rejected, or sent for recount.',
  NOT_POSTABLE: 'Only APPROVED stock counts can be posted.',
  CANCEL_NOT_ALLOWED: 'Posted stock counts cannot be cancelled.',
  UNCOUNTED_LINES: 'All required count lines must be COUNTED or SKIPPED before submit.',
  EMPTY: 'Stock count has no lines to post.',
  ITEM_NOT_FOUND: 'Stock count item was not found.',
  INVALID_QUANTITY: 'Counted quantity must be a non-negative integer.',
  OUTSIDE_SCOPE: 'This SKU/location is outside the current count scope.',
  LOCATION_MISMATCH: 'Product scan does not match the active count location.',
  WAREHOUSE_INACTIVE: 'Count warehouse must be ACTIVE.',
  LOCATION_INACTIVE: 'Count location must be ACTIVE.',
  BATCH_SKU_MISMATCH: 'Batch does not belong to the count item SKU.',
  SYSTEM_WAREHOUSE: 'System warehouses cannot be used for stock counts.',
  UNKNOWN_PRODUCT_BARCODE: 'Product barcode was not found.',
  UNKNOWN_LOCATION_BARCODE: 'Warehouse location barcode was not found.',
} as const;
