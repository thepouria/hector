import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hector/database';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentCompany } from '../companies/decorators/current-company.decorator';
import { ApiCompanyHeader, RequireCompany } from '../companies/decorators/require-company.decorator';
import type { CompanyContext } from '../companies/types/company.types';
import { AccountTransfersService } from './account-transfers.service';
import {
  CreateAccountTransferDto,
  ListAccountTransfersQueryDto,
} from './dto/account-transfer.dto';

@ApiTags('finance-account-transfers')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('finance/account-transfers')
export class AccountTransfersController {
  constructor(private readonly transfersService: AccountTransfersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FINANCE_TRANSFERS_READ)
  @ApiOperation({ summary: 'List financial account transfers' })
  async list(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListAccountTransfersQueryDto,
  ) {
    return this.transfersService.list(company, query);
  }

  @Get(':transferId')
  @RequirePermissions(PERMISSIONS.FINANCE_TRANSFERS_READ)
  @ApiOperation({ summary: 'Get account transfer detail' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('transferId', ParseUUIDPipe) transferId: string,
  ) {
    const data = await this.transfersService.get(company, transferId);
    return { data };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.FINANCE_TRANSFERS_CREATE)
  @ApiOperation({ summary: 'Create (and optionally post) a same-currency account transfer' })
  async create(
    @CurrentCompany() company: CompanyContext,
    @Body() body: CreateAccountTransferDto,
  ) {
    const data = await this.transfersService.create(company, body);
    return { data };
  }

  @Post(':transferId/post')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FINANCE_TRANSFERS_CREATE)
  @ApiOperation({ summary: 'Post a DRAFT transfer (atomic OUT+IN)' })
  async post(
    @CurrentCompany() company: CompanyContext,
    @Param('transferId', ParseUUIDPipe) transferId: string,
  ) {
    const data = await this.transfersService.post(company, transferId);
    return { data };
  }

  @Post(':transferId/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FINANCE_TRANSFERS_CREATE)
  @ApiOperation({ summary: 'Cancel a DRAFT transfer' })
  async cancel(
    @CurrentCompany() company: CompanyContext,
    @Param('transferId', ParseUUIDPipe) transferId: string,
  ) {
    const data = await this.transfersService.cancel(company, transferId);
    return { data };
  }

  @Post(':transferId/reverse')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FINANCE_TRANSFERS_CREATE)
  @ApiOperation({ summary: 'Reverse a POSTED transfer (creates linked reversal document)' })
  async reverse(
    @CurrentCompany() company: CompanyContext,
    @Param('transferId', ParseUUIDPipe) transferId: string,
  ) {
    const data = await this.transfersService.reverse(company, transferId);
    return { data };
  }
}
