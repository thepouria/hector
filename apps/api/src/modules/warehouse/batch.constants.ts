export const BATCH_ERROR_MESSAGES = {
  NOT_FOUND: 'Batch was not found.',
  SKU_MISMATCH: 'Batch SKU must match the goods receipt item SKU.',
  NUMBER_CONFLICT: 'Batch number conflict. Retry the request.',
  SUPPLIER_NUMBER_CONFLICT:
    'Another batch already uses this supplier batch number for the same SKU.',
  INVALID_DATES: 'Expiry date must be on or after the manufactured date when both are set.',
  SKU_IMMUTABLE: 'Batch SKU cannot be changed.',
  ALLOCATION_NOT_FOUND: 'Batch allocation was not found.',
  ALLOCATION_DUPLICATE: 'This batch is already allocated on the receipt item.',
  ALLOCATION_INVALID_QUANTITY: 'Batch allocation quantity must be a positive integer.',
  ALLOCATION_INCOMPLETE: 'Goods receipt item quantity is not fully allocated to batches.',
  ALLOCATION_EXCEEDED: 'Batch allocations exceed the goods receipt item quantity.',
  ALLOCATION_POSTED_IMMUTABLE: 'Posted batch allocations cannot be modified.',
  ALLOCATION_ITEM_QUANTITY_CONFLICT:
    'Receipt item quantity cannot be less than the sum of batch allocations.',
  SKU_NOT_FOUND: 'SKU was not found.',
  INVALID_NOTES: 'Batch notes must be at most 1000 characters.',
  INVALID_SUPPLIER_BATCH: 'Supplier batch number must be at most 128 characters.',
} as const;

export const BATCH_NOTES_MAX_LENGTH = 1000;
export const BATCH_SUPPLIER_NUMBER_MAX_LENGTH = 128;
export const BATCH_SEARCH_MAX_LENGTH = 100;
