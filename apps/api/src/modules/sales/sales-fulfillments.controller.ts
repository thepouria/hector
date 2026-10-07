import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hector/database';
import { CurrentCompany } from '../companies/decorators/current-company.decorator';
import { ApiCompanyHeader, RequireCompany } from '../companies/decorators/require-company.decorator';
import type { CompanyContext } from '../companies/types/company.types';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CreateSalesFulfillmentDto } from './dto/create-sales-fulfillment.dto';
import { ListSalesFulfillmentsQueryDto } from './dto/list-sales-fulfillments.query.dto';
import { SalesFulfillmentsService } from './sales-fulfillments.service';

@ApiTags('sales-fulfillments')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('sales/fulfillments')
export class SalesFulfillmentsController {
  constructor(private readonly fulfillments: SalesFulfillmentsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SALES_FULFILLMENTS_READ)
  @ApiOperation({ summary: 'List sales fulfillments' })
  async list(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListSalesFulfillmentsQueryDto,
  ) {
    return this.fulfillments.list(company, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SALES_FULFILLMENTS_CREATE)
  @ApiOperation({ summary: 'Create a DRAFT sales fulfillment' })
  async create(
    @CurrentCompany() company: CompanyContext,
    @Body() body: CreateSalesFulfillmentDto,
  ) {
    return { data: await this.fulfillments.create(company, body) };
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.SALES_FULFILLMENTS_READ)
  @ApiOperation({ summary: 'Get sales fulfillment detail' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.fulfillments.get(company, id) };
  }

  @Post(':id/complete')
  @RequirePermissions(PERMISSIONS.SALES_FULFILLMENTS_COMPLETE)
  @ApiOperation({
    summary: 'Complete a DRAFT sales fulfillment',
    description:
      'Atomically posts Warehouse ISSUE, consumes reservations, updates fulfilledQuantity, lifecycle, and Finance AR recognition.',
  })
  async complete(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.fulfillments.complete(company, id) };
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.SALES_FULFILLMENTS_MANAGE)
  @ApiOperation({ summary: 'Cancel a DRAFT sales fulfillment' })
  async cancel(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.fulfillments.cancel(company, id) };
  }
}
