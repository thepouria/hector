import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
  CreateFxConversionDto,
  CreateFxRateDto,
  FxConvertPreviewDto,
  FxValuationQueryDto,
  LatestFxRateQueryDto,
  ListFxConversionsQueryDto,
  ListFxRatesQueryDto,
} from './dto/fx.dto';
import { FxConversionsService } from './fx-conversions.service';
import { FxPositionsService } from './fx-positions.service';
import { FxRatesService } from './fx-rates.service';

@ApiTags('finance-fx')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('finance/fx')
export class FxController {
  constructor(
    private readonly ratesService: FxRatesService,
    private readonly conversionsService: FxConversionsService,
    private readonly positionsService: FxPositionsService,
  ) {}

  // --- Rates ---

  @Get('rates')
  @RequirePermissions(PERMISSIONS.FINANCE_FX_READ)
  @ApiOperation({ summary: 'List FX rates (immutable history)' })
  async listRates(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListFxRatesQueryDto,
  ) {
    return this.ratesService.list(company, query);
  }

  @Get('rates/latest')
  @RequirePermissions(PERMISSIONS.FINANCE_FX_READ)
  @ApiOperation({ summary: 'Latest applicable FX rate asOf' })
  async latestRate(
    @CurrentCompany() company: CompanyContext,
    @Query() query: LatestFxRateQueryDto,
  ) {
    return this.ratesService.latest(company, query);
  }

  @Get('rates/:rateId')
  @RequirePermissions(PERMISSIONS.FINANCE_FX_READ)
  @ApiOperation({ summary: 'Get FX rate by id' })
  async getRate(
    @CurrentCompany() company: CompanyContext,
    @Param('rateId', ParseUUIDPipe) rateId: string,
  ) {
    const data = await this.ratesService.get(company, rateId);
    return { data };
  }

  @Post('rates')
  @RequirePermissions(PERMISSIONS.FINANCE_FX_MANAGE)
  @ApiOperation({ summary: 'Create a new FX rate snapshot (rates are immutable)' })
  async createRate(
    @CurrentCompany() company: CompanyContext,
    @Body() body: CreateFxRateDto,
  ) {
    const data = await this.ratesService.create(company, body);
    return { data };
  }

  @Post('rates/:rateId/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FINANCE_FX_MANAGE)
  @ApiOperation({ summary: 'Soft-archive an FX rate (no hard delete)' })
  async archiveRate(
    @CurrentCompany() company: CompanyContext,
    @Param('rateId', ParseUUIDPipe) rateId: string,
  ) {
    const data = await this.ratesService.archive(company, rateId);
    return { data };
  }

  // --- Conversions ---

  @Get('conversions')
  @RequirePermissions(PERMISSIONS.FINANCE_FX_READ)
  @ApiOperation({ summary: 'List FX conversions' })
  async listConversions(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListFxConversionsQueryDto,
  ) {
    return this.conversionsService.list(company, query);
  }

  @Get('conversions/:conversionId')
  @RequirePermissions(PERMISSIONS.FINANCE_FX_READ)
  @ApiOperation({ summary: 'Get FX conversion detail' })
  async getConversion(
    @CurrentCompany() company: CompanyContext,
    @Param('conversionId', ParseUUIDPipe) conversionId: string,
  ) {
    const data = await this.conversionsService.get(company, conversionId);
    return { data };
  }

  @Post('conversions')
  @RequirePermissions(PERMISSIONS.FINANCE_FX_MANAGE)
  @ApiOperation({ summary: 'Create (and optionally post) an FX conversion' })
  async createConversion(
    @CurrentCompany() company: CompanyContext,
    @Body() body: CreateFxConversionDto,
  ) {
    const data = await this.conversionsService.create(company, body);
    return { data };
  }

  @Post('conversions/:conversionId/post')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FINANCE_FX_MANAGE)
  @ApiOperation({ summary: 'Post a DRAFT FX conversion (MONEY_OUT + MONEY_IN)' })
  async postConversion(
    @CurrentCompany() company: CompanyContext,
    @Param('conversionId', ParseUUIDPipe) conversionId: string,
  ) {
    const data = await this.conversionsService.post(company, conversionId);
    return { data };
  }

  @Post('conversions/:conversionId/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FINANCE_FX_MANAGE)
  @ApiOperation({ summary: 'Cancel a DRAFT FX conversion' })
  async cancelConversion(
    @CurrentCompany() company: CompanyContext,
    @Param('conversionId', ParseUUIDPipe) conversionId: string,
  ) {
    const data = await this.conversionsService.cancel(company, conversionId);
    return { data };
  }

  @Post('conversions/:conversionId/reverse')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FINANCE_FX_MANAGE)
  @ApiOperation({
    summary: 'Reverse a POSTED FX conversion using ORIGINAL amounts (not market rate)',
  })
  async reverseConversion(
    @CurrentCompany() company: CompanyContext,
    @Param('conversionId', ParseUUIDPipe) conversionId: string,
  ) {
    const data = await this.conversionsService.reverse(company, conversionId);
    return { data };
  }

  // --- Preview / Positions / Valuation ---

  @Post('convert/preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FINANCE_FX_MANAGE)
  @ApiOperation({ summary: 'Preview FX convertMoney result (no posting)' })
  async preview(@Body() body: FxConvertPreviewDto) {
    const data = this.conversionsService.preview(body);
    return { data };
  }

  @Get('positions')
  @RequirePermissions(PERMISSIONS.FINANCE_FX_READ)
  @ApiOperation({
    summary:
      'Currency positions: cash + payable + loan outstanding; net = cash − payables − loans',
  })
  async positions(@CurrentCompany() company: CompanyContext) {
    const data = await this.positionsService.positions(company);
    return { data };
  }

  @Get('valuation')
  @RequirePermissions(PERMISSIONS.FINANCE_FX_READ)
  @ApiOperation({
    summary:
      'Read-only valuation of positions (VALUATION rate, REFERENCE fallback). UNAVAILABLE ≠ zero.',
  })
  async valuation(
    @CurrentCompany() company: CompanyContext,
    @Query() query: FxValuationQueryDto,
  ) {
    const data = await this.positionsService.valuation(company, query);
    return { data };
  }
}
