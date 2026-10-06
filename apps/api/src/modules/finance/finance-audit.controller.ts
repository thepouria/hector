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
import { AuditService } from '../audit/audit.service';
import { ListFinanceAuditQueryDto } from './dto/list-finance-audit.query.dto';
import { FINANCE_AUDIT_ENTITY_TYPES } from './finance-audit.constants';

@ApiTags('finance-audit')
@ApiBearerAuth()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@RequireCompany()
@Controller('finance/audit')
export class FinanceAuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FINANCE_AUDIT_READ)
  @ApiOperation({
    summary: 'List Finance-domain audit logs',
    description: `Requires \`${PERMISSIONS.FINANCE_AUDIT_READ}\`. Restricted to finance entity types. Read-only.`,
  })
  async list(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListFinanceAuditQueryDto,
  ) {
    return this.auditService.list(company.companyId, query, {
      restrictEntityTypes: FINANCE_AUDIT_ENTITY_TYPES,
    });
  }

  @Get(':auditLogId')
  @RequirePermissions(PERMISSIONS.FINANCE_AUDIT_READ)
  @ApiOperation({
    summary: 'Get a Finance-domain audit log detail',
    description: `Requires \`${PERMISSIONS.FINANCE_AUDIT_READ}\`. Non-finance entity types return 404.`,
  })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('auditLogId', ParseUUIDPipe) auditLogId: string,
  ) {
    const data = await this.auditService.getById(company.companyId, auditLogId, {
      restrictEntityTypes: FINANCE_AUDIT_ENTITY_TYPES,
    });
    return { data };
  }
}
