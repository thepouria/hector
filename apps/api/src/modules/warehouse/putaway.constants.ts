export const PUTAWAY_ERROR_MESSAGES = {
  NOT_FOUND: 'Putaway was not found.',
  NOT_EDITABLE: 'Putaway cannot be edited in its current status.',
  ALREADY_COMPLETED: 'Putaway is already completed.',
  NOT_COMPLETABLE: 'Putaway cannot be completed.',
  EMPTY: 'Putaway has no placement items.',
  QUANTITY_EXCEEDED: 'Putaway quantity exceeds remaining received batch quantity.',
  INVALID_QUANTITY: 'Putaway quantity must be a positive integer.',
  ITEM_NOT_FOUND: 'Putaway item was not found.',
  CANCEL_NOT_ALLOWED: 'Putaway cannot be cancelled in its current status.',
  NUMBER_CONFLICT: 'Putaway number conflict. Retry the request.',
  GRN_NOT_POSTED: 'Only POSTED goods receipts can be put away.',
  RECEIPT_BATCH_ALLOCATION_NOT_FOUND: 'Receipt batch allocation was not found.',
  RECEIPT_ALREADY_FULLY_PUT_AWAY: 'All received batch quantity is already put away.',
  UNKNOWN_LOCATION_BARCODE: 'Location barcode was not found.',
  LOCATION_NOT_IN_PUTAWAY_WAREHOUSE: 'Location does not belong to the putaway warehouse.',
  LOCATION_NOT_AVAILABLE: 'Location is not available for putaway.',
  LOCATION_NOT_STOCK_BEARING: 'Location cannot receive putaway placement.',
  WAREHOUSE_MISMATCH: 'Putaway warehouse must match the goods receipt warehouse.',
} as const;

export const PUTAWAY_SEARCH_MAX_LENGTH = 100;
