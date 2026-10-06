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
  AddDiscoveredStockCountItemDto,
  CreateStockCountDto,
  ListStockCountsQueryDto,
  RecordStockCountItemDto,
  RequestRecountDto,
  ScanApplyStockCountDto,
  SkipStockCountItemDto,
  UpdateStockCountDto,
} from './dto/stock-count.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { StockCountsService } from './stock-counts.service';
import { WarehouseActivityService } from './warehouse-activity.service';

@ApiTags('stock-counts')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('warehouse/counts')
export class StockCountsController {
  constructor(
    private readonly stockCountsService: StockCountsService,
    private readonly warehouseActivity: WarehouseActivityService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.WAREHOUSE_COUNT_READ)
  @ApiOperation({ summary: 'List stock counts' })
  async list(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListStockCountsQueryDto,
  ) {
    return this.stockCountsService.list(company, query);
  }

  @Get(':countId/review')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_COUNT_READ)
  @ApiOperation({ summary: 'Stock count review (differences + mismatch hints)' })
  async review(
    @CurrentCompany() company: CompanyContext,
    @Param('countId', ParseUUIDPipe) countId: string,
  ) {
    const data = await this.stockCountsService.review(company, countId);
    return { data };
  }

  @Get(':countId/activity')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_COUNT_READ)
  @ApiOperation({ summary: 'Business activity timeline for a stock count' })
  async activity(
    @CurrentCompany() company: CompanyContext,
    @Param('countId', ParseUUIDPipe) countId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.warehouseActivity.listForEntity(company, 'STOCK_COUNT', countId, query);
  }

  @Get(':countId')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_COUNT_READ)
  @ApiOperation({ summary: 'Stock count detail' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('countId', ParseUUIDPipe) countId: string,
  ) {
    const data = await this.stockCountsService.get(company, countId);
    return { data };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.WAREHOUSE_COUNT_CREATE)
  @ApiOperation({ summary: 'Create DRAFT stock count' })
  async create(
    @CurrentCompany() company: CompanyContext,
    @Body() body: CreateStockCountDto,
  ) {
    const data = await this.stockCountsService.create(company, body);
    return { data };
  }

  @Patch(':countId')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_COUNT_CREATE)
  @ApiOperation({ summary: 'Update DRAFT stock count scope/settings' })
  async update(
    @CurrentCompany() company: CompanyContext,
    @Param('countId', ParseUUIDPipe) countId: string,
    @Body() body: UpdateStockCountDto,
  ) {
    const data = await this.stockCountsService.update(company, countId, body);
    return { data };
  }

  @Post(':countId/start')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_COUNT_CREATE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start DRAFT count (snapshot lines from On Hand)' })
  async start(
    @CurrentCompany() company: CompanyContext,
    @Param('countId', ParseUUIDPipe) countId: string,
  ) {
    const data = await this.stockCountsService.start(company, countId);
    return { data };
  }

  @Post(':countId/items/:itemId/record')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_COUNT_PERFORM)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record counted quantity on a line' })
  async recordItem(
    @CurrentCompany() company: CompanyContext,
    @Param('countId', ParseUUIDPipe) countId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() body: RecordStockCountItemDto,
  ) {
    const data = await this.stockCountsService.recordItem(company, countId, itemId, body);
    return { data };
  }

  @Post(':countId/items/:itemId/skip')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_COUNT_PERFORM)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Skip a count line' })
  async skipItem(
    @CurrentCompany() company: CompanyContext,
    @Param('countId', ParseUUIDPipe) countId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() body: SkipStockCountItemDto,
  ) {
    const data = await this.stockCountsService.skipItem(company, countId, itemId, body);
    return { data };
  }

  @Post(':countId/discovered-items')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_COUNT_PERFORM)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add discovered position (when allowed)' })
  async addDiscoveredItem(
    @CurrentCompany() company: CompanyContext,
    @Param('countId', ParseUUIDPipe) countId: string,
    @Body() body: AddDiscoveredStockCountItemDto,
  ) {
    const data = await this.stockCountsService.addDiscoveredItem(company, countId, body);
    return { data };
  }

  @Post(':countId/scan-apply')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_COUNT_PERFORM)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Scanner apply (idempotent by requestId)' })
  async scanApply(
    @CurrentCompany() company: CompanyContext,
    @Param('countId', ParseUUIDPipe) countId: string,
    @Body() body: ScanApplyStockCountDto,
  ) {
    const data = await this.stockCountsService.scanApply(company, countId, body);
    return { data };
  }

  @Post(':countId/submit')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_COUNT_SUBMIT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit IN_PROGRESS / RECOUNT_REQUIRED count' })
  async submit(
    @CurrentCompany() company: CompanyContext,
    @Param('countId', ParseUUIDPipe) countId: string,
  ) {
    const data = await this.stockCountsService.submit(company, countId);
    return { data };
  }

  @Post(':countId/request-recount')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_COUNT_APPROVE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send SUBMITTED count back for recount' })
  async requestRecount(
    @CurrentCompany() company: CompanyContext,
    @Param('countId', ParseUUIDPipe) countId: string,
    @Body() body: RequestRecountDto,
  ) {
    const data = await this.stockCountsService.requestRecount(company, countId, body);
    return { data };
  }

  @Post(':countId/approve')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_COUNT_APPROVE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve SUBMITTED count' })
  async approve(
    @CurrentCompany() company: CompanyContext,
    @Param('countId', ParseUUIDPipe) countId: string,
  ) {
    const data = await this.stockCountsService.approve(company, countId);
    return { data };
  }

  @Post(':countId/reject')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_COUNT_APPROVE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject SUBMITTED count' })
  async reject(
    @CurrentCompany() company: CompanyContext,
    @Param('countId', ParseUUIDPipe) countId: string,
  ) {
    const data = await this.stockCountsService.reject(company, countId);
    return { data };
  }

  @Post(':countId/post')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_COUNT_POST)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Post APPROVED count (STOCK_COUNT_ADJUSTMENT movements)' })
  async post(
    @CurrentCompany() company: CompanyContext,
    @Param('countId', ParseUUIDPipe) countId: string,
  ) {
    const data = await this.stockCountsService.post(company, countId);
    return { data };
  }

  @Post(':countId/cancel')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_COUNT_CANCEL)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel pre-post count' })
  async cancel(
    @CurrentCompany() company: CompanyContext,
    @Param('countId', ParseUUIDPipe) countId: string,
  ) {
    const data = await this.stockCountsService.cancel(company, countId);
    return { data };
  }
}
