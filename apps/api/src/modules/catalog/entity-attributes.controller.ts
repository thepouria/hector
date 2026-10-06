import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hector/database';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentCompany } from '../companies/decorators/current-company.decorator';
import { ApiCompanyHeader, RequireCompany } from '../companies/decorators/require-company.decorator';
import type { CompanyContext } from '../companies/types/company.types';
import { EntityAttributesService } from './entity-attributes.service';
import { PutEntityAttributesDto } from './dto/put-entity-attributes.dto';

@ApiTags('catalog-entity-attributes')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('catalog')
export class EntityAttributesController {
  constructor(private readonly entityAttributesService: EntityAttributesService) {}

  @Get('products/:productId/attributes')
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOperation({ summary: 'List attribute values stored on a product' })
  async getProductAttributes(
    @CurrentCompany() company: CompanyContext,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    const data = await this.entityAttributesService.getProductAttributes(company, productId);
    return { data };
  }

  @Put('products/:productId/attributes')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({
    summary: 'Replace all product attribute values',
    description: 'Full replacement. An empty attributes array clears all stored values.',
  })
  async putProductAttributes(
    @CurrentCompany() company: CompanyContext,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() body: PutEntityAttributesDto,
  ) {
    const data = await this.entityAttributesService.putProductAttributes(company, productId, body);
    return { data };
  }

  @Get('skus/:skuId/attributes')
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOperation({ summary: 'List attribute values stored on a SKU' })
  async getSkuAttributes(
    @CurrentCompany() company: CompanyContext,
    @Param('skuId', ParseUUIDPipe) skuId: string,
  ) {
    const data = await this.entityAttributesService.getSkuAttributes(company, skuId);
    return { data };
  }

  @Put('skus/:skuId/attributes')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({
    summary: 'Replace all SKU attribute values',
    description: 'Full replacement. An empty attributes array clears all stored values.',
  })
  async putSkuAttributes(
    @CurrentCompany() company: CompanyContext,
    @Param('skuId', ParseUUIDPipe) skuId: string,
    @Body() body: PutEntityAttributesDto,
  ) {
    const data = await this.entityAttributesService.putSkuAttributes(company, skuId, body);
    return { data };
  }
}
