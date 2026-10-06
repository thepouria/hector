import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hector/database';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentCompany } from '../companies/decorators/current-company.decorator';
import { ApiCompanyHeader, RequireCompany } from '../companies/decorators/require-company.decorator';
import type { CompanyContext } from '../companies/types/company.types';
import { BarcodesService } from './barcodes.service';
import { CreateSkuBarcodeDto } from './dto/create-sku-barcode.dto';

@ApiTags('catalog-barcodes')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('catalog/skus/:skuId/barcodes')
export class SkuBarcodesController {
  constructor(private readonly barcodesService: BarcodesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOperation({ summary: 'List barcodes for a SKU (includes archived)' })
  async list(
    @CurrentCompany() company: CompanyContext,
    @Param('skuId', ParseUUIDPipe) skuId: string,
  ) {
    const data = await this.barcodesService.listForSku(company, skuId);
    return { data };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({
    summary: 'Assign an external/manual barcode to a SKU',
    description:
      'Value and type are immutable after create. First active barcode becomes primary unless overridden.',
  })
  async create(
    @CurrentCompany() company: CompanyContext,
    @Param('skuId', ParseUUIDPipe) skuId: string,
    @Body() body: CreateSkuBarcodeDto,
  ) {
    const data = await this.barcodesService.create(company, skuId, body);
    return { data };
  }

  @Post('generate-internal')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({
    summary: 'Generate a Hector INTERNAL barcode for a SKU',
    description:
      'Server-generated HCT-* value. At most one active INTERNAL barcode per SKU. Rendered as CODE128 on labels.',
  })
  async generateInternal(
    @CurrentCompany() company: CompanyContext,
    @Param('skuId', ParseUUIDPipe) skuId: string,
  ) {
    const data = await this.barcodesService.generateInternal(company, skuId);
    return { data };
  }
}
