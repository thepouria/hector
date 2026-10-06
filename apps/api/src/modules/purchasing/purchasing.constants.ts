/**
 * Purchasing domain constants (Phase 2.2 Supplier Master).
 * Permission keys are also registered in packages/database/src/permissions.ts.
 */
export const PURCHASING_PERMISSIONS = {
  READ: 'purchasing.read',
  CREATE: 'purchasing.create',
  MANAGE: 'purchasing.manage',
  APPROVE: 'purchasing.approve',
  CANCEL: 'purchasing.cancel',
  PO_CORRECT: 'purchasing.po.correct',
  PO_SHORT_CLOSE: 'purchasing.po.short_close',
  DISCREPANCY_MANAGE: 'purchasing.discrepancy.manage',
  RETURN_CREATE: 'purchasing.return.create',
  RETURN_APPROVE: 'purchasing.return.approve',
  RETURN_CANCEL: 'purchasing.return.cancel',
} as const;

export type PurchasingPermissionKey =
  (typeof PURCHASING_PERMISSIONS)[keyof typeof PURCHASING_PERMISSIONS];

/** Planned HTTP prefix under global `/api/v1`. */
export const PURCHASING_API_PREFIX = 'purchasing';

export const SUPPLIER_NAME_MAX_LENGTH = 200;
export const SUPPLIER_LEGAL_NAME_MAX_LENGTH = 200;
export const SUPPLIER_CODE_MAX_LENGTH = 64;
export const SUPPLIER_PHONE_MAX_LENGTH = 64;
export const SUPPLIER_EMAIL_MAX_LENGTH = 254;
export const SUPPLIER_ADDRESS_MAX_LENGTH = 500;

export const SUPPLIER_CONTACT_NAME_MAX_LENGTH = 120;
export const SUPPLIER_CONTACT_ROLE_MAX_LENGTH = 80;
export const SUPPLIER_CONTACT_NOTES_MAX_LENGTH = 1000;

export const SUPPLIER_NOTE_BODY_MAX_LENGTH = 4000;

export const SUPPLIER_SEARCH_MAX_LENGTH = 200;

export const SUPPLIER_SORT_FIELDS = ['name', 'createdAt', 'updatedAt'] as const;
export type SupplierSortField = (typeof SUPPLIER_SORT_FIELDS)[number];

export const SUPPLIER_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,63}$/;

export const SUPPLIER_OFFER_NOTES_MAX_LENGTH = 2000;
export const SUPPLIER_OFFER_SEARCH_MAX_LENGTH = 200;
export const SUPPLIER_OFFER_SORT_FIELDS = [
  'quotedAt',
  'unitPrice',
  'createdAt',
  'validUntil',
] as const;
export type SupplierOfferSortField = (typeof SUPPLIER_OFFER_SORT_FIELDS)[number];

export const PURCHASING_ERROR_MESSAGES = {
  SUPPLIER_NOT_FOUND: 'Supplier was not found.',
  SUPPLIER_CODE_ALREADY_EXISTS: 'A supplier with this code already exists in the company.',
  SUPPLIER_CONTACT_NOT_FOUND: 'Supplier contact was not found.',
  SUPPLIER_CONTACT_ALREADY_ARCHIVED: 'Supplier contact is already archived.',
  SUPPLIER_PRIMARY_CONTACT_CONFLICT: 'Another contact is already marked as primary.',
  SUPPLIER_NOTE_NOT_FOUND: 'Supplier note was not found.',
  SUPPLIER_INVALID_STATUS_TRANSITION: 'This supplier status transition is not allowed.',
  INVALID_SUPPLIER_NAME: 'Supplier name is invalid.',
  INVALID_SUPPLIER_CODE: 'Supplier code is invalid.',
  INVALID_SUPPLIER_EMAIL: 'Supplier email is invalid.',
  INVALID_CONTACT_NAME: 'Contact name is invalid.',
  INVALID_NOTE_BODY: 'Note body is invalid.',

  SUPPLIER_OFFER_NOT_FOUND: 'Supplier offer was not found.',
  SUPPLIER_OFFER_ALREADY_ARCHIVED: 'Supplier offer is already archived.',
  SUPPLIER_OFFER_SUPPLIER_NOT_ASSIGNABLE:
    'Offers can only be recorded for active or inactive suppliers (not archived).',
  SUPPLIER_OFFER_SKU_NOT_ASSIGNABLE: 'Offers can only be recorded for non-archived SKUs.',
  SUPPLIER_OFFER_CONTACT_INVALID: 'Supplier contact does not belong to the selected supplier.',
  SUPPLIER_OFFER_INVALID_TERMS: 'Purchase type and payment terms are inconsistent.',
  SUPPLIER_OFFER_INVALID_FX: 'FX reference rate requires an explicit currency pair and positive rate.',
  SUPPLIER_OFFER_INVALID_PRICE: 'Unit price must be a positive decimal amount.',
  SUPPLIER_OFFER_INVALID_VALIDITY: 'validUntil must be greater than or equal to quotedAt.',
} as const;

