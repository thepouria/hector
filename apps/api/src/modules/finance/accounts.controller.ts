import {
  Body,
  Controller,
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
import { AccountsService } from './accounts.service';
import {
  CreateFinancialAccountDto,
  ListAccountMovementsQueryDto,
  ListFinancialAccountsQueryDto,
  RecordOpeningBalanceDto,
  UpdateFinancialAccountDto,
} from './dto/financial-account.dto';

@ApiTags('finance-accounts')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('finance/accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FINANCE_ACCOUNTS_READ)
  @ApiOperation({ summary: 'List financial accounts' })
  async list(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListFinancialAccountsQueryDto,
  ) {
    return this.accountsService.list(company, query);
  }

  @Get('summary')
  @RequirePermissions(PERMISSIONS.FINANCE_ACCOUNTS_READ)
  @ApiOperation({ summary: 'Company cash/bank summary by currency (no FX conversion)' })
  async summary(@CurrentCompany() company: CompanyContext) {
    const data = await this.accountsService.summary(company);
    return { data };
  }

  @Get(':accountId')
  @RequirePermissions(PERMISSIONS.FINANCE_ACCOUNTS_READ)
  @ApiOperation({ summary: 'Get financial account detail with ledger balance' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('accountId', ParseUUIDPipe) accountId: string,
  ) {
    const data = await this.accountsService.get(company, accountId);
    return { data };
  }

  @Get(':accountId/balance')
  @RequirePermissions(PERMISSIONS.FINANCE_ACCOUNTS_READ)
  @ApiOperation({ summary: 'Get ledger-derived account balance' })
  async balance(
    @CurrentCompany() company: CompanyContext,
    @Param('accountId', ParseUUIDPipe) accountId: string,
  ) {
    const data = await this.accountsService.getBalance(company, accountId);
    return { data };
  }

  @Get(':accountId/movements')
  @RequirePermissions(PERMISSIONS.FINANCE_ACCOUNTS_READ)
  @ApiOperation({ summary: 'List account money movements (paginated)' })
  async movements(
    @CurrentCompany() company: CompanyContext,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Query() query: ListAccountMovementsQueryDto,
  ) {
    return this.accountsService.listMovements(company, accountId, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.FINANCE_ACCOUNTS_MANAGE)
  @ApiOperation({ summary: 'Create a financial account' })
  async create(
    @CurrentCompany() company: CompanyContext,
    @Body() body: CreateFinancialAccountDto,
  ) {
    const data = await this.accountsService.create(company, body);
    return { data };
  }

  @Patch(':accountId')
  @RequirePermissions(PERMISSIONS.FINANCE_ACCOUNTS_MANAGE)
  @ApiOperation({
    summary: 'Update account metadata (currency/balance never changeable)',
  })
  async update(
    @CurrentCompany() company: CompanyContext,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body() body: UpdateFinancialAccountDto,
  ) {
    const data = await this.accountsService.update(company, accountId, body);
    return { data };
  }

  @Post(':accountId/activate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FINANCE_ACCOUNTS_MANAGE)
  @ApiOperation({ summary: 'Activate account (INACTIVE → ACTIVE)' })
  async activate(
    @CurrentCompany() company: CompanyContext,
    @Param('accountId', ParseUUIDPipe) accountId: string,
  ) {
    const data = await this.accountsService.activate(company, accountId);
    return { data };
  }

  @Post(':accountId/deactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FINANCE_ACCOUNTS_MANAGE)
  @ApiOperation({ summary: 'Deactivate account (ACTIVE → INACTIVE)' })
  async deactivate(
    @CurrentCompany() company: CompanyContext,
    @Param('accountId', ParseUUIDPipe) accountId: string,
  ) {
    const data = await this.accountsService.deactivate(company, accountId);
    return { data };
  }

  @Post(':accountId/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FINANCE_ACCOUNTS_MANAGE)
  @ApiOperation({ summary: 'Archive account (ledger balance must be zero)' })
  async archive(
    @CurrentCompany() company: CompanyContext,
    @Param('accountId', ParseUUIDPipe) accountId: string,
  ) {
    const data = await this.accountsService.archive(company, accountId);
    return { data };
  }

  @Post(':accountId/set-default')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FINANCE_ACCOUNTS_MANAGE)
  @ApiOperation({ summary: 'Set as default account for its currency' })
  async setDefault(
    @CurrentCompany() company: CompanyContext,
    @Param('accountId', ParseUUIDPipe) accountId: string,
  ) {
    const data = await this.accountsService.setDefault(company, accountId);
    return { data };
  }

  @Post(':accountId/opening-balance')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FINANCE_ACCOUNTS_MANAGE)
  @ApiOperation({
    summary: 'Record opening balance (idempotent; not revenue)',
  })
  async openingBalance(
    @CurrentCompany() company: CompanyContext,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body() body: RecordOpeningBalanceDto,
  ) {
    const data = await this.accountsService.recordOpeningBalance(company, accountId, body);
    return { data };
  }
}
