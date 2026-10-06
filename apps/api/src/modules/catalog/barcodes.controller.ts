import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hector/database';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentCompany } from '../companies/decorators/current-company.decorator';
import { ApiCompanyHeader, RequireCompany } from '../companies/decorators/require-company.decorator';
import type { CompanyContext } from '../companies/types/company.types';
import { BarcodesService } from './barcodes.service';
import { BarcodeLookupQueryDto } from './dto/barcode-lookup.query.dto';
import { CreateBarcodeDto } from './dto/create-barcode.dto';
import { ResolveBarcodeDto } from './dto/resolve-barcode.dto';

@ApiTags('catalog-barcodes')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('catalog/barcodes')
export class BarcodesController {
  constructor(private readonly barcodesService: BarcodesService) {}

  @Post('resolve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOperation({
    summary: 'Resolve a scanned barcode to SKU + Product (company-scoped exact match)',
    description:
      'Operational scan identity only — never mutates inventory. Archived barcodes return BARCODE_NOT_ACTIVE. SKU/Product status is returned for callers to decide eligibility.',
  })
  async resolve(@CurrentCompany() company: CompanyContext, @Body() body: ResolveBarcodeDto) {
    const data = await this.barcodesService.resolve(company, body.value);
    return { data };
  }

  @Get('lookup')
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOperation({
    summary: 'Resolve barcode (GET alias of POST /resolve)',
    deprecated: true,
  })
  async lookup(
    @CurrentCompany() company: CompanyContext,
    @Query() query: BarcodeLookupQueryDto,
  ) {
    const data = await this.barcodesService.resolve(company, query.value);
    return { data };
  }

  @Get('detect-type')
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOperation({
    summary: 'Suggest barcode type from a raw value (UI helper; not authoritative)',
  })
  async detectType(@Query() query: BarcodeLookupQueryDto) {
    return { data: this.barcodesService.detectType(query.value) };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({
    summary: 'Assign barcode (legacy body skuId) — prefer POST /catalog/skus/:skuId/barcodes',
    deprecated: true,
  })
  async assignLegacy(@CurrentCompany() company: CompanyContext, @Body() body: CreateBarcodeDto) {
    const data = await this.barcodesService.create(company, body.skuId, body);
    return { data };
  }

  @Get(':barcodeId')
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOperation({ summary: 'Get a barcode by id (company-scoped)' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('barcodeId', ParseUUIDPipe) barcodeId: string,
  ) {
    const data = await this.barcodesService.get(company, barcodeId);
    return { data };
  }

  @Post(':barcodeId/set-primary')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({
    summary: 'Set barcode as the SKU primary (atomically demotes other active primaries)',
  })
  async setPrimary(
    @CurrentCompany() company: CompanyContext,
    @Param('barcodeId', ParseUUIDPipe) barcodeId: string,
  ) {
    const data = await this.barcodesService.setPrimary(company, barcodeId);
    return { data };
  }

  @Post(':barcodeId/archive')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({
    summary: 'Archive barcode (non-destructive; value remains reserved)',
    description:
      'If the archived barcode was primary, the oldest remaining active barcode is promoted.',
  })
  async archive(
    @CurrentCompany() company: CompanyContext,
    @Param('barcodeId', ParseUUIDPipe) barcodeId: string,
  ) {
    const data = await this.barcodesService.archive(company, barcodeId);
    return { data };
  }
}
