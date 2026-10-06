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
import { BrandsService } from './brands.service';
import { CreateBrandDto } from './dto/create-brand.dto';
import { ListBrandsQueryDto } from './dto/list-brands.query.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';

@ApiTags('catalog-brands')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('catalog/brands')
export class BrandsController {
  constructor(private readonly brandsService: BrandsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOperation({
    summary: 'List brands (paginated, searchable, filterable)',
    description: 'Optional view=options returns id, name, code, status only.',
  })
  async list(@CurrentCompany() company: CompanyContext, @Query() query: ListBrandsQueryDto) {
    return this.brandsService.list(company, query);
  }

  @Get(':brandId')
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOperation({ summary: 'Get a brand by id (company-scoped)' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('brandId', ParseUUIDPipe) brandId: string,
  ) {
    const data = await this.brandsService.get(company, brandId);
    return { data };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Create a brand' })
  async create(@CurrentCompany() company: CompanyContext, @Body() body: CreateBrandDto) {
    const data = await this.brandsService.create(company, body);
    return { data };
  }

  @Patch(':brandId')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Update a brand' })
  async update(
    @CurrentCompany() company: CompanyContext,
    @Param('brandId', ParseUUIDPipe) brandId: string,
    @Body() body: UpdateBrandDto,
  ) {
    const data = await this.brandsService.update(company, brandId, body);
    return { data };
  }

  @Post(':brandId/archive')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({
    summary: 'Archive a brand',
    description: 'Non-destructive. Products may keep referencing the archived brand.',
  })
  async archive(
    @CurrentCompany() company: CompanyContext,
    @Param('brandId', ParseUUIDPipe) brandId: string,
  ) {
    const data = await this.brandsService.archive(company, brandId);
    return { data };
  }

  @Post(':brandId/activate')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Activate a brand (INACTIVE/ARCHIVED → ACTIVE)' })
  async activate(
    @CurrentCompany() company: CompanyContext,
    @Param('brandId', ParseUUIDPipe) brandId: string,
  ) {
    const data = await this.brandsService.activate(company, brandId);
    return { data };
  }
}
