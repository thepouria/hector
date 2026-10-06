import {
  CurrencyCode,
  JournalLineDirection,
  Prisma,
} from '@hector/database';
import type { JournalPostingService } from '../journal-posting.service';
import type { LedgerAccountsService } from '../ledger-accounts.service';
import {
  JOURNAL_EFFECT_TYPES,
  JOURNAL_SOURCE_TYPES,
  LEDGER_SYSTEM_KEYS,
} from '../finance-journals.constants';
import { resolveJournalBaseAmount } from '../journal-fx';
import type { JournalLineDraftInput } from '../journal-balance';

type Tx = Prisma.TransactionClient;

type Services = {
  journals: JournalPostingService;
  ledger: LedgerAccountsService;
};

async function companyBase(tx: Tx, companyId: string): Promise<CurrencyCode> {
  const company = await tx.company.findFirstOrThrow({
    where: { id: companyId },
    select: { baseCurrency: true },
  });
  return company.baseCurrency;
}

async function moneyLine(
  tx: Tx,
  input: {
    companyId: string;
    baseCurrency: CurrencyCode;
    ledgerAccountId: string;
    direction: JournalLineDirection;
    amount: Prisma.Decimal;
    currency: CurrencyCode;
    asOf: Date;
    description?: string;
    explicitFxRate?: Prisma.Decimal | null;
    explicitFxBaseCurrency?: CurrencyCode | null;
    explicitFxQuoteCurrency?: CurrencyCode | null;
    explicitFxRateSource?: string | null;
    lineOrder?: number;
  },
): Promise<JournalLineDraftInput> {
  const base = await resolveJournalBaseAmount(tx, {
    companyId: input.companyId,
    baseCurrency: input.baseCurrency,
    originalAmount: input.amount,
    originalCurrency: input.currency,
    asOf: input.asOf,
    explicitFxRate: input.explicitFxRate,
    explicitFxBaseCurrency: input.explicitFxBaseCurrency,
    explicitFxQuoteCurrency: input.explicitFxQuoteCurrency,
    explicitFxRateSource: input.explicitFxRateSource,
  });
  return {
    ledgerAccountId: input.ledgerAccountId,
    direction: input.direction,
    originalAmount: input.amount,
    originalCurrency: input.currency,
    baseAmount: base.baseAmount,
    baseCurrency: base.baseCurrency,
    fxRate: base.fxRate,
    fxRateSource: base.fxRateSource,
    description: input.description ?? null,
    lineOrder: input.lineOrder,
  };
}

/** DR Bank · CR CAPITAL_EQUITY */
export async function postCapitalJournalInTx(
  tx: Tx,
  svc: Services,
  input: {
    companyId: string;
    actorUserId: string;
    capitalContributionId: string;
    accountId: string;
    amount: Prisma.Decimal;
    currency: CurrencyCode;
    effectiveAt: Date;
    number: string;
  },
): Promise<void> {
  const baseCurrency = await companyBase(tx, input.companyId);
  const bank = await svc.ledger.resolveFinancialAccountLedger(
    tx,
    input.companyId,
    input.accountId,
  );
  const equity = await svc.ledger.resolveSystemKey(
    tx,
    input.companyId,
    LEDGER_SYSTEM_KEYS.CAPITAL_EQUITY,
  );
  const lines = [
    await moneyLine(tx, {
      companyId: input.companyId,
      baseCurrency,
      ledgerAccountId: bank.id,
      direction: JournalLineDirection.DEBIT,
      amount: input.amount,
      currency: input.currency,
      asOf: input.effectiveAt,
      description: `Capital ${input.number}`,
      lineOrder: 0,
    }),
    await moneyLine(tx, {
      companyId: input.companyId,
      baseCurrency,
      ledgerAccountId: equity.id,
      direction: JournalLineDirection.CREDIT,
      amount: input.amount,
      currency: input.currency,
      asOf: input.effectiveAt,
      description: `Capital equity ${input.number}`,
      lineOrder: 1,
    }),
  ];
  await svc.journals.postInTx(tx, {
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    description: `Capital contribution ${input.number}`,
    sourceType: JOURNAL_SOURCE_TYPES.CAPITAL_CONTRIBUTION,
    sourceId: input.capitalContributionId,
    effectType: JOURNAL_EFFECT_TYPES.CAPITAL_POST,
    effectiveAt: input.effectiveAt,
    baseCurrency,
    lines,
  });
}

