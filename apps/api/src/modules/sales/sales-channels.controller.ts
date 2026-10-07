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
import { CreateSalesChannelDto } from './dto/create-sales-channel.dto';
import { ListSalesChannelsQueryDto } from './dto/list-sales-channels.query.dto';
import { UpdateSalesChannelDto } from './dto/update-sales-channel.dto';
import { SalesChannelsService } from './sales-channels.service';

@ApiTags('sales-channels')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('sales/channels')
export class SalesChannelsController {
  constructor(private readonly salesChannelsService: SalesChannelsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SALES_CHANNELS_READ)
  @ApiOperation({ summary: 'List sales channels' })
  async list(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListSalesChannelsQueryDto,
  ) {
    return this.salesChannelsService.list(company, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.SALES_CHANNELS_READ)
  @ApiOperation({ summary: 'Get sales channel by id' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.salesChannelsService.get(company, id);
    return { data };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SALES_CHANNELS_MANAGE)
  @ApiOperation({ summary: 'Create a sales channel' })
  async create(
    @CurrentCompany() company: CompanyContext,
    @Body() body: CreateSalesChannelDto,
  ) {
    const data = await this.salesChannelsService.create(company, body);
    return { data };
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.SALES_CHANNELS_MANAGE)
  @ApiOperation({ summary: 'Update sales channel metadata (not status)' })
  async update(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateSalesChannelDto,
  ) {
    const data = await this.salesChannelsService.update(company, id, body);
    return { data };
  }

  @Post(':id/activate')
  @RequirePermissions(PERMISSIONS.SALES_CHANNELS_MANAGE)
  @ApiOperation({ summary: 'Activate sales channel (INACTIVE → ACTIVE)' })
  async activate(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.salesChannelsService.activate(company, id);
    return { data };
  }

  @Post(':id/deactivate')
  @RequirePermissions(PERMISSIONS.SALES_CHANNELS_MANAGE)
  @ApiOperation({ summary: 'Deactivate sales channel (ACTIVE → INACTIVE)' })
  async deactivate(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.salesChannelsService.deactivate(company, id);
    return { data };
  }
}
