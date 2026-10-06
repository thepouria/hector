import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hector/database';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ERROR_CODES } from '../../common/constants';
import { AppError } from '../../common/exceptions/app.error';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentCompany } from '../companies/decorators/current-company.decorator';
import { ApiCompanyHeader, RequireCompany } from '../companies/decorators/require-company.decorator';
import type { CompanyContext } from '../companies/types/company.types';
import { BarcodesService } from '../catalog/barcodes.service';
import { WarehouseLocationsService } from './warehouse-locations.service';

const BARCODE_MAX = 128;

class ScannerBarcodeQueryDto {
  @ApiProperty({
    description: 'Exact barcode string (leading zeros preserved; not numeric)',
    maxLength: BARCODE_MAX,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(BARCODE_MAX)
  barcode!: string;
}

/**
 * Bounded scanner resolvers (Phase 3.16).
 * Orchestration only — mutations go through canonical domain command endpoints.
 */
@ApiTags('warehouse-scanner')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('warehouse/scanner')
export class WarehouseScannerController {
  constructor(
    private readonly barcodesService: BarcodesService,
    private readonly locationsService: WarehouseLocationsService,
    private readonly database: DatabaseService,
  ) {}

  @Get('products/resolve')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_SCANNER_USE)
  @ApiOperation({
    summary: 'Exact product barcode resolve for scanner UX',
    description:
      'Delegates to Catalog barcode resolve. Leading zeros preserved. Does not create Product/SKU.',
  })
  async resolveProduct(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ScannerBarcodeQueryDto,
  ) {
    const resolved = await this.barcodesService.resolve(company, query.barcode);
    return {
      data: {
        barcode: resolved.barcode.value,
        barcodeType: resolved.barcode.type,
        skuId: resolved.sku.id,
        skuCode: resolved.sku.code,
        skuName: resolved.sku.name,
        skuStatus: resolved.sku.status,
        productId: resolved.product.id,
        productName: resolved.product.name,
        productCode: resolved.product.code,
        variantLabel: resolved.sku.name,
      },
    };
  }

  @Get('locations/resolve')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_SCANNER_USE)
  @ApiOperation({
    summary: 'Exact location barcode resolve for scanner UX',
    description: 'Exact match only. Leading zeros preserved.',
  })
  async resolveLocation(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ScannerBarcodeQueryDto,
  ) {
    const location = await this.locationsService.resolveBarcode(company, query.barcode);
    const warehouse = await this.database.client.warehouse.findFirst({
      where: { id: location.warehouseId, companyId: company.companyId },
      select: { id: true, code: true, name: true, status: true },
    });
    if (!warehouse) {
      throw new AppError({
        code: ERROR_CODES.WAREHOUSE_NOT_FOUND,
        message: 'Warehouse not found.',
        statusCode: 404,
      });
    }
    return {
      data: {
        locationId: location.id,
        locationCode: location.code,
        locationName: location.name,
        locationBarcode: location.barcode,
        locationType: location.type,
        locationStatus: location.status,
        warehouseId: warehouse.id,
        warehouseCode: warehouse.code,
        warehouseName: warehouse.name,
        warehouseStatus: warehouse.status,
        pathCodes: (location.breadcrumb ?? []).map((b) => b.code),
      },
    };
  }
}
