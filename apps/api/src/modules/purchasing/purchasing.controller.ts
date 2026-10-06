import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hector/database';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentCompany } from '../companies/decorators/current-company.decorator';
import { ApiCompanyHeader, RequireCompany } from '../companies/decorators/require-company.decorator';
import type { CompanyContext } from '../companies/types/company.types';
import { PurchasingDashboardQueryDto } from './dto/purchasing-dashboard.query.dto';
import { PurchaseDashboardService } from './purchase-dashboard.service';
import { PurchasingSummaryService } from './purchasing-summary.service';

/**
 * Purchasing module root endpoints (Phase 2.12–2.14).
 * Domain rules live in application services — not here.
 */
@ApiTags('purchasing')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('purchasing')
export class PurchasingController {
  constructor(
    private readonly summary: PurchasingSummaryService,
    private readonly dashboard: PurchaseDashboardService,
  ) {}

  @Get('summary')
  @RequirePermissions(PERMISSIONS.PURCHASING_READ)
  @ApiOperation({
    summary: 'Purchasing operational summary for the active company',
    description:
      'Counts of suppliers, current offers, PO lifecycle buckets, contractual due windows, and return intents. No Finance payable or Warehouse stock KPIs.',
  })
  async getSummary(@CurrentCompany() company: CompanyContext) {
    const data = await this.summary.getSummary(company);
    return { data };
  }

  @Get('dashboard')
  @RequirePermissions(PERMISSIONS.PURCHASING_READ)
  @ApiOperation({
    summary: 'Purchasing operational dashboard aggregates',
    description:
      'Server-side read model: KPIs, attention, open/due/unfulfilled lists, period trend, supplier/type/currency breakdowns. Uses orderDate for period analytics. No Finance payments or Warehouse received quantities.',
  })
  async getDashboard(
    @CurrentCompany() company: CompanyContext,
    @Query() query: PurchasingDashboardQueryDto,
  ) {
    const data = await this.dashboard.getDashboard(company, query);
    return { data };
  }
}
