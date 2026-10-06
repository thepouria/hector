import {
  Body,
  Controller,
  Get,
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
  CancelPurchaseReturnDto,
  CreatePurchaseReturnDto,
  UpdatePurchaseReturnDto,
} from './dto/create-purchase-return.dto';
import { ListPurchaseReturnsQueryDto } from './dto/list-purchase-returns.query.dto';
import { PurchaseReturnsService } from './purchase-returns.service';

@ApiTags('purchasing-purchase-returns')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('purchasing/purchase-returns')
export class PurchaseReturnsController {
  constructor(private readonly returns: PurchaseReturnsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PURCHASING_READ)
  @ApiOperation({ summary: 'List purchase returns (commercial intent records)' })
  async list(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListPurchaseReturnsQueryDto,
  ) {
    return this.returns.list(company, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PURCHASING_RETURN_CREATE)
  @ApiOperation({
    summary: 'Create a draft purchase return',
    description:
      'Commercial return intent only. Does not decrease stock or create supplier refunds.',
  })
  async create(
    @CurrentCompany() company: CompanyContext,
    @Body() body: CreatePurchaseReturnDto,
  ) {
    return { data: await this.returns.create(company, body) };
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PURCHASING_READ)
  @ApiOperation({ summary: 'Get purchase return detail' })
  async getById(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.returns.getById(company, id) };
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PURCHASING_RETURN_CREATE)
  @ApiOperation({ summary: 'Update a DRAFT purchase return' })
  async update(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdatePurchaseReturnDto,
  ) {
    return { data: await this.returns.update(company, id, body) };
  }

  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.PURCHASING_RETURN_APPROVE)
  @ApiOperation({
    summary: 'Approve purchase return (commercial intent)',
    description: 'Does not execute Warehouse stock exit or Finance refund.',
  })
  async approve(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.returns.approve(company, id) };
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.PURCHASING_RETURN_CANCEL)
  @ApiOperation({ summary: 'Cancel a draft or approved purchase return plan' })
  async cancel(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CancelPurchaseReturnDto,
  ) {
    return { data: await this.returns.cancel(company, id, body) };
  }
}
