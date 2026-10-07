export const RECONCILIATION_ERROR_MESSAGES = {
  NOT_FOUND: 'Reconciliation was not found.',
  SOURCE_NOT_FOUND: 'Reconciliation source was not found.',
  SOURCE_UNSUPPORTED: 'Reconciliation source type is not supported.',
  INVALID_STATUS: 'Reconciliation status transition is not allowed.',
  EDIT_BLOCKED: 'Reconciliation cannot be changed in the current state.',
  MATCHING_NOT_CLOSED: 'Matching must be declared complete before this operation.',
  DISCREPANCY_INVALID: 'Discrepancy data is invalid.',
  DISCREPANCY_NOT_FOUND: 'Discrepancy was not found.',
  RESOLUTION_INVALID: 'Resolution evidence is required.',
  FINANCE_DIRECTION_INVALID: 'Finance transaction direction is invalid for this source.',
  DUPLICATE: 'A reconciliation already exists for this source.',
} as const;
