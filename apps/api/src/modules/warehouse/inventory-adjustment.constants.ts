export const INVENTORY_ADJUSTMENT_SEARCH_MAX_LENGTH = 100;
export const INVENTORY_ADJUSTMENT_NOTES_MAX_LENGTH = 2000;
export const INVENTORY_ADJUSTMENT_REASON_TEXT_MAX_LENGTH = 500;

export const INVENTORY_ADJUSTMENT_ERROR_MESSAGES = {
  NOT_FOUND: 'Inventory adjustment was not found.',
  NOT_EDITABLE: 'Only DRAFT inventory adjustments can be edited.',
  EMPTY: 'Inventory adjustment must have at least one item before submit/post.',
  INVALID_QUANTITY: 'Adjustment item quantity must be a positive integer.',
  REASON_TEXT_REQUIRED:
    'reasonText is required when reason is REGISTRATION_ERROR, CORRECTION, or OTHER.',
  ITEM_NOT_FOUND: 'Inventory adjustment item was not found.',
  NOT_SUBMITTABLE: 'Only DRAFT inventory adjustments can be submitted.',
  NOT_APPROVABLE: 'Only PENDING_APPROVAL inventory adjustments can be approved or rejected.',
  NOT_POSTABLE: 'Only APPROVED inventory adjustments can be posted.',
  CANCEL_NOT_ALLOWED: 'Posted inventory adjustments cannot be cancelled.',
  WAREHOUSE_INACTIVE: 'Adjustment warehouse must be ACTIVE.',
  LOCATION_INACTIVE: 'Adjustment location must be ACTIVE.',
  LOCATION_WAREHOUSE_MISMATCH: 'Adjustment item location must belong to the adjustment warehouse.',
  BATCH_SKU_MISMATCH: 'Batch does not belong to the adjustment item SKU.',
  SYSTEM_WAREHOUSE: 'System warehouses cannot be used for inventory adjustments.',
} as const;
