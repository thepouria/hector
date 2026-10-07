import { Module, forwardRef } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { RbacModule } from '../rbac/rbac.module';
import { SettlementModule } from '../settlement/settlement.module';
import { ReconciliationCandidatesService } from './reconciliation-candidates.service';
import { ReconciliationsController } from './reconciliations.controller';
import { ReconciliationsService } from './reconciliations.service';

@Module({
  imports: [AuditModule, forwardRef(() => RbacModule), forwardRef(() => SettlementModule)],
  controllers: [ReconciliationsController],
  providers: [ReconciliationsService, ReconciliationCandidatesService],
  exports: [ReconciliationsService],
})
export class ReconciliationModule {}
