import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hector/database';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentCompany } from '../companies/decorators/current-company.decorator';
import { ApiCompanyHeader, RequireCompany } from '../companies/decorators/require-company.decorator';
import type { CompanyContext } from '../companies/types/company.types';
import {
  ChangeStockClassificationDto,
  ListStockClassificationChangesQueryDto,
} from './dto/stock-classification.dto';
import { StockClassificationService } from './stock-classification.service';

@ApiTags('stock-classification')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('warehouse/stock')
export class StockClassificationController {
  constructor(private readonly stockClassificationService: StockClassificationService) {}

  @Post('classification-change')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_CLASSIFICATION_CHANGE)
  @ApiOperation({
    summary: 'Reclassify stock at a location',
    description:
      'Posts RECLASSIFY_OUT/IN atomically and records a StockClassificationChange document.',
  })
  async change(
    @CurrentCompany() company: CompanyContext,
    @Body() body: ChangeStockClassificationDto,
  ) {
    const data = await this.stockClassificationService.change(company, body);
    return { data };
  }

  @Get('classification-changes')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_STOCK_READ)
  @ApiOperation({ summary: 'List stock classification change history' })
  async list(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListStockClassificationChangesQueryDto,
  ) {
    return this.stockClassificationService.list(company, query);
  }
}
