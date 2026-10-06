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
import { CompareSupplierOffersQueryDto } from './dto/compare-supplier-offers.query.dto';
import { CreateSupplierOfferDto } from './dto/create-supplier-offer.dto';
import { ListSupplierOffersQueryDto } from './dto/list-supplier-offers.query.dto';
import { UpdateSupplierOfferDto } from './dto/update-supplier-offer.dto';
import { SupplierOffersService } from './supplier-offers.service';

@ApiTags('purchasing-offers')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('purchasing/offers')
export class SupplierOffersController {
  constructor(private readonly offersService: SupplierOffersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PURCHASING_READ)
  @ApiOperation({ summary: 'List supplier offers (paginated, filterable)' })
  async list(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListSupplierOffersQueryDto,
  ) {
    return this.offersService.list(company, query);
  }

  @Get('compare')
  @RequirePermissions(PERMISSIONS.PURCHASING_READ)
  @ApiOperation({
    summary: 'Latest offer per supplier for a SKU',
    description:
      'Uses quotedAt (not createdAt). Does not declare a best supplier across differing terms/currencies.',
  })
  async compare(
    @CurrentCompany() company: CompanyContext,
    @Query() query: CompareSupplierOffersQueryDto,
  ) {
    return this.offersService.compare(company, query);
  }

  @Get('latest')
  @RequirePermissions(PERMISSIONS.PURCHASING_READ)
  @ApiOperation({ summary: 'Latest non-archived offer for Supplier + SKU' })
  async latest(
    @CurrentCompany() company: CompanyContext,
    @Query('supplierId', ParseUUIDPipe) supplierId: string,
    @Query('skuId', ParseUUIDPipe) skuId: string,
  ) {
    const data = await this.offersService.latestForSupplierSku(company, supplierId, skuId);
    return { data };
  }

  @Get(':offerId')
  @RequirePermissions(PERMISSIONS.PURCHASING_READ)
  @ApiOperation({ summary: 'Get supplier offer detail' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('offerId', ParseUUIDPipe) offerId: string,
  ) {
    const data = await this.offersService.get(company, offerId);
    return { data };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PURCHASING_CREATE)
  @ApiOperation({
    summary: 'Record a supplier offer / price quote',
    description:
      'Append-oriented history. IRR unitPrice is in rials (Toman is UI display only).',
  })
  async create(
    @CurrentCompany() company: CompanyContext,
    @Body() body: CreateSupplierOfferDto,
  ) {
    const data = await this.offersService.create(company, body);
    return { data };
  }

  @Patch(':offerId')
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  @ApiOperation({ summary: 'Correct a supplier offer (audited commercial changes)' })
  async update(
    @CurrentCompany() company: CompanyContext,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Body() body: UpdateSupplierOfferDto,
  ) {
    const data = await this.offersService.update(company, offerId, body);
    return { data };
  }

  @Post(':offerId/archive')
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  @ApiOperation({ summary: 'Archive a supplier offer (non-destructive)' })
  async archive(
    @CurrentCompany() company: CompanyContext,
    @Param('offerId', ParseUUIDPipe) offerId: string,
  ) {
    const data = await this.offersService.archive(company, offerId);
    return { data };
  }
}
