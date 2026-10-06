import type {
  CurrencyCode,
  FxConversionStatus,
  FxRateSourceType,
  FxRateType,
} from '@hector/database';

export type FxRateView = {
  id: string;
  companyId: string;
  baseCurrency: CurrencyCode;
  quoteCurrency: CurrencyCode;
  rate: string;
  rateDisplay: string;
  rateType: FxRateType;
  sourceType: FxRateSourceType;
  sourceReference: string | null;
  effectiveAt: string;
  notes: string | null;
  archivedAt: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
};

export type FxConversionAccountRef = {
  id: string;
  code: string;
  name: string;
  currency: CurrencyCode;
  status: string;
};

export type FxConversionView = {
  id: string;
  companyId: string;
  number: string;
  sourceAccountId: string;
  destinationAccountId: string;
  sourceAccount: FxConversionAccountRef;
  destinationAccount: FxConversionAccountRef;
  fromAmount: string;
  fromCurrency: CurrencyCode;
  toAmount: string;
  toCurrency: CurrencyCode;
  appliedRate: string;
  rateDisplay: string;
  rateBaseCurrency: CurrencyCode;
  rateQuoteCurrency: CurrencyCode;
  rateType: FxRateType;
  fxRateId: string | null;
  feeAmount: string | null;
  feeCurrency: CurrencyCode | null;
  feeAccountId: string | null;
  status: FxConversionStatus;
  effectiveAt: string;
  notes: string | null;
  requestId: string | null;
  createdById: string;
  postedAt: string | null;
  postedById: string | null;
  cancelledAt: string | null;
  cancelledById: string | null;
  reversedAt: string | null;
  reversedById: string | null;
  reversalOfId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FxCurrencyPositionRow = {
  currency: CurrencyCode;
  cashBalance: string;
  payableOutstanding: string;
  loanOutstanding: string;
  /** net = cash − payables − loans (same currency; never cross-aggregated). */
  net: string;
};

export type FxPositionsView = {
  baseCurrency: CurrencyCode;
  positions: FxCurrencyPositionRow[];
  signConvention:
    'net = cashBalance - payableOutstanding - loanOutstanding (per currency; no silent FX sum)';
};

export type FxValuationLine = {
  currency: CurrencyCode;
  originalAmount: string;
  kind: 'CASH' | 'PAYABLE' | 'LOAN' | 'NET';
  baseAmount: string | null;
  rateUsed: string | null;
  rateType: FxRateType | null;
  rateDisplay: string | null;
  status: 'VALUED' | 'UNAVAILABLE';
};

export type FxValuationView = {
  asOf: string;
  baseCurrency: CurrencyCode;
  requestedRateType: FxRateType;
  fallbackRateType: FxRateType | null;
  lines: FxValuationLine[];
  note: string;
};

export type FxConvertPreviewView = {
  fromAmount: string;
  fromCurrency: CurrencyCode;
  toAmount: string;
  toCurrency: CurrencyCode;
  appliedRate: string;
  rateBaseCurrency: CurrencyCode;
  rateQuoteCurrency: CurrencyCode;
  rateDisplay: string;
};
