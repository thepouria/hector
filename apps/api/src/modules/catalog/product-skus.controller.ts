import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hector/database';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentCompany } from '../companies/decorators/current-company.decorator';
import { ApiCompanyHeader, RequireCompany } from '../companies/decorators/require-company.decorator';
import type { CompanyContext } from '../companies/types/company.types';
import { BulkCreateSkusDto } from './dto/bulk-create-skus.dto';
import { CreateSkuDto } from './dto/create-sku.dto';
import { ListSkusQueryDto } from './dto/list-skus.query.dto';
import { SkusService } from './skus.service';

@ApiTags('catalog-skus')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('catalog/products/:productId/skus')
export class ProductSkusController {
  constructor(private readonly skusService: SkusService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOperation({ summary: 'List SKUs of a product (paginated)' })
  async list(
    @CurrentCompany() company: CompanyContext,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query() query: ListSkusQueryDto,
  ) {
    return this.skusService.listForProduct(company, productId, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({
    summary: 'Create a SKU under a product',
    description:
      'Requires an ACTIVE product. Products without variant options allow exactly one (simple) SKU; otherwise select one value per option via optionValueIds.',
  })
  async create(
    @CurrentCompany() company: CompanyContext,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() body: CreateSkuDto,
  ) {
    const data = await this.skusService.create(company, productId, body);
    return { data };
  }

  @Post('bulk')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({
    summary: 'Bulk-create SKUs (all-or-nothing)',
    description: 'The whole batch is validated first; any conflict rejects the entire request.',
  })
  async bulkCreate(
    @CurrentCompany() company: CompanyContext,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() body: BulkCreateSkusDto,
  ) {
    return this.skusService.bulkCreate(company, productId, body);
  }
}
