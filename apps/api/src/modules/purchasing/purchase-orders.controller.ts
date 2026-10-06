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
import { PERMISSIONS, Prisma } from '@hector/database';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentCompany } from '../companies/decorators/current-company.decorator';
import { ApiCompanyHeader, RequireCompany } from '../companies/decorators/require-company.decorator';
import type { CompanyContext } from '../companies/types/company.types';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { ListPurchaseOrdersQueryDto } from './dto/list-purchase-orders.query.dto';
import {
  AddPurchaseOrderItemDto,
  UpdatePurchaseOrderItemDto,
} from './dto/purchase-order-item.dto';
import {
  CancelPurchaseOrderDto,
  OrderPurchaseOrderDto,
  PurchaseOrderTransitionDto,
} from './dto/purchase-order-transition.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { PurchaseOrderCostsService } from './purchase-order-costs.service';
import { PurchaseOrdersService } from './purchase-orders.service';

/**
 * Purchase Orders (Phase 2.4–2.9).
 *
 * RequirePermissions has AND semantics, so each route names ONE primary permission.
 * OWNER holds every permission; custom roles must be granted the specific key:
 *   read=purchasing.read, create draft=purchasing.create,
 *   edit draft / items / order=purchasing.manage,
 *   approve=purchasing.approve, cancel=purchasing.cancel.
 *
 * Lifecycle transitions are explicit commands — never PATCH status.
 * PARTIALLY_RECEIVED / RECEIVED have no public Purchasing endpoints (Phase 3).
 */
@ApiTags('purchasing-purchase-orders')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('purchasing/purchase-orders')
export class PurchaseOrdersController {
  constructor(
    private readonly purchaseOrders: PurchaseOrdersService,
    private readonly purchaseOrderCosts: PurchaseOrderCostsService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PURCHASING_READ)
  @ApiOperation({ summary: 'List purchase orders (paginated, filterable)' })
  async list(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListPurchaseOrdersQueryDto,
  ) {
    return this.purchaseOrders.list(company, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PURCHASING_CREATE)
  @ApiOperation({
    summary: 'Create a DRAFT purchase order with at least one item',
    description:
      'Number (PO-YYYY-NNNNNN), status, subtotal and total are server-owned. IRR amounts are whole rials.',
  })
  async create(@CurrentCompany() company: CompanyContext, @Body() body: CreatePurchaseOrderDto) {
    const data = await this.purchaseOrders.create(company, body);
    return { data };
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PURCHASING_READ)
  @ApiOperation({
    summary: 'Get purchase order detail with items and purchase-cost summary',
  })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.purchaseOrders.get(company, id);
    const summary = await this.purchaseOrderCosts.summaryForPurchaseOrder(
      company.companyId,
      id,
      new Prisma.Decimal(data.total),
      data.currency,
    );
    return {
      data: {
        ...data,
        purchaseCosts: summary.purchaseCosts,
        purchaseCostTotalsByCurrency: summary.purchaseCostTotalsByCurrency,
        referenceAcquisitionTotal: summary.referenceAcquisitionTotal,
      },
    };
  }

  @Get(':id/activity')
  @RequirePermissions(PERMISSIONS.PURCHASING_READ)
  @ApiOperation({
    summary: 'Business activity timeline for a purchase order',
    description:
      'Human-readable projection of Audit history for the PO and related child entities (items, costs, corrections, discrepancies, returns). Not a second audit store. Technical metadata (IP/UA) remains on GET /audit-logs with audit.read.',
  })
  async activity(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.purchaseOrders.listActivity(company, id, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  @ApiOperation({
    summary: 'Update purchase order header',
    description:
      'DRAFT: full header edit (supplier/currency locked while items exist). APPROVED/ORDERED: notes and expectedAt only.',
  })
  async update(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdatePurchaseOrderDto,
  ) {
    const data = await this.purchaseOrders.update(company, id, body);
    return { data };
  }

  @Post(':id/items')
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  @ApiOperation({ summary: 'Add an item to a DRAFT purchase order' })
  async addItem(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddPurchaseOrderItemDto,
  ) {
    const data = await this.purchaseOrders.addItem(company, id, body);
    return { data };
  }

  @Patch(':id/items/:itemId')
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  @ApiOperation({ summary: 'Update an item on a DRAFT purchase order' })
  async updateItem(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() body: UpdatePurchaseOrderItemDto,
  ) {
    const data = await this.purchaseOrders.updateItem(company, id, itemId, body);
    return { data };
  }

  @Delete(':id/items/:itemId')
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  @ApiOperation({ summary: 'Remove an item from a DRAFT purchase order' })
  async removeItem(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    const data = await this.purchaseOrders.removeItem(company, id, itemId);
    return { data };
  }

  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.PURCHASING_APPROVE)
  @ApiOperation({
    summary: 'DRAFT → APPROVED (internal approval; revalidates commercial terms)',
  })
  async approve(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PurchaseOrderTransitionDto,
  ) {
    const data = await this.purchaseOrders.approve(company, id, body);
    return { data };
  }

  @Post(':id/order')
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  @ApiOperation({
    summary: 'APPROVED → ORDERED (supplier commitment; freezes commercial snapshots)',
    description:
      'Canonical Phase 2.9 command. Optional supplierOrderReference / orderDate. orderedAt is server-owned.',
  })
  async order(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: OrderPurchaseOrderDto,
  ) {
    const data = await this.purchaseOrders.order(company, id, body);
    return { data };
  }

  @Post(':id/mark-ordered')
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  @ApiOperation({
    summary: 'APPROVED → ORDERED (alias of /order for Phase 2.4 clients)',
  })
  async markOrdered(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: OrderPurchaseOrderDto,
  ) {
    const data = await this.purchaseOrders.markOrdered(company, id, body);
    return { data };
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.PURCHASING_CANCEL)
  @ApiOperation({
    summary: 'DRAFT | APPROVED | ORDERED → CANCELLED',
    description:
      'Reason required for APPROVED/ORDERED. ORDERED cancel allowed until Phase 3 Goods Receipt evidence exists. No public path into PARTIALLY_RECEIVED/RECEIVED.',
  })
  async cancel(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CancelPurchaseOrderDto,
  ) {
    const data = await this.purchaseOrders.cancel(company, id, body);
    return { data };
  }
}
