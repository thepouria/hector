import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hector/database';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentCompany } from '../companies/decorators/current-company.decorator';
import { ApiCompanyHeader, RequireCompany } from '../companies/decorators/require-company.decorator';
import type { CompanyContext } from '../companies/types/company.types';
import { CreateVariantOptionDto } from './dto/create-variant-option.dto';
import { CreateVariantValuesDto } from './dto/create-variant-values.dto';
import { UpdateVariantOptionDto } from './dto/update-variant-option.dto';
import { UpdateVariantValueDto } from './dto/update-variant-value.dto';
import { VariantsService } from './variants.service';

@ApiTags('catalog-variants')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('catalog')
export class VariantsController {
  constructor(private readonly variantsService: VariantsService) {}

  @Get('products/:productId/variant-options')
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOperation({ summary: 'List variant options (with values) of a product' })
  async listOptions(
    @CurrentCompany() company: CompanyContext,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    const data = await this.variantsService.listOptions(company, productId);
    return { data };
  }

  @Post('products/:productId/variant-options')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({
    summary: 'Create a variant option',
    description: 'Rejected once the product already has any SKU (VARIANT_OPTION_ADD_BLOCKED).',
  })
  async createOption(
    @CurrentCompany() company: CompanyContext,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() body: CreateVariantOptionDto,
  ) {
    const data = await this.variantsService.createOption(company, productId, body);
    return { data };
  }

  @Patch('variant-options/:optionId')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Rename / reorder a variant option' })
  async updateOption(
    @CurrentCompany() company: CompanyContext,
    @Param('optionId', ParseUUIDPipe) optionId: string,
    @Body() body: UpdateVariantOptionDto,
  ) {
    const data = await this.variantsService.updateOption(company, optionId, body);
    return { data };
  }

  @Post('variant-options/:optionId/values')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({
    summary: 'Add values to an option (batch)',
    description: 'Values are normalized and de-duplicated; returns the updated option with values.',
  })
  async createValues(
    @CurrentCompany() company: CompanyContext,
    @Param('optionId', ParseUUIDPipe) optionId: string,
    @Body() body: CreateVariantValuesDto,
  ) {
    const data = await this.variantsService.createValues(company, optionId, body);
    return { data };
  }

  @Patch('variant-option-values/:valueId')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Rename / reorder a variant value' })
  async updateValue(
    @CurrentCompany() company: CompanyContext,
    @Param('valueId', ParseUUIDPipe) valueId: string,
    @Body() body: UpdateVariantValueDto,
  ) {
    const data = await this.variantsService.updateValue(company, valueId, body);
    return { data };
  }

  @Post('variant-option-values/:valueId/deactivate')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({
    summary: 'Deactivate a variant value',
    description: 'Blocks new assignments only; existing SKU links are kept.',
  })
  async deactivateValue(
    @CurrentCompany() company: CompanyContext,
    @Param('valueId', ParseUUIDPipe) valueId: string,
  ) {
    const data = await this.variantsService.deactivateValue(company, valueId);
    return { data };
  }

  @Post('variant-option-values/:valueId/activate')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Re-activate a variant value' })
  async activateValue(
    @CurrentCompany() company: CompanyContext,
    @Param('valueId', ParseUUIDPipe) valueId: string,
  ) {
    const data = await this.variantsService.activateValue(company, valueId);
    return { data };
  }
}
