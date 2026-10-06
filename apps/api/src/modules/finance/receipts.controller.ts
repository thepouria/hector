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
  CreateReceiptDto,
  ListReceiptsQueryDto,
  ReverseReceiptDto,
  UpdateReceiptDto,
} from './dto/receipt.dto';
import { ReceiptsService } from './receipts.service';

@ApiTags('finance-receipts')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('finance/receipts')
export class ReceiptsController {
  constructor(private readonly receiptsService: ReceiptsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FINANCE_RECEIPTS_READ)
  @ApiOperation({ summary: 'List receipts (standalone money-in)' })
  async list(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListReceiptsQueryDto,
  ) {
    return this.receiptsService.list(company, query);
  }

  @Get(':receiptId')
  @RequirePermissions(PERMISSIONS.FINANCE_RECEIPTS_READ)
  @ApiOperation({ summary: 'Get receipt detail' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('receiptId', ParseUUIDPipe) receiptId: string,
  ) {
    const data = await this.receiptsService.get(company, receiptId);
    return { data };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.FINANCE_RECEIPTS_CREATE)
  @ApiOperation({ summary: 'Create receipt (optionally post)' })
  async create(@CurrentCompany() company: CompanyContext, @Body() body: CreateReceiptDto) {
    const data = await this.receiptsService.create(company, body);
    return { data };
  }

  @Patch(':receiptId')
  @RequirePermissions(PERMISSIONS.FINANCE_RECEIPTS_CREATE)
  @ApiOperation({ summary: 'Update DRAFT receipt' })
  async update(
    @CurrentCompany() company: CompanyContext,
    @Param('receiptId', ParseUUIDPipe) receiptId: string,
    @Body() body: UpdateReceiptDto,
  ) {
    const data = await this.receiptsService.update(company, receiptId, body);
    return { data };
  }

  @Post(':receiptId/post')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FINANCE_RECEIPTS_CREATE)
  @ApiOperation({ summary: 'Post receipt → MONEY_IN sourceType RECEIPT' })
  async post(
    @CurrentCompany() company: CompanyContext,
    @Param('receiptId', ParseUUIDPipe) receiptId: string,
  ) {
    const data = await this.receiptsService.post(company, receiptId);
    return { data };
  }

  @Post(':receiptId/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FINANCE_RECEIPTS_CREATE)
  @ApiOperation({ summary: 'Cancel DRAFT receipt' })
  async cancel(
    @CurrentCompany() company: CompanyContext,
    @Param('receiptId', ParseUUIDPipe) receiptId: string,
  ) {
    const data = await this.receiptsService.cancel(company, receiptId);
    return { data };
  }

  @Post(':receiptId/reverse')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FINANCE_RECEIPTS_CREATE)
  @ApiOperation({ summary: 'Reverse POSTED receipt (reason required)' })
  async reverse(
    @CurrentCompany() company: CompanyContext,
    @Param('receiptId', ParseUUIDPipe) receiptId: string,
    @Body() body: ReverseReceiptDto,
  ) {
    const data = await this.receiptsService.reverse(company, receiptId, body);
    return { data };
  }
}
