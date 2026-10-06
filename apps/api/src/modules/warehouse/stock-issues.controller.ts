import {
  Body,
  Controller,
  Delete,
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
  CreateStockIssueDto,
  ListStockIssuesQueryDto,
  ScanApplyStockIssueDto,
  UpdateStockIssueDto,
  UpsertStockIssueItemDto,
} from './dto/stock-issue.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { StockIssuesService } from './stock-issues.service';
import { WarehouseActivityService } from './warehouse-activity.service';

@ApiTags('stock-issues')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('warehouse/issues')
export class StockIssuesController {
  constructor(
    private readonly stockIssuesService: StockIssuesService,
    private readonly warehouseActivity: WarehouseActivityService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.WAREHOUSE_ISSUE_READ)
  @ApiOperation({ summary: 'List stock issues' })
  async list(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListStockIssuesQueryDto,
  ) {
    return this.stockIssuesService.list(company, query);
  }

  @Get(':issueId/activity')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_ISSUE_READ)
  @ApiOperation({ summary: 'Business activity timeline for a stock issue' })
  async activity(
    @CurrentCompany() company: CompanyContext,
    @Param('issueId', ParseUUIDPipe) issueId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.warehouseActivity.listForEntity(company, 'STOCK_ISSUE', issueId, query);
  }

  @Get(':issueId')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_ISSUE_READ)
  @ApiOperation({ summary: 'Stock issue detail' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('issueId', ParseUUIDPipe) issueId: string,
  ) {
    const data = await this.stockIssuesService.get(company, issueId);
    return { data };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.WAREHOUSE_ISSUE_CREATE)
  @ApiOperation({
    summary: 'Create DRAFT stock issue',
    description: 'Does not post inventory movements until POST.',
  })
  async create(
    @CurrentCompany() company: CompanyContext,
    @Body() body: CreateStockIssueDto,
  ) {
    const data = await this.stockIssuesService.create(company, body);
    return { data };
  }

  @Patch(':issueId')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_ISSUE_UPDATE)
  @ApiOperation({ summary: 'Update DRAFT stock issue (header/items)' })
  async update(
    @CurrentCompany() company: CompanyContext,
    @Param('issueId', ParseUUIDPipe) issueId: string,
    @Body() body: UpdateStockIssueDto,
  ) {
    const data = await this.stockIssuesService.update(company, issueId, body);
    return { data };
  }

  @Post(':issueId/items')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_ISSUE_UPDATE)
  @ApiOperation({ summary: 'Upsert DRAFT issue item (optional quantity increment)' })
  async upsertItem(
    @CurrentCompany() company: CompanyContext,
    @Param('issueId', ParseUUIDPipe) issueId: string,
    @Body() body: UpsertStockIssueItemDto,
  ) {
    const data = await this.stockIssuesService.upsertItem(company, issueId, body);
    return { data };
  }

  @Delete(':issueId/items/:itemId')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_ISSUE_UPDATE)
  @ApiOperation({ summary: 'Remove DRAFT issue item' })
  async removeItem(
    @CurrentCompany() company: CompanyContext,
    @Param('issueId', ParseUUIDPipe) issueId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    const data = await this.stockIssuesService.removeItem(company, issueId, itemId);
    return { data };
  }

  @Post(':issueId/scan-apply')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_ISSUE_UPDATE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Scanner-friendly DRAFT line upsert (idempotent by requestId)',
  })
  async scanApply(
    @CurrentCompany() company: CompanyContext,
    @Param('issueId', ParseUUIDPipe) issueId: string,
    @Body() body: ScanApplyStockIssueDto,
  ) {
    const data = await this.stockIssuesService.scanApply(company, issueId, body);
    return { data };
  }

  @Post(':issueId/post')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_ISSUE_POST)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Post stock issue (ISSUE movements)',
    description: 'Idempotent if already POSTED.',
  })
  async post(
    @CurrentCompany() company: CompanyContext,
    @Param('issueId', ParseUUIDPipe) issueId: string,
  ) {
    const data = await this.stockIssuesService.post(company, issueId);
    return { data };
  }

  @Post(':issueId/cancel')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_ISSUE_CANCEL)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel DRAFT stock issue',
    description: 'POSTED issues cannot be cancelled.',
  })
  async cancel(
    @CurrentCompany() company: CompanyContext,
    @Param('issueId', ParseUUIDPipe) issueId: string,
  ) {
    const data = await this.stockIssuesService.cancel(company, issueId);
    return { data };
  }
}