// ---------------------------------------------------------------------------
// Phase 2.4 Purchase Orders
// ---------------------------------------------------------------------------
export const PURCHASE_ORDER_NOTES_MAX_LENGTH = 2000;
export const PURCHASE_ORDER_CANCELLATION_REASON_MAX_LENGTH = 1000;
export const PURCHASE_ORDER_SUPPLIER_ORDER_REFERENCE_MAX_LENGTH = 120;
export const PURCHASE_ORDER_ITEM_NOTES_MAX_LENGTH = 1000;
export const PURCHASE_ORDER_SEARCH_MAX_LENGTH = 200;
export const PURCHASE_ORDER_MAX_ITEMS = 500;
/** Per-line ordered quantity cap (Int column; keeps line totals inside Decimal(24,6)). */
export const PURCHASE_ORDER_MAX_QUANTITY = 10_000_000;
/** Unit price must be strictly below this (rials / USD). */
export const PURCHASE_ORDER_MAX_UNIT_PRICE = '10000000000';
/** Decimal(24,6) has 18 integer digits. */
export const PURCHASE_ORDER_MAX_TOTAL = '1000000000000000000';
export const PURCHASE_ORDER_SORT_FIELDS = [
  'orderDate',
  'dueDate',
  'createdAt',
  'number',
  'total',
  'status',
] as const;
export type PurchaseOrderSortField = (typeof PURCHASE_ORDER_SORT_FIELDS)[number];

export const PURCHASE_ORDER_ERROR_MESSAGES = {
  NOT_FOUND: 'Purchase order was not found.',
  ITEM_NOT_FOUND: 'Purchase order item was not found.',
  INVALID_STATUS_TRANSITION: 'This purchase order status transition is not allowed.',
  NOT_EDITABLE: 'This purchase order can no longer be edited in its current status.',
  VERSION_CONFLICT:
    'The purchase order was modified by another request. Reload and try again.',
  DUPLICATE_SKU: 'This SKU already exists on the purchase order.',
  EMPTY: 'A purchase order needs at least one item before it can progress.',
  PARTY_LOCKED:
    'Supplier and currency cannot change while the purchase order has items. Remove the items first.',
  SUPPLIER_NOT_ASSIGNABLE: 'Archived suppliers cannot be used on purchase orders.',
  SKU_NOT_ASSIGNABLE: 'Archived SKUs cannot be used on purchase orders.',
  CONTACT_INVALID: 'Supplier contact does not belong to the selected supplier.',
  OFFER_INVALID:
    'Supplier offer must belong to the same supplier and SKU, match the PO currency, and not be archived.',
  INVALID_QUANTITY: 'Quantity must be a positive integer within the allowed range.',
  INVALID_PRICE: 'Unit price must be a positive decimal amount.',
  INVALID_DATES: 'expectedAt must be greater than or equal to orderDate.',
  TOTAL_OUT_OF_RANGE: 'Purchase order total exceeds the supported range.',
  INVALID_TERMS: 'Purchase type and commercial terms are inconsistent.',
  INVALID_FX:
    'FX_CREDIT requires a positive reference FX rate with an explicit base/quote currency pair.',
  TERMS_INCOMPLETE:
    'Purchase type commercial terms are incomplete for this lifecycle transition.',
  CANCELLATION_REASON_REQUIRED:
    'A cancellation reason is required once the purchase order is approved or ordered.',
  NOT_RECEIVABLE:
    'This purchase order is not eligible for Warehouse receiving in its current status.',
  CANCELLED: 'Cancelled purchase orders cannot accept Warehouse receipts.',
  ALREADY_RECEIVED:
    'This purchase order is already fully received; additional receiving requires an explicit over-receipt policy.',
  ITEM_MISMATCH_DUPLICATE: 'Duplicate purchase order item identity in receiving evidence.',
  OVER_RECEIPT_NOT_ALLOWED:
    'Accepted received quantity cannot exceed ordered quantity without an explicit over-receipt policy.',
  HAS_POSTED_RECEIPTS:
    'This purchase order has posted goods receipts and cannot be cancelled.',
} as const;

/** Max net days for NET_DAYS terms (≈10 years). */
export const PURCHASE_ORDER_MAX_NET_DAYS = 3650;

export const PURCHASE_ORDER_PAYMENT_TERMS_NOTE_MAX_LENGTH = 1000;

/**
 * Days ahead (exclusive of today) treated as DUE_SOON for derived contractual due status.
 * Not payment state — see docs/credit-terms.md.
 */
export const PURCHASE_ORDER_DUE_SOON_DAYS = 3;

export const PURCHASE_DUE_STATUSES = [
  'NO_DUE_DATE',
  'UPCOMING',
  'DUE_SOON',
  'DUE_TODAY',
  'OVERDUE',
] as const;
export type PurchaseDueStatus = (typeof PURCHASE_DUE_STATUSES)[number];

