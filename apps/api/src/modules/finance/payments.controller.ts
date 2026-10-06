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
  CreatePaymentDto,
  ListPaymentsQueryDto,
  ReversePaymentDto,
  UpdatePaymentDto,
} from './dto/payment.dto';
import { PaymentsService } from './payments.service';

@ApiTags('finance-payments')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('finance/payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FINANCE_PAYMENTS_READ)
  @ApiOperation({ summary: 'List payments (standalone money-out)' })
  async list(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListPaymentsQueryDto,
  ) {
    return this.paymentsService.list(company, query);
  }

  @Get(':paymentId')
  @RequirePermissions(PERMISSIONS.FINANCE_PAYMENTS_READ)
  @ApiOperation({ summary: 'Get payment detail' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
  ) {
    const data = await this.paymentsService.get(company, paymentId);
    return { data };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.FINANCE_PAYMENTS_CREATE)
  @ApiOperation({
    summary:
      'Create payment (optionally post). purposeType=SUPPLIER does not settle SupplierPayable.',
  })
  async create(@CurrentCompany() company: CompanyContext, @Body() body: CreatePaymentDto) {
    const data = await this.paymentsService.create(company, body);
    return { data };
  }

  @Patch(':paymentId')
  @RequirePermissions(PERMISSIONS.FINANCE_PAYMENTS_CREATE)
  @ApiOperation({ summary: 'Update DRAFT payment' })
  async update(
    @CurrentCompany() company: CompanyContext,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() body: UpdatePaymentDto,
  ) {
    const data = await this.paymentsService.update(company, paymentId, body);
    return { data };
  }

  @Post(':paymentId/post')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FINANCE_PAYMENTS_CREATE)
  @ApiOperation({ summary: 'Post payment → MONEY_OUT sourceType PAYMENT' })
  async post(
    @CurrentCompany() company: CompanyContext,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
  ) {
    const data = await this.paymentsService.post(company, paymentId);
    return { data };
  }

  @Post(':paymentId/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FINANCE_PAYMENTS_CREATE)
  @ApiOperation({ summary: 'Cancel DRAFT payment' })
  async cancel(
    @CurrentCompany() company: CompanyContext,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
  ) {
    const data = await this.paymentsService.cancel(company, paymentId);
    return { data };
  }

  @Post(':paymentId/reverse')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FINANCE_PAYMENTS_CREATE)
  @ApiOperation({ summary: 'Reverse POSTED payment (reason required)' })
  async reverse(
    @CurrentCompany() company: CompanyContext,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() body: ReversePaymentDto,
  ) {
    const data = await this.paymentsService.reverse(company, paymentId, body);
    return { data };
  }
}
