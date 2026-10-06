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
import {
  CreateLoanDisbursementDto,
  CreateLoanDto,
  CreateLoanRepaymentDto,
  ListLoansQueryDto,
  UpdateLoanDto,
} from './dto/loan.dto';
import { LoansService } from './loans.service';

@ApiTags('finance-loans')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('finance/loans')
export class LoansController {
  constructor(private readonly loansService: LoansService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FINANCE_LOANS_READ)
  @ApiOperation({ summary: 'List loans with derived outstanding' })
  async list(@CurrentCompany() company: CompanyContext, @Query() query: ListLoansQueryDto) {
    return this.loansService.list(company, query);
  }

  @Get(':loanId')
  @RequirePermissions(PERMISSIONS.FINANCE_LOANS_READ)
  @ApiOperation({ summary: 'Get loan detail with outstanding / overdue' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('loanId', ParseUUIDPipe) loanId: string,
  ) {
    const data = await this.loansService.get(company, loanId);
    return { data };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.FINANCE_LOANS_MANAGE)
  @ApiOperation({ summary: 'Create loan (optional first disbursement)' })
  async create(@CurrentCompany() company: CompanyContext, @Body() body: CreateLoanDto) {
    const data = await this.loansService.create(company, body);
    return { data };
  }

  @Patch(':loanId')
  @RequirePermissions(PERMISSIONS.FINANCE_LOANS_MANAGE)
  @ApiOperation({ summary: 'Update loan (economic fields DRAFT-only; notes always)' })
  async update(
    @CurrentCompany() company: CompanyContext,
    @Param('loanId', ParseUUIDPipe) loanId: string,
    @Body() body: UpdateLoanDto,
  ) {
    const data = await this.loansService.update(company, loanId, body);
    return { data };
  }

  @Post(':loanId/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FINANCE_LOANS_MANAGE)
  @ApiOperation({ summary: 'Cancel DRAFT loan with no disbursements' })
  async cancel(
    @CurrentCompany() company: CompanyContext,
    @Param('loanId', ParseUUIDPipe) loanId: string,
  ) {
    const data = await this.loansService.cancel(company, loanId);
    return { data };
  }

  @Post(':loanId/disbursements')
  @RequirePermissions(PERMISSIONS.FINANCE_LOANS_MANAGE)
  @ApiOperation({ summary: 'Create loan disbursement' })
  async createDisbursement(
    @CurrentCompany() company: CompanyContext,
    @Param('loanId', ParseUUIDPipe) loanId: string,
    @Body() body: CreateLoanDisbursementDto,
  ) {
    const data = await this.loansService.createDisbursement(company, loanId, body);
    return { data };
  }

  @Post(':loanId/disbursements/:disbursementId/post')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FINANCE_LOANS_MANAGE)
  @ApiOperation({ summary: 'Post loan disbursement → MONEY_IN LOAN_DISBURSEMENT' })
  async postDisbursement(
    @CurrentCompany() company: CompanyContext,
    @Param('loanId', ParseUUIDPipe) loanId: string,
    @Param('disbursementId', ParseUUIDPipe) disbursementId: string,
  ) {
    const data = await this.loansService.postDisbursement(company, loanId, disbursementId);
    return { data };
  }

  @Post(':loanId/disbursements/:disbursementId/reverse')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FINANCE_LOANS_MANAGE)
  @ApiOperation({ summary: 'Reverse posted disbursement (no repayments allowed)' })
  async reverseDisbursement(
    @CurrentCompany() company: CompanyContext,
    @Param('loanId', ParseUUIDPipe) loanId: string,
    @Param('disbursementId', ParseUUIDPipe) disbursementId: string,
  ) {
    const data = await this.loansService.reverseDisbursement(company, loanId, disbursementId);
    return { data };
  }

  @Post(':loanId/repayments')
  @RequirePermissions(PERMISSIONS.FINANCE_LOANS_MANAGE)
  @ApiOperation({ summary: 'Create loan repayment' })
  async createRepayment(
    @CurrentCompany() company: CompanyContext,
    @Param('loanId', ParseUUIDPipe) loanId: string,
    @Body() body: CreateLoanRepaymentDto,
  ) {
    const data = await this.loansService.createRepayment(company, loanId, body);
    return { data };
  }

  @Post(':loanId/repayments/:repaymentId/post')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FINANCE_LOANS_MANAGE)
  @ApiOperation({ summary: 'Post loan repayment → MONEY_OUT (principal reduces outstanding)' })
  async postRepayment(
    @CurrentCompany() company: CompanyContext,
    @Param('loanId', ParseUUIDPipe) loanId: string,
    @Param('repaymentId', ParseUUIDPipe) repaymentId: string,
  ) {
    const data = await this.loansService.postRepayment(company, loanId, repaymentId);
    return { data };
  }

  @Post(':loanId/repayments/:repaymentId/reverse')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FINANCE_LOANS_MANAGE)
  @ApiOperation({ summary: 'Reverse posted repayment' })
  async reverseRepayment(
    @CurrentCompany() company: CompanyContext,
    @Param('loanId', ParseUUIDPipe) loanId: string,
    @Param('repaymentId', ParseUUIDPipe) repaymentId: string,
  ) {
    const data = await this.loansService.reverseRepayment(company, loanId, repaymentId);
    return { data };
  }
}
