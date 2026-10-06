export const STOCK_ISSUE_SEARCH_MAX_LENGTH = 100;
export const STOCK_ISSUE_NOTES_MAX_LENGTH = 2000;
export const STOCK_ISSUE_REASON_TEXT_MAX_LENGTH = 500;

export const STOCK_ISSUE_ERROR_MESSAGES = {
  NOT_FOUND: 'Stock issue was not found.',
  NOT_EDITABLE: 'Only DRAFT stock issues can be edited.',
  EMPTY: 'Stock issue must have at least one item before posting.',
  INVALID_QUANTITY: 'Issue item quantity must be a positive integer.',
  REASON_TEXT_REQUIRED: 'reasonText is required when reason is MANUAL or OTHER.',
  ITEM_NOT_FOUND: 'Stock issue item was not found.',
  NOT_POSTABLE: 'Only DRAFT stock issues can be posted.',
  CANCEL_NOT_ALLOWED: 'Posted stock issues cannot be cancelled.',
  WAREHOUSE_INACTIVE: 'Issue warehouse must be ACTIVE.',
  LOCATION_INACTIVE: 'Issue location must be ACTIVE.',
  LOCATION_WAREHOUSE_MISMATCH: 'Issue item location must belong to the issue warehouse.',
  BATCH_SKU_MISMATCH: 'Batch does not belong to the issue item SKU.',
  SYSTEM_WAREHOUSE: 'System warehouses cannot be used for stock issues.',
  UNKNOWN_PRODUCT_BARCODE: 'Product barcode was not found.',
  UNKNOWN_LOCATION_BARCODE: 'Warehouse location barcode was not found.',
} as const;
