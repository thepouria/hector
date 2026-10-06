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
  AdjustInventoryReservationDto,
  AvailabilityQueryDto,
  BulkAvailabilityDto,
  CreateInventoryReservationDto,
  ListInventoryReservationsQueryDto,
  ReleaseInventoryReservationDto,
} from './dto/inventory-reservation.dto';
import { InventoryReservationsService } from './inventory-reservations.service';

@ApiTags('inventory-reservations')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('warehouse')
export class InventoryReservationsController {
  constructor(private readonly reservations: InventoryReservationsService) {}

  @Get('availability')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_RESERVATION_READ)
  @ApiOperation({
    summary: 'SELLABLE availability (On Hand / Reserved / Available)',
  })
  async availability(
    @CurrentCompany() company: CompanyContext,
    @Query() query: AvailabilityQueryDto,
  ) {
    return {
      data: await this.reservations.getAvailability(
        company,
        query.warehouseId,
        query.skuId,
      ),
    };
  }

  @Post('availability/bulk')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_RESERVATION_READ)
  @ApiOperation({ summary: 'Bulk SELLABLE availability lookup' })
  async bulkAvailability(
    @CurrentCompany() company: CompanyContext,
    @Body() body: BulkAvailabilityDto,
  ) {
    return this.reservations.bulkAvailability(company, body.items);
  }

  @Post('reservations')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_RESERVATION_MANAGE)
  @ApiOperation({
    summary: 'Create SELLABLE inventory reservation (no InventoryMovement)',
  })
  async create(
    @CurrentCompany() company: CompanyContext,
    @Body() body: CreateInventoryReservationDto,
  ) {
    return {
      data: await this.reservations.create(company, body),
    };
  }

  @Get('reservations')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_RESERVATION_READ)
  @ApiOperation({ summary: 'List inventory reservations' })
  async list(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListInventoryReservationsQueryDto,
  ) {
    return this.reservations.list(company, query);
  }

  @Get('reservations/:id')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_RESERVATION_READ)
  @ApiOperation({ summary: 'Get reservation' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.reservations.get(company, id) };
  }

  @Post('reservations/:id/release')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_RESERVATION_MANAGE)
  @ApiOperation({ summary: 'Release reservation (full or partial)' })
  async release(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReleaseInventoryReservationDto,
  ) {
    return { data: await this.reservations.release(company, id, body.quantity) };
  }

  @Post('reservations/:id/increase')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_RESERVATION_MANAGE)
  @ApiOperation({ summary: 'Increase ACTIVE reservation if available' })
  async increase(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AdjustInventoryReservationDto,
  ) {
    return { data: await this.reservations.increase(company, id, body.quantity) };
  }

  @Post('reservations/:id/expire')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_RESERVATION_MANAGE)
  @ApiOperation({ summary: 'Expire ACTIVE reservation (foundation; no scheduler)' })
  async expire(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.reservations.expire(company, id) };
  }
}
