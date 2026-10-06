/**
 * Phase 4.1 — Finance architecture constants (no operational workflows yet).
 */
export const FINANCE_DOMAIN = 'finance' as const;

/** Conceptual money-movement directions (nature is NOT derived from direction alone). */
export const FINANCE_MONEY_DIRECTIONS = [
  'MONEY_IN',
  'MONEY_OUT',
  'ACCOUNT_TRANSFER',
] as const;
export type FinanceMoneyDirection = (typeof FINANCE_MONEY_DIRECTIONS)[number];

/** Explicit funding economic types — counterparty identity does NOT decide this. */
export const FINANCE_FUNDING_TYPES = [
  'OWNER_EQUITY',
  'PARTNER_EQUITY',
  'LOAN_RECEIVED',
  'OTHER_FUNDING',
] as const;
export type FinanceFundingType = (typeof FINANCE_FUNDING_TYPES)[number];

/**
 * Future financial source provenance keys (sourceType).
 * Free-text is never the primary linkage.
 */
export const FINANCE_SOURCE_TYPES = [
  'OPENING_BALANCE',
  'CAPITAL_INJECTION',
  'LOAN',
  'LOAN_DISBURSEMENT',
  'LOAN_REPAYMENT',
  'PURCHASE',
  'GOODS_RECEIPT',
  'SUPPLIER_PAYMENT',
  'SUPPLIER_RETURN',
  'EXPENSE',
  'ACCOUNT_TRANSFER',
  'FX_EXCHANGE',
  'FX_CONVERSION',
  'FUTURE_SALE',
  'FUTURE_SETTLEMENT',
  'MANUAL_JOURNAL',
] as const;
export type FinanceSourceType = (typeof FINANCE_SOURCE_TYPES)[number];

/**
 * Payable recognition policy (locked for Phase 4).
 *
 * Physical accepted quantity on a POSTED Goods Receipt creates the Finance
 * recognition signal for supplier liability (incrementally per receipt).
 * DRAFT PO / DRAFT GRN never create payables.
 *
 * Commercial PO still owns ordered qty, price, currency, terms, FX reference.
 * Warehouse owns physical receipt; Finance owns payable / settlement.
 */
export const SUPPLIER_PAYABLE_RECOGNITION = {
  point: 'GOODS_RECEIPT_POSTED',
  quantityBasis: 'ACCEPTED_RECEIVED_QUANTITY',
  draftPoCreatesPayable: false,
  draftGrnCreatesPayable: false,
  orderedOnlyCreatesPayable: false,
} as const;

/** Planned / emitted Finance domain event names. */
export const FINANCE_DOMAIN_EVENT_TYPES = {
  FINANCIAL_ACCOUNT_CREATED: 'finance.account.created',
  FINANCIAL_ACCOUNT_UPDATED: 'finance.account.updated',
  FINANCIAL_ACCOUNT_ARCHIVED: 'finance.account.archived',
  FINANCIAL_ACCOUNT_ACTIVATED: 'finance.account.activated',
  FINANCIAL_ACCOUNT_DEACTIVATED: 'finance.account.deactivated',
  FINANCIAL_ACCOUNT_DEFAULT_CHANGED: 'finance.account.default_changed',
  OPENING_BALANCE_RECORDED: 'finance.opening_balance.recorded',
  ACCOUNT_TRANSFER_CREATED: 'finance.account_transfer.created',
  ACCOUNT_TRANSFER_POSTED: 'finance.account_transfer.posted',
  ACCOUNT_TRANSFER_CANCELLED: 'finance.account_transfer.cancelled',
  ACCOUNT_TRANSFER_REVERSED: 'finance.account_transfer.reversed',
  ACCOUNT_TRANSFER_COMPLETED: 'finance.account_transfer.completed',
  CAPITAL_INJECTED: 'finance.capital.injected',
  CAPITAL_CONTRIBUTION_REVERSED: 'finance.capital.reversed',
  LOAN_CREATED: 'finance.loan.created',
  LOAN_RECEIVED: 'finance.loan.received',
  LOAN_DISBURSED: 'finance.loan.disbursed',
  LOAN_REPAID: 'finance.loan.repaid',
  LOAN_SETTLED: 'finance.loan.settled',
  LOAN_DISBURSEMENT_REVERSED: 'finance.loan.disbursement_reversed',
  LOAN_REPAYMENT_REVERSED: 'finance.loan.repayment_reversed',
  SUPPLIER_PAYABLE_CREATED: 'finance.payable.created',
  SUPPLIER_PAYABLE_ADJUSTED: 'finance.payable.adjusted',
  SUPPLIER_PAYABLE_SETTLED: 'finance.payable.settled',
  SUPPLIER_PAYABLE_OPENING_RECORDED: 'finance.payable.opening_recorded',
  SUPPLIER_PAYABLE_ALLOCATION_POSTED: 'finance.payable.allocation_posted',
  SUPPLIER_CREDIT_CREATED: 'finance.payable.credit_created',
  SUPPLIER_PAYMENT_RECORDED: 'finance.payment.recorded',
  MONEY_RECEIVED: 'finance.money.received',
  MONEY_PAID: 'finance.money.paid',
  EXPENSE_RECORDED: 'finance.expense.recorded',
  JOURNAL_POSTED: 'finance.journal.posted',
  JOURNAL_REVERSED: 'finance.journal.reversed',
  FX_RATE_CREATED: 'finance.fx.rate_created',
  FX_RATE_ARCHIVED: 'finance.fx.rate_archived',
  FX_CONVERSION_CREATED: 'finance.fx.conversion_created',
  FX_CONVERSION_POSTED: 'finance.fx.conversion_posted',
  FX_CONVERSION_CANCELLED: 'finance.fx.conversion_cancelled',
  FX_CONVERSION_REVERSED: 'finance.fx.conversion_reversed',
} as const;
