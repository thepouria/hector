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
  CreateStockTransferDto,
  ListStockTransfersQueryDto,
  ScanApplyStockTransferDto,
  UpdateStockTransferDto,
  UpsertStockTransferItemDto,
} from './dto/stock-transfer.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { StockTransfersService } from './stock-transfers.service';
import { WarehouseActivityService } from './warehouse-activity.service';

@ApiTags('stock-transfers')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('warehouse/transfers')
export class StockTransfersController {
  constructor(
    private readonly stockTransfersService: StockTransfersService,
    private readonly warehouseActivity: WarehouseActivityService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.WAREHOUSE_TRANSFER_READ)
  @ApiOperation({ summary: 'List internal stock transfers' })
  async list(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListStockTransfersQueryDto,
  ) {
    return this.stockTransfersService.list(company, query);
  }

  @Get(':transferId/activity')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_TRANSFER_READ)
  @ApiOperation({ summary: 'Business activity timeline for a stock transfer' })
  async activity(
    @CurrentCompany() company: CompanyContext,
    @Param('transferId', ParseUUIDPipe) transferId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.warehouseActivity.listForEntity(company, 'STOCK_TRANSFER', transferId, query);
  }

  @Get(':transferId')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_TRANSFER_READ)
  @ApiOperation({ summary: 'Stock transfer detail' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('transferId', ParseUUIDPipe) transferId: string,
  ) {
    const data = await this.stockTransfersService.get(company, transferId);
    return { data };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.WAREHOUSE_TRANSFER_MANAGE)
  @ApiOperation({
    summary: 'Create DRAFT stock transfer',
    description: 'Does not create InventoryMovement or change StockBalance.',
  })
  async create(
    @CurrentCompany() company: CompanyContext,
    @Body() body: CreateStockTransferDto,
  ) {
    const data = await this.stockTransfersService.create(company, body);
    return { data };
  }

  @Patch(':transferId')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_TRANSFER_MANAGE)
  @ApiOperation({
    summary: 'Update DRAFT transfer (header/items). Status cannot be set via PATCH.',
  })
  async update(
    @CurrentCompany() company: CompanyContext,
    @Param('transferId', ParseUUIDPipe) transferId: string,
    @Body() body: UpdateStockTransferDto,
  ) {
    const data = await this.stockTransfersService.update(company, transferId, body);
    return { data };
  }

  @Post(':transferId/items')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_TRANSFER_MANAGE)
  @ApiOperation({ summary: 'Upsert DRAFT transfer item (optional quantity increment)' })
  async upsertItem(
    @CurrentCompany() company: CompanyContext,
    @Param('transferId', ParseUUIDPipe) transferId: string,
    @Body() body: UpsertStockTransferItemDto,
  ) {
    const data = await this.stockTransfersService.upsertItem(company, transferId, body);
    return { data };
  }

  @Delete(':transferId/items/:itemId')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_TRANSFER_MANAGE)
  @ApiOperation({ summary: 'Remove DRAFT transfer item' })
  async removeItem(
    @CurrentCompany() company: CompanyContext,
    @Param('transferId', ParseUUIDPipe) transferId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    const data = await this.stockTransfersService.removeItem(company, transferId, itemId);
    return { data };
  }

  @Post(':transferId/scan-apply')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_TRANSFER_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Scanner-friendly DRAFT line upsert (idempotent by requestId)',
    description:
      'Resolves product + location barcodes; increments quantity for matching position lines.',
  })
  async scanApply(
    @CurrentCompany() company: CompanyContext,
    @Param('transferId', ParseUUIDPipe) transferId: string,
    @Body() body: ScanApplyStockTransferDto,
  ) {
    const data = await this.stockTransfersService.scanApply(company, transferId, body);
    return { data };
  }

  @Post(':transferId/dispatch')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_TRANSFER_DISPATCH)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Dispatch transfer (source → transit)',
    description:
      'Posts TRANSFER_OUT at source and TRANSFER_IN at system transit for every item atomically.',
  })
  async dispatch(
    @CurrentCompany() company: CompanyContext,
    @Param('transferId', ParseUUIDPipe) transferId: string,
  ) {
    const data = await this.stockTransfersService.dispatch(company, transferId);
    return { data };
  }

  @Post(':transferId/complete')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_TRANSFER_COMPLETE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete transfer (transit → destination)',
    description: 'Idempotent if already COMPLETED.',
  })
  async complete(
    @CurrentCompany() company: CompanyContext,
    @Param('transferId', ParseUUIDPipe) transferId: string,
  ) {
    const data = await this.stockTransfersService.complete(company, transferId);
    return { data };
  }

  @Post(':transferId/cancel')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_TRANSFER_CANCEL)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel DRAFT (no stock) or IN_TRANSIT (return transit → source)',
    description: 'COMPLETED cannot be cancelled. Create a reverse transfer instead.',
  })
  async cancel(
    @CurrentCompany() company: CompanyContext,
    @Param('transferId', ParseUUIDPipe) transferId: string,
  ) {
    const data = await this.stockTransfersService.cancel(company, transferId);
    return { data };
  }
}
