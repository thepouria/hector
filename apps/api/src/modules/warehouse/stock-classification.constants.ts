export const STOCK_CLASSIFICATION_REASON_MAX_LENGTH = 120;
export const STOCK_CLASSIFICATION_NOTES_MAX_LENGTH = 2000;

export const STOCK_CLASSIFICATION_ERROR_MESSAGES = {
  INVALID_QUANTITY: 'Classification change quantity must be a positive integer.',
  TRANSIT_FORBIDDEN: 'Stock cannot be reclassified at a TRANSIT location.',
  LOCATION_INACTIVE: 'Location must be ACTIVE to reclassify stock.',
  LOCATION_WAREHOUSE_MISMATCH: 'Location does not belong to the specified warehouse.',
  BATCH_SKU_MISMATCH: 'Batch does not belong to the specified SKU.',
  WAREHOUSE_NOT_FOUND: 'Warehouse was not found.',
  WAREHOUSE_INACTIVE: 'Warehouse must be ACTIVE to reclassify stock.',
  SYSTEM_WAREHOUSE: 'System warehouses cannot be used for classification changes.',
} as const;
