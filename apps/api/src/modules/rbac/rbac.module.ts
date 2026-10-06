import { Module, forwardRef } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuditModule } from '../audit/audit.module';
import { CompaniesModule } from '../companies/companies.module';
import { AuthorizationService } from './authorization.service';
import { MeAuthorizationController } from './me-authorization.controller';
import { PermissionsController } from './permissions.controller';
import { PermissionsService } from './permissions.service';
import { PermissionsGuard } from './guards/permissions.guard';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

@Module({
  imports: [forwardRef(() => CompaniesModule), AuditModule],
  controllers: [PermissionsController, RolesController, MeAuthorizationController],
  providers: [
    AuthorizationService,
    PermissionsService,
    RolesService,
    PermissionsGuard,
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
  ],
  exports: [AuthorizationService, RolesService, PermissionsService],
})
export class RbacModule {}
