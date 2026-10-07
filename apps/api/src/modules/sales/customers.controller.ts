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
import { CreateCustomerAddressDto } from './dto/create-customer-address.dto';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { ListCustomersQueryDto } from './dto/list-customers.query.dto';
import { UpdateCustomerAddressDto } from './dto/update-customer-address.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomersService } from './customers.service';

@ApiTags('sales-customers')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('sales/customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SALES_CUSTOMERS_READ)
  @ApiOperation({ summary: 'List customers' })
  async list(@CurrentCompany() company: CompanyContext, @Query() query: ListCustomersQueryDto) {
    return this.customersService.list(company, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.SALES_CUSTOMERS_READ)
  @ApiOperation({ summary: 'Get customer detail with active addresses' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.customersService.get(company, id);
    return { data };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SALES_CUSTOMERS_MANAGE)
  @ApiOperation({ summary: 'Create a customer (type + displayName required)' })
  async create(@CurrentCompany() company: CompanyContext, @Body() body: CreateCustomerDto) {
    const data = await this.customersService.create(company, body);
    return { data };
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.SALES_CUSTOMERS_MANAGE)
  @ApiOperation({ summary: 'Update customer metadata (not status)' })
  async update(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateCustomerDto,
  ) {
    const data = await this.customersService.update(company, id, body);
    return { data };
  }

  @Post(':id/activate')
  @RequirePermissions(PERMISSIONS.SALES_CUSTOMERS_MANAGE)
  @ApiOperation({ summary: 'Activate customer (INACTIVE → ACTIVE)' })
  async activate(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.customersService.activate(company, id);
    return { data };
  }

  @Post(':id/deactivate')
  @RequirePermissions(PERMISSIONS.SALES_CUSTOMERS_MANAGE)
  @ApiOperation({ summary: 'Deactivate customer (ACTIVE → INACTIVE)' })
  async deactivate(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.customersService.deactivate(company, id);
    return { data };
  }

  @Post(':id/addresses')
  @RequirePermissions(PERMISSIONS.SALES_CUSTOMERS_MANAGE)
  @ApiOperation({ summary: 'Add a customer address' })
  async createAddress(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateCustomerAddressDto,
  ) {
    const data = await this.customersService.createAddress(company, id, body);
    return { data };
  }

  @Patch(':id/addresses/:addressId')
  @RequirePermissions(PERMISSIONS.SALES_CUSTOMERS_MANAGE)
  @ApiOperation({ summary: 'Update a customer address' })
  async updateAddress(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('addressId', ParseUUIDPipe) addressId: string,
    @Body() body: UpdateCustomerAddressDto,
  ) {
    const data = await this.customersService.updateAddress(company, id, addressId, body);
    return { data };
  }

  @Post(':id/addresses/:addressId/set-default')
  @RequirePermissions(PERMISSIONS.SALES_CUSTOMERS_MANAGE)
  @ApiOperation({ summary: 'Set address as default (atomic)' })
  async setDefaultAddress(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('addressId', ParseUUIDPipe) addressId: string,
  ) {
    const data = await this.customersService.setDefaultAddress(company, id, addressId);
    return { data };
  }

  @Post(':id/addresses/:addressId/archive')
  @RequirePermissions(PERMISSIONS.SALES_CUSTOMERS_MANAGE)
  @ApiOperation({ summary: 'Archive a customer address' })
  async archiveAddress(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('addressId', ParseUUIDPipe) addressId: string,
  ) {
    const data = await this.customersService.archiveAddress(company, id, addressId);
    return { data };
  }
}
