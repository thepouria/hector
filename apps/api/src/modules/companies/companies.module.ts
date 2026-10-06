import { Module, forwardRef } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuditModule } from '../audit/audit.module';
import { RbacModule } from '../rbac/rbac.module';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { CompanyContextService } from './company-context.service';
import { CompanyContextGuard } from './guards/company-context.guard';
import { MembersController } from './members/members.controller';
import { MembersService } from './members/members.service';

@Module({
  imports: [forwardRef(() => RbacModule), AuditModule],
  controllers: [CompaniesController, MembersController],
  providers: [
    CompaniesService,
    MembersService,
    CompanyContextService,
    CompanyContextGuard,
    {
      provide: APP_GUARD,
      useClass: CompanyContextGuard,
    },
  ],
  exports: [CompanyContextService, CompaniesService, MembersService],
})
export class CompaniesModule {}
