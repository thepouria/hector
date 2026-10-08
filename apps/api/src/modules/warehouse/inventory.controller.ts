import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import { AppError } from '../../common/exceptions/app.error';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentCompany } from '../companies/decorators/current-company.decorator';
import { ApiCompanyHeader, RequireCompany } from '../companies/decorators/require-company.decorator';
import type { CompanyContext } from '../companies/types/company.types';
import {
  InventoryLookupQueryDto,
  ListInventoryBalancesQueryDto,
  ListInventoryMovementsQueryDto,
  WarehouseInventoryQueryDto,
} from './dto/inventory.dto';
import { InventoryLedgerService } from './inventory-ledger.service';
import { InventoryQueryService } from './inventory-query.service';

@ApiTags('inventory')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('warehouse/inventory')
export class InventoryController {
  constructor(
    private readonly inventoryLedger: InventoryLedgerService,
    private readonly inventoryQuery: InventoryQueryService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.WAREHOUSE_STOCK_READ)
  @ApiOperation({
    summary: 'List current On Hand inventory balances (ledger projection)',
    description:
      'On Hand is derived from InventoryMovement ledger. Balance rows are a rebuildable projection — not independently editable. Default hides zero stock; pass includeZero=true to include zeros. Label is On Hand — not Available-to-Sell.',
  })
  async listBalances(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListInventoryBalancesQueryDto,
  ) {
    return this.inventoryQuery.listBalances(company, query);
  }

  @Get('lookup')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_STOCK_READ)
  @ApiOperation({
    summary: 'Lookup On Hand by product barcode or location barcode',
    description:
      'PRODUCT resolves Catalog barcode → SKU summary. LOCATION resolves Warehouse location barcode → location contents. AUTO tries product then location. Leading zeros are preserved.',
  })
  async lookup(
    @CurrentCompany() company: CompanyContext,
    @Query() query: InventoryLookupQueryDto,
  ) {
    const kind = query.kind ?? 'AUTO';
    if (kind === 'PRODUCT') {
      return { data: await this.inventoryQuery.lookupByProductBarcode(company, query.value) };
    }
    if (kind === 'LOCATION') {
      return { data: await this.inventoryQuery.lookupByLocationBarcode(company, query.value) };
    }

    try {
      return { data: await this.inventoryQuery.lookupByProductBarcode(company, query.value) };
    } catch (error) {
      if (
        error instanceof AppError &&
        (error.code === ERROR_CODES.BARCODE_NOT_FOUND ||
          error.code === ERROR_CODES.BARCODE_NOT_ACTIVE)
      ) {
        return {
          data: await this.inventoryQuery.lookupByLocationBarcode(company, query.value),
        };
      }
      throw error;
    }
  }

  // Static path segments before parameterized routes (Nest matches in declaration order).
  @Get('movements')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_STOCK_READ)
  @ApiOperation({
    summary: 'List inventory movement ledger history',
    description: 'Append-only ledger. Posted movements are immutable — no edit/delete.',
  })
  async listMovements(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListInventoryMovementsQueryDto,
  ) {
    return this.inventoryLedger.listMovements(company, query);
  }

  @Get('movements/:movementId')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_STOCK_READ)
  @ApiOperation({ summary: 'Inventory movement detail' })
  async getMovement(
    @CurrentCompany() company: CompanyContext,
    @Param('movementId', ParseUUIDPipe) movementId: string,
  ) {
    const data = await this.inventoryLedger.getMovement(company, movementId);
    return { data };
  }

  @Get('skus/:skuId')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_STOCK_READ)
  @ApiOperation({
    summary: 'SKU On Hand summary with warehouse / batch / location breakdown',
  })
  async getSkuInventory(
    @CurrentCompany() company: CompanyContext,
    @Param('skuId', ParseUUIDPipe) skuId: string,
  ) {
    return { data: await this.inventoryQuery.getSkuSummary(company, skuId) };
  }

  @Get('warehouses/:warehouseId')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_STOCK_READ)
  @ApiOperation({ summary: 'Warehouse On Hand summary (SKU-level preferred)' })
  async getWarehouseInventory(
    @CurrentCompany() company: CompanyContext,
    @Param('warehouseId', ParseUUIDPipe) warehouseId: string,
    @Query() query: WarehouseInventoryQueryDto,
  ) {
    return {
      data: await this.inventoryQuery.getWarehouseSummary(company, warehouseId, query),
    };
  }

  @Get('locations/:locationId')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_STOCK_READ)
  @ApiOperation({ summary: 'Location On Hand contents' })
  async getLocationInventory(
    @CurrentCompany() company: CompanyContext,
    @Param('locationId', ParseUUIDPipe) locationId: string,
  ) {
    return { data: await this.inventoryQuery.getLocationSummary(company, locationId) };
  }

  @Get('batches/:batchId')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_STOCK_READ)
  @ApiOperation({ summary: 'Batch On Hand across warehouses / locations' })
  async getBatchInventory(
    @CurrentCompany() company: CompanyContext,
    @Param('batchId', ParseUUIDPipe) batchId: string,
  ) {
    return { data: await this.inventoryQuery.getBatchSummary(company, batchId) };
  }
}
