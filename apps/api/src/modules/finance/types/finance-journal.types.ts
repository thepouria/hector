import type {
  CurrencyCode,
  JournalEntryStatus,
  JournalLineDirection,
  LedgerAccountKind,
  LedgerAccountStatus,
  LedgerAccountType,
} from '@hector/database';

export type LedgerAccountView = {
  id: string;
  code: string;
  name: string;
  type: LedgerAccountType;
  systemKey: string | null;
  kind: LedgerAccountKind;
  status: LedgerAccountStatus;
  parentId: string | null;
  description: string | null;
  createdAt: string;
  archivedAt: string | null;
};

export type JournalLineView = {
  id: string;
  ledgerAccountId: string;
  ledgerAccountCode: string;
  ledgerAccountName: string;
  ledgerAccountType: LedgerAccountType;
  systemKey: string | null;
  direction: JournalLineDirection;
  originalAmount: string;
  originalCurrency: CurrencyCode;
  baseAmount: string;
  baseCurrency: CurrencyCode;
  fxRate: string | null;
  fxRateSource: string | null;
  description: string | null;
  lineOrder: number;
};

export type JournalEntryView = {
  id: string;
  number: string;
  status: JournalEntryStatus;
  effectiveAt: string;
  description: string;
  reference: string | null;
  sourceType: string;
  sourceId: string | null;
  effectType: string;
  baseCurrency: CurrencyCode;
  totalDebitBase: string;
  totalCreditBase: string;
  reversalOfId: string | null;
  requestId: string | null;
  postedAt: string | null;
  reversedAt: string | null;
  createdAt: string;
  lines: JournalLineView[];
};

export type LedgerLineView = {
  id: string;
  journalEntryId: string;
  journalNumber: string;
  effectiveAt: string;
  description: string;
  ledgerAccountId: string;
  ledgerAccountCode: string;
  ledgerAccountName: string;
  direction: JournalLineDirection;
  originalAmount: string;
  originalCurrency: CurrencyCode;
  baseAmount: string;
  baseCurrency: CurrencyCode;
  fxRate: string | null;
  sourceType: string;
  effectType: string;
};

export type GeneralLedgerLineView = LedgerLineView & {
  /** Cumulative signed base balance after this line (DEBIT +, CREDIT −). */
  runningBalanceBase: string;
};

export type GeneralLedgerView = {
  ledgerAccount: {
    id: string;
    code: string;
    name: string;
    type: LedgerAccountType;
  };
  baseCurrency: CurrencyCode;
  openingBalanceBase: string;
  closingBalanceBase: string;
  data: GeneralLedgerLineView[];
};

export type TrialBalanceRowView = {
  ledgerAccountId: string;
  code: string;
  name: string;
  type: string;
  systemKey: string | null;
  debitBase: string;
  creditBase: string;
  netBase: string;
};
