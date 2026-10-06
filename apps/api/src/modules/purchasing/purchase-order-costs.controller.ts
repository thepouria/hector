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
import { CreatePurchaseOrderCostDto } from './dto/create-purchase-order-cost.dto';
import { ListPurchaseOrderCostsQueryDto } from './dto/list-purchase-order-costs.query.dto';
import { UpdatePurchaseOrderCostDto } from './dto/update-purchase-order-cost.dto';
import { VoidPurchaseOrderCostDto } from './dto/void-purchase-order-cost.dto';
import {
  AllocatePurchaseCostBodyDto,
  PreviewPurchaseCostAllocationBodyDto,
  SetPurchaseCostTreatmentBodyDto,
} from './dto/purchase-cost-finance.dto';
import { PurchaseOrderCostFinanceService } from './purchase-order-cost-finance.service';
import { PurchaseOrderCostsService } from './purchase-order-costs.service';

/**
 * Purchase Order Costs (Phase 2.8 + Phase 4.7 financialization).
 */
@ApiTags('purchasing-purchase-order-costs')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('purchasing/purchase-orders/:purchaseOrderId/costs')
export class PurchaseOrderCostsController {
  constructor(
    private readonly costs: PurchaseOrderCostsService,
    private readonly costFinance: PurchaseOrderCostFinanceService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PURCHASING_READ)
  @ApiOperation({
    summary: 'List purchase costs for a PO with ACTIVE totals by currency',
    description:
      'referenceAcquisitionTotal is present only when merchandise and ACTIVE costs share one currency.',
  })
  async list(
    @CurrentCompany() company: CompanyContext,
    @Param('purchaseOrderId', ParseUUIDPipe) purchaseOrderId: string,
    @Query() query: ListPurchaseOrderCostsQueryDto,
  ) {
    return this.costs.list(company, purchaseOrderId, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  @ApiOperation({
    summary: 'Add a purchase cost (DRAFT / APPROVED / ORDERED)',
    description:
      'Costs may be appended after confirmation when discovered later. Does not mark paid or allocate to stock.',
  })
  async create(
    @CurrentCompany() company: CompanyContext,
    @Param('purchaseOrderId', ParseUUIDPipe) purchaseOrderId: string,
    @Body() body: CreatePurchaseOrderCostDto,
  ) {
    const data = await this.costs.create(company, purchaseOrderId, body);
    return { data };
  }

  @Patch(':costId')
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  @ApiOperation({
    summary: 'Update a DRAFT PO cost',
    description: 'After APPROVED/ORDERED, use void + create instead of silent rewrite.',
  })
  async update(
    @CurrentCompany() company: CompanyContext,
    @Param('purchaseOrderId', ParseUUIDPipe) purchaseOrderId: string,
    @Param('costId', ParseUUIDPipe) costId: string,
    @Body() body: UpdatePurchaseOrderCostDto,
  ) {
    const data = await this.costs.update(company, purchaseOrderId, costId, body);
    return { data };
  }

  @Delete(':costId')
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  @ApiOperation({ summary: 'Hard-delete a cost on a DRAFT PO only' })
  async remove(
    @CurrentCompany() company: CompanyContext,
    @Param('purchaseOrderId', ParseUUIDPipe) purchaseOrderId: string,
    @Param('costId', ParseUUIDPipe) costId: string,
  ) {
    const data = await this.costs.removeDraft(company, purchaseOrderId, costId);
    return { data };
  }

  @Post(':costId/void')
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  @ApiOperation({
    summary: 'Void an ACTIVE cost (append-oriented correction)',
    description: 'Requires reason. Voided rows remain for history and are excluded from ACTIVE totals.',
  })
  async void(
    @CurrentCompany() company: CompanyContext,
    @Param('purchaseOrderId', ParseUUIDPipe) purchaseOrderId: string,
    @Param('costId', ParseUUIDPipe) costId: string,
    @Body() body: VoidPurchaseOrderCostDto,
  ) {
    const data = await this.costs.void(company, purchaseOrderId, costId, body);
    return { data };
  }

  @Post(':costId/set-treatment')
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  @ApiOperation({
    summary: 'Set CAPITALIZABLE or PERIOD_EXPENSE treatment (immutable once set)',
  })
  async setTreatment(
    @CurrentCompany() company: CompanyContext,
    @Param('purchaseOrderId', ParseUUIDPipe) purchaseOrderId: string,
    @Param('costId', ParseUUIDPipe) costId: string,
    @Body() body: SetPurchaseCostTreatmentBodyDto,
  ) {
    const data = await this.costFinance.setTreatment(
      company,
      purchaseOrderId,
      costId,
      body,
    );
    return { data };
  }

  @Post(':costId/allocation-preview')
  @RequirePermissions(PERMISSIONS.PURCHASING_READ)
  @ApiOperation({ summary: 'Preview purchase cost allocation (does not persist)' })
  async previewAllocation(
    @CurrentCompany() company: CompanyContext,
    @Param('purchaseOrderId', ParseUUIDPipe) purchaseOrderId: string,
    @Param('costId', ParseUUIDPipe) costId: string,
    @Body() body: PreviewPurchaseCostAllocationBodyDto,
  ) {
    return this.costFinance.previewAllocation(company, purchaseOrderId, costId, body);
  }

  @Post(':costId/allocate')
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  @ApiOperation({
    summary:
      'Persist allocation; CAPITALIZABLE updates FIFO unit costs; PERIOD_EXPENSE does not',
  })
  async allocate(
    @CurrentCompany() company: CompanyContext,
    @Param('purchaseOrderId', ParseUUIDPipe) purchaseOrderId: string,
    @Param('costId', ParseUUIDPipe) costId: string,
    @Body() body: AllocatePurchaseCostBodyDto,
  ) {
    const data = await this.costFinance.allocate(company, purchaseOrderId, costId, body);
    return { data };
  }
}
