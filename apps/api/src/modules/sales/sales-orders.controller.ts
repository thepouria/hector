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
import { CancelSalesOrderDto } from './dto/cancel-sales-order.dto';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { ListSalesOrdersQueryDto } from './dto/list-sales-orders.query.dto';
import { ReserveSalesOrderDto } from './dto/reserve-sales-order.dto';
import { CancelSalesOrderItemDto } from './dto/sales-order-item.dto';
import { UpdateSalesOrderDto } from './dto/update-sales-order.dto';
import { SalesOrdersService } from './sales-orders.service';
import { SalesReservationsService } from './sales-reservations.service';

@ApiTags('sales-orders')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('sales/orders')
export class SalesOrdersController {
  constructor(
    private readonly orders: SalesOrdersService,
    private readonly reservations: SalesReservationsService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SALES_ORDERS_READ)
  @ApiOperation({ summary: 'List sales orders' })
  async list(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListSalesOrdersQueryDto,
  ) {
    return this.orders.list(company, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SALES_ORDERS_CREATE)
  @ApiOperation({
    summary: 'Create a DRAFT sales order',
    description: 'Commercial draft only. Does not reserve stock or create receivables.',
  })
  async create(
    @CurrentCompany() company: CompanyContext,
    @Body() body: CreateSalesOrderDto,
  ) {
    return { data: await this.orders.create(company, body) };
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.SALES_ORDERS_READ)
  @ApiOperation({
    summary: 'Get sales order detail',
    description:
      'Includes derived per-item quantities, reservationSummary, fulfillmentSummary, and financeSummary (CustomerReceivable by salesOrderId).',
  })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.orders.get(company, id) };
  }

  @Get(':id/finance')
  @RequirePermissions(PERMISSIONS.SALES_ORDERS_READ)
  @ApiOperation({
    summary: 'Get Finance receivables linked to a sales order',
    description: 'Read-only CustomerReceivable rows for this order. Settlement is Phase 6.',
  })
  async getFinance(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.orders.getFinance(company, id) };
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.SALES_ORDERS_MANAGE)
  @ApiOperation({ summary: 'Update a DRAFT sales order' })
  async update(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateSalesOrderDto,
  ) {
    return { data: await this.orders.update(company, id, body) };
  }

  @Post(':id/confirm')
  @RequirePermissions(PERMISSIONS.SALES_ORDERS_CONFIRM)
  @ApiOperation({
    summary: 'Confirm a DRAFT sales order',
    description:
      'Locks commercial facts, then best-effort reserves inventory (partial OK).',
  })
  async confirm(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.orders.confirm(company, id) };
  }

  @Post(':id/reserve')
  @RequirePermissions(PERMISSIONS.SALES_ORDERS_RESERVE)
  @ApiOperation({
    summary: 'Reserve inventory for a confirmed sales order',
    description: 'Partial reserve when available is insufficient. Moves CONFIRMED → PROCESSING.',
  })
  async reserve(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReserveSalesOrderDto,
  ) {
    return { data: await this.reservations.reserveOrder(company, id, body) };
  }

  @Get(':id/reservations')
  @RequirePermissions(PERMISSIONS.SALES_ORDERS_READ)
  @ApiOperation({ summary: 'List inventory reservations for a sales order' })
  async listReservations(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reservations.list(company, id);
  }

  @Post(':id/reservations/release')
  @RequirePermissions(PERMISSIONS.SALES_ORDERS_RESERVE)
  @ApiOperation({ summary: 'Release all ACTIVE reservations for a sales order' })
  async releaseReservations(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.reservations.releaseAll(company, id) };
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.SALES_ORDERS_CANCEL)
  @ApiOperation({ summary: 'Cancel a sales order (remaining open quantities)' })
  async cancel(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CancelSalesOrderDto,
  ) {
    return { data: await this.orders.cancel(company, id, body) };
  }

  @Post(':id/items/:itemId/cancel')
  @RequirePermissions(PERMISSIONS.SALES_ORDERS_CANCEL)
  @ApiOperation({ summary: 'Cancel a partial quantity on a sales order item' })
  async cancelItem(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() body: CancelSalesOrderItemDto,
  ) {
    return { data: await this.orders.cancelItem(company, id, itemId, body) };
  }
}
