export const COST_LAYER_ERROR_MESSAGES = {
  INSUFFICIENT_LAYER_QUANTITY: 'Insufficient FIFO cost-layer quantity for outbound',
  LAYER_NOT_FOUND: 'Cost layer not found',
  INVALID_QUANTITY: 'Cost layer quantity must be a positive integer',
} as const;

/** Movement types that create acquisition / unvalued inbound layers. */
export const LAYER_INBOUND_MOVEMENT_TYPES = [
  'RECEIVE',
  'ADJUSTMENT_IN',
  'STOCK_COUNT_ADJUSTMENT_IN',
  'OPENING_BALANCE',
  'RETURN_IN',
] as const;

/** Movement types that consume layers economically (or move provenance). */
export const LAYER_OUTBOUND_MOVEMENT_TYPES = [
  'ISSUE',
  'ADJUSTMENT_OUT',
  'STOCK_COUNT_ADJUSTMENT_OUT',
  'RETURN_OUT',
  'TRANSFER_OUT',
  'RECLASSIFY_OUT',
] as const;
