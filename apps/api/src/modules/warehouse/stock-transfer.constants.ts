export const STOCK_TRANSFER_SEARCH_MAX_LENGTH = 100;
export const STOCK_TRANSFER_NOTES_MAX_LENGTH = 2000;
export const STOCK_TRANSFER_REFERENCE_MAX_LENGTH = 120;

export const STOCK_TRANSFER_ERROR_MESSAGES = {
  NOT_FOUND: 'Stock transfer was not found.',
  NOT_EDITABLE: 'Only DRAFT stock transfers can be edited.',
  EMPTY: 'Stock transfer must have at least one item before dispatch.',
  INVALID_QUANTITY: 'Transfer item quantity must be a positive integer.',
  SAME_LOCATION: 'Source and destination locations must be different.',
  LOCATION_WAREHOUSE_MISMATCH:
    'Transfer item locations must belong to the transfer source/destination warehouses.',
  BATCH_SKU_MISMATCH: 'Batch does not belong to the transfer item SKU.',
  ITEM_NOT_FOUND: 'Stock transfer item was not found.',
  NOT_DISPATCHABLE: 'Only DRAFT transfers can be dispatched.',
  NOT_COMPLETABLE: 'Only IN_TRANSIT transfers can be completed.',
  CANCEL_NOT_ALLOWED: 'This transfer cannot be cancelled in its current status.',
  WAREHOUSE_INACTIVE: 'Transfer warehouses must be ACTIVE (system transit excluded).',
  LOCATION_INACTIVE: 'Destination location must be ACTIVE for new transfers.',
  SYSTEM_WAREHOUSE: 'System warehouses cannot be used as transfer source/destination.',
  NUMBER_CONFLICT: 'Stock transfer number conflict. Retry the operation.',
  UNKNOWN_PRODUCT_BARCODE: 'Product barcode was not found.',
  UNKNOWN_LOCATION_BARCODE: 'Warehouse location barcode was not found.',
} as const;
