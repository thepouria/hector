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
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  CreateSupplierReturnExecutionDto,
  ListSupplierReturnExecutionsQueryDto,
  ListWarehouseSupplierReturnsQueryDto,
  ScanApplySupplierReturnExecutionDto,
  UpdateSupplierReturnExecutionDto,
  UpsertSupplierReturnExecutionItemDto,
} from './dto/supplier-return-execution.dto';
import { SupplierReturnExecutionsService } from './supplier-return-executions.service';
import { WarehouseActivityService } from './warehouse-activity.service';

@ApiTags('supplier-returns')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('warehouse/supplier-returns')
export class WarehouseSupplierReturnsController {
  constructor(private readonly supplierReturnExecutionsService: SupplierReturnExecutionsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_READ)
  @ApiOperation({ summary: 'List APPROVED purchase returns with warehouse dispatch progress' })
  async listReturns(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListWarehouseSupplierReturnsQueryDto,
  ) {
    return this.supplierReturnExecutionsService.listApprovedReturns(company, query);
  }

  @Get(':purchaseReturnId')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_READ)
  @ApiOperation({ summary: 'Approved purchase return detail with executions and progress' })
  async getReturn(
    @CurrentCompany() company: CompanyContext,
    @Param('purchaseReturnId', ParseUUIDPipe) purchaseReturnId: string,
  ) {
    const data = await this.supplierReturnExecutionsService.getApprovedReturn(
      company,
      purchaseReturnId,
    );
    return { data };
  }

  @Post(':purchaseReturnId/executions')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_CREATE_EXECUTION)
  @ApiOperation({ summary: 'Create DRAFT supplier return execution' })
  async createExecution(
    @CurrentCompany() company: CompanyContext,
    @Param('purchaseReturnId', ParseUUIDPipe) purchaseReturnId: string,
    @Body() body: CreateSupplierReturnExecutionDto,
  ) {
    const data = await this.supplierReturnExecutionsService.createExecution(
      company,
      purchaseReturnId,
      body,
    );
    return { data };
  }
}

@ApiTags('supplier-return-executions')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('warehouse/supplier-return-executions')
export class SupplierReturnExecutionsController {
  constructor(
    private readonly supplierReturnExecutionsService: SupplierReturnExecutionsService,
    private readonly warehouseActivity: WarehouseActivityService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_READ)
  @ApiOperation({ summary: 'List supplier return executions' })
  async list(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListSupplierReturnExecutionsQueryDto,
  ) {
    return this.supplierReturnExecutionsService.listExecutions(company, query);
  }

  @Get(':executionId/activity')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_READ)
  @ApiOperation({ summary: 'Business activity timeline for a supplier return execution' })
  async activity(
    @CurrentCompany() company: CompanyContext,
    @Param('executionId', ParseUUIDPipe) executionId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.warehouseActivity.listForEntity(
      company,
      'SUPPLIER_RETURN_EXECUTION',
      executionId,
      query,
    );
  }

  @Get(':executionId')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_READ)
  @ApiOperation({ summary: 'Supplier return execution detail' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('executionId', ParseUUIDPipe) executionId: string,
  ) {
    const data = await this.supplierReturnExecutionsService.getExecution(company, executionId);
    return { data };
  }

  @Patch(':executionId')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_UPDATE_EXECUTION)
  @ApiOperation({ summary: 'Update DRAFT execution (notes / replace items)' })
  async update(
    @CurrentCompany() company: CompanyContext,
    @Param('executionId', ParseUUIDPipe) executionId: string,
    @Body() body: UpdateSupplierReturnExecutionDto,
  ) {
    const data = await this.supplierReturnExecutionsService.updateExecution(
      company,
      executionId,
      body,
    );
    return { data };
  }

  @Post(':executionId/items')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_UPDATE_EXECUTION)
  @ApiOperation({ summary: 'Upsert DRAFT execution item' })
  async upsertItem(
    @CurrentCompany() company: CompanyContext,
    @Param('executionId', ParseUUIDPipe) executionId: string,
    @Body() body: UpsertSupplierReturnExecutionItemDto,
  ) {
    const data = await this.supplierReturnExecutionsService.upsertItem(company, executionId, body);
    return { data };
  }

  @Delete(':executionId/items/:itemId')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_UPDATE_EXECUTION)
  @ApiOperation({ summary: 'Remove DRAFT execution item' })
  async removeItem(
    @CurrentCompany() company: CompanyContext,
    @Param('executionId', ParseUUIDPipe) executionId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    const data = await this.supplierReturnExecutionsService.removeItem(
      company,
      executionId,
      itemId,
    );
    return { data };
  }

  @Post(':executionId/scan-apply')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_UPDATE_EXECUTION)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Scanner-friendly DRAFT line upsert (idempotent by requestId)' })
  async scanApply(
    @CurrentCompany() company: CompanyContext,
    @Param('executionId', ParseUUIDPipe) executionId: string,
    @Body() body: ScanApplySupplierReturnExecutionDto,
  ) {
    const data = await this.supplierReturnExecutionsService.scanApply(company, executionId, body);
    return { data };
  }

  @Post(':executionId/dispatch')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_DISPATCH)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Dispatch execution (RETURN_OUT movements)',
    description: 'Idempotent if already DISPATCHED.',
  })
  async dispatch(
    @CurrentCompany() company: CompanyContext,
    @Param('executionId', ParseUUIDPipe) executionId: string,
  ) {
    const data = await this.supplierReturnExecutionsService.dispatch(company, executionId);
    return { data };
  }

  @Post(':executionId/cancel')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_CANCEL_EXECUTION)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel DRAFT supplier return execution' })
  async cancel(
    @CurrentCompany() company: CompanyContext,
    @Param('executionId', ParseUUIDPipe) executionId: string,
  ) {
    const data = await this.supplierReturnExecutionsService.cancelExecution(company, executionId);
    return { data };
  }
}
