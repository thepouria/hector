import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hector/database';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentCompany } from '../companies/decorators/current-company.decorator';
import { ApiCompanyHeader, RequireCompany } from '../companies/decorators/require-company.decorator';
import type { CompanyContext } from '../companies/types/company.types';
import { CatalogQueryService } from './catalog-query.service';
import { CatalogLookupQueryDto } from './dto/catalog-lookup.query.dto';

@ApiTags('catalog')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('catalog')
export class CatalogPlatformController {
  constructor(private readonly catalogQueryService: CatalogQueryService) {}

  @Get('lookup')
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOperation({
    summary: 'Unified catalog lookup (products, SKUs, barcodes)',
    description:
      'Tenant-scoped typeahead with exact → prefix → contains ranking. Max 20 hits. For scan resolution use POST /catalog/barcodes/resolve.',
  })
  async lookup(@CurrentCompany() company: CompanyContext, @Query() query: CatalogLookupQueryDto) {
    return this.catalogQueryService.lookup(company, query);
  }

  @Get('stats')
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOperation({
    summary: 'Catalog aggregate counts',
    description: 'Entity counts for the active company (no inventory or pricing fields).',
  })
  async stats(@CurrentCompany() company: CompanyContext) {
    return this.catalogQueryService.stats(company);
  }
}
