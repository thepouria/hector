import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hector/database';
import { CurrentCompany } from '../companies/decorators/current-company.decorator';
import { ApiCompanyHeader, RequireCompany } from '../companies/decorators/require-company.decorator';
import type { CompanyContext } from '../companies/types/company.types';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CustomerReceivablesService } from './customer-receivables.service';
import { ListCustomerReceivablesQueryDto } from './dto/list-customer-receivables.query.dto';

@ApiTags('finance-receivables')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('finance/receivables')
export class CustomerReceivablesController {
  constructor(private readonly receivables: CustomerReceivablesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FINANCE_RECEIVABLES_READ)
  @ApiOperation({ summary: 'List customer/channel receivables' })
  async list(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListCustomerReceivablesQueryDto,
  ) {
    return this.receivables.list(company, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.FINANCE_RECEIVABLES_READ)
  @ApiOperation({ summary: 'Get customer receivable detail' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.receivables.get(company, id) };
  }
}