/** DR Bank · CR LOAN_PAYABLE */
export async function postLoanDisburseJournalInTx(
  tx: Tx,
  svc: Services,
  input: {
    companyId: string;
    actorUserId: string;
    disbursementId: string;
    accountId: string;
    amount: Prisma.Decimal;
    currency: CurrencyCode;
    effectiveAt: Date;
    number: string;
    referenceFxRate?: Prisma.Decimal | null;
    referenceFxBaseCurrency?: CurrencyCode | null;
    referenceFxQuoteCurrency?: CurrencyCode | null;
  },
): Promise<void> {
  const baseCurrency = await companyBase(tx, input.companyId);
  const bank = await svc.ledger.resolveFinancialAccountLedger(
    tx,
    input.companyId,
    input.accountId,
  );
  const loanPayable = await svc.ledger.resolveSystemKey(
    tx,
    input.companyId,
    LEDGER_SYSTEM_KEYS.LOAN_PAYABLE,
  );
  const fx = {
    explicitFxRate: input.referenceFxRate,
    explicitFxBaseCurrency: input.referenceFxBaseCurrency,
    explicitFxQuoteCurrency: input.referenceFxQuoteCurrency,
    explicitFxRateSource: input.referenceFxRate ? 'LOAN_REFERENCE_FX' : null,
  };
  const lines = [
    await moneyLine(tx, {
      companyId: input.companyId,
      baseCurrency,
      ledgerAccountId: bank.id,
      direction: JournalLineDirection.DEBIT,
      amount: input.amount,
      currency: input.currency,
      asOf: input.effectiveAt,
      description: `Loan disburse ${input.number}`,
      lineOrder: 0,
      ...fx,
    }),
    await moneyLine(tx, {
      companyId: input.companyId,
      baseCurrency,
      ledgerAccountId: loanPayable.id,
      direction: JournalLineDirection.CREDIT,
      amount: input.amount,
      currency: input.currency,
      asOf: input.effectiveAt,
      description: `Loan payable ${input.number}`,
      lineOrder: 1,
      ...fx,
    }),
  ];
  await svc.journals.postInTx(tx, {
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    description: `Loan disbursement ${input.number}`,
    sourceType: JOURNAL_SOURCE_TYPES.LOAN_DISBURSEMENT,
    sourceId: input.disbursementId,
    effectType: JOURNAL_EFFECT_TYPES.LOAN_DISBURSE,
    effectiveAt: input.effectiveAt,
    baseCurrency,
    lines,
  });
}

/** DR LOAN_PAYABLE · CR Bank (principal only — not Expense) */
export async function postLoanRepayJournalInTx(
  tx: Tx,
  svc: Services,
  input: {
    companyId: string;
    actorUserId: string;
    repaymentId: string;
    accountId: string;
    principalAmount: Prisma.Decimal;
    currency: CurrencyCode;
    effectiveAt: Date;
    number: string;
    referenceFxRate?: Prisma.Decimal | null;
    referenceFxBaseCurrency?: CurrencyCode | null;
    referenceFxQuoteCurrency?: CurrencyCode | null;
  },
): Promise<void> {
  if (input.principalAmount.lte(0)) return;
  const baseCurrency = await companyBase(tx, input.companyId);
  const bank = await svc.ledger.resolveFinancialAccountLedger(
    tx,
    input.companyId,
    input.accountId,
  );
  const loanPayable = await svc.ledger.resolveSystemKey(
    tx,
    input.companyId,
    LEDGER_SYSTEM_KEYS.LOAN_PAYABLE,
  );
  const fx = {
    explicitFxRate: input.referenceFxRate,
    explicitFxBaseCurrency: input.referenceFxBaseCurrency,
    explicitFxQuoteCurrency: input.referenceFxQuoteCurrency,
    explicitFxRateSource: input.referenceFxRate ? 'LOAN_REFERENCE_FX' : null,
  };
  const lines = [
    await moneyLine(tx, {
      companyId: input.companyId,
      baseCurrency,
      ledgerAccountId: loanPayable.id,
      direction: JournalLineDirection.DEBIT,
      amount: input.principalAmount,
      currency: input.currency,
      asOf: input.effectiveAt,
      description: `Loan repay principal ${input.number}`,
      lineOrder: 0,
      ...fx,
    }),
    await moneyLine(tx, {
      companyId: input.companyId,
      baseCurrency,
      ledgerAccountId: bank.id,
      direction: JournalLineDirection.CREDIT,
      amount: input.principalAmount,
      currency: input.currency,
      asOf: input.effectiveAt,
      description: `Loan repay cash ${input.number}`,
      lineOrder: 1,
      ...fx,
    }),
  ];
  await svc.journals.postInTx(tx, {
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    description: `Loan repayment ${input.number}`,
    sourceType: JOURNAL_SOURCE_TYPES.LOAN_REPAYMENT,
    sourceId: input.repaymentId,
    effectType: JOURNAL_EFFECT_TYPES.LOAN_REPAY_PRINCIPAL,
    effectiveAt: input.effectiveAt,
    baseCurrency,
    lines,
  });
}

