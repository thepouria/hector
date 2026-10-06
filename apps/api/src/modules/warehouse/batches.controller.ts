import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hector/database';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentCompany } from '../companies/decorators/current-company.decorator';
import { ApiCompanyHeader, RequireCompany } from '../companies/decorators/require-company.decorator';
import type { CompanyContext } from '../companies/types/company.types';
import { BatchesService } from './batches.service';
import { CreateBatchDto, ListBatchesQueryDto, UpdateBatchDto } from './dto/batch.dto';

@ApiTags('batches')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('warehouse/batches')
export class BatchesController {
  constructor(private readonly batchesService: BatchesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.WAREHOUSE_BATCH_READ)
  @ApiOperation({
    summary: 'List batches / lots for the active company',
    description:
      'Identity list with Total Received derived from POSTED GRN allocations only. Does not expose current stock.',
  })
  async list(@CurrentCompany() company: CompanyContext, @Query() query: ListBatchesQueryDto) {
    return this.batchesService.list(company, query);
  }

  @Get(':batchId')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_BATCH_READ)
  @ApiOperation({
    summary: 'Batch detail with POSTED receipt history',
    description: 'Provenance: Batch → GRN → PO → Supplier. No current stock field.',
  })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('batchId', ParseUUIDPipe) batchId: string,
  ) {
    const data = await this.batchesService.get(company, batchId);
    return { data };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.WAREHOUSE_BATCH_MANAGE)
  @ApiOperation({
    summary: 'Create a batch identity',
    description:
      'Generates internal BAT-######. Creating a batch does not create inventory. Non-null supplier batch is unique per SKU.',
  })
  async create(@CurrentCompany() company: CompanyContext, @Body() body: CreateBatchDto) {
    const data = await this.batchesService.create(company, body);
    return { data };
  }

  @Patch(':batchId')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_BATCH_MANAGE)
  @ApiOperation({
    summary: 'Update batch metadata (supplier batch, dates, notes)',
    description: 'skuId and batchNumber are immutable. Does not change posted allocations.',
  })
  async update(
    @CurrentCompany() company: CompanyContext,
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @Body() body: UpdateBatchDto,
  ) {
    const data = await this.batchesService.update(company, batchId, body);
    return { data };
  }
}
