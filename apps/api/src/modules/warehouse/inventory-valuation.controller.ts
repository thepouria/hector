import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hector/database';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentCompany } from '../companies/decorators/current-company.decorator';
import { ApiCompanyHeader, RequireCompany } from '../companies/decorators/require-company.decorator';
import type { CompanyContext } from '../companies/types/company.types';
import {
  ListCostLayersQueryDto,
  ValuationBreakdownQueryDto,
} from './dto/inventory-valuation.dto';
import { InventoryCostLayersService } from './inventory-cost-layers.service';
import { InventoryValuationService } from './inventory-valuation.service';

@ApiTags('inventory-valuation')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('warehouse')
export class InventoryValuationController {
  constructor(
    private readonly valuation: InventoryValuationService,
    private readonly costLayers: InventoryCostLayersService,
  ) {}

  @Get('valuation')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_VALUATION_READ)
  @ApiOperation({ summary: 'Company inventory valuation summary' })
  async summary(@CurrentCompany() company: CompanyContext) {
    return { data: await this.valuation.summary(company) };
  }

  @Get('valuation/by-warehouse')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_VALUATION_READ)
  @ApiOperation({ summary: 'Inventory value by warehouse' })
  async byWarehouse(@CurrentCompany() company: CompanyContext) {
    return this.valuation.byWarehouse(company);
  }

  @Get('valuation/by-sku')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_VALUATION_READ)
  @ApiOperation({ summary: 'Inventory value by SKU' })
  async bySku(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ValuationBreakdownQueryDto,
  ) {
    return this.valuation.bySku(company, query.warehouseId);
  }

  @Get('valuation/by-classification')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_VALUATION_READ)
  @ApiOperation({ summary: 'Inventory value by classification' })
  async byClassification(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ValuationBreakdownQueryDto,
  ) {
    return this.valuation.byClassification(company, query.warehouseId);
  }

  @Get('valuation/unvalued')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_VALUATION_READ)
  @ApiOperation({ summary: 'Explicit UNVALUED remaining inventory layers' })
  async unvalued(@CurrentCompany() company: CompanyContext) {
    return this.valuation.unvalued(company);
  }

  @Get('cost-layers')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_COST_LAYER_READ)
  @ApiOperation({ summary: 'List FIFO cost layers' })
  async listLayers(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListCostLayersQueryDto,
  ) {
    return this.costLayers.listLayers(company, query);
  }

  @Get('cost-layers/:id')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_COST_LAYER_READ)
  @ApiOperation({ summary: 'Cost layer detail + consumptions' })
  async getLayer(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.costLayers.getLayer(company, id) };
  }

  @Get('inventory/movements/:id/cost-trace')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_COST_LAYER_READ)
  @ApiOperation({
    summary: 'Inventory cost consumption trace for a movement (not COGS)',
  })
  async movementCostTrace(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.costLayers.getMovementCostTrace(company, id) };
  }
}