/** DR Dest Bank · CR Source Bank */
export async function postTransferJournalInTx(
  tx: Tx,
  svc: Services,
  input: {
    companyId: string;
    actorUserId: string;
    transferId: string;
    sourceAccountId: string;
    destinationAccountId: string;
    amount: Prisma.Decimal;
    currency: CurrencyCode;
    effectiveAt: Date;
    number: string;
  },
): Promise<void> {
  const baseCurrency = await companyBase(tx, input.companyId);
  const source = await svc.ledger.resolveFinancialAccountLedger(
    tx,
    input.companyId,
    input.sourceAccountId,
  );
  const dest = await svc.ledger.resolveFinancialAccountLedger(
    tx,
    input.companyId,
    input.destinationAccountId,
  );
  const lines = [
    await moneyLine(tx, {
      companyId: input.companyId,
      baseCurrency,
      ledgerAccountId: dest.id,
      direction: JournalLineDirection.DEBIT,
      amount: input.amount,
      currency: input.currency,
      asOf: input.effectiveAt,
      description: `Transfer in ${input.number}`,
      lineOrder: 0,
    }),
    await moneyLine(tx, {
      companyId: input.companyId,
      baseCurrency,
      ledgerAccountId: source.id,
      direction: JournalLineDirection.CREDIT,
      amount: input.amount,
      currency: input.currency,
      asOf: input.effectiveAt,
      description: `Transfer out ${input.number}`,
      lineOrder: 1,
    }),
  ];
  await svc.journals.postInTx(tx, {
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    description: `Account transfer ${input.number}`,
    sourceType: JOURNAL_SOURCE_TYPES.ACCOUNT_TRANSFER,
    sourceId: input.transferId,
    effectType: JOURNAL_EFFECT_TYPES.TRANSFER_POST,
    effectiveAt: input.effectiveAt,
    baseCurrency,
    lines,
  });
}

/**
 * Generic Payment → DR UNCLASSIFIED_PAYMENTS · CR Bank
 * Never Expense. SUPPLIER purpose = clearing cash only (no AP settle).
 */
export async function postPaymentClearingJournalInTx(
  tx: Tx,
  svc: Services,
  input: {
    companyId: string;
    actorUserId: string;
    paymentId: string;
    accountId: string;
    amount: Prisma.Decimal;
    currency: CurrencyCode;
    effectiveAt: Date;
    number: string;
  },
): Promise<void> {
  const baseCurrency = await companyBase(tx, input.companyId);
  const bank = await svc.ledger.resolveFinancialAccountLedger(
    tx,
    input.companyId,
    input.accountId,
  );
  const clearing = await svc.ledger.resolveSystemKey(
    tx,
    input.companyId,
    LEDGER_SYSTEM_KEYS.UNCLASSIFIED_PAYMENTS,
  );
  const lines = [
    await moneyLine(tx, {
      companyId: input.companyId,
      baseCurrency,
      ledgerAccountId: clearing.id,
      direction: JournalLineDirection.DEBIT,
      amount: input.amount,
      currency: input.currency,
      asOf: input.effectiveAt,
      description: `Payment clearing ${input.number}`,
      lineOrder: 0,
    }),
    await moneyLine(tx, {
      companyId: input.companyId,
      baseCurrency,
      ledgerAccountId: bank.id,
      direction: JournalLineDirection.CREDIT,
      amount: input.amount,
      currency: input.currency,
      asOf: input.effectiveAt,
      description: `Payment cash ${input.number}`,
      lineOrder: 1,
    }),
  ];
  await svc.journals.postInTx(tx, {
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    description: `Payment ${input.number} clearing`,
    sourceType: JOURNAL_SOURCE_TYPES.PAYMENT,
    sourceId: input.paymentId,
    effectType: JOURNAL_EFFECT_TYPES.PAYMENT_CLEARING,
    effectiveAt: input.effectiveAt,
    baseCurrency,
    lines,
  });
}

