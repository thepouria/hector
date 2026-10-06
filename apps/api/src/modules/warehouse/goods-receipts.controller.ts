import {
  Body,
  Controller,
  Delete,
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
import { CancelGoodsReceiptDto } from './dto/cancel-goods-receipt.dto';
import { CreateGoodsReceiptDto } from './dto/create-goods-receipt.dto';
import {
  AddGoodsReceiptItemDto,
  UpdateGoodsReceiptItemDto,
} from './dto/goods-receipt-item.dto';
import { ListGoodsReceiptsQueryDto } from './dto/list-goods-receipts.query.dto';
import {
  UpdateGoodsReceiptItemBatchDto,
  UpsertGoodsReceiptItemBatchDto,
} from './dto/batch.dto';
import {
  ScanApplyGoodsReceiptDto,
  ScanResolveGoodsReceiptDto,
} from './dto/scan-goods-receipt.dto';
import { UpdateGoodsReceiptDto } from './dto/update-goods-receipt.dto';
import { GoodsReceiptsService } from './goods-receipts.service';
import { WarehouseActivityService } from './warehouse-activity.service';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

@ApiTags('goods-receipts')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('goods-receipts')
export class GoodsReceiptsController {
  constructor(
    private readonly goodsReceiptsService: GoodsReceiptsService,
    private readonly warehouseActivity: WarehouseActivityService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.WAREHOUSE_RECEIPT_READ)
  @ApiOperation({ summary: 'List goods receipts for the active company' })
  async list(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListGoodsReceiptsQueryDto,
  ) {
    return this.goodsReceiptsService.list(company, query);
  }

  @Get('eligible-purchase-orders')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_RECEIPT_READ)
  @ApiOperation({
    summary: 'List ORDERED / PARTIALLY_RECEIVED purchase orders eligible for receiving',
  })
  async listEligiblePurchaseOrders(@CurrentCompany() company: CompanyContext) {
    return this.goodsReceiptsService.listEligiblePurchaseOrders(company);
  }

  @Get('purchase-orders/:purchaseOrderId/progress')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_RECEIPT_READ)
  @ApiOperation({ summary: 'Receiving progress for a purchase order (posted quantities only)' })
  async receivingProgress(
    @CurrentCompany() company: CompanyContext,
    @Param('purchaseOrderId', ParseUUIDPipe) purchaseOrderId: string,
  ) {
    const data = await this.goodsReceiptsService.getPurchaseOrderReceivingProgress(
      company,
      purchaseOrderId,
    );
    return { data };
  }

  @Get(':goodsReceiptId/activity')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_RECEIPT_READ)
  @ApiOperation({
    summary: 'Business activity timeline for a goods receipt',
    description: 'Company-scoped Audit projection. Raw audit remains GET /audit-logs.',
  })
  async activity(
    @CurrentCompany() company: CompanyContext,
    @Param('goodsReceiptId', ParseUUIDPipe) goodsReceiptId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.warehouseActivity.listForEntity(company, 'GOODS_RECEIPT', goodsReceiptId, query);
  }

  @Get(':goodsReceiptId')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_RECEIPT_READ)
  @ApiOperation({ summary: 'Get goods receipt detail' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('goodsReceiptId', ParseUUIDPipe) goodsReceiptId: string,
  ) {
    const data = await this.goodsReceiptsService.get(company, goodsReceiptId);
    return { data };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.WAREHOUSE_RECEIPT_MANAGE)
  @ApiOperation({ summary: 'Create a DRAFT goods receipt (optionally with items)' })
  async create(@CurrentCompany() company: CompanyContext, @Body() body: CreateGoodsReceiptDto) {
    const data = await this.goodsReceiptsService.create(company, body);
    return { data };
  }

  @Patch(':goodsReceiptId')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_RECEIPT_MANAGE)
  @ApiOperation({ summary: 'Update DRAFT goods receipt header (notes / receivedAt)' })
  async update(
    @CurrentCompany() company: CompanyContext,
    @Param('goodsReceiptId', ParseUUIDPipe) goodsReceiptId: string,
    @Body() body: UpdateGoodsReceiptDto,
  ) {
    const data = await this.goodsReceiptsService.update(company, goodsReceiptId, body);
    return { data };
  }

  @Post(':goodsReceiptId/scan/resolve')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_RECEIPT_MANAGE)
  @ApiOperation({
    summary: 'Resolve barcode for DRAFT GRN scanner receiving (no mutation)',
    description:
      'Uses Catalog exact barcode resolution within the company, then matches SKU to the GRN purchase order. Returns structured status for unknown / wrong-SKU / capacity outcomes.',
  })
  async scanResolve(
    @CurrentCompany() company: CompanyContext,
    @Param('goodsReceiptId', ParseUUIDPipe) goodsReceiptId: string,
    @Body() body: ScanResolveGoodsReceiptDto,
  ) {
    const data = await this.goodsReceiptsService.scanResolve(company, goodsReceiptId, body);
    return { data };
  }

  @Post(':goodsReceiptId/scan/apply')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_RECEIPT_MANAGE)
  @ApiOperation({
    summary: 'Apply barcode scan to DRAFT GRN (atomic increment / create item)',
    description:
      'Server derives barcode → SKU → PO item. Optional requestId makes retries idempotent. Does not post the GRN or create inventory movements.',
  })
  async scanApply(
    @CurrentCompany() company: CompanyContext,
    @Param('goodsReceiptId', ParseUUIDPipe) goodsReceiptId: string,
    @Body() body: ScanApplyGoodsReceiptDto,
  ) {
    const data = await this.goodsReceiptsService.scanApply(company, goodsReceiptId, body);
    return { data };
  }

  @Post(':goodsReceiptId/items')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_RECEIPT_MANAGE)
  @ApiOperation({ summary: 'Add an item to a DRAFT goods receipt' })
  async addItem(
    @CurrentCompany() company: CompanyContext,
    @Param('goodsReceiptId', ParseUUIDPipe) goodsReceiptId: string,
    @Body() body: AddGoodsReceiptItemDto,
  ) {
    const data = await this.goodsReceiptsService.addItem(company, goodsReceiptId, body);
    return { data };
  }

  @Patch(':goodsReceiptId/items/:itemId')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_RECEIPT_MANAGE)
  @ApiOperation({ summary: 'Update a DRAFT goods receipt item' })
  async updateItem(
    @CurrentCompany() company: CompanyContext,
    @Param('goodsReceiptId', ParseUUIDPipe) goodsReceiptId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() body: UpdateGoodsReceiptItemDto,
  ) {
    const data = await this.goodsReceiptsService.updateItem(
      company,
      goodsReceiptId,
      itemId,
      body,
    );
    return { data };
  }

  @Delete(':goodsReceiptId/items/:itemId')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_RECEIPT_MANAGE)
  @ApiOperation({ summary: 'Remove an item from a DRAFT goods receipt' })
  async removeItem(
    @CurrentCompany() company: CompanyContext,
    @Param('goodsReceiptId', ParseUUIDPipe) goodsReceiptId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    const data = await this.goodsReceiptsService.removeItem(company, goodsReceiptId, itemId);
    return { data };
  }

  @Post(':goodsReceiptId/items/:itemId/batches')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_RECEIPT_MANAGE)
  @ApiOperation({
    summary: 'Upsert batch allocation on a DRAFT GRN item',
    description:
      'Select existing batchId or find-or-create by supplierBatchNumber for the item SKU. Consolidates same batch into one row. Does not create inventory.',
  })
  async upsertItemBatch(
    @CurrentCompany() company: CompanyContext,
    @Param('goodsReceiptId', ParseUUIDPipe) goodsReceiptId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() body: UpsertGoodsReceiptItemBatchDto,
  ) {
    const data = await this.goodsReceiptsService.upsertItemBatch(
      company,
      goodsReceiptId,
      itemId,
      body,
    );
    return { data };
  }

  @Patch(':goodsReceiptId/items/:itemId/batches/:allocationId')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_RECEIPT_MANAGE)
  @ApiOperation({ summary: 'Update DRAFT batch allocation quantity' })
  async updateItemBatch(
    @CurrentCompany() company: CompanyContext,
    @Param('goodsReceiptId', ParseUUIDPipe) goodsReceiptId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Param('allocationId', ParseUUIDPipe) allocationId: string,
    @Body() body: UpdateGoodsReceiptItemBatchDto,
  ) {
    const data = await this.goodsReceiptsService.updateItemBatch(
      company,
      goodsReceiptId,
      itemId,
      allocationId,
      body,
    );
    return { data };
  }

  @Delete(':goodsReceiptId/items/:itemId/batches/:allocationId')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_RECEIPT_MANAGE)
  @ApiOperation({ summary: 'Remove DRAFT batch allocation' })
  async removeItemBatch(
    @CurrentCompany() company: CompanyContext,
    @Param('goodsReceiptId', ParseUUIDPipe) goodsReceiptId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Param('allocationId', ParseUUIDPipe) allocationId: string,
  ) {
    const data = await this.goodsReceiptsService.removeItemBatch(
      company,
      goodsReceiptId,
      itemId,
      allocationId,
    );
    return { data };
  }

  @Post(':goodsReceiptId/post')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_RECEIPT_POST)
  @ApiOperation({
    summary: 'Post DRAFT goods receipt as physical receipt fact',
    description:
      'Atomic: validates over-receipt with PO lock, validates full batch allocation per item, marks POSTED, updates purchase receiving status. No inventory movement yet.',
  })
  async post(
    @CurrentCompany() company: CompanyContext,
    @Param('goodsReceiptId', ParseUUIDPipe) goodsReceiptId: string,
  ) {
    const data = await this.goodsReceiptsService.post(company, goodsReceiptId);
    return { data };
  }

  @Post(':goodsReceiptId/cancel')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_RECEIPT_MANAGE)
  @ApiOperation({ summary: 'Cancel a DRAFT goods receipt (POSTED cannot be cancelled in 3.4)' })
  async cancel(
    @CurrentCompany() company: CompanyContext,
    @Param('goodsReceiptId', ParseUUIDPipe) goodsReceiptId: string,
    @Body() body: CancelGoodsReceiptDto,
  ) {
    const data = await this.goodsReceiptsService.cancel(company, goodsReceiptId, body);
    return { data };
  }
}
