import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hector/database';
import { CurrentCompany } from '../companies/decorators/current-company.decorator';
import {
  ApiCompanyHeader,
  RequireCompany,
} from '../companies/decorators/require-company.decorator';
import type { CompanyContext } from '../companies/types/company.types';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { AuditService } from './audit.service';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs.query.dto';

@ApiTags('audit')
@ApiBearerAuth()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@RequireCompany()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.AUDIT_READ)
  @ApiOperation({
    summary: 'List company audit logs',
    description: `Requires \`${PERMISSIONS.AUDIT_READ}\`. Scoped to validated X-Company-Id.`,
  })
  async list(@CurrentCompany() company: CompanyContext, @Query() query: ListAuditLogsQueryDto) {
    return this.auditService.list(company.companyId, query);
  }

  @Get(':auditLogId')
  @RequirePermissions(PERMISSIONS.AUDIT_READ)
  @ApiOperation({
    summary: 'Get a company audit log detail',
    description: `Requires \`${PERMISSIONS.AUDIT_READ}\`.`,
  })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('auditLogId', ParseUUIDPipe) auditLogId: string,
  ) {
    const data = await this.auditService.getById(company.companyId, auditLogId);
    return { data };
  }
}
