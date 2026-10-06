import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hector/database';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentCompany } from '../companies/decorators/current-company.decorator';
import { ApiCompanyHeader, RequireCompany } from '../companies/decorators/require-company.decorator';
import type { CompanyContext } from '../companies/types/company.types';
import { WarehouseDashboardQueryDto } from './dto/warehouse-dashboard.query.dto';
import { WarehouseDashboardService } from './warehouse-dashboard.service';

@ApiTags('warehouse-dashboard')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('warehouse/dashboard')
export class WarehouseDashboardController {
  constructor(private readonly dashboard: WarehouseDashboardService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.WAREHOUSE_STOCK_READ)
  @ApiOperation({
    summary: 'Operational warehouse dashboard summary',
    description:
      'Bounded DB aggregates for floor ops (Phase 3.17). Valuation section is included only when the actor has warehouse.valuation.read; otherwise valuation is null.',
  })
  async summary(
    @CurrentCompany() company: CompanyContext,
    @Query() query: WarehouseDashboardQueryDto,
  ) {
    return {
      data: await this.dashboard.getSummary(company, {
        warehouseId: query.warehouseId,
      }),
    };
  }
}
