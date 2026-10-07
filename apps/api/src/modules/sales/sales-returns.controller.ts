import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hector/database';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentCompany } from '../companies/decorators/current-company.decorator';
import { ApiCompanyHeader, RequireCompany } from '../companies/decorators/require-company.decorator';
import type { CompanyContext } from '../companies/types/company.types';
import {
  CancelSalesReturnDto,
  CreateSalesReturnDto,
} from './dto/create-sales-return.dto';
import { ListSalesReturnsQueryDto } from './dto/list-sales-returns.query.dto';
import { ReceiveSalesReturnDto } from './dto/receive-sales-return.dto';
import { SalesReturnsService } from './sales-returns.service';

@ApiTags('sales-returns')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('sales/returns')
export class SalesReturnsController {
  constructor(private readonly returns: SalesReturnsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SALES_RETURNS_READ)
  @ApiOperation({ summary: 'List sales returns (commercial intent)' })
  async list(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListSalesReturnsQueryDto,
  ) {
    return this.returns.list(company, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SALES_RETURNS_CREATE)
  @ApiOperation({
    summary: 'Create a DRAFT sales return',
    description: 'Commercial return intent. Returnable = fulfilledQuantity − returnedQuantity.',
  })
  async create(
    @CurrentCompany() company: CompanyContext,
    @Body() body: CreateSalesReturnDto,
  ) {
    return { data: await this.returns.create(company, body) };
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.SALES_RETURNS_READ)
  @ApiOperation({ summary: 'Get sales return detail' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.returns.get(company, id) };
  }

  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.SALES_RETURNS_APPROVE)
  @ApiOperation({
    summary: 'Approve sales return (commercial intent)',
    description: 'Increments order-item returnedQuantity. Does not receive stock or refund.',
  })
  async approve(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.returns.approve(company, id) };
  }

  @Post(':id/receive')
  @RequirePermissions(PERMISSIONS.SALES_RETURNS_RECEIVE)
  @ApiOperation({
    summary: 'Physically receive an APPROVED sales return',
    description: 'Posts Warehouse RETURN_IN and Finance AR credit in one transaction.',
  })
  async receive(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReceiveSalesReturnDto,
  ) {
    return { data: await this.returns.receivePhysical(company, id, body) };
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.SALES_RETURNS_MANAGE)
  @ApiOperation({ summary: 'Cancel a DRAFT or APPROVED sales return' })
  async cancel(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CancelSalesReturnDto,
  ) {
    return { data: await this.returns.cancel(company, id, body) };
  }
}
