import { Module, forwardRef } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { RbacModule } from '../rbac/rbac.module';
import { ChannelSettlementsService } from './channel-settlements.service';
import { DomainSettlementsService } from './domain-settlements.service';
import { SettlementDashboardService } from './settlement-dashboard.service';
import { SettlementsCoreController } from './settlements-core.controller';
import { SettlementsCoreService } from './settlements-core.service';

/**
 * Phase 6.1 — Settlement Allocation Core.
 * Phase 6.2 — Supplier Payable + Loan + FX settle commands.
 * Phase 6.3 — Channel Settlement (manual-first marketplace statements).
 * Phase 6.5 — Settlement Dashboard + operational API surface.
 * Phase 4.9 SupplierPaymentAllocation remains a live AP path (shared payment capacity).
 */
@Module({
  imports: [AuditModule, forwardRef(() => RbacModule)],
  controllers: [SettlementsCoreController],
  providers: [
    SettlementsCoreService,
    DomainSettlementsService,
    ChannelSettlementsService,
    SettlementDashboardService,
  ],
  exports: [
    SettlementsCoreService,
    DomainSettlementsService,
    ChannelSettlementsService,
    SettlementDashboardService,
  ],
})
export class SettlementModule {}
