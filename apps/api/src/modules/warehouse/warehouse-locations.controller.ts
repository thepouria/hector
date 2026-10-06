import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { CreateWarehouseLocationDto } from './dto/create-warehouse-location.dto';
import { ListWarehouseLocationsQueryDto } from './dto/list-warehouse-locations.query.dto';
import { ResolveLocationBarcodeDto } from './dto/resolve-location-barcode.dto';
import { UpdateWarehouseLocationDto } from './dto/update-warehouse-location.dto';
import { WarehouseLocationsService } from './warehouse-locations.service';

@ApiTags('warehouse-locations')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller()
export class WarehouseLocationsController {
  constructor(private readonly locationsService: WarehouseLocationsService) {}

  @Post('warehouse-locations/resolve-barcode')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.WAREHOUSE_READ)
  @ApiOperation({
    summary: 'Resolve a Warehouse Location barcode (company-scoped exact match)',
    description:
      'Warehouse-owned LOC-* barcodes only — not Catalog product barcodes. Returns inactive locations with status for callers to decide eligibility. Never auto-creates.',
  })
  async resolveBarcode(
    @CurrentCompany() company: CompanyContext,
    @Body() body: ResolveLocationBarcodeDto,
  ) {
    const data = await this.locationsService.resolveBarcode(company, body.value);
    return { data };
  }

  @Get('warehouses/:warehouseId/locations')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_READ)
  @ApiOperation({ summary: 'List locations for a warehouse (flat or tree)' })
  async list(
    @CurrentCompany() company: CompanyContext,
    @Param('warehouseId', ParseUUIDPipe) warehouseId: string,
    @Query() query: ListWarehouseLocationsQueryDto,
  ) {
    return this.locationsService.list(company, warehouseId, query);
  }

  @Get('warehouses/:warehouseId/locations/:locationId')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_READ)
  @ApiOperation({ summary: 'Get location detail with breadcrumb' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('warehouseId', ParseUUIDPipe) warehouseId: string,
    @Param('locationId', ParseUUIDPipe) locationId: string,
  ) {
    const data = await this.locationsService.get(company, warehouseId, locationId);
    return { data };
  }

  @Post('warehouses/:warehouseId/locations')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_MANAGE)
  @ApiOperation({ summary: 'Create a warehouse location (server generates LOC-* barcode)' })
  async create(
    @CurrentCompany() company: CompanyContext,
    @Param('warehouseId', ParseUUIDPipe) warehouseId: string,
    @Body() body: CreateWarehouseLocationDto,
  ) {
    const data = await this.locationsService.create(company, warehouseId, body);
    return { data };
  }

  @Patch('warehouses/:warehouseId/locations/:locationId')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_MANAGE)
  @ApiOperation({
    summary: 'Update location metadata / parent / type (not status or barcode)',
  })
  async update(
    @CurrentCompany() company: CompanyContext,
    @Param('warehouseId', ParseUUIDPipe) warehouseId: string,
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Body() body: UpdateWarehouseLocationDto,
  ) {
    const data = await this.locationsService.update(company, warehouseId, locationId, body);
    return { data };
  }

  @Post('warehouses/:warehouseId/locations/:locationId/activate')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_MANAGE)
  @ApiOperation({ summary: 'Activate location (INACTIVE → ACTIVE)' })
  async activate(
    @CurrentCompany() company: CompanyContext,
    @Param('warehouseId', ParseUUIDPipe) warehouseId: string,
    @Param('locationId', ParseUUIDPipe) locationId: string,
  ) {
    const data = await this.locationsService.activate(company, warehouseId, locationId);
    return { data };
  }

  @Post('warehouses/:warehouseId/locations/:locationId/deactivate')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_MANAGE)
  @ApiOperation({
    summary: 'Deactivate location (ACTIVE → INACTIVE)',
    description: 'Blocked while ACTIVE child locations exist.',
  })
  async deactivate(
    @CurrentCompany() company: CompanyContext,
    @Param('warehouseId', ParseUUIDPipe) warehouseId: string,
    @Param('locationId', ParseUUIDPipe) locationId: string,
  ) {
    const data = await this.locationsService.deactivate(company, warehouseId, locationId);
    return { data };
  }
}
