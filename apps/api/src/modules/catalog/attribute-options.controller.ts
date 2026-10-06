import { Body, Controller, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hector/database';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentCompany } from '../companies/decorators/current-company.decorator';
import { ApiCompanyHeader, RequireCompany } from '../companies/decorators/require-company.decorator';
import type { CompanyContext } from '../companies/types/company.types';
import { AttributesService } from './attributes.service';
import { UpdateAttributeOptionDto } from './dto/update-attribute-option.dto';

@ApiTags('catalog-attribute-options')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('catalog/attribute-options')
export class AttributeOptionsController {
  constructor(private readonly attributesService: AttributesService) {}

  @Patch(':optionId')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Update an attribute option (value / position)' })
  async update(
    @CurrentCompany() company: CompanyContext,
    @Param('optionId', ParseUUIDPipe) optionId: string,
    @Body() body: UpdateAttributeOptionDto,
  ) {
    const data = await this.attributesService.updateOption(company, optionId, body);
    return { data };
  }

  @Post(':optionId/deactivate')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Deactivate an attribute option' })
  async deactivate(
    @CurrentCompany() company: CompanyContext,
    @Param('optionId', ParseUUIDPipe) optionId: string,
  ) {
    const data = await this.attributesService.deactivateOption(company, optionId);
    return { data };
  }

  @Post(':optionId/activate')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Activate an attribute option' })
  async activate(
    @CurrentCompany() company: CompanyContext,
    @Param('optionId', ParseUUIDPipe) optionId: string,
  ) {
    const data = await this.attributesService.activateOption(company, optionId);
    return { data };
  }
}