/**
 * FX_CREDIT settlement is always based on remaining foreign obligation (Finance later).
 * Not a mutable PO payment status — Purchasing only records the commercial principal.
 */
export const FX_PURCHASE_SETTLEMENT_BASIS = 'FOREIGN_OBLIGATION' as const;
export type FxPurchaseSettlementBasis = typeof FX_PURCHASE_SETTLEMENT_BASIS;

/** Matches Prisma `@db.Decimal(24, 8)` for reference FX rates. */
export const PURCHASE_ORDER_FX_RATE_MAX_DECIMAL_PLACES = 8;

// ---------------------------------------------------------------------------
// Phase 2.8 Purchase Costs
// ---------------------------------------------------------------------------

export const PURCHASE_COST_DESCRIPTION_MAX_LENGTH = 500;
export const PURCHASE_COST_PAYEE_NAME_MAX_LENGTH = 200;
export const PURCHASE_COST_REFERENCE_MAX_LENGTH = 120;
export const PURCHASE_COST_NOTES_MAX_LENGTH = 1000;
export const PURCHASE_COST_VOID_REASON_MAX_LENGTH = 1000;
/** Soft cap per PO to keep detail/list aggregation fast. */
export const PURCHASE_ORDER_MAX_COSTS = 200;

export const PURCHASE_COST_ERROR_MESSAGES = {
  NOT_FOUND: 'Purchase cost was not found.',
  INVALID_AMOUNT: 'Purchase cost amount must be a positive decimal amount.',
  INVALID_OTHER: 'OTHER purchase costs require a meaningful description.',
  NOT_EDITABLE: 'This purchase cost can no longer be edited.',
  NOT_VOIDABLE: 'This purchase cost cannot be voided in its current state.',
  VOID_REASON_REQUIRED: 'Voiding a purchase cost requires a reason.',
  PO_NOT_ACCEPTING: 'Purchase costs cannot be changed on a cancelled purchase order.',
  TOO_MANY: 'This purchase order already has the maximum number of cost rows.',
} as const;

// ---------------------------------------------------------------------------
// Phase 2.11 Returns / Corrections / Discrepancies
// ---------------------------------------------------------------------------

export const PURCHASE_CORRECTION_REASON_MAX_LENGTH = 1000;
export const PURCHASE_DISCREPANCY_REASON_MAX_LENGTH = 1000;
export const PURCHASE_DISCREPANCY_NOTES_MAX_LENGTH = 2000;
export const PURCHASE_RETURN_NOTES_MAX_LENGTH = 2000;
export const PURCHASE_RETURN_CANCELLATION_REASON_MAX_LENGTH = 1000;
export const PURCHASE_RETURN_MAX_ITEMS = 200;
export const PURCHASE_RETURN_SEARCH_MAX_LENGTH = 200;
export const PURCHASE_RETURN_SORT_FIELDS = ['createdAt', 'number', 'status'] as const;
export type PurchaseReturnSortField = (typeof PURCHASE_RETURN_SORT_FIELDS)[number];

export const PURCHASE_CORRECTION_ERROR_MESSAGES = {
  NOT_ALLOWED:
    'This purchase order cannot accept commercial corrections in its current status. Use draft edit, or cancel/create a new PO when appropriate.',
  UNSUPPORTED: 'This correction type or field change is not supported.',
  REASON_REQUIRED: 'A correction reason is required.',
  NO_CHANGE: 'Correction must change at least one commercial value.',
} as const;

export const PURCHASE_DISCREPANCY_ERROR_MESSAGES = {
  NOT_FOUND: 'Purchase discrepancy was not found.',
  INVALID: 'Purchase discrepancy payload is invalid.',
  NOT_OPEN: 'Only open discrepancies can be resolved this way.',
} as const;

export const PURCHASE_SHORT_CLOSE_ERROR_MESSAGES = {
  INVALID: 'Short-close quantity must be a positive integer within the remaining open quantity.',
  NOT_ALLOWED: 'Short-close is not allowed for this purchase order status.',
} as const;

export const PURCHASE_RETURN_ERROR_MESSAGES = {
  NOT_FOUND: 'Purchase return was not found.',
  INVALID_STATUS: 'This purchase return status transition is not allowed.',
  EMPTY: 'A purchase return needs at least one item.',
  SUPPLIER_MISMATCH: 'Purchase return supplier must match the linked purchase order supplier.',
  ITEM_INVALID: 'Purchase return item does not belong to the linked purchase order.',
  SKU_MISMATCH: 'Purchase return SKU must match the linked purchase order item SKU.',
  VERSION_CONFLICT: 'The purchase return was modified by another request. Reload and try again.',
  HAS_DISPATCHED_EXECUTION:
    'Purchase return cannot be cancelled after a supplier return execution has been dispatched.',
} as const;
