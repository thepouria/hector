import type {
  CapitalContributionStatus,
  CapitalFundingType,
  CurrencyCode,
  FinanceCounterpartyType,
  FinancialAccountStatus,
  LoanDisbursementStatus,
  LoanRepaymentStatus,
  LoanStatus,
} from '@hector/database';

export type AccountRefView = {
  id: string;
  code: string;
  name: string;
  currency: CurrencyCode;
  status: FinancialAccountStatus;
};

export type CapitalContributionView = {
  id: string;
  number: string;
  fundingType: CapitalFundingType;
  contributorType: FinanceCounterpartyType;
  contributorId: string | null;
  contributorName: string;
  account: AccountRefView;
  amount: string;
  currency: CurrencyCode;
  status: CapitalContributionStatus;
  effectiveAt: string;
  reference: string | null;
  notes: string | null;
  requestId: string | null;
  postedAt: string | null;
  cancelledAt: string | null;
  reversedAt: string | null;
  reversalOfId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CapitalSummaryBucket = {
  currency: CurrencyCode;
  total: string;
  byFundingType: Array<{ fundingType: CapitalFundingType; total: string }>;
};

export type CapitalSummaryView = {
  byCurrency: CapitalSummaryBucket[];
};

export type LoanDisbursementView = {
  id: string;
  number: string;
  loanId: string;
  account: AccountRefView;
  amount: string;
  currency: CurrencyCode;
  status: LoanDisbursementStatus;
  effectiveAt: string;
  notes: string | null;
  requestId: string | null;
  postedAt: string | null;
  cancelledAt: string | null;
  reversedAt: string | null;
  reversalOfId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LoanRepaymentView = {
  id: string;
  number: string;
  loanId: string;
  account: AccountRefView;
  principalAmount: string;
  interestAmount: string;
  feeAmount: string;
  cashOutAmount: string;
  currency: CurrencyCode;
  status: LoanRepaymentStatus;
  effectiveAt: string;
  notes: string | null;
  requestId: string | null;
  postedAt: string | null;
  cancelledAt: string | null;
  reversedAt: string | null;
  reversalOfId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LoanView = {
  id: string;
  number: string;
  lenderType: FinanceCounterpartyType;
  lenderId: string | null;
  lenderName: string;
  currency: CurrencyCode;
  contractedPrincipal: string;
  receivedPrincipal: string;
  repaidPrincipal: string;
  outstandingPrincipal: string;
  overdue: boolean;
  referenceFxRate: string | null;
  referenceFxBaseCurrency: CurrencyCode | null;
  referenceFxQuoteCurrency: CurrencyCode | null;
  dueDate: string | null;
  interestRate: string | null;
  interestNotes: string | null;
  feeAmount: string | null;
  notes: string | null;
  reference: string | null;
  status: LoanStatus;
  receivingAccount: AccountRefView | null;
  requestId: string | null;
  postedAt: string | null;
  cancelledAt: string | null;
  reversedAt: string | null;
  settledAt: string | null;
  createdAt: string;
  updatedAt: string;
  disbursements?: LoanDisbursementView[];
  repayments?: LoanRepaymentView[];
};
