import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hector/database';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentCompany } from '../companies/decorators/current-company.decorator';
import { ApiCompanyHeader, RequireCompany } from '../companies/decorators/require-company.decorator';
import type { CompanyContext } from '../companies/types/company.types';
import {
  PreviewSettlementDto,
  SettlePayableDto,
  SettlePaymentDto,
} from './dto/settlement.dto';
import { SettlementService } from './settlement.service';

@ApiTags('finance-settlements')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('finance')
export class SettlementsController {
  constructor(private readonly settlementService: SettlementService) {}

  @Post('settlements/preview')
  @RequirePermissions(PERMISSIONS.FINANCE_SETTLEMENTS_READ)
  @ApiOperation({ summary: 'Preview supplier liability settlement (no write)' })
  async preview(
    @CurrentCompany() company: CompanyContext,
    @Body() dto: PreviewSettlementDto,
  ) {
    return { data: await this.settlementService.preview(company, dto) };
  }

  @Get('payments/:paymentId/settlements')
  @RequirePermissions(PERMISSIONS.FINANCE_SETTLEMENTS_READ)
  @ApiOperation({ summary: 'List supplier settlements for a payment' })
  async listForPayment(
    @CurrentCompany() company: CompanyContext,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
  ) {
    return this.settlementService.listForPayment(company, paymentId);
  }

  @Post('payments/:paymentId/settlements')
  @RequirePermissions(PERMISSIONS.FINANCE_SETTLEMENTS_MANAGE)
  @ApiOperation({
    summary: 'Settle one or many supplier payables from a POSTED payment (atomic)',
  })
  async settleFromPayment(
    @CurrentCompany() company: CompanyContext,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() dto: SettlePaymentDto,
  ) {
    return { data: await this.settlementService.settleFromPayment(company, paymentId, dto) };
  }

  @Post('payables/:payableId/settle')
  @RequirePermissions(PERMISSIONS.FINANCE_SETTLEMENTS_MANAGE)
  @ApiOperation({ summary: 'Settle one supplier payable from a POSTED payment' })
  async settlePayable(
    @CurrentCompany() company: CompanyContext,
    @Param('payableId', ParseUUIDPipe) payableId: string,
    @Body() dto: SettlePayableDto,
  ) {
    return { data: await this.settlementService.settlePayable(company, payableId, dto) };
  }

  @Get('settlements/:id')
  @RequirePermissions(PERMISSIONS.FINANCE_SETTLEMENTS_READ)
  @ApiOperation({ summary: 'Get supplier settlement allocation detail' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.settlementService.get(company, id) };
  }

  @Post('settlements/:id/reverse')
  @RequirePermissions(PERMISSIONS.FINANCE_SETTLEMENTS_MANAGE)
  @ApiOperation({ summary: 'Reverse a POSTED supplier settlement allocation' })
  async reverse(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.settlementService.reverseAllocation(company, id) };
  }
}
