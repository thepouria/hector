import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hector/database';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentCompany } from '../companies/decorators/current-company.decorator';
import { ApiCompanyHeader, RequireCompany } from '../companies/decorators/require-company.decorator';
import type { CompanyContext } from '../companies/types/company.types';
import {
  CreateLedgerAccountDto,
  ListLedgerAccountsQueryDto,
} from './dto/ledger-account.dto';
import {
  CreateManualJournalDto,
  GeneralLedgerQueryDto,
  ListJournalsQueryDto,
  ListLedgerQueryDto,
  TrialBalanceQueryDto,
} from './dto/journal.dto';
import { LedgerAccountsService } from './ledger-accounts.service';
import { JournalPostingService } from './journal-posting.service';

@ApiTags('finance-ledger-accounts')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('finance/ledger-accounts')
export class LedgerAccountsController {
  constructor(private readonly ledgerAccounts: LedgerAccountsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FINANCE_JOURNALS_READ)
  @ApiOperation({ summary: 'List ledger accounts (CoA)' })
  async list(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListLedgerAccountsQueryDto,
  ) {
    return this.ledgerAccounts.list(company, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.FINANCE_JOURNALS_READ)
  @ApiOperation({ summary: 'Get ledger account' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.ledgerAccounts.get(company, id) };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.FINANCE_JOURNALS_POST)
  @ApiOperation({ summary: 'Create user-defined ledger account' })
  async create(
    @CurrentCompany() company: CompanyContext,
    @Body() body: CreateLedgerAccountDto,
  ) {
    return { data: await this.ledgerAccounts.create(company, body) };
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FINANCE_JOURNALS_POST)
  @ApiOperation({ summary: 'Archive ledger account' })
  async archive(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.ledgerAccounts.archive(company, id) };
  }
}

@ApiTags('finance-journals')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('finance/journals')
export class JournalsController {
  constructor(private readonly journals: JournalPostingService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FINANCE_JOURNALS_READ)
  @ApiOperation({ summary: 'List journal entries' })
  async list(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListJournalsQueryDto,
  ) {
    return this.journals.list(company, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.FINANCE_JOURNALS_READ)
  @ApiOperation({ summary: 'Get journal entry detail' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.journals.get(company, id) };
  }

  @Post('manual')
  @RequirePermissions(PERMISSIONS.FINANCE_JOURNALS_POST)
  @ApiOperation({
    summary: 'Create manual journal (DRAFT or postImmediately). Never creates AccountMovement.',
  })
  async createManual(
    @CurrentCompany() company: CompanyContext,
    @Body() body: CreateManualJournalDto,
  ) {
    return { data: await this.journals.createManual(company, body) };
  }

  @Post(':id/post')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FINANCE_JOURNALS_POST)
  @ApiOperation({ summary: 'Post a DRAFT journal' })
  async post(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.journals.post(company, id) };
  }

  @Post(':id/reverse')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FINANCE_JOURNALS_POST)
  @ApiOperation({ summary: 'Reverse a POSTED journal' })
  async reverse(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.journals.reverse(company, id) };
  }
}

@ApiTags('finance-ledger')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('finance')
export class FinanceLedgerReportsController {
  constructor(private readonly journals: JournalPostingService) {}

  @Get('ledger')
  @RequirePermissions(PERMISSIONS.FINANCE_JOURNALS_READ)
  @ApiOperation({ summary: 'Account ledger lines (posted journals)' })
  async ledger(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListLedgerQueryDto,
  ) {
    return this.journals.listLedger(company, query);
  }

  @Get('general-ledger')
  @RequirePermissions(PERMISSIONS.FINANCE_JOURNALS_READ)
  @ApiOperation({
    summary:
      'General ledger for one ledger account with running balance (base currency)',
  })
  async generalLedger(
    @CurrentCompany() company: CompanyContext,
    @Query() query: GeneralLedgerQueryDto,
  ) {
    return this.journals.generalLedger(company, query);
  }

  @Get('trial-balance')
  @RequirePermissions(PERMISSIONS.FINANCE_JOURNALS_READ)
  @ApiOperation({ summary: 'Trial balance in company base currency' })
  async trialBalance(
    @CurrentCompany() company: CompanyContext,
    @Query() query: TrialBalanceQueryDto,
  ) {
    return this.journals.trialBalance(company, query);
  }
}
