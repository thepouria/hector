export const FX_RATE_ERROR_MESSAGES = {
  NOT_FOUND: 'FX rate not found.',
  INVALID_RATE: 'FX rate must be positive.',
  SAME_CURRENCY: 'Base and quote currencies must be different.',
  INVALID_NOTES: 'FX rate notes must be at most 2000 characters.',
  INVALID_SOURCE_REFERENCE: 'Source reference must be at most 200 characters.',
  IMMUTABLE: 'FX rates are immutable. Create a new rate instead of updating.',
  ARCHIVED: 'FX rate is archived.',
  REFERENCED_CANNOT_HARD_DELETE:
    'FX rate is referenced by a conversion and cannot be hard-deleted. Archive instead.',
  ZERO_RATE: 'FX rate of zero is rejected.',
} as const;

export const FX_CONVERSION_ERROR_MESSAGES = {
  NOT_FOUND: 'FX conversion not found.',
  NOT_EDITABLE: 'Only DRAFT FX conversions can be edited.',
  NOT_POSTABLE: 'Only DRAFT FX conversions can be posted.',
  NOT_CANCELLABLE: 'Only DRAFT FX conversions can be cancelled.',
  NOT_REVERSIBLE: 'Only POSTED FX conversions can be reversed.',
  SAME_CURRENCY:
    'Same-currency movement is not an FX conversion. Use an account transfer instead.',
  SAME_ACCOUNT: 'Source and destination accounts must be different.',
  ACCOUNT_INACTIVE: 'Source and destination accounts must be ACTIVE.',
  ACCOUNT_CURRENCY_MISMATCH:
    'Account currency must match the conversion side currency (from → source, to → destination).',
  ARITHMETIC_MISMATCH:
    'toAmount does not match convertMoney(fromAmount) at the applied rate within rounding policy.',
  RATE_TYPE_MUST_BE_CONVERSION: 'FX conversion applied rateType must be CONVERSION.',
  IDEMPOTENCY_CONFLICT: 'This requestId was already used for a different FX conversion payload.',
  NUMBER_CONFLICT: 'FX conversion number conflict.',
  ALREADY_POSTED: 'FX conversion is already posted.',
  ALREADY_REVERSED: 'FX conversion is already reversed.',
  INVALID_NOTES: 'FX conversion notes must be at most 2000 characters.',
  FEE_INCOMPLETE: 'Fee requires feeAmount, feeCurrency, and feeAccountId together.',
  FEE_CURRENCY_MISMATCH: 'Fee account currency must match feeCurrency.',
  RATE_PAIR_MISMATCH: 'Applied rate base/quote pair cannot convert from→to currencies.',
  VALUATION_UNAVAILABLE: 'No applicable FX rate for valuation at the requested asOf.',
} as const;

export const FX_RATE_NOTES_MAX_LENGTH = 2000;
export const FX_RATE_SOURCE_REFERENCE_MAX_LENGTH = 200;
export const FX_CONVERSION_NOTES_MAX_LENGTH = 2000;
export const FX_SEARCH_MAX_LENGTH = 100;

/** Provenance key for FX conversion cash movements. */
export const FX_CONVERSION_SOURCE_TYPE = 'FX_CONVERSION' as const;
