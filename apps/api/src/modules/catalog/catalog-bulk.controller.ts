import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hector/database';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentCompany } from '../companies/decorators/current-company.decorator';
import { ApiCompanyHeader, RequireCompany } from '../companies/decorators/require-company.decorator';
import type { CompanyContext } from '../companies/types/company.types';
import { CatalogBulkService } from './catalog-bulk.service';
import { BulkCommandDto } from './dto/bulk-operation.dto';

@ApiTags('catalog-bulk')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('catalog/bulk')
export class CatalogBulkController {
  constructor(private readonly catalogBulkService: CatalogBulkService) {}

  @Post('preview')
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOperation({
    summary: 'Preview a catalog bulk operation (read-only)',
    description:
      'Resolves IDS or QUERY selection inside the active company and reports matched/eligible/ineligible counts without mutating. Empty QUERY requires selectAll=true.',
  })
  async preview(@CurrentCompany() company: CompanyContext, @Body() dto: BulkCommandDto) {
    const data = await this.catalogBulkService.preview(company, dto);
    return { data };
  }

  @Post('execute')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({
    summary: 'Execute a catalog bulk operation',
    description:
      'Explicit validated commands only (no arbitrary patch). Selection is re-resolved at execution time. Per-entity best-effort; returns matched/succeeded/failed/skipped.',
  })
  async execute(@CurrentCompany() company: CompanyContext, @Body() dto: BulkCommandDto) {
    const data = await this.catalogBulkService.execute(company, dto);
    return { data };
  }

  @Get(':operationId')
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOperation({ summary: 'Get bulk operation status/summary by id' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('operationId', ParseUUIDPipe) operationId: string,
  ) {
    const data = await this.catalogBulkService.get(company, operationId);
    return { data };
  }
}
