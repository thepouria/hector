export const FINANCIAL_ACCOUNT_ERROR_MESSAGES = {
  NOT_FOUND: 'Financial account not found.',
  CODE_ALREADY_EXISTS: 'A financial account with this code already exists in the company.',
  INVALID_STATUS_TRANSITION: 'This financial account status transition is not allowed.',
  CURRENCY_IMMUTABLE: 'Account currency cannot be changed after creation.',
  TYPE_IMMUTABLE: 'Account type cannot be changed after movements exist.',
  DEFAULT_CONFLICT: 'Another account is already the default for this currency.',
  DEFAULT_REQUIRES_ACTIVE: 'Only an ACTIVE account can be the currency default.',
  ARCHIVE_BALANCE_NOT_ZERO: 'Account can only be archived when ledger balance is zero.',
  INACTIVE: 'Account is not ACTIVE.',
  ARCHIVED: 'Account is archived.',
  OPENING_ALREADY_EXISTS: 'Opening balance has already been recorded for this account.',
  OPENING_IDEMPOTENCY_CONFLICT:
    'This requestId was already used for a different opening-balance payload.',
  INSUFFICIENT_BALANCE: 'Insufficient account balance for this operation.',
  BALANCE_NOT_ACCEPTABLE: 'Balance is not an editable account field.',
  INVALID_CODE:
    'Account code must be 1–64 characters using A–Z, 0–9, underscore, or hyphen (e.g. CASH-IRR, BANK-MELLAT-IRR).',
  INVALID_NAME: 'Account name is required and must be at most 200 characters.',
  INVALID_DESCRIPTION: 'Account description must be at most 2000 characters.',
  INVALID_BANK_NAME: 'Bank name must be at most 200 characters.',
  INVALID_ACCOUNT_NUMBER: 'Account number must be at most 64 characters.',
  INVALID_IBAN: 'IBAN must be at most 34 characters.',
  INVALID_MONEY: 'Invalid money amount for the account currency.',
} as const;

export const ACCOUNT_TRANSFER_ERROR_MESSAGES = {
  NOT_FOUND: 'Account transfer not found.',
  NOT_EDITABLE: 'Only DRAFT transfers can be edited.',
  NOT_POSTABLE: 'Only DRAFT transfers can be posted.',
  NOT_CANCELLABLE: 'Only DRAFT transfers can be cancelled.',
  NOT_REVERSIBLE: 'Only POSTED transfers can be reversed.',
  SAME_ACCOUNT: 'Source and destination accounts must be different.',
  CROSS_CURRENCY:
    'Same-currency transfers only. Cross-currency movement belongs to FX / Payments (Phase 4.5/4.6).',
  ACCOUNT_INACTIVE: 'Both source and destination accounts must be ACTIVE.',
  IDEMPOTENCY_CONFLICT: 'This requestId was already used for a different transfer payload.',
  NUMBER_CONFLICT: 'Account transfer number conflict.',
  ALREADY_POSTED: 'Transfer is already posted.',
  ALREADY_REVERSED: 'Transfer is already reversed.',
  INVALID_NOTES: 'Transfer notes must be at most 2000 characters.',
} as const;

export const FINANCIAL_ACCOUNT_CODE_MAX_LENGTH = 64;
export const FINANCIAL_ACCOUNT_NAME_MAX_LENGTH = 200;
export const FINANCIAL_ACCOUNT_DESCRIPTION_MAX_LENGTH = 2000;
export const FINANCIAL_ACCOUNT_BANK_NAME_MAX_LENGTH = 200;
export const FINANCIAL_ACCOUNT_NUMBER_MAX_LENGTH = 64;
export const FINANCIAL_ACCOUNT_IBAN_MAX_LENGTH = 34;
export const FINANCIAL_ACCOUNT_SEARCH_MAX_LENGTH = 100;

/** Same operational code alphabet as Warehouse / Catalog. */
export const FINANCIAL_ACCOUNT_CODE_PATTERN = /^[A-Z0-9_-]+$/;

export const FINANCIAL_ACCOUNT_SORT_FIELDS = [
  'name',
  'code',
  'status',
  'currency',
  'type',
  'updatedAt',
  'createdAt',
] as const;
export type FinancialAccountSortField = (typeof FINANCIAL_ACCOUNT_SORT_FIELDS)[number];

export const ACCOUNT_TRANSFER_NOTES_MAX_LENGTH = 2000;
export const ACCOUNT_TRANSFER_SEARCH_MAX_LENGTH = 100;

/** Provenance keys written by Phase 4.2 / 4.3 / 4.5 workflows. */
export const FINANCE_ACCOUNT_SOURCE_TYPES = {
  OPENING_BALANCE: 'OPENING_BALANCE',
  ACCOUNT_TRANSFER: 'ACCOUNT_TRANSFER',
  CAPITAL_INJECTION: 'CAPITAL_INJECTION',
  LOAN_DISBURSEMENT: 'LOAN_DISBURSEMENT',
  LOAN_REPAYMENT: 'LOAN_REPAYMENT',
  FX_CONVERSION: 'FX_CONVERSION',
} as const;
