import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hector/database';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentCompany } from '../companies/decorators/current-company.decorator';
import { ApiCompanyHeader, RequireCompany } from '../companies/decorators/require-company.decorator';
import type { CompanyContext } from '../companies/types/company.types';
import { ListSkusQueryDto } from './dto/list-skus.query.dto';
import { UpdateSkuDto } from './dto/update-sku.dto';
import { CatalogQueryService } from './catalog-query.service';
import { SkusService } from './skus.service';

@ApiTags('catalog-skus')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('catalog/skus')
export class SkusController {
  constructor(
    private readonly skusService: SkusService,
    private readonly catalogQueryService: CatalogQueryService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOperation({
    summary: 'List SKUs (paginated)',
    description:
      'Supports search (SKU code/name, product name/code, active barcode value), hasBarcode, status, productId, sorting, pagination.',
  })
  async list(@CurrentCompany() company: CompanyContext, @Query() query: ListSkusQueryDto) {
    return this.skusService.list(company, query);
  }

  @Get(':skuId/identity')
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOperation({
    summary: 'Compact SKU identity',
    description:
      'Lightweight SKU + product + primary barcode projection for operational modules (no inventory fields).',
  })
  async identity(
    @CurrentCompany() company: CompanyContext,
    @Param('skuId', ParseUUIDPipe) skuId: string,
  ) {
    const data = await this.catalogQueryService.getSkuIdentity(company.companyId, skuId);
    return { data };
  }

  @Get(':skuId')
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOperation({ summary: 'Get a SKU by id (company-scoped)' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('skuId', ParseUUIDPipe) skuId: string,
  ) {
    const data = await this.skusService.get(company, skuId);
    return { data };
  }

  @Patch(':skuId')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({
    summary: 'Update a SKU',
    description:
      'SKU code changes are sensitive and audited. optionValueIds replaces the variant selection (signature recomputed server-side).',
  })
  async update(
    @CurrentCompany() company: CompanyContext,
    @Param('skuId', ParseUUIDPipe) skuId: string,
    @Body() body: UpdateSkuDto,
  ) {
    const data = await this.skusService.update(company, skuId, body);
    return { data };
  }

  @Post(':skuId/deactivate')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Deactivate a SKU (ACTIVE → INACTIVE)' })
  async deactivate(
    @CurrentCompany() company: CompanyContext,
    @Param('skuId', ParseUUIDPipe) skuId: string,
  ) {
    const data = await this.skusService.deactivate(company, skuId);
    return { data };
  }

  @Post(':skuId/activate')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({
    summary: 'Activate a SKU',
    description: 'Requires an ACTIVE product and a complete, active variant selection.',
  })
  async activate(
    @CurrentCompany() company: CompanyContext,
    @Param('skuId', ParseUUIDPipe) skuId: string,
  ) {
    const data = await this.skusService.activate(company, skuId);
    return { data };
  }

  @Post(':skuId/archive')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({
    summary: 'Archive a SKU',
    description:
      'Non-destructive. The SKU code and variant combination stay reserved; barcodes are kept.',
  })
  async archive(
    @CurrentCompany() company: CompanyContext,
    @Param('skuId', ParseUUIDPipe) skuId: string,
  ) {
    const data = await this.skusService.archive(company, skuId);
    return { data };
  }
}
