export const SUPPLIER_PAYABLE_NOTES_MAX_LENGTH = 2000;
export const SUPPLIER_PAYABLE_REFERENCE_MAX_LENGTH = 200;
export const SUPPLIER_PAYABLE_SEARCH_MAX_LENGTH = 100;

export const SUPPLIER_PAYABLE_LIABILITY_SOURCE_TYPES = {
  GOODS_RECEIPT_ITEM: 'GOODS_RECEIPT_ITEM',
  SUPPLIER_RETURN_EXECUTION: 'SUPPLIER_RETURN_EXECUTION',
  SUPPLIER_RETURN_EXECUTION_SLICE: 'SUPPLIER_RETURN_EXECUTION_SLICE',
  OPENING_BALANCE: 'OPENING_BALANCE',
  SUPPLIER_PAYMENT_ALLOCATION: 'SUPPLIER_PAYMENT_ALLOCATION',
  SUPPLIER_CREDIT: 'SUPPLIER_CREDIT',
} as const;

export const SUPPLIER_PAYABLE_ERROR_MESSAGES = {
  NOT_FOUND: 'Supplier payable not found.',
  SUPPLIER_NOT_FOUND: 'Supplier not found.',
  CURRENCY_MISMATCH: 'Allocation currency must match payable currency.',
  OVER_ALLOCATE: 'Allocation exceeds payable outstanding.',
  AMOUNT_INVALID: 'Amount must be a positive money value.',
  OPENING_REQUIRES_SUPPLIER: 'Opening payable requires a supplier.',
  IDEMPOTENCY_CONFLICT: 'Idempotency conflict for supplier payable request.',
  ALLOCATION_NOT_FOUND: 'Supplier payment allocation not found.',
  CANCELLED: 'Cannot allocate against a cancelled payable.',
} as const;
