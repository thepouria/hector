import { Module, forwardRef } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { RbacModule } from '../rbac/rbac.module';
import { AccountTransfersController } from './account-transfers.controller';
import { AccountTransfersService } from './account-transfers.service';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { CapitalContributionsController } from './capital-contributions.controller';
import { CapitalContributionsService } from './capital-contributions.service';
import { FxController } from './fx.controller';
import { FxConversionsService } from './fx-conversions.service';
import { FxPositionsService } from './fx-positions.service';
import { FxRatesService } from './fx-rates.service';
import { LoansController } from './loans.controller';
import { LoansService } from './loans.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { ReceiptsController } from './receipts.controller';
import { ReceiptsService } from './receipts.service';
import { SupplierPayablesController } from './supplier-payables.controller';
import { SupplierPayablesService } from './supplier-payables.service';
import { ExpenseCategoriesController, ExpensesController } from './expenses.controller';
import { ExpenseCategoriesService } from './expense-categories.service';
import { ExpensesService } from './expenses.service';
import {
  FinanceLedgerReportsController,
  JournalsController,
  LedgerAccountsController,
} from './journals.controller';
import { JournalPostingService } from './journal-posting.service';
import { LedgerAccountsService } from './ledger-accounts.service';
import { SettlementsController } from './settlements.controller';
import { SettlementService } from './settlement.service';
import { FinanceDashboardController } from './finance-dashboard.controller';
import { FinanceDashboardService } from './finance-dashboard.service';
import { FinanceAuditController } from './finance-audit.controller';

/**
 * Finance domain module.
 * Phase 4.1–4.7: Accounts, Capital, Loans, AP, FX, Payments, Expenses
 * Phase 4.8: Ledger accounts + Journal posting foundation
 * Phase 4.9: Liability Settlement (Supplier AP ↔ Payment)
 * Phase 4.11: Finance Dashboard + Finance Audit
 *
 * Must NOT import WarehouseModule (Warehouse → Finance only).
 * Purchasing may import Finance for PERIOD_EXPENSE recognition + journals.
 */
@Module({
  imports: [AuditModule, forwardRef(() => RbacModule)],
  controllers: [
    FinanceDashboardController,
    FinanceAuditController,
    AccountsController,
    AccountTransfersController,
    CapitalContributionsController,
    LoansController,
    SupplierPayablesController,
    SettlementsController,
    FxController,
    PaymentsController,
    ReceiptsController,
    ExpenseCategoriesController,
    ExpensesController,
    LedgerAccountsController,
    JournalsController,
    FinanceLedgerReportsController,
  ],
  providers: [
    FinanceDashboardService,
    AccountsService,
    AccountTransfersService,
    CapitalContributionsService,
    LoansService,
    SupplierPayablesService,
    SettlementService,
    FxRatesService,
    FxConversionsService,
    FxPositionsService,
    PaymentsService,
    ReceiptsService,
    ExpenseCategoriesService,
    ExpensesService,
    LedgerAccountsService,
    JournalPostingService,
  ],
  exports: [
    FinanceDashboardService,
    AccountsService,
    AccountTransfersService,
    CapitalContributionsService,
    LoansService,
    SupplierPayablesService,
    SettlementService,
    FxRatesService,
    FxConversionsService,
    FxPositionsService,
    PaymentsService,
    ReceiptsService,
    ExpenseCategoriesService,
    ExpensesService,
    LedgerAccountsService,
    JournalPostingService,
  ],
})
export class FinanceModule {}
