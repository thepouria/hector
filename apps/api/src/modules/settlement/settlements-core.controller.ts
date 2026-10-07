import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hector/database';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentCompany } from '../companies/decorators/current-company.decorator';
import { ApiCompanyHeader, RequireCompany } from '../companies/decorators/require-company.decorator';
import type { CompanyContext } from '../companies/types/company.types';
import { AddSettlementItemDto } from './dto/add-settlement-item.dto';
import {
  AllocateChannelReceiptDto,
  CreateChannelSettlementDto,
  ReplaceChannelSettlementComponentsDto,
} from './dto/channel-settlement.dto';
import { CreateManualObligationDto } from './dto/create-manual-obligation.dto';
import { CreateSettlementAllocationDto } from './dto/create-settlement-allocation.dto';
import { CreateSettlementDto } from './dto/create-settlement.dto';
import {
  RepayLoanDto,
  SettleSupplierPayableDto,
} from './dto/domain-settle.dto';
import { ListChannelSettlementsQueryDto } from './dto/list-channel-settlements.query.dto';
import {
  ListOutstandingLoansQueryDto,
  ListOutstandingPayablesQueryDto,
} from './dto/list-outstanding.query.dto';
import { ReverseSettlementAllocationDto } from './dto/reverse-settlement-allocation.dto';
import { ChannelSettlementsService } from './channel-settlements.service';
import { DomainSettlementsService } from './domain-settlements.service';
import { SettlementDashboardService } from './settlement-dashboard.service';
import { SettlementsCoreService } from './settlements-core.service';

/**
 * Settlement Allocation Core + Phase 6.2/6.3 domain commands + Phase 6.5 dashboard.
 * Economic state changes only via semantic commands.
 */
@ApiTags('settlements')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('settlements')
export class SettlementsCoreController {
  constructor(
    private readonly settlements: SettlementsCoreService,
    private readonly domain: DomainSettlementsService,
    private readonly channels: ChannelSettlementsService,
    private readonly dashboard: SettlementDashboardService,
  ) {}

  @Get('dashboard')
  @RequirePermissions(PERMISSIONS.FINANCE_SETTLEMENTS_READ)
  @ApiOperation({
    summary: 'Settlement operational dashboard (currency-aware KPIs + attention queue)',
  })
  async getDashboard(@CurrentCompany() company: CompanyContext) {
    return { data: await this.dashboard.getDashboard(company) };
  }

  @Post('manual-obligations')
  @RequirePermissions(PERMISSIONS.FINANCE_SETTLEMENTS_MANAGE)
  @ApiOperation({
    summary: 'Create MANUAL_OBLIGATION scaffold (Phase 6.1 test source)',
  })
  async createManualObligation(
    @CurrentCompany() company: CompanyContext,
    @Body() dto: CreateManualObligationDto,
  ) {
    return { data: await this.settlements.createManualObligation(company, dto) };
  }

  @Get('outstanding/payables')
  @RequirePermissions(PERMISSIONS.FINANCE_SETTLEMENTS_READ)
  @ApiOperation({ summary: 'List outstanding supplier payables (grouped by currency)' })
  async listOutstandingPayables(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListOutstandingPayablesQueryDto,
  ) {
    return this.domain.listOutstandingPayables(company, query);
  }

  @Get('outstanding/loans')
  @RequirePermissions(PERMISSIONS.FINANCE_SETTLEMENTS_READ)
  @ApiOperation({ summary: 'List outstanding loans (grouped by currency)' })
  async listOutstandingLoans(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListOutstandingLoansQueryDto,
  ) {
    return this.domain.listOutstandingLoans(company, query);
  }

  @Get('channels')
  @RequirePermissions(PERMISSIONS.FINANCE_SETTLEMENTS_READ)
  @ApiOperation({ summary: 'List channel settlements (paginated, grouped outstanding)' })
  async listChannelSettlements(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListChannelSettlementsQueryDto,
  ) {
    return this.channels.list(company, query);
  }

  @Post('channels')
  @RequirePermissions(PERMISSIONS.FINANCE_SETTLEMENTS_MANAGE)
  @ApiOperation({ summary: 'Create DRAFT channel settlement with components' })
  async createChannelSettlement(
    @CurrentCompany() company: CompanyContext,
    @Body() dto: CreateChannelSettlementDto,
  ) {
    return { data: await this.channels.create(company, dto) };
  }

