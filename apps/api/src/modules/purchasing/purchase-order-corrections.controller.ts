import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hector/database';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentCompany } from '../companies/decorators/current-company.decorator';
import { ApiCompanyHeader, RequireCompany } from '../companies/decorators/require-company.decorator';
import type { CompanyContext } from '../companies/types/company.types';
import { PurchaseReceivingContract } from './contracts/purchase-receiving.contract';
import { CreatePurchaseOrderCorrectionDto } from './dto/create-purchase-order-correction.dto';
import { CreatePurchaseDiscrepancyDto } from './dto/create-purchase-discrepancy.dto';
import { CloseRemainingPurchaseOrderItemDto } from './dto/close-remaining-purchase-order-item.dto';
import { ShortClosePurchaseOrderItemDto } from './dto/short-close-purchase-order-item.dto';
import { PurchaseOrderCorrectionsService } from './purchase-order-corrections.service';
import { PurchaseDiscrepanciesService } from './purchase-discrepancies.service';

@ApiTags('purchasing-purchase-order-corrections')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('purchasing/purchase-orders/:purchaseOrderId')
export class PurchaseOrderCorrectionsController {
  constructor(
    private readonly corrections: PurchaseOrderCorrectionsService,
    private readonly discrepancies: PurchaseDiscrepanciesService,
    private readonly purchaseReceiving: PurchaseReceivingContract,
  ) {}

  @Get('receiving')
  @RequirePermissions(PERMISSIONS.PURCHASING_READ)
  @ApiOperation({
    summary: 'Canonical purchase receiving progress (Phase 3.5)',
    description:
      'Ordered / posted-received / short / remaining per PO item. Same formulas as warehouse GRN progress.',
  })
  async receivingProgress(
    @CurrentCompany() company: CompanyContext,
    @Param('purchaseOrderId', ParseUUIDPipe) purchaseOrderId: string,
  ) {
    return { data: await this.purchaseReceiving.getReceivingProgress(company, purchaseOrderId) };
  }

  @Get('corrections')
  @RequirePermissions(PERMISSIONS.PURCHASING_READ)
  @ApiOperation({ summary: 'List applied corrections for a purchase order' })
  async listCorrections(
    @CurrentCompany() company: CompanyContext,
    @Param('purchaseOrderId', ParseUUIDPipe) purchaseOrderId: string,
  ) {
    return { data: await this.corrections.list(company, purchaseOrderId) };
  }

  @Post('corrections')
  @RequirePermissions(PERMISSIONS.PURCHASING_PO_CORRECT)
  @ApiOperation({
    summary: 'Apply an explicit commercial correction to a committed PO',
    description:
      'Preserves before/after history. Does not support supplier/SKU/purchaseType mutation. Draft POs use normal edit.',
  })
  async createCorrection(
    @CurrentCompany() company: CompanyContext,
    @Param('purchaseOrderId', ParseUUIDPipe) purchaseOrderId: string,
    @Body() body: CreatePurchaseOrderCorrectionDto,
  ) {
    return { data: await this.corrections.apply(company, purchaseOrderId, body) };
  }

  @Get('discrepancies')
  @RequirePermissions(PERMISSIONS.PURCHASING_READ)
  @ApiOperation({ summary: 'List purchasing discrepancies for a PO' })
  async listDiscrepancies(
    @CurrentCompany() company: CompanyContext,
    @Param('purchaseOrderId', ParseUUIDPipe) purchaseOrderId: string,
  ) {
    return { data: await this.discrepancies.list(company, purchaseOrderId) };
  }

  @Post('discrepancies')
  @RequirePermissions(PERMISSIONS.PURCHASING_DISCREPANCY_MANAGE)
  @ApiOperation({
    summary: 'Record a purchasing discrepancy (does not rewrite ordered quantity)',
  })
  async createDiscrepancy(
    @CurrentCompany() company: CompanyContext,
    @Param('purchaseOrderId', ParseUUIDPipe) purchaseOrderId: string,
    @Body() body: CreatePurchaseDiscrepancyDto,
  ) {
    return { data: await this.discrepancies.record(company, purchaseOrderId, body) };
  }

  @Post('items/:itemId/short-close')
  @RequirePermissions(PERMISSIONS.PURCHASING_PO_SHORT_CLOSE)
  @ApiOperation({
    summary: 'Short-close remaining expected quantity on a PO item',
    description:
      'Increments closedUnfulfilledQuantity (short). Caps by ordered − POSTED received − already short. ' +
      'Serializes with GRN post. Never rewrites ordered quantity. Not a Warehouse receipt / stock.',
  })
  async shortClose(
    @CurrentCompany() company: CompanyContext,
    @Param('purchaseOrderId', ParseUUIDPipe) purchaseOrderId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() body: ShortClosePurchaseOrderItemDto,
  ) {
    return { data: await this.discrepancies.shortClose(company, purchaseOrderId, itemId, body) };
  }

  @Post('items/:itemId/close-remaining')
  @RequirePermissions(PERMISSIONS.PURCHASING_PO_SHORT_CLOSE)
  @ApiOperation({
    summary: 'Close all remaining expected quantity as short (Phase 3.5)',
    description:
      'Server recalculates remaining under PO lock. Prefer this UX over client-supplied quantity.',
  })
  async closeRemaining(
    @CurrentCompany() company: CompanyContext,
    @Param('purchaseOrderId', ParseUUIDPipe) purchaseOrderId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() body: CloseRemainingPurchaseOrderItemDto,
  ) {
    return {
      data: await this.discrepancies.closeRemaining(company, purchaseOrderId, itemId, body),
    };
  }
}
