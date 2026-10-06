import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hector/database';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentCompany } from '../companies/decorators/current-company.decorator';
import { ApiCompanyHeader, RequireCompany } from '../companies/decorators/require-company.decorator';
import type { CompanyContext } from '../companies/types/company.types';
import { AttributesService } from './attributes.service';
import { CreateAttributeDto } from './dto/create-attribute.dto';
import { CreateAttributeOptionDto } from './dto/create-attribute-option.dto';
import { ListAttributesQueryDto } from './dto/list-attributes.query.dto';
import { UpdateAttributeDto } from './dto/update-attribute.dto';

@ApiTags('catalog-attributes')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('catalog/attributes')
export class AttributesController {
  constructor(private readonly attributesService: AttributesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOperation({
    summary: 'List attribute definitions (paginated, filterable)',
    description: 'Optional view=options returns id, name, code, status only.',
  })
  async list(@CurrentCompany() company: CompanyContext, @Query() query: ListAttributesQueryDto) {
    return this.attributesService.list(company, query);
  }

  @Get(':attributeId')
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOperation({ summary: 'Get an attribute definition with options' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('attributeId', ParseUUIDPipe) attributeId: string,
  ) {
    const data = await this.attributesService.get(company, attributeId);
    return { data };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Create an attribute definition' })
  async create(@CurrentCompany() company: CompanyContext, @Body() body: CreateAttributeDto) {
    const data = await this.attributesService.create(company, body);
    return { data };
  }

  @Patch(':attributeId')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Update attribute metadata (name, unit, description)' })
  async update(
    @CurrentCompany() company: CompanyContext,
    @Param('attributeId', ParseUUIDPipe) attributeId: string,
    @Body() body: UpdateAttributeDto,
  ) {
    const data = await this.attributesService.update(company, attributeId, body);
    return { data };
  }

  @Post(':attributeId/archive')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Archive an attribute definition' })
  async archive(
    @CurrentCompany() company: CompanyContext,
    @Param('attributeId', ParseUUIDPipe) attributeId: string,
  ) {
    const data = await this.attributesService.archive(company, attributeId);
    return { data };
  }

  @Post(':attributeId/options')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Create an option for a select-type attribute' })
  async createOption(
    @CurrentCompany() company: CompanyContext,
    @Param('attributeId', ParseUUIDPipe) attributeId: string,
    @Body() body: CreateAttributeOptionDto,
  ) {
    const data = await this.attributesService.createOption(company, attributeId, body);
    return { data };
  }
}
