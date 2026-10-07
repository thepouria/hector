/** Phase 6.1 — Settlement Allocation Core constants. */

export const SETTLEMENT_CODE_PREFIX = 'STL';
export const SETTLEMENT_CODE_PATTERN = /^STL-\d{6,}$/;

export const SETTLEMENT_NOTES_MAX = 4000;
export const SETTLEMENT_REFERENCE_MAX = 200;
export const SETTLEMENT_REVERSE_REASON_MAX = 1000;

export const SETTLEMENT_ERROR_MESSAGES = {
  NOT_FOUND: 'Settlement was not found.',
  ITEM_NOT_FOUND: 'Settlement item was not found.',
  ALLOCATION_NOT_FOUND: 'Settlement allocation was not found.',
  OBLIGATION_NOT_FOUND: 'Settlement obligation was not found.',
  INVALID_STATUS: 'Settlement status transition is not allowed.',
  DRAFT_ONLY: 'This operation is only allowed while the Settlement is DRAFT.',
  OPENABLE_ONLY: 'Settlement can only be opened from DRAFT.',
  CANCEL_BLOCKED: 'Settlement with active allocations cannot be cancelled. Reverse allocations first.',
  ALREADY_CANCELLED: 'Settlement is already cancelled.',
  NOT_ALLOCATABLE: 'Settlement is not in an allocatable state.',
  SOURCE_UNSUPPORTED: 'This settlement source type is not enabled.',
  SOURCE_NOT_SETTLEABLE: 'Source obligation is not settleable.',
  CURRENCY_MISMATCH: 'Currency mismatch — cross-currency settlement is deferred to Phase 6.2.',
  PARTY_CONFLICT: 'Settlement party contradicts the obligation counterparty.',
  PAYMENT_NOT_FOUND: 'Payment was not found.',
  PAYMENT_NOT_POSTED: 'Only POSTED payments can be allocated.',
  RECEIPT_NOT_FOUND: 'Receipt was not found.',
  RECEIPT_NOT_POSTED: 'Only POSTED receipts can be allocated.',
  OVER_ALLOCATE_PAYMENT: 'Allocation would exceed remaining payment capacity.',
  OVER_ALLOCATE_RECEIPT: 'Allocation would exceed remaining receipt capacity.',
  OVER_SETTLE_OBLIGATION: 'Allocation would exceed remaining obligation capacity.',
  INVALID_AMOUNT: 'Allocation amount must be a positive money amount.',
  ALLOCATION_ALREADY_REVERSED: 'Allocation is already reversed.',
  IDEMPOTENCY_CONFLICT: 'This requestId was already used for a different settlement payload.',
  FINANCE_TXN_UNSUPPORTED: 'This finance transaction type is not enabled for allocation.',
  FINANCE_TXN_DIRECTION_INVALID:
    'Finance transaction direction is not valid for this settlement source.',
  CHANNEL_SETTLEMENT_NOT_FOUND: 'Channel settlement was not found.',
  CHANNEL_SETTLEMENT_INVALID_STATUS: 'Channel settlement status transition is not allowed.',
  CHANNEL_SETTLEMENT_EDIT_BLOCKED:
    'Channel settlement components cannot be changed after receipt allocation.',
  CHANNEL_SETTLEMENT_NEGATIVE_NET: 'Expected net cannot be negative for finalization.',
  CHANNEL_SETTLEMENT_COMPONENT_INVALID: 'Channel settlement component is invalid.',
  CHANNEL_SETTLEMENT_DUPLICATE: 'A channel settlement with this external reference already exists.',
} as const;
