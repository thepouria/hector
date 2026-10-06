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
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductsQueryDto } from './dto/list-products.query.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';

@ApiTags('catalog-products')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('catalog/products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOperation({
    summary: 'List products (paginated)',
    description:
      'Supports search (product name/code, nested SKU code/name, barcode value), status, brandId, categoryId (exact or includeDescendants), hasSku, sorting, pagination. List rows include skuCount.',
  })
  async list(@CurrentCompany() company: CompanyContext, @Query() query: ListProductsQueryDto) {
    return this.productsService.list(company, query);
  }

  @Get(':productId')
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOperation({ summary: 'Get a product by id (company-scoped)' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    const data = await this.productsService.get(company, productId);
    return { data };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Create a product' })
  async create(@CurrentCompany() company: CompanyContext, @Body() body: CreateProductDto) {
    const data = await this.productsService.create(company, body);
    return { data };
  }

  @Patch(':productId')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({
    summary: 'Update a product',
    description: 'Omit fields to leave unchanged; null clears optional code/description/brand/category.',
  })
  async update(
    @CurrentCompany() company: CompanyContext,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() body: UpdateProductDto,
  ) {
    const data = await this.productsService.update(company, productId, body);
    return { data };
  }

  @Post(':productId/deactivate')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Deactivate a product (ACTIVE → INACTIVE)' })
  async deactivate(
    @CurrentCompany() company: CompanyContext,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    const data = await this.productsService.deactivate(company, productId);
    return { data };
  }

  @Post(':productId/activate')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({
    summary: 'Activate a product',
    description:
      'Requires Brand/Category (if set) to be assignable (ACTIVE with ACTIVE ancestors for Category).',
  })
  async activate(
    @CurrentCompany() company: CompanyContext,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    const data = await this.productsService.activate(company, productId);
    return { data };
  }

  @Post(':productId/archive')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({
    summary: 'Archive a product',
    description:
      'Non-destructive. Does not delete Brand, Category, or child SKUs. Phase 1.4 defines SKU interaction details.',
  })
  async archive(
    @CurrentCompany() company: CompanyContext,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    const data = await this.productsService.archive(company, productId);
    return { data };
  }
}
