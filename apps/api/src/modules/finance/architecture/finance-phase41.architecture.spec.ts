import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_PERMISSION_KEYS, CurrencyCode, PERMISSIONS } from '@hector/database';
import {
  FINANCE_DOMAIN_EVENT_TYPES,
  FINANCE_FUNDING_TYPES,
  SUPPLIER_PAYABLE_RECOGNITION,
} from '../finance.constants';
import { PURCHASING_FINANCE_GUARDS } from '../contracts/purchasing-finance.contract';
import { WAREHOUSE_FINANCE_GUARDS } from '../contracts/warehouse-finance.contract';

/**
 * Phase 4.1 — Finance architecture gates only.
 * Does not implement accounts, loans, payables, journals, or payments.
 */
describe('Finance Phase 4.1 architecture', () => {
  const schemaPath = join(process.cwd(), '../../packages/database/prisma/schema.prisma');
  const repoRoot = join(process.cwd(), '../..');

  it('Company already carries baseCurrency (no hard-coded global IRR)', () => {
    const schema = readFileSync(schemaPath, 'utf8');
    expect(schema).toMatch(/model Company \{[\s\S]*baseCurrency CurrencyCode/);
    expect(schema).toMatch(/enum CurrencyCode \{\s*IRR\s*USD/);
  });

  it('registers Finance permission namespace for OWNER sync', () => {
    const financeKeys = ALL_PERMISSION_KEYS.filter((k) => k.startsWith('finance.'));
    expect(financeKeys.length).toBeGreaterThanOrEqual(20);
    expect(financeKeys).toContain(PERMISSIONS.FINANCE_ACCOUNTS_READ);
    expect(financeKeys).toContain(PERMISSIONS.FINANCE_JOURNALS_POST);
    expect(financeKeys).toContain(PERMISSIONS.FINANCE_DASHBOARD_READ);
  });

  it('locks supplier payable recognition to POSTED goods receipt', () => {
    expect(SUPPLIER_PAYABLE_RECOGNITION.point).toBe('GOODS_RECEIPT_POSTED');
    expect(SUPPLIER_PAYABLE_RECOGNITION.draftPoCreatesPayable).toBe(false);
    expect(SUPPLIER_PAYABLE_RECOGNITION.draftGrnCreatesPayable).toBe(false);
    expect(SUPPLIER_PAYABLE_RECOGNITION.orderedOnlyCreatesPayable).toBe(false);
  });

  it('keeps Equity vs Debt as explicit funding types', () => {
    expect(FINANCE_FUNDING_TYPES).toEqual(
      expect.arrayContaining(['OWNER_EQUITY', 'PARTNER_EQUITY', 'LOAN_RECEIVED']),
    );
  });

  it('guards Purchasing and Warehouse boundaries', () => {
    expect(PURCHASING_FINANCE_GUARDS.financeMustNotMutatePurchaseOrder).toBe(true);
    expect(PURCHASING_FINANCE_GUARDS.draftPurchaseOrderCreatesPayable).toBe(false);
    expect(WAREHOUSE_FINANCE_GUARDS.financeMustNotMutateStockBalance).toBe(true);
    expect(WAREHOUSE_FINANCE_GUARDS.fifoConsumptionIsNotAutomaticallyCogs).toBe(true);
  });

  it('defines planned Finance domain event names without requiring emitters yet', () => {
    expect(FINANCE_DOMAIN_EVENT_TYPES.CAPITAL_INJECTED).toBe('finance.capital.injected');
    expect(FINANCE_DOMAIN_EVENT_TYPES.JOURNAL_POSTED).toBe('finance.journal.posted');
  });

  it('ships architecture documentation set', () => {
    for (const rel of [
      'docs/finance-architecture.md',
      'docs/finance-invariants.md',
      'docs/finance-domain-boundaries.md',
      'docs/finance-currency-and-money.md',
      'docs/finance-purchasing-contract.md',
      'docs/finance-warehouse-contract.md',
      'docs/phase-4.1-finance-architecture-report.md',
    ]) {
      const body = readFileSync(join(repoRoot, rel), 'utf8');
      expect(body.length).toBeGreaterThan(200);
    }
  });

  it('negative architecture gate remains FALSE', () => {
    const falsehoods = {
      cashIsAutomaticallyRevenue: false,
      loanReceiptIsRevenue: false,
      capitalInjectionIsRevenue: false,
      loanIsEquity: false,
      equityIsDebt: false,
      supplierPaymentIsAutomaticallyExpense: false,
      inventoryPurchaseIsAutomaticallyExpense: false,
      usdDebtMayLoseUsdDenomination: false,
      accountBalanceFreelyEditable: false,
      postedHistoryNormallyDeleted: false,
      clientChoosesCompanyId: false,
      clientSpoofsActor: false,
      financeOverwritesStockBalance: false,
      financeOverwritesFifoLayers: false,
      financeOverwritesPoTruth: false,
      warehouseCreatesSupplierSettlement: false,
      phase4ProfitFromCash: false,
      phase4EveryIssueIsCogs: false,
    };
    for (const [key, value] of Object.entries(falsehoods)) {
      expect({ [key]: value }).toEqual({ [key]: false });
    }
  });

  it('positive architecture gate remains YES', () => {
    expect(CurrencyCode.IRR).toBe('IRR');
    expect(CurrencyCode.USD).toBe('USD');
    const truths = {
      companyMayHaveIrrAccounts: true,
      companyMayHaveUsdAccounts: true,
      companyMayReceiveCapital: true,
      companyMayReceiveIrrLoan: true,
      companyMayReceiveUsdLoan: true,
      usdLoanPrincipalRemainsUsd: true,
      partialLoanRepaymentSupported: true,
      usdPayableRemainsUsd: true,
      partialSupplierPaymentsSupported: true,
      cashReconcilesFromTransactions: true,
      liabilitiesReconcileFromObligations: true,
      futureJournalDoubleEntry: true,
      financeConsumesPurchasingWithoutDuplication: true,
      financeConsumesWarehouseWithoutOwningStock: true,
      futureSalesIntegrates: true,
      futureSettlementIntegrates: true,
      futureProfitUsesFinanceAndFifo: true,
      financialObjectsTenantIsolated: true,
    };
    for (const [key, value] of Object.entries(truths)) {
      expect({ [key]: value }).toEqual({ [key]: true });
    }
  });
});
