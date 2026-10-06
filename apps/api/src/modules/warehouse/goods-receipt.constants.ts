export const GOODS_RECEIPT_ERROR_MESSAGES = {
  NOT_FOUND: 'Goods receipt was not found.',
  NOT_DRAFT: 'Only DRAFT goods receipts can be modified.',
  ALREADY_POSTED: 'This goods receipt is already posted.',
  EMPTY: 'A goods receipt needs at least one item before it can be posted.',
  ITEM_NOT_FOUND: 'Goods receipt item was not found.',
  ITEM_DUPLICATE: 'This purchase order item is already on the goods receipt.',
  ITEM_INVALID: 'Receipt item must reference a purchase order item on the same purchase order.',
  SKU_MISMATCH: 'Receipt item SKU must match the purchase order item SKU.',
  PO_ITEM_MISMATCH: 'Receipt item does not belong to the goods receipt purchase order.',
  WAREHOUSE_INACTIVE: 'Goods receipts may only target an ACTIVE warehouse.',
  INVALID_QUANTITY: 'Received quantity must be a positive integer.',
  VERSION_CONFLICT: 'The goods receipt was modified by another request. Reload and try again.',
  POSTED_IMMUTABLE: 'Posted goods receipts cannot be edited.',
  CANCEL_NOT_ALLOWED: 'Only DRAFT goods receipts can be cancelled in Phase 3.4.',
  INVALID_NOTES: 'Goods receipt notes must be at most 2000 characters.',
  INVALID_ITEM_NOTES: 'Goods receipt item notes must be at most 1000 characters.',
  UNKNOWN_BARCODE: 'Barcode was not found in the catalog for this company.',
  BARCODE_NOT_ACTIVE: 'Barcode is archived and cannot be used for receiving.',
  SKU_NOT_IN_PURCHASE_ORDER: 'Resolved SKU is not on this purchase order.',
  AMBIGUOUS_PO_ITEM: 'Resolved SKU matches more than one purchase order line.',
  PO_ITEM_ALREADY_FULLY_RECEIVED: 'This purchase order line is already fully received.',
  PO_ITEM_RECEIVING_CLOSED: 'This purchase order line is closed for receiving (shortage closed).',
  RECEIVING_QUANTITY_EXCEEDED: 'Requested quantity exceeds available draft capacity for this line.',
  GRN_NOT_DRAFT: 'Scanner receiving is only allowed on DRAFT goods receipts.',
} as const;

export const GOODS_RECEIPT_NOTES_MAX_LENGTH = 2000;
export const GOODS_RECEIPT_ITEM_NOTES_MAX_LENGTH = 1000;
export const GOODS_RECEIPT_CANCELLATION_REASON_MAX_LENGTH = 1000;
export const GOODS_RECEIPT_SEARCH_MAX_LENGTH = 100;
export const GOODS_RECEIPT_MAX_ITEMS = 500;

export const GOODS_RECEIPT_SORT_FIELDS = [
  'number',
  'status',
  'receivedAt',
  'createdAt',
  'updatedAt',
] as const;
export type GoodsReceiptSortField = (typeof GOODS_RECEIPT_SORT_FIELDS)[number];
