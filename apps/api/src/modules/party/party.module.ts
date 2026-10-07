import { Module, forwardRef } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { RbacModule } from '../rbac/rbac.module';
import { PartiesController } from './parties.controller';
import { PartiesService } from './parties.service';
import { PartyIdentityLookupService } from './party-identity-lookup.service';

/**
 * Phase 5.5.1/5.5.2 — Party Master + domain linking helpers.
 * Full Party Management UI/API polish is Phase 5.5.3.
 */
@Module({
  imports: [AuditModule, forwardRef(() => RbacModule)],
  controllers: [PartiesController],
  providers: [PartiesService, PartyIdentityLookupService],
  exports: [PartiesService, PartyIdentityLookupService],
})
export class PartyModule {}