/**
 * Generic Receipt → DR Bank · CR UNCLASSIFIED_RECEIPTS
 * Never Revenue.
 */
export async function postReceiptClearingJournalInTx(
  tx: Tx,
  svc: Services,
  input: {
    companyId: string;
    actorUserId: string;
    receiptId: string;
    accountId: string;
    amount: Prisma.Decimal;
    currency: CurrencyCode;
    effectiveAt: Date;
    number: string;
  },
): Promise<void> {
  const baseCurrency = await companyBase(tx, input.companyId);
  const bank = await svc.ledger.resolveFinancialAccountLedger(
    tx,
    input.companyId,
    input.accountId,
  );
  const clearing = await svc.ledger.resolveSystemKey(
    tx,
    input.companyId,
    LEDGER_SYSTEM_KEYS.UNCLASSIFIED_RECEIPTS,
  );
  const lines = [
    await moneyLine(tx, {
      companyId: input.companyId,
      baseCurrency,
      ledgerAccountId: bank.id,
      direction: JournalLineDirection.DEBIT,
      amount: input.amount,
      currency: input.currency,
      asOf: input.effectiveAt,
      description: `Receipt cash ${input.number}`,
      lineOrder: 0,
    }),
    await moneyLine(tx, {
      companyId: input.companyId,
      baseCurrency,
      ledgerAccountId: clearing.id,
      direction: JournalLineDirection.CREDIT,
      amount: input.amount,
      currency: input.currency,
      asOf: input.effectiveAt,
      description: `Receipt clearing ${input.number}`,
      lineOrder: 1,
    }),
  ];
  await svc.journals.postInTx(tx, {
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    description: `Receipt ${input.number} clearing`,
    sourceType: JOURNAL_SOURCE_TYPES.RECEIPT,
    sourceId: input.receiptId,
    effectType: JOURNAL_EFFECT_TYPES.RECEIPT_CLEARING,
    effectiveAt: input.effectiveAt,
    baseCurrency,
    lines,
  });
}

/** Approve: DR ExpenseCategory ledger · CR EXPENSE_PAYABLE */
export async function postExpenseRecognitionJournalInTx(
  tx: Tx,
  svc: Services,
  input: {
    companyId: string;
    actorUserId: string;
    expenseId: string;
    categoryId: string;
    amount: Prisma.Decimal;
    currency: CurrencyCode;
    effectiveAt: Date;
    number: string;
  },
): Promise<void> {
  const baseCurrency = await companyBase(tx, input.companyId);
  await svc.ledger.resolveSystemKey(
    tx,
    input.companyId,
    LEDGER_SYSTEM_KEYS.OPERATING_EXPENSE,
  );

  const category = await tx.expenseCategory.findFirst({
    where: { id: input.categoryId, companyId: input.companyId },
  });
  let expenseLedgerId = category?.ledgerAccountId ?? null;
  if (!expenseLedgerId) {
    const operating = await svc.ledger.resolveSystemKey(
      tx,
      input.companyId,
      LEDGER_SYSTEM_KEYS.OPERATING_EXPENSE,
    );
    expenseLedgerId = operating.id;
  }
  const payable = await svc.ledger.resolveSystemKey(
    tx,
    input.companyId,
    LEDGER_SYSTEM_KEYS.EXPENSE_PAYABLE,
  );
  const lines = [
    await moneyLine(tx, {
      companyId: input.companyId,
      baseCurrency,
      ledgerAccountId: expenseLedgerId,
      direction: JournalLineDirection.DEBIT,
      amount: input.amount,
      currency: input.currency,
      asOf: input.effectiveAt,
      description: `Expense recognition ${input.number}`,
      lineOrder: 0,
    }),
    await moneyLine(tx, {
      companyId: input.companyId,
      baseCurrency,
      ledgerAccountId: payable.id,
      direction: JournalLineDirection.CREDIT,
      amount: input.amount,
      currency: input.currency,
      asOf: input.effectiveAt,
      description: `Expense payable ${input.number}`,
      lineOrder: 1,
    }),
  ];
  await svc.journals.postInTx(tx, {
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    description: `Expense recognition ${input.number}`,
    sourceType: JOURNAL_SOURCE_TYPES.EXPENSE,
    sourceId: input.expenseId,
    effectType: JOURNAL_EFFECT_TYPES.EXPENSE_RECOGNITION,
    effectiveAt: input.effectiveAt,
    baseCurrency,
    lines,
  });
}

