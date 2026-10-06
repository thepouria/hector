export const SUPPLIER_RETURN_EXECUTION_SEARCH_MAX_LENGTH = 100;
export const SUPPLIER_RETURN_EXECUTION_NOTES_MAX_LENGTH = 2000;

export const SUPPLIER_RETURN_EXECUTION_ERROR_MESSAGES = {
  NOT_FOUND: 'Supplier return execution was not found.',
  NOT_EDITABLE: 'Only DRAFT supplier return executions can be edited.',
  EMPTY: 'Supplier return execution must have at least one item before dispatch.',
  INVALID_QUANTITY: 'Execution item quantity must be a positive integer.',
  ITEM_NOT_FOUND: 'Supplier return execution item was not found.',
  NOT_DISPATCHABLE: 'Only DRAFT supplier return executions can be dispatched.',
  CANCEL_NOT_ALLOWED: 'Dispatched supplier return executions cannot be cancelled.',
  WAREHOUSE_INACTIVE: 'Execution warehouse must be ACTIVE.',
  LOCATION_INACTIVE: 'Execution location must be ACTIVE.',
  LOCATION_WAREHOUSE_MISMATCH: 'Execution item location must belong to the execution warehouse.',
  BATCH_SKU_MISMATCH: 'Batch does not belong to the execution item SKU.',
  SKU_MISMATCH: 'Execution item SKU must match the purchase return line SKU.',
  SYSTEM_WAREHOUSE: 'System warehouses cannot be used for supplier return executions.',
  OVER_AUTHORIZED: 'Execution quantity exceeds remaining authorized return quantity.',
  RETURN_INELIGIBLE: 'Purchase return is not eligible for warehouse execution.',
  SKU_NOT_ON_RETURN: 'SKU is not on the approved purchase return.',
  PROVENANCE_MISMATCH: 'Batch provenance does not match the return supplier.',
  UNKNOWN_PRODUCT_BARCODE: 'Product barcode was not found.',
  UNKNOWN_LOCATION_BARCODE: 'Warehouse location barcode was not found.',
  PURCHASE_RETURN_NOT_FOUND: 'Purchase return was not found.',
} as const;

export const SUPPLIER_RETURN_FULFILLMENT_STATUSES = [
  'NOT_DISPATCHED',
  'PARTIALLY_DISPATCHED',
  'FULLY_DISPATCHED',
] as const;

export type SupplierReturnFulfillmentStatus =
  (typeof SUPPLIER_RETURN_FULFILLMENT_STATUSES)[number];
