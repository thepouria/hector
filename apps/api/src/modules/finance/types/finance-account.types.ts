import type {
  CurrencyCode,
  FinancialAccountStatus,
  FinancialAccountType,
  FinancialAccountTransferStatus,
} from '@hector/database';

export type MoneyView = {
  amount: string;
  currency: CurrencyCode;
};

export type FinancialAccountView = {
  id: string;
  companyId: string;
  code: string;
  name: string;
  type: FinancialAccountType;
  currency: CurrencyCode;
  status: FinancialAccountStatus;
  isDefault: boolean;
  description: string | null;
  bankName: string | null;
  accountNumber: string | null;
  iban: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Present on list/detail when balance was computed. */
  balance?: MoneyView;
};

export type FinancialAccountOptionView = {
  id: string;
  code: string;
  name: string;
  type: FinancialAccountType;
  currency: CurrencyCode;
  status: FinancialAccountStatus;
  isDefault: boolean;
};

export type FinancialAccountMovementView = {
  id: string;
  accountId: string;
  direction: 'IN' | 'OUT';
  amount: string;
  currency: CurrencyCode;
  type: string;
  sourceType: string;
  sourceId: string | null;
  effectiveAt: string;
  postedAt: string;
  description: string | null;
  requestId: string | null;
  createdAt: string;
};

export type CurrencySummaryBucket = {
  currency: CurrencyCode;
  total: string;
  accounts: Array<{
    id: string;
    code: string;
    name: string;
    type: FinancialAccountType;
    status: FinancialAccountStatus;
    isDefault: boolean;
    balance: string;
  }>;
};

export type AccountsSummaryView = {
  byCurrency: CurrencySummaryBucket[];
};

export type AccountRefView = {
  id: string;
  code: string;
  name: string;
  currency: CurrencyCode;
  status: FinancialAccountStatus;
};

export type AccountTransferView = {
  id: string;
  number: string;
  status: FinancialAccountTransferStatus;
  amount: string;
  currency: CurrencyCode;
  sourceAccount: AccountRefView;
  destinationAccount: AccountRefView;
  effectiveAt: string;
  notes: string | null;
  requestId: string | null;
  postedAt: string | null;
  cancelledAt: string | null;
  reversedAt: string | null;
  reversalOfTransferId: string | null;
  createdAt: string;
  updatedAt: string;
};