/**
 * Settle allocation: DR EXPENSE_PAYABLE · CR UNCLASSIFIED_PAYMENTS
 * Does NOT re-recognize Expense. Does NOT credit Bank again —
 * Payment post already posted DR UNCLASSIFIED · CR Bank (cash truth + clearing).
 */
export async function postExpenseSettlementJournalInTx(
  tx: Tx,
  svc: Services,
  input: {
    companyId: string;
    actorUserId: string;
    allocationId: string;
    amount: Prisma.Decimal;
    currency: CurrencyCode;
    effectiveAt: Date;
    expenseNumber: string;
  },
): Promise<void> {
  const baseCurrency = await companyBase(tx, input.companyId);
  const payable = await svc.ledger.resolveSystemKey(
    tx,
    input.companyId,
    LEDGER_SYSTEM_KEYS.EXPENSE_PAYABLE,
  );
  const clearing = await svc.ledger.resolveSystemKey(
    tx,
    input.companyId,
    LEDGER_SYSTEM_KEYS.UNCLASSIFIED_PAYMENTS,
  );
  const lines = [
    await moneyLine(tx, {
      companyId: input.companyId,
      baseCurrency,
      ledgerAccountId: payable.id,
      direction: JournalLineDirection.DEBIT,
      amount: input.amount,
      currency: input.currency,
      asOf: input.effectiveAt,
      description: `Expense settle ${input.expenseNumber}`,
      lineOrder: 0,
    }),
    await moneyLine(tx, {
      companyId: input.companyId,
      baseCurrency,
      ledgerAccountId: clearing.id,
      direction: JournalLineDirection.CREDIT,
      amount: input.amount,
      currency: input.currency,
      asOf: input.effectiveAt,
      description: `Expense settle clearing ${input.expenseNumber}`,
      lineOrder: 1,
    }),
  ];
  await svc.journals.postInTx(tx, {
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    description: `Expense settlement ${input.expenseNumber}`,
    sourceType: JOURNAL_SOURCE_TYPES.EXPENSE_PAYMENT_ALLOCATION,
    sourceId: input.allocationId,
    effectType: JOURNAL_EFFECT_TYPES.EXPENSE_SETTLEMENT,
    effectiveAt: input.effectiveAt,
    baseCurrency,
    lines,
  });
}

/**
 * CAPITALIZABLE allocate: DR INVENTORY · CR FINANCE_CLEARING (unpaid clearing)
 * PERIOD_EXPENSE uses expense recognition builder only — do not call here.
 */
export async function postPurchaseCostCapitalizeJournalInTx(
  tx: Tx,
  svc: Services,
  input: {
    companyId: string;
    actorUserId: string;
    purchaseOrderCostId: string;
    amount: Prisma.Decimal;
    currency: CurrencyCode;
    effectiveAt: Date;
    costLabel: string;
  },
): Promise<void> {
  const baseCurrency = await companyBase(tx, input.companyId);
  const inventory = await svc.ledger.resolveSystemKey(
    tx,
    input.companyId,
    LEDGER_SYSTEM_KEYS.INVENTORY,
  );
  const clearing = await svc.ledger.resolveSystemKey(
    tx,
    input.companyId,
    LEDGER_SYSTEM_KEYS.FINANCE_CLEARING,
  );
  const lines = [
    await moneyLine(tx, {
      companyId: input.companyId,
      baseCurrency,
      ledgerAccountId: inventory.id,
      direction: JournalLineDirection.DEBIT,
      amount: input.amount,
      currency: input.currency,
      asOf: input.effectiveAt,
      description: `Capitalize cost ${input.costLabel}`,
      lineOrder: 0,
    }),
    await moneyLine(tx, {
      companyId: input.companyId,
      baseCurrency,
      ledgerAccountId: clearing.id,
      direction: JournalLineDirection.CREDIT,
      amount: input.amount,
      currency: input.currency,
      asOf: input.effectiveAt,
      description: `Cost clearing ${input.costLabel}`,
      lineOrder: 1,
    }),
  ];
  await svc.journals.postInTx(tx, {
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    description: `Purchase cost capitalize ${input.costLabel}`,
    sourceType: JOURNAL_SOURCE_TYPES.PURCHASE_ORDER_COST,
    sourceId: input.purchaseOrderCostId,
    effectType: JOURNAL_EFFECT_TYPES.PURCHASE_COST_CAPITALIZE,
    effectiveAt: input.effectiveAt,
    baseCurrency,
    lines,
  });
}

