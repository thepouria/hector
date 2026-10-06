import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hector/database';
import { CurrentCompany } from '../companies/decorators/current-company.decorator';
import {
  ApiCompanyHeader,
  RequireCompany,
} from '../companies/decorators/require-company.decorator';
import type { CompanyContext } from '../companies/types/company.types';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { AuthorizationService } from '../rbac/authorization.service';
import { FinanceDashboardQueryDto } from './dto/finance-dashboard.query.dto';
import { FinanceDashboardService } from './finance-dashboard.service';

@ApiTags('finance-dashboard')
@ApiBearerAuth()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@RequireCompany()
@Controller('finance')
export class FinanceDashboardController {
  constructor(
    private readonly dashboard: FinanceDashboardService,
    private readonly authorization: AuthorizationService,
  ) {}

  @Get('dashboard')
  @RequirePermissions(PERMISSIONS.FINANCE_DASHBOARD_READ)
  @ApiOperation({
    summary: 'Finance operational dashboard aggregates',
    description:
      'Server-side snapshot + period metrics. Money In = Receipts (not Revenue). Money Out = Payments (not Expenses). Internal transfers excluded. Currencies never summed. Sections omitted when member lacks domain read permissions.',
  })
  async getDashboard(
    @CurrentCompany() company: CompanyContext,
    @Query() query: FinanceDashboardQueryDto,
  ) {
    const permissions = await this.authorization.getEffectivePermissions(company.companyMemberId);
    const data = await this.dashboard.getDashboard(company, query, permissions);
    return { data };
  }
}