  @Get('channels/:id')
  @RequirePermissions(PERMISSIONS.FINANCE_SETTLEMENTS_READ)
  @ApiOperation({ summary: 'Get channel settlement summary (expected vs received)' })
  async getChannelSettlement(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.channels.get(company, id) };
  }

  @Put('channels/:id/components')
  @RequirePermissions(PERMISSIONS.FINANCE_SETTLEMENTS_MANAGE)
  @ApiOperation({ summary: 'Replace DRAFT channel settlement components' })
  async replaceChannelComponents(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceChannelSettlementComponentsDto,
  ) {
    return { data: await this.channels.replaceComponents(company, id, dto) };
  }

  @Post('channels/:id/finalize')
  @RequirePermissions(PERMISSIONS.FINANCE_SETTLEMENTS_MANAGE)
  @HttpCode(200)
  @ApiOperation({ summary: 'Finalize/open channel settlement for receipt allocation' })
  async finalizeChannelSettlement(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.channels.finalize(company, id) };
  }

  @Post('channels/:id/allocate-receipt')
  @RequirePermissions(PERMISSIONS.FINANCE_SETTLEMENTS_MANAGE)
  @HttpCode(200)
  @ApiOperation({ summary: 'Allocate a POSTED Finance Receipt to channel settlement' })
  async allocateChannelReceipt(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AllocateChannelReceiptDto,
  ) {
    return { data: await this.channels.allocateReceipt(company, id, dto) };
  }

  @Post('channels/:id/cancel')
  @RequirePermissions(PERMISSIONS.FINANCE_SETTLEMENTS_MANAGE)
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel channel settlement (no active receipt allocations)' })
  async cancelChannelSettlement(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.channels.cancel(company, id) };
  }

  @Get('payables/:payableId')
  @RequirePermissions(PERMISSIONS.FINANCE_SETTLEMENTS_READ)
  @ApiOperation({ summary: 'Supplier payable settlement summary' })
  async getPayableSummary(
    @CurrentCompany() company: CompanyContext,
    @Param('payableId', ParseUUIDPipe) payableId: string,
  ) {
    return { data: await this.domain.getPayableSummary(company, payableId) };
  }

  @Post('payables/:payableId/settle')
  @RequirePermissions(PERMISSIONS.FINANCE_SETTLEMENTS_MANAGE)
  @ApiOperation({
    summary: 'Settle supplier payable from a POSTED Payment (same-currency or FX)',
  })
  async settlePayable(
    @CurrentCompany() company: CompanyContext,
    @Param('payableId', ParseUUIDPipe) payableId: string,
    @Body() dto: SettleSupplierPayableDto,
  ) {
    return { data: await this.domain.settleSupplierPayable(company, payableId, dto) };
  }

  @Get('loans/:loanId')
  @RequirePermissions(PERMISSIONS.FINANCE_SETTLEMENTS_READ)
  @ApiOperation({ summary: 'Loan settlement summary' })
  async getLoanSummary(
    @CurrentCompany() company: CompanyContext,
    @Param('loanId', ParseUUIDPipe) loanId: string,
  ) {
    return { data: await this.domain.getLoanSummary(company, loanId) };
  }

  @Post('loans/:loanId/repay')
  @RequirePermissions(PERMISSIONS.FINANCE_SETTLEMENTS_MANAGE)
  @ApiOperation({
    summary: 'Repay loan principal from a POSTED Payment (same-currency or FX)',
  })
  async repayLoan(
    @CurrentCompany() company: CompanyContext,
    @Param('loanId', ParseUUIDPipe) loanId: string,
    @Body() dto: RepayLoanDto,
  ) {
    return { data: await this.domain.repayLoan(company, loanId, dto) };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.FINANCE_SETTLEMENTS_MANAGE)
  @ApiOperation({ summary: 'Create DRAFT settlement' })
  async create(@CurrentCompany() company: CompanyContext, @Body() dto: CreateSettlementDto) {
    return { data: await this.settlements.create(company, dto) };
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.FINANCE_SETTLEMENTS_READ)
  @ApiOperation({ summary: 'Get settlement with derived totals' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.settlements.get(company, id) };
  }

  @Post(':id/items')
  @RequirePermissions(PERMISSIONS.FINANCE_SETTLEMENTS_MANAGE)
  @ApiOperation({ summary: 'Add settleable source item (DRAFT only)' })
  async addItem(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddSettlementItemDto,
  ) {
    return { data: await this.settlements.addItem(company, id, dto) };
  }

  @Post(':id/open')
  @RequirePermissions(PERMISSIONS.FINANCE_SETTLEMENTS_MANAGE)
  @HttpCode(200)
  @ApiOperation({ summary: 'Open DRAFT settlement for allocation' })
  async open(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.settlements.open(company, id) };
  }

  @Post(':id/allocations')
  @RequirePermissions(PERMISSIONS.FINANCE_SETTLEMENTS_MANAGE)
  @ApiOperation({ summary: 'Allocate Finance Payment/Receipt to a settlement item' })
  async allocate(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSettlementAllocationDto,
  ) {
    return { data: await this.settlements.allocate(company, id, dto) };
  }

  @Post(':id/allocations/:allocationId/reverse')
  @RequirePermissions(PERMISSIONS.FINANCE_SETTLEMENTS_MANAGE)
  @HttpCode(200)
  @ApiOperation({ summary: 'Reverse an ACTIVE allocation' })
  async reverse(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('allocationId', ParseUUIDPipe) allocationId: string,
    @Body() dto: ReverseSettlementAllocationDto,
  ) {
    return {
      data: await this.settlements.reverseAllocation(company, id, allocationId, dto),
    };
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.FINANCE_SETTLEMENTS_MANAGE)
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel settlement (no active allocations)' })
  async cancel(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.settlements.cancel(company, id) };
  }
}
