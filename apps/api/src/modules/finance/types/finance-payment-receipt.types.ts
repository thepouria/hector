import type {
  CurrencyCode,
  FinanceCounterpartyType,
  FinancialAccountStatus,
  PaymentPurposeType,
  PaymentStatus,
  ReceiptSourceType,
  ReceiptStatus,
} from '@hector/database';

export type PaymentAccountRefView = {
  id: string;
  code: string;
  name: string;
  currency: CurrencyCode;
  status: FinancialAccountStatus;
};

export type PaymentView = {
  id: string;
  number: string;
  account: PaymentAccountRefView;
  amount: string;
  currency: CurrencyCode;
  status: PaymentStatus;
  effectiveAt: string;
  counterpartyType: FinanceCounterpartyType | null;
  counterpartyId: string | null;
  counterpartyName: string | null;
  purposeType: PaymentPurposeType;
  purposeReferenceType: string | null;
  purposeReferenceId: string | null;
  reference: string | null;
  externalReference: string | null;
  notes: string | null;
  requestId: string | null;
  postedAt: string | null;
  cancelledAt: string | null;
  reversedAt: string | null;
  reversalOfId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReceiptView = {
  id: string;
  number: string;
  account: PaymentAccountRefView;
  amount: string;
  currency: CurrencyCode;
  status: ReceiptStatus;
  effectiveAt: string;
  counterpartyType: FinanceCounterpartyType | null;
  counterpartyId: string | null;
  counterpartyName: string | null;
  sourceType: ReceiptSourceType;
  sourceReferenceType: string | null;
  sourceReferenceId: string | null;
  reference: string | null;
  externalReference: string | null;
  notes: string | null;
  requestId: string | null;
  postedAt: string | null;
  cancelledAt: string | null;
  reversedAt: string | null;
  reversalOfId: string | null;
  createdAt: string;
  updatedAt: string;
};