/**
 * AP recognition at GRN post (same TX as recognizeFromPostedGoodsReceiptInTx):
 * DR INVENTORY · CR SUPPLIER_PAYABLE for total recognized liability amount.
 * Prefer INVENTORY to match Phase 4.4 liability timing (FIN-JRN timing docs).
 */
export async function postSupplierApRecognitionJournalInTx(
  tx: Tx,
  svc: Services,
  input: {
    companyId: string;
    actorUserId: string;
    goodsReceiptId: string;
    amount: Prisma.Decimal;
    currency: CurrencyCode;
    effectiveAt: Date;
    grnNumber: string;
    referenceFxRate?: Prisma.Decimal | null;
    referenceFxBaseCurrency?: CurrencyCode | null;
    referenceFxQuoteCurrency?: CurrencyCode | null;
  },
): Promise<void> {
  if (input.amount.lte(0)) return;
  const baseCurrency = await companyBase(tx, input.companyId);
  const inventory = await svc.ledger.resolveSystemKey(
    tx,
    input.companyId,
    LEDGER_SYSTEM_KEYS.INVENTORY,
  );
  const ap = await svc.ledger.resolveSystemKey(
    tx,
    input.companyId,
    LEDGER_SYSTEM_KEYS.SUPPLIER_PAYABLE,
  );
  const fx = {
    explicitFxRate: input.referenceFxRate,
    explicitFxBaseCurrency: input.referenceFxBaseCurrency,
    explicitFxQuoteCurrency: input.referenceFxQuoteCurrency,
    explicitFxRateSource: input.referenceFxRate ? 'PO_REFERENCE_FX' : null,
  };
  const lines = [
    await moneyLine(tx, {
      companyId: input.companyId,
      baseCurrency,
      ledgerAccountId: inventory.id,
      direction: JournalLineDirection.DEBIT,
      amount: input.amount,
      currency: input.currency,
      asOf: input.effectiveAt,
      description: `AP inventory ${input.grnNumber}`,
      lineOrder: 0,
      ...fx,
    }),
    await moneyLine(tx, {
      companyId: input.companyId,
      baseCurrency,
      ledgerAccountId: ap.id,
      direction: JournalLineDirection.CREDIT,
      amount: input.amount,
      currency: input.currency,
      asOf: input.effectiveAt,
      description: `AP liability ${input.grnNumber}`,
      lineOrder: 1,
      ...fx,
    }),
  ];
  await svc.journals.postInTx(tx, {
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    description: `Supplier AP recognition GRN ${input.grnNumber}`,
    sourceType: JOURNAL_SOURCE_TYPES.GOODS_RECEIPT,
    sourceId: input.goodsReceiptId,
    effectType: JOURNAL_EFFECT_TYPES.SUPPLIER_AP_RECOGNITION,
    effectiveAt: input.effectiveAt,
    baseCurrency,
    lines,
  });
}

/**
 * Supplier AP settlement reclass (FIN-SET-004 / FIN-SET-005):
 * Same currency: DR SUPPLIER_PAYABLE · CR UNCLASSIFIED_PAYMENTS
 * Cross-currency: DR SUPPLIER_PAYABLE (carrying base) · DR FX_LOSS | CR FX_GAIN · CR UNCLASSIFIED_PAYMENTS (payment base)
 * Never credits Bank again — Payment post already cleared cash.
 */
