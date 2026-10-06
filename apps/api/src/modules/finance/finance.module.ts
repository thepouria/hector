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
import { SupplierPayablesController } from './supplier-payables.controller';
import { SupplierPayablesService } from './supplier-payables.service';

/**
 * Finance domain module.
 * Phase 4.1: architecture + money primitives + contracts
 * Phase 4.2: Financial Accounts + same-currency transfers
 * Phase 4.3: Capital contributions + Loans / disbursements / repayments
 * Phase 4.4: Supplier Payables (recognition on GRN POST; no cash on recognition)
 * Phase 4.5: FX rates + FX conversions + currency positions / valuation (read)
 *
 * Must NOT import WarehouseModule (Warehouse → Finance only).
 */
@Module({
  imports: [AuditModule, forwardRef(() => RbacModule)],
  controllers: [
    AccountsController,
    AccountTransfersController,
    CapitalContributionsController,
    LoansController,
    SupplierPayablesController,
    FxController,
  ],
  providers: [
    AccountsService,
    AccountTransfersService,
    CapitalContributionsService,
    LoansService,
    SupplierPayablesService,
    FxRatesService,
    FxConversionsService,
    FxPositionsService,
  ],
  exports: [
    AccountsService,
    AccountTransfersService,
    CapitalContributionsService,
    LoansService,
    SupplierPayablesService,
    FxRatesService,
    FxConversionsService,
    FxPositionsService,
  ],
})
export class FinanceModule {}
