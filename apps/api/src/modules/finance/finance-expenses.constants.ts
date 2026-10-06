export const EXPENSE_ERROR_MESSAGES = {
  NOT_FOUND: 'Expense not found.',
  CATEGORY_NOT_FOUND: 'Expense category not found.',
  CATEGORY_INACTIVE: 'Expense category must be ACTIVE.',
  CATEGORY_CODE_TAKEN: 'Expense category code already exists.',
  NOT_EDITABLE: 'Only DRAFT expenses can be edited.',
  NOT_APPROVABLE: 'Only DRAFT expenses can be approved.',
  NOT_CANCELLABLE: 'Only DRAFT or APPROVED unpaid expenses can be cancelled.',
  CANCEL_WITH_PAYMENTS:
    'Cannot cancel an expense with active payment allocations. Reverse payments first.',
  NOT_ALLOCATABLE: 'Only APPROVED expenses can receive payment allocations.',
  OVER_ALLOCATION: 'Allocation would exceed expense outstanding amount.',
  CROSS_CURRENCY:
    'Cross-currency expense settlement requires Phase 4.9 FX settlement semantics.',
  PAYMENT_NOT_POSTED: 'Only POSTED payments can be allocated to expenses.',
  PAYMENT_CURRENCY_MISMATCH: 'Payment currency must match expense currency.',
  IDEMPOTENCY_CONFLICT: 'This requestId was already used for a different expense payload.',
  INVALID_DESCRIPTION: 'Description must be 1–500 characters.',
  INVALID_NOTES: 'Notes must be at most 2000 characters.',
  INVALID_REFERENCE: 'Reference must be at most 200 characters.',
  INVALID_COUNTERPARTY_NAME: 'Counterparty name must be at most 200 characters.',
  INVALID_MONEY: 'Invalid money amount for the expense currency.',
  APPROVED_IMMUTABLE: 'Approved expenses are immutable except for settlement.',
  ALLOCATION_NOT_FOUND: 'Expense payment allocation not found.',
} as const;

export const EXPENSE_CATEGORY_ERROR_MESSAGES = {
  NOT_FOUND: 'Expense category not found.',
  NOT_EDITABLE: 'Archived categories cannot be edited.',
  CODE_INVALID: 'Category code must be 2–40 uppercase letters, digits, or underscores.',
  NAME_INVALID: 'Category name must be 1–120 characters.',
} as const;

export const EXPENSE_DESCRIPTION_MAX_LENGTH = 500;
export const EXPENSE_NOTES_MAX_LENGTH = 2000;
export const EXPENSE_REFERENCE_MAX_LENGTH = 200;
export const EXPENSE_COUNTERPARTY_NAME_MAX_LENGTH = 200;
export const EXPENSE_SEARCH_MAX_LENGTH = 100;
export const EXPENSE_CATEGORY_CODE_MAX_LENGTH = 40;
export const EXPENSE_CATEGORY_NAME_MAX_LENGTH = 120;
export const EXPENSE_CATEGORY_DESCRIPTION_MAX_LENGTH = 500;

/** Default system expense categories seeded per company (idempotent by code). */
export const DEFAULT_EXPENSE_CATEGORIES = [
  { code: 'RENT', name: 'Rent' },
  { code: 'SALARY', name: 'Salary' },
  { code: 'TRANSPORT', name: 'Transport' },
  { code: 'COURIER', name: 'Courier' },
  { code: 'OFFICE', name: 'Office' },
  { code: 'UTILITIES', name: 'Utilities' },
  { code: 'SOFTWARE', name: 'Software' },
  { code: 'BANK_FEE', name: 'Bank fee' },
  { code: 'FREIGHT', name: 'Freight' },
  { code: 'CUSTOMS', name: 'Customs' },
  { code: 'PACKAGING', name: 'Packaging' },
  { code: 'PURCHASE_FEE', name: 'Purchase fee' },
  { code: 'OTHER', name: 'Other' },
] as const;

export const PURCHASE_COST_FINANCE_ERROR_MESSAGES = {
  TREATMENT_REQUIRED: 'Purchase cost treatment must be set before allocation.',
  TREATMENT_IMMUTABLE: 'Purchase cost treatment is immutable once set.',
  ALREADY_ALLOCATED: 'Purchase cost is already allocated.',
  ALLOCATION_SUM_MISMATCH: 'Allocation lines must sum exactly to the cost amount.',
  TARGETS_REQUIRED: 'Allocation requires at least one target.',
  MANUAL_LINES_REQUIRED: 'MANUAL allocation requires explicit lines.',
  CAPITALIZABLE_REQUIRES_LAYERS:
    'CAPITALIZABLE allocation requires inventory cost layers (received stock).',
  CROSS_CURRENCY_COST:
    'Cross-currency purchase cost capitalization/settlement requires Phase 4.9.',
  NOT_ACTIVE: 'Only ACTIVE purchase costs can be financialized.',
  OVER_PAYMENT: 'Payment allocation would exceed purchase cost outstanding.',
  PERIOD_EXPENSE_PAY_VIA_EXPENSE:
    'PERIOD_EXPENSE costs are paid via the linked Expense, not direct cost allocations.',
} as const;