export async function postSupplierPayableSettlementJournalInTx(
  tx: Tx,
  svc: Services,
  input: {
    companyId: string;
    actorUserId: string;
    allocationId: string;
    payableNumber: string;
    liabilityAmount: Prisma.Decimal;
    liabilityCurrency: CurrencyCode;
    paymentAmount: Prisma.Decimal;
    paymentCurrency: CurrencyCode;
    baseCarryingAmount: Prisma.Decimal;
    basePaymentAmount: Prisma.Decimal;
    fxDifferenceBase: Prisma.Decimal;
    settlementRate?: Prisma.Decimal | null;
    settlementRateBaseCurrency?: CurrencyCode | null;
    settlementRateQuoteCurrency?: CurrencyCode | null;
    effectiveAt: Date;
  },
): Promise<void> {
  const baseCurrency = await companyBase(tx, input.companyId);
  const ap = await svc.ledger.resolveSystemKey(
    tx,
    input.companyId,
    LEDGER_SYSTEM_KEYS.SUPPLIER_PAYABLE,
  );
  const clearing = await svc.ledger.resolveSystemKey(
    tx,
    input.companyId,
    LEDGER_SYSTEM_KEYS.UNCLASSIFIED_PAYMENTS,
  );

  const sameCurrency = input.liabilityCurrency === input.paymentCurrency;
  const lines: JournalLineDraftInput[] = [];

  if (sameCurrency) {
    lines.push(
      await moneyLine(tx, {
        companyId: input.companyId,
        baseCurrency,
        ledgerAccountId: ap.id,
        direction: JournalLineDirection.DEBIT,
        amount: input.liabilityAmount,
        currency: input.liabilityCurrency,
        asOf: input.effectiveAt,
        description: `AP settle ${input.payableNumber}`,
        lineOrder: 0,
      }),
      await moneyLine(tx, {
        companyId: input.companyId,
        baseCurrency,
        ledgerAccountId: clearing.id,
        direction: JournalLineDirection.CREDIT,
        amount: input.paymentAmount,
        currency: input.paymentCurrency,
        asOf: input.effectiveAt,
        description: `AP settle clearing ${input.payableNumber}`,
        lineOrder: 1,
      }),
    );
  } else {
    const settleFx = {
      fxRate: input.settlementRate ?? null,
      fxRateSource: input.settlementRate ? 'SETTLEMENT_RATE' : 'SETTLEMENT_EXPLICIT',
    };
    lines.push({
      ledgerAccountId: ap.id,
      direction: JournalLineDirection.DEBIT,
      originalAmount: input.liabilityAmount,
      originalCurrency: input.liabilityCurrency,
      baseAmount: input.baseCarryingAmount,
      baseCurrency,
      fxRate: settleFx.fxRate,
      fxRateSource: 'SETTLEMENT_CARRYING',
      description: `AP settle ${input.payableNumber}`,
      lineOrder: 0,
    });

    const fxDiff = input.fxDifferenceBase;
    if (fxDiff.gt(0)) {
      const fxLoss = await svc.ledger.resolveSystemKey(
        tx,
        input.companyId,
        LEDGER_SYSTEM_KEYS.FX_LOSS,
      );
      lines.push({
        ledgerAccountId: fxLoss.id,
        direction: JournalLineDirection.DEBIT,
        originalAmount: fxDiff,
        originalCurrency: baseCurrency,
        baseAmount: fxDiff,
        baseCurrency,
        fxRate: null,
        fxRateSource: null,
        description: `FX loss AP settle ${input.payableNumber}`,
        lineOrder: 1,
      });
    } else if (fxDiff.lt(0)) {
      const fxGain = await svc.ledger.resolveSystemKey(
        tx,
        input.companyId,
        LEDGER_SYSTEM_KEYS.FX_GAIN,
      );
      const gain = fxDiff.abs();
      lines.push({
        ledgerAccountId: fxGain.id,
        direction: JournalLineDirection.CREDIT,
        originalAmount: gain,
        originalCurrency: baseCurrency,
        baseAmount: gain,
        baseCurrency,
        fxRate: null,
        fxRateSource: null,
        description: `FX gain AP settle ${input.payableNumber}`,
        lineOrder: 1,
      });
    }

    lines.push({
      ledgerAccountId: clearing.id,
      direction: JournalLineDirection.CREDIT,
      originalAmount: input.paymentAmount,
      originalCurrency: input.paymentCurrency,
      baseAmount: input.basePaymentAmount,
      baseCurrency,
      fxRate: input.settlementRate ?? null,
      fxRateSource: settleFx.fxRateSource,
      description: `AP settle clearing ${input.payableNumber}`,
      lineOrder: 2,
    });
  }

  await svc.journals.postInTx(tx, {
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    description: `Supplier AP settlement ${input.payableNumber}`,
    sourceType: JOURNAL_SOURCE_TYPES.SUPPLIER_PAYMENT_ALLOCATION,
    sourceId: input.allocationId,
    effectType: JOURNAL_EFFECT_TYPES.SUPPLIER_AP_SETTLEMENT,
    effectiveAt: input.effectiveAt,
    baseCurrency,
    lines,
  });
}
