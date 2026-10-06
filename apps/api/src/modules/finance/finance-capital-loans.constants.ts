export const CAPITAL_CONTRIBUTION_ERROR_MESSAGES = {
  NOT_FOUND: 'Capital contribution not found.',
  NOT_EDITABLE: 'Only DRAFT capital contributions can be edited.',
  NOT_POSTABLE: 'Only DRAFT capital contributions can be posted.',
  NOT_CANCELLABLE: 'Only DRAFT capital contributions can be cancelled.',
  NOT_REVERSIBLE: 'Only POSTED capital contributions can be reversed.',
  OTHER_FUNDING_REQUIRES_NOTES: 'OTHER_FUNDING requires notes explaining the economic nature.',
  CROSS_CURRENCY:
    'Capital currency must match the receiving account. Cross-currency funding is deferred to FX.',
  ACCOUNT_INACTIVE: 'Receiving account must be ACTIVE.',
  IDEMPOTENCY_CONFLICT: 'This requestId was already used for a different capital contribution payload.',
  INVALID_NOTES: 'Notes must be at most 2000 characters.',
  INVALID_REFERENCE: 'Reference must be at most 200 characters.',
  INVALID_CONTRIBUTOR_NAME: 'Contributor name is required and must be at most 200 characters.',
  INVALID_MONEY: 'Invalid money amount for the contribution currency.',
  LOAN_NOT_CAPITAL: 'LOAN is not a capital funding type; use the Loans API.',
} as const;

export const LOAN_ERROR_MESSAGES = {
  NOT_FOUND: 'Loan not found.',
  DISBURSEMENT_NOT_FOUND: 'Loan disbursement not found.',
  REPAYMENT_NOT_FOUND: 'Loan repayment not found.',
  NOT_EDITABLE: 'Only DRAFT loans can change economic fields.',
  NOT_CANCELLABLE: 'Only DRAFT loans with no disbursements can be cancelled.',
  DISBURSEMENT_NOT_POSTABLE: 'Only DRAFT disbursements can be posted.',
  DISBURSEMENT_NOT_CANCELLABLE: 'Only DRAFT disbursements can be cancelled.',
  DISBURSEMENT_NOT_REVERSIBLE:
    'Only POSTED disbursements without posted repayments can be reversed.',
  REPAYMENT_NOT_POSTABLE: 'Only DRAFT repayments can be posted.',
  REPAYMENT_NOT_CANCELLABLE: 'Only DRAFT repayments can be cancelled.',
  REPAYMENT_NOT_REVERSIBLE: 'Only POSTED repayments can be reversed.',
  CROSS_CURRENCY:
    'Loan operations require the same currency as the loan and account. Cross-currency settlement is deferred to FX / Liability Settlement.',
  ACCOUNT_INACTIVE: 'Account must be ACTIVE.',
  OVER_DISBURSE: 'Disbursement would exceed contracted principal.',
  OVER_REPAY: 'Principal repayment exceeds outstanding principal.',
  CURRENCY_IMMUTABLE: 'Loan currency cannot change after the first posted disbursement.',
  IDEMPOTENCY_CONFLICT: 'This requestId was already used for a different loan payload.',
  DISBURSEMENT_IDEMPOTENCY_CONFLICT:
    'This requestId was already used for a different disbursement payload.',
  REPAYMENT_IDEMPOTENCY_CONFLICT:
    'This requestId was already used for a different repayment payload.',
  INVALID_NOTES: 'Notes must be at most 2000 characters.',
  INVALID_REFERENCE: 'Reference must be at most 200 characters.',
  INVALID_LENDER_NAME: 'Lender name is required and must be at most 200 characters.',
  INVALID_MONEY: 'Invalid money amount for the loan currency.',
  DUE_DATE_BEFORE_EFFECTIVE: 'Due date cannot be before the loan effective / receipt date.',
  HAS_DISBURSEMENTS: 'Cannot cancel a loan that already has disbursements.',
  HAS_REPAYMENTS: 'Cannot reverse a disbursement after repayments exist.',
} as const;

export const CAPITAL_NOTES_MAX_LENGTH = 2000;
export const CAPITAL_REFERENCE_MAX_LENGTH = 200;
export const CAPITAL_CONTRIBUTOR_NAME_MAX_LENGTH = 200;
export const CAPITAL_SEARCH_MAX_LENGTH = 100;

export const LOAN_NOTES_MAX_LENGTH = 2000;
export const LOAN_REFERENCE_MAX_LENGTH = 200;
export const LOAN_LENDER_NAME_MAX_LENGTH = 200;
export const LOAN_SEARCH_MAX_LENGTH = 100;

/** Operational provenance keys — keep in sync with finance-accounts.constants. */
export const FINANCE_ACCOUNT_SOURCE_TYPES = {
  OPENING_BALANCE: 'OPENING_BALANCE',
  ACCOUNT_TRANSFER: 'ACCOUNT_TRANSFER',
  CAPITAL_INJECTION: 'CAPITAL_INJECTION',
  LOAN_DISBURSEMENT: 'LOAN_DISBURSEMENT',
  LOAN_REPAYMENT: 'LOAN_REPAYMENT',
  FX_CONVERSION: 'FX_CONVERSION',
  PAYMENT: 'PAYMENT',
  RECEIPT: 'RECEIPT',
} as const;
