import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hector/database';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentCompany } from '../companies/decorators/current-company.decorator';
import { ApiCompanyHeader, RequireCompany } from '../companies/decorators/require-company.decorator';
import type { CompanyContext } from '../companies/types/company.types';
import { CategoryAttributesService } from './category-attributes.service';
import { CategoriesService } from './categories.service';
import { PutCategoryAttributesDto } from './dto/put-category-attributes.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { ListCategoriesQueryDto } from './dto/list-categories.query.dto';
import { MoveCategoryDto } from './dto/move-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@ApiTags('catalog-categories')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('catalog/categories')
export class CategoriesController {
  constructor(
    private readonly categoriesService: CategoriesService,
    private readonly categoryAttributesService: CategoryAttributesService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOperation({
    summary: 'List categories (flat, paginated, searchable)',
    description: 'Optional view=options returns id, name, code, status only (no path).',
  })
  async list(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListCategoriesQueryDto,
  ) {
    return this.categoriesService.list(company, query);
  }

  @Get('tree')
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOperation({
    summary: 'Return the full category tree for the active company',
    description: 'Single company query + in-memory tree build (no N+1).',
  })
  async tree(@CurrentCompany() company: CompanyContext) {
    const data = await this.categoriesService.tree(company);
    return { data };
  }

  @Get(':categoryId/attributes')
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOperation({ summary: 'List attributes assigned directly to this category' })
  async listCategoryAttributes(
    @CurrentCompany() company: CompanyContext,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
  ) {
    const data = await this.categoryAttributesService.listAssigned(company, categoryId);
    return { data };
  }

  @Get(':categoryId/suggested-attributes')
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOperation({
    summary: 'Merged attribute suggestions from category ancestors',
    description: 'Root→leaf merge; nearest category wins. Returns visible suggestions only.',
  })
  async listSuggestedAttributes(
    @CurrentCompany() company: CompanyContext,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
  ) {
    const data = await this.categoryAttributesService.listSuggested(company, categoryId);
    return { data };
  }

  @Put(':categoryId/attributes')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({
    summary: 'Replace category attribute assignments',
    description: 'Suggestion-only metadata. An empty attributes array clears assignments.',
  })
  async putCategoryAttributes(
    @CurrentCompany() company: CompanyContext,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() body: PutCategoryAttributesDto,
  ) {
    const data = await this.categoryAttributesService.replaceAssigned(company, categoryId, body);
    return { data };
  }

  @Get(':categoryId')
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOperation({ summary: 'Get a category by id with breadcrumb path' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
  ) {
    const data = await this.categoriesService.get(company, categoryId);
    return { data };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Create a root or child category' })
  async create(@CurrentCompany() company: CompanyContext, @Body() body: CreateCategoryDto) {
    const data = await this.categoriesService.create(company, body);
    return { data };
  }

  @Patch(':categoryId')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Update category metadata (not parent — use move)' })
  async update(
    @CurrentCompany() company: CompanyContext,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() body: UpdateCategoryDto,
  ) {
    const data = await this.categoriesService.update(company, categoryId, body);
    return { data };
  }

  @Post(':categoryId/move')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({
    summary: 'Reparent a category',
    description: 'Rejects self-parent, descendant cycles, and cross-company parents.',
  })
  async move(
    @CurrentCompany() company: CompanyContext,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() body: MoveCategoryDto,
  ) {
    const data = await this.categoriesService.move(company, categoryId, body);
    return { data };
  }

  @Post(':categoryId/archive')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({
    summary: 'Archive a category',
    description: 'Does not delete children or products. Tree structure is preserved.',
  })
  async archive(
    @CurrentCompany() company: CompanyContext,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
  ) {
    const data = await this.categoriesService.archive(company, categoryId);
    return { data };
  }

  @Post(':categoryId/activate')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Activate a category' })
  async activate(
    @CurrentCompany() company: CompanyContext,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
  ) {
    const data = await this.categoriesService.activate(company, categoryId);
    return { data };
  }
}
