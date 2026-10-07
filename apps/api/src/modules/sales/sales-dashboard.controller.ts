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
import { SalesDashboardQueryDto } from './dto/sales-dashboard.query.dto';
import { SalesDashboardService } from './sales-dashboard.service';

@ApiTags('sales-dashboard')
@ApiBearerAuth()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@RequireCompany()
@Controller('sales')
export class SalesDashboardController {
  constructor(private readonly dashboard: SalesDashboardService) {}

  @Get('dashboard')
  @RequirePermissions(PERMISSIONS.SALES_DASHBOARD_READ)
  @ApiOperation({
    summary: 'Sales operational dashboard aggregates',
    description:
      'Company-scoped server-side snapshot + period metrics. Outstanding receivables are Finance CustomerReceivable OPEN rows (read-only). Settlement is Phase 6.',
  })
  async getDashboard(
    @CurrentCompany() company: CompanyContext,
    @Query() query: SalesDashboardQueryDto,
  ) {
    const data = await this.dashboard.getDashboard(company, query);
    return { data };
  }
}
