import type { CurrencyCode, SupplierPaymentAllocationStatus } from '@hector/database';

export type SettlementAllocationView = {
  id: string;
  companyId: string;
  payableId: string;
  payableNumber: string | null;
  paymentId: string | null;
  paymentNumber: string | null;
  amount: string;
  currency: CurrencyCode;
  paymentCurrency: CurrencyCode;
  paymentAmountApplied: string;
  liabilityAmountSettled: string;
  settlementRate: string | null;
  settlementRateBaseCurrency: CurrencyCode | null;
  settlementRateQuoteCurrency: CurrencyCode | null;
  settlementFxRateId: string | null;
  baseCarryingAmount: string | null;
  basePaymentAmount: string | null;
  fxDifferenceBase: string | null;
  settlementGroupId: string | null;
  requestId: string | null;
  status: SupplierPaymentAllocationStatus;
  effectiveAt: string;
  createdAt: string;
  reversedAt: string | null;
};

export type SettlementPreviewLineView = {
  payableId: string;
  payableNumber: string;
  liabilityCurrency: CurrencyCode;
  liabilityAmount: string;
  paymentCurrency: CurrencyCode;
  paymentAmount: string;
  outstandingBefore: string;
  outstandingAfter: string;
  baseCarryingAmount: string;
  basePaymentAmount: string;
  fxDifferenceBase: string;
  settlementRate: string | null;
};

export type SettlementPreviewView = {
  paymentId: string;
  paymentNumber: string;
  paymentAmount: string;
  paymentCurrency: CurrencyCode;
  paymentRemainingBefore: string;
  paymentRemainingAfter: string;
  lines: SettlementPreviewLineView[];
};

export type SettlementBatchView = {
  settlementGroupId: string;
  paymentId: string;
  allocations: SettlementAllocationView[];
};
