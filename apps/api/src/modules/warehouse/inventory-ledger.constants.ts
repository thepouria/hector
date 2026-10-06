import { InventoryMovementType } from '@hector/database';

export const INVENTORY_SEARCH_MAX_LENGTH = 100;

/** Movement types that require quantityDelta > 0. */
export const POSITIVE_MOVEMENT_TYPES = new Set<InventoryMovementType>([
  InventoryMovementType.RECEIVE,
  InventoryMovementType.TRANSFER_IN,
  InventoryMovementType.RECLASSIFY_IN,
  InventoryMovementType.ADJUSTMENT_IN,
  InventoryMovementType.RETURN_IN,
  InventoryMovementType.STOCK_COUNT_ADJUSTMENT_IN,
  InventoryMovementType.OPENING_BALANCE,
]);

/** Movement types that require quantityDelta < 0. */
export const NEGATIVE_MOVEMENT_TYPES = new Set<InventoryMovementType>([
  InventoryMovementType.ISSUE,
  InventoryMovementType.TRANSFER_OUT,
  InventoryMovementType.RECLASSIFY_OUT,
  InventoryMovementType.ADJUSTMENT_OUT,
  InventoryMovementType.RETURN_OUT,
  InventoryMovementType.STOCK_COUNT_ADJUSTMENT_OUT,
]);

export const INVENTORY_ERROR_MESSAGES = {
  INVALID_QUANTITY: 'Inventory movement quantityDelta must be a non-zero integer.',
  INVALID_SIGN: 'Inventory movement type and quantityDelta sign do not agree.',
  INSUFFICIENT_STOCK: 'Insufficient On Hand for outbound inventory movement.',
  BATCH_SKU_MISMATCH: 'Batch does not belong to the movement SKU.',
  LOCATION_WAREHOUSE_MISMATCH: 'Location does not belong to the movement warehouse.',
  NOT_FOUND: 'Inventory movement was not found.',
  IMMUTABLE: 'Posted inventory movements are immutable.',
  LOCATION_BARCODE_NOT_FOUND: 'Warehouse location barcode was not found.',
  BALANCE_NOT_FOUND: 'Inventory balance position was not found.',
} as const;
