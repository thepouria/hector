import {
  Body,
  Controller,
  Delete,
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
import {
  CreateInventoryAdjustmentDto,
  ListInventoryAdjustmentsQueryDto,
  UpdateInventoryAdjustmentDto,
  UpsertInventoryAdjustmentItemDto,
} from './dto/inventory-adjustment.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { InventoryAdjustmentsService } from './inventory-adjustments.service';
import { WarehouseActivityService } from './warehouse-activity.service';

@ApiTags('inventory-adjustments')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('warehouse/adjustments')
export class InventoryAdjustmentsController {
  constructor(
    private readonly inventoryAdjustmentsService: InventoryAdjustmentsService,
    private readonly warehouseActivity: WarehouseActivityService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.WAREHOUSE_ADJUSTMENT_READ)
  @ApiOperation({ summary: 'List inventory adjustments' })
  async list(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListInventoryAdjustmentsQueryDto,
  ) {
    return this.inventoryAdjustmentsService.list(company, query);
  }

  @Get(':adjustmentId/activity')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_ADJUSTMENT_READ)
  @ApiOperation({ summary: 'Business activity timeline for an inventory adjustment' })
  async activity(
    @CurrentCompany() company: CompanyContext,
    @Param('adjustmentId', ParseUUIDPipe) adjustmentId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.warehouseActivity.listForEntity(
      company,
      'INVENTORY_ADJUSTMENT',
      adjustmentId,
      query,
    );
  }

  @Get(':adjustmentId')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_ADJUSTMENT_READ)
  @ApiOperation({ summary: 'Inventory adjustment detail' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('adjustmentId', ParseUUIDPipe) adjustmentId: string,
  ) {
    const data = await this.inventoryAdjustmentsService.get(company, adjustmentId);
    return { data };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.WAREHOUSE_ADJUSTMENT_CREATE)
  @ApiOperation({ summary: 'Create DRAFT inventory adjustment' })
  async create(
    @CurrentCompany() company: CompanyContext,
    @Body() body: CreateInventoryAdjustmentDto,
  ) {
    const data = await this.inventoryAdjustmentsService.create(company, body);
    return { data };
  }

  @Patch(':adjustmentId')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_ADJUSTMENT_UPDATE)
  @ApiOperation({ summary: 'Update DRAFT inventory adjustment' })
  async update(
    @CurrentCompany() company: CompanyContext,
    @Param('adjustmentId', ParseUUIDPipe) adjustmentId: string,
    @Body() body: UpdateInventoryAdjustmentDto,
  ) {
    const data = await this.inventoryAdjustmentsService.update(company, adjustmentId, body);
    return { data };
  }

  @Post(':adjustmentId/items')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_ADJUSTMENT_UPDATE)
  @ApiOperation({ summary: 'Upsert DRAFT adjustment item' })
  async upsertItem(
    @CurrentCompany() company: CompanyContext,
    @Param('adjustmentId', ParseUUIDPipe) adjustmentId: string,
    @Body() body: UpsertInventoryAdjustmentItemDto,
  ) {
    const data = await this.inventoryAdjustmentsService.upsertItem(company, adjustmentId, body);
    return { data };
  }

  @Delete(':adjustmentId/items/:itemId')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_ADJUSTMENT_UPDATE)
  @ApiOperation({ summary: 'Remove DRAFT adjustment item' })
  async removeItem(
    @CurrentCompany() company: CompanyContext,
    @Param('adjustmentId', ParseUUIDPipe) adjustmentId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    const data = await this.inventoryAdjustmentsService.removeItem(
      company,
      adjustmentId,
      itemId,
    );
    return { data };
  }

  @Post(':adjustmentId/submit')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_ADJUSTMENT_UPDATE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit DRAFT adjustment for approval' })
  async submit(
    @CurrentCompany() company: CompanyContext,
    @Param('adjustmentId', ParseUUIDPipe) adjustmentId: string,
  ) {
    const data = await this.inventoryAdjustmentsService.submit(company, adjustmentId);
    return { data };
  }

  @Post(':adjustmentId/approve')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_ADJUSTMENT_APPROVE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve PENDING_APPROVAL adjustment' })
  async approve(
    @CurrentCompany() company: CompanyContext,
    @Param('adjustmentId', ParseUUIDPipe) adjustmentId: string,
  ) {
    const data = await this.inventoryAdjustmentsService.approve(company, adjustmentId);
    return { data };
  }

  @Post(':adjustmentId/reject')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_ADJUSTMENT_APPROVE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject PENDING_APPROVAL adjustment' })
  async reject(
    @CurrentCompany() company: CompanyContext,
    @Param('adjustmentId', ParseUUIDPipe) adjustmentId: string,
  ) {
    const data = await this.inventoryAdjustmentsService.reject(company, adjustmentId);
    return { data };
  }

  @Post(':adjustmentId/post')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_ADJUSTMENT_POST)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Post APPROVED adjustment (ADJUSTMENT_IN/OUT via Ledger)' })
  async post(
    @CurrentCompany() company: CompanyContext,
    @Param('adjustmentId', ParseUUIDPipe) adjustmentId: string,
  ) {
    const data = await this.inventoryAdjustmentsService.post(company, adjustmentId);
    return { data };
  }

  @Post(':adjustmentId/cancel')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_ADJUSTMENT_CANCEL)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel DRAFT/PENDING adjustment (no inventory effect)' })
  async cancel(
    @CurrentCompany() company: CompanyContext,
    @Param('adjustmentId', ParseUUIDPipe) adjustmentId: string,
  ) {
    const data = await this.inventoryAdjustmentsService.cancel(company, adjustmentId);
    return { data };
  }
}
