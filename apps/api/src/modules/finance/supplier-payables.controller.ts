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
import { getRequestContext } from '../../common/context/request-context';
import { AppError } from '../../common/exceptions/app.error';
import { ERROR_CODES } from '../../common/constants';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentCompany } from '../companies/decorators/current-company.decorator';
import { ApiCompanyHeader, RequireCompany } from '../companies/decorators/require-company.decorator';
import type { CompanyContext } from '../companies/types/company.types';
import {
  AllocateSupplierPaymentDto,
  CreateOpeningSupplierPayableDto,
  ListSupplierPayablesQueryDto,
} from './dto/supplier-payable.dto';
import { SupplierPayablesService } from './supplier-payables.service';

@ApiTags('finance-payables')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('finance')
export class SupplierPayablesController {
  constructor(private readonly supplierPayablesService: SupplierPayablesService) {}

  @Get('payables')
  @RequirePermissions(PERMISSIONS.FINANCE_PAYABLES_READ)
  @ApiOperation({ summary: 'List supplier payables (outstanding derived)' })
  async list(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListSupplierPayablesQueryDto,
  ) {
    return this.supplierPayablesService.list(company, query);
  }

  @Get('payables/summary')
  @RequirePermissions(PERMISSIONS.FINANCE_PAYABLES_READ)
  @ApiOperation({ summary: 'Payables summary by currency (no FX aggregation)' })
  async summary(@CurrentCompany() company: CompanyContext) {
    return this.supplierPayablesService.summary(company);
  }

  @Get('payables/aging')
  @RequirePermissions(PERMISSIONS.FINANCE_PAYABLES_READ)
  @ApiOperation({ summary: 'Payables aging buckets by currency' })
  async aging(@CurrentCompany() company: CompanyContext) {
    return this.supplierPayablesService.aging(company);
  }

  @Get('payables/:id')
  @RequirePermissions(PERMISSIONS.FINANCE_PAYABLES_READ)
  @ApiOperation({ summary: 'Get supplier payable detail' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.supplierPayablesService.get(company, id);
    return { data };
  }

  @Get('suppliers/:supplierId/payables')
  @RequirePermissions(PERMISSIONS.FINANCE_PAYABLES_READ)
  @ApiOperation({ summary: 'List payables for one supplier' })
  async listForSupplier(
    @CurrentCompany() company: CompanyContext,
    @Param('supplierId', ParseUUIDPipe) supplierId: string,
    @Query() query: ListSupplierPayablesQueryDto,
  ) {
    return this.supplierPayablesService.listForSupplier(company, supplierId, query);
  }

  @Get('suppliers/:supplierId/statement')
  @RequirePermissions(PERMISSIONS.FINANCE_PAYABLES_READ)
  @ApiOperation({ summary: 'Supplier liability statement (movements + credits)' })
  async statement(
    @CurrentCompany() company: CompanyContext,
    @Param('supplierId', ParseUUIDPipe) supplierId: string,
  ) {
    return this.supplierPayablesService.supplierStatement(company, supplierId);
  }

  @Post('payables/opening')
  @RequirePermissions(PERMISSIONS.FINANCE_PAYABLES_MANAGE)
  @ApiOperation({ summary: 'Record opening supplier payable (no fake PO/GRN)' })
  async createOpening(
    @CurrentCompany() company: CompanyContext,
    @Body() body: CreateOpeningSupplierPayableDto,
  ) {
    const actorUserId = this.requireActorUserId();
    const data = await this.supplierPayablesService.createOpening(
      company,
      body,
      actorUserId,
    );
    return { data };
  }

  @Post('payables/:id/allocations')
  @RequirePermissions(PERMISSIONS.FINANCE_PAYABLES_MANAGE)
  @ApiOperation({
    summary:
      'Foundation payment allocation (liability decrease only; no cash — Phase 4.6)',
  })
  async allocate(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AllocateSupplierPaymentDto,
  ) {
    const actorUserId = this.requireActorUserId();
    const data = await this.supplierPayablesService.allocateSupplierPayment(
      company,
      id,
      body,
      actorUserId,
    );
    return { data };
  }

  private requireActorUserId(): string {
    const userId = getRequestContext()?.userId;
    if (!userId) {
      throw new AppError({
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Authentication required.',
        statusCode: 401,
      });
    }
    return userId;
  }
}
