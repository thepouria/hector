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
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { DeactivateWarehouseDto } from './dto/deactivate-warehouse.dto';
import { ListWarehousesQueryDto } from './dto/list-warehouses.query.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { WarehousesService } from './warehouses.service';

@ApiTags('warehouses')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('warehouses')
export class WarehousesController {
  constructor(private readonly warehousesService: WarehousesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.WAREHOUSE_READ)
  @ApiOperation({ summary: 'List warehouses for the active company' })
  async list(@CurrentCompany() company: CompanyContext, @Query() query: ListWarehousesQueryDto) {
    return this.warehousesService.list(company, query);
  }

  @Get(':warehouseId')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_READ)
  @ApiOperation({ summary: 'Get warehouse detail' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('warehouseId', ParseUUIDPipe) warehouseId: string,
  ) {
    const data = await this.warehousesService.get(company, warehouseId);
    return { data };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.WAREHOUSE_MANAGE)
  @ApiOperation({ summary: 'Create a warehouse' })
  async create(@CurrentCompany() company: CompanyContext, @Body() body: CreateWarehouseDto) {
    const data = await this.warehousesService.create(company, body);
    return { data };
  }

  @Patch(':warehouseId')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_MANAGE)
  @ApiOperation({ summary: 'Update warehouse metadata (not status/default)' })
  async update(
    @CurrentCompany() company: CompanyContext,
    @Param('warehouseId', ParseUUIDPipe) warehouseId: string,
    @Body() body: UpdateWarehouseDto,
  ) {
    const data = await this.warehousesService.update(company, warehouseId, body);
    return { data };
  }

  @Post(':warehouseId/activate')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_MANAGE)
  @ApiOperation({ summary: 'Activate warehouse (INACTIVE → ACTIVE)' })
  async activate(
    @CurrentCompany() company: CompanyContext,
    @Param('warehouseId', ParseUUIDPipe) warehouseId: string,
  ) {
    const data = await this.warehousesService.activate(company, warehouseId);
    return { data };
  }

  @Post(':warehouseId/deactivate')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_MANAGE)
  @ApiOperation({
    summary: 'Deactivate warehouse (ACTIVE → INACTIVE)',
    description:
      'If deactivating the default while other ACTIVE warehouses exist, replacementWarehouseId is required.',
  })
  async deactivate(
    @CurrentCompany() company: CompanyContext,
    @Param('warehouseId', ParseUUIDPipe) warehouseId: string,
    @Body() body: DeactivateWarehouseDto,
  ) {
    const data = await this.warehousesService.deactivate(company, warehouseId, body);
    return { data };
  }

  @Post(':warehouseId/set-default')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_MANAGE)
  @ApiOperation({ summary: 'Set warehouse as company default (ACTIVE only)' })
  async setDefault(
    @CurrentCompany() company: CompanyContext,
    @Param('warehouseId', ParseUUIDPipe) warehouseId: string,
  ) {
    const data = await this.warehousesService.setDefault(company, warehouseId);
    return { data };
  }
}
