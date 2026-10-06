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
  CreatePutawayDto,
  ListPendingPutawayQueryDto,
  ListPutawaysQueryDto,
  ResolvePutawayLocationDto,
  ScanApplyPutawayDto,
  UpdatePutawayItemDto,
  UpsertPutawayItemDto,
} from './dto/putaway.dto';
import { PutawaysService } from './putaways.service';

@ApiTags('putaways')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('warehouse/putaways')
export class PutawaysController {
  constructor(private readonly putawaysService: PutawaysService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.WAREHOUSE_PUTAWAY_READ)
  @ApiOperation({ summary: 'List putaways for the active company' })
  async list(@CurrentCompany() company: CompanyContext, @Query() query: ListPutawaysQueryDto) {
    return this.putawaysService.list(company, query);
  }

  @Get('pending')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_PUTAWAY_READ)
  @ApiOperation({
    summary: 'Pending putaway queue (POSTED receipt batch allocations with remaining > 0)',
    description:
      'Canonical remaining = received batch allocation − COMPLETED putaway qty. Does not expose current stock.',
  })
  async listPending(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListPendingPutawayQueryDto,
  ) {
    return this.putawaysService.listPending(company, query);
  }

  @Get(':putawayId')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_PUTAWAY_READ)
  @ApiOperation({ summary: 'Putaway detail with sources and placement items' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('putawayId', ParseUUIDPipe) putawayId: string,
  ) {
    const data = await this.putawaysService.get(company, putawayId);
    return { data };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.WAREHOUSE_PUTAWAY_MANAGE)
  @ApiOperation({
    summary: 'Create a DRAFT putaway for a POSTED goods receipt',
    description: 'Warehouse is derived from the GRN. Creating putaway does not create inventory.',
  })
  async create(@CurrentCompany() company: CompanyContext, @Body() body: CreatePutawayDto) {
    const data = await this.putawaysService.create(company, body);
    return { data };
  }

  @Post(':putawayId/items')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_PUTAWAY_MANAGE)
  @ApiOperation({
    summary: 'Upsert putaway placement item (absolute quantity for allocation+location)',
  })
  async upsertItem(
    @CurrentCompany() company: CompanyContext,
    @Param('putawayId', ParseUUIDPipe) putawayId: string,
    @Body() body: UpsertPutawayItemDto,
  ) {
    const data = await this.putawaysService.upsertItem(company, putawayId, body);
    return { data };
  }

  @Patch(':putawayId/items/:itemId')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_PUTAWAY_MANAGE)
  @ApiOperation({ summary: 'Update draft/in-progress putaway item' })
  async updateItem(
    @CurrentCompany() company: CompanyContext,
    @Param('putawayId', ParseUUIDPipe) putawayId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() body: UpdatePutawayItemDto,
  ) {
    const data = await this.putawaysService.updateItem(company, putawayId, itemId, body);
    return { data };
  }

  @Delete(':putawayId/items/:itemId')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_PUTAWAY_MANAGE)
  @ApiOperation({ summary: 'Remove draft/in-progress putaway item' })
  async removeItem(
    @CurrentCompany() company: CompanyContext,
    @Param('putawayId', ParseUUIDPipe) putawayId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    const data = await this.putawaysService.removeItem(company, putawayId, itemId);
    return { data };
  }

  @Post(':putawayId/location/resolve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.WAREHOUSE_PUTAWAY_MANAGE)
  @ApiOperation({
    summary: 'Resolve location barcode in putaway warehouse context',
    description:
      'Exact location barcode resolution. Does not search product barcodes. No mutation.',
  })
  async resolveLocation(
    @CurrentCompany() company: CompanyContext,
    @Param('putawayId', ParseUUIDPipe) putawayId: string,
    @Body() body: ResolvePutawayLocationDto,
  ) {
    return this.putawaysService.resolveLocation(company, putawayId, body);
  }

  @Post(':putawayId/scan/apply')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_PUTAWAY_MANAGE)
  @ApiOperation({
    summary: 'Apply location barcode scan + quantity to putaway (idempotent via requestId)',
  })
  async scanApply(
    @CurrentCompany() company: CompanyContext,
    @Param('putawayId', ParseUUIDPipe) putawayId: string,
    @Body() body: ScanApplyPutawayDto,
  ) {
    const data = await this.putawaysService.scanApply(company, putawayId, body);
    return { data };
  }

  @Post(':putawayId/complete')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_PUTAWAY_COMPLETE)
  @ApiOperation({
    summary: 'Complete putaway as immutable historical placement',
    description:
      'Revalidates capacity transactionally against COMPLETED putaways. Posts RECEIVE movements (Balance projection updates atomically).',
  })
  async complete(
    @CurrentCompany() company: CompanyContext,
    @Param('putawayId', ParseUUIDPipe) putawayId: string,
  ) {
    const data = await this.putawaysService.complete(company, putawayId);
    return { data };
  }

  @Post(':putawayId/cancel')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_PUTAWAY_MANAGE)
  @ApiOperation({ summary: 'Cancel DRAFT/IN_PROGRESS putaway (COMPLETED cannot cancel)' })
  async cancel(
    @CurrentCompany() company: CompanyContext,
    @Param('putawayId', ParseUUIDPipe) putawayId: string,
  ) {
    const data = await this.putawaysService.cancel(company, putawayId);
    return { data };
  }
}
