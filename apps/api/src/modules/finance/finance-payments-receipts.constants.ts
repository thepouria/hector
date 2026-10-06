export const PAYMENT_ERROR_MESSAGES = {
  NOT_FOUND: 'Payment not found.',
  NOT_EDITABLE: 'Only DRAFT payments can be edited.',
  NOT_POSTABLE: 'Only DRAFT payments can be posted.',
  NOT_CANCELLABLE: 'Only DRAFT payments can be cancelled.',
  NOT_REVERSIBLE: 'Only POSTED payments can be reversed.',
  REVERSAL_REASON_REQUIRED: 'Reversal requires a non-empty reason.',
  ACCOUNT_INACTIVE: 'Payment account must be ACTIVE.',
  CURRENCY_MISMATCH:
    'Payment currency must match the account currency. Cross-currency settlement is deferred to FX Conversion / Phase 4.9.',
  IDEMPOTENCY_CONFLICT: 'This requestId was already used for a different payment payload.',
  INVALID_NOTES: 'Notes must be at most 2000 characters.',
  INVALID_REFERENCE: 'Reference must be at most 200 characters.',
  INVALID_EXTERNAL_REFERENCE: 'External reference must be at most 200 characters.',
  INVALID_COUNTERPARTY_NAME: 'Counterparty name must be at most 200 characters.',
  INVALID_PURPOSE_REFERENCE_TYPE: 'Purpose reference type must be at most 100 characters.',
  INVALID_MONEY: 'Invalid money amount for the payment currency.',
  POSTED_IMMUTABLE: 'Posted payments are immutable; reverse to undo.',
} as const;

export const RECEIPT_ERROR_MESSAGES = {
  NOT_FOUND: 'Receipt not found.',
  NOT_EDITABLE: 'Only DRAFT receipts can be edited.',
  NOT_POSTABLE: 'Only DRAFT receipts can be posted.',
  NOT_CANCELLABLE: 'Only DRAFT receipts can be cancelled.',
  NOT_REVERSIBLE: 'Only POSTED receipts can be reversed.',
  REVERSAL_REASON_REQUIRED: 'Reversal requires a non-empty reason.',
  ACCOUNT_INACTIVE: 'Receipt account must be ACTIVE.',
  CURRENCY_MISMATCH:
    'Receipt currency must match the account currency. Cross-currency settlement is deferred to FX Conversion / Phase 4.9.',
  IDEMPOTENCY_CONFLICT: 'This requestId was already used for a different receipt payload.',
  INVALID_NOTES: 'Notes must be at most 2000 characters.',
  INVALID_REFERENCE: 'Reference must be at most 200 characters.',
  INVALID_EXTERNAL_REFERENCE: 'External reference must be at most 200 characters.',
  INVALID_COUNTERPARTY_NAME: 'Counterparty name must be at most 200 characters.',
  INVALID_SOURCE_REFERENCE_TYPE: 'Source reference type must be at most 100 characters.',
  INVALID_MONEY: 'Invalid money amount for the receipt currency.',
  POSTED_IMMUTABLE: 'Posted receipts are immutable; reverse to undo.',
} as const;

export const PAYMENT_NOTES_MAX_LENGTH = 2000;
export const PAYMENT_REFERENCE_MAX_LENGTH = 200;
export const PAYMENT_EXTERNAL_REFERENCE_MAX_LENGTH = 200;
export const PAYMENT_COUNTERPARTY_NAME_MAX_LENGTH = 200;
export const PAYMENT_PURPOSE_REFERENCE_TYPE_MAX_LENGTH = 100;
export const PAYMENT_SEARCH_MAX_LENGTH = 100;
export const PAYMENT_REVERSAL_REASON_MAX_LENGTH = 2000;

export const RECEIPT_NOTES_MAX_LENGTH = 2000;
export const RECEIPT_REFERENCE_MAX_LENGTH = 200;
export const RECEIPT_EXTERNAL_REFERENCE_MAX_LENGTH = 200;
export const RECEIPT_COUNTERPARTY_NAME_MAX_LENGTH = 200;
export const RECEIPT_SOURCE_REFERENCE_TYPE_MAX_LENGTH = 100;
export const RECEIPT_SEARCH_MAX_LENGTH = 100;
export const RECEIPT_REVERSAL_REASON_MAX_LENGTH = 2000;
