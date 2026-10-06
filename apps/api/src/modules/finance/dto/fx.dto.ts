import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CurrencyCode,
  FxConversionStatus,
  FxRateSourceType,
  FxRateType,
} from '@hector/database';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  FX_CONVERSION_NOTES_MAX_LENGTH,
  FX_RATE_NOTES_MAX_LENGTH,
  FX_RATE_SOURCE_REFERENCE_MAX_LENGTH,
  FX_SEARCH_MAX_LENGTH,
} from '../finance-fx.constants';

export class CreateFxRateDto {
  @ApiProperty({ enum: CurrencyCode })
  @IsEnum(CurrencyCode)
  baseCurrency!: CurrencyCode;

  @ApiProperty({ enum: CurrencyCode })
  @IsEnum(CurrencyCode)
  quoteCurrency!: CurrencyCode;

  @ApiProperty({ example: '250000', description: '1 base = rate quote' })
  @IsString()
  rate!: string;

  @ApiProperty({ enum: FxRateType })
  @IsEnum(FxRateType)
  rateType!: FxRateType;

  @ApiPropertyOptional({ enum: FxRateSourceType, default: FxRateSourceType.MANUAL })
  @IsOptional()
  @IsEnum(FxRateSourceType)
  sourceType?: FxRateSourceType;

  @ApiPropertyOptional({ maxLength: FX_RATE_SOURCE_REFERENCE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(FX_RATE_SOURCE_REFERENCE_MAX_LENGTH)
  sourceReference?: string;

  @ApiPropertyOptional({ description: 'ISO-8601; defaults to now.' })
  @IsOptional()
  @IsISO8601()
  effectiveAt?: string;

  @ApiPropertyOptional({ maxLength: FX_RATE_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(FX_RATE_NOTES_MAX_LENGTH)
  notes?: string;
}

export class ListFxRatesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  baseCurrency?: CurrencyCode;

  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  quoteCurrency?: CurrencyCode;

  @ApiPropertyOptional({ enum: FxRateType })
  @IsOptional()
  @IsEnum(FxRateType)
  rateType?: FxRateType;

  @ApiPropertyOptional({ enum: FxRateSourceType })
  @IsOptional()
  @IsEnum(FxRateSourceType)
  sourceType?: FxRateSourceType;

  @ApiPropertyOptional({ description: 'Include archived rates when true.' })
  @IsOptional()
  @IsBoolean()
  includeArchived?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  asOf?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(FX_SEARCH_MAX_LENGTH)
  q?: string;
}

export class LatestFxRateQueryDto {
  @ApiProperty({ enum: CurrencyCode })
  @IsEnum(CurrencyCode)
  base!: CurrencyCode;

  @ApiProperty({ enum: CurrencyCode })
  @IsEnum(CurrencyCode)
  quote!: CurrencyCode;

  @ApiProperty({ enum: FxRateType })
  @IsEnum(FxRateType)
  rateType!: FxRateType;

  @ApiPropertyOptional({ description: 'ISO-8601; defaults to now.' })
  @IsOptional()
  @IsISO8601()
  asOf?: string;
}

export class CreateFxConversionDto {
  @ApiProperty()
  @IsUUID()
  sourceAccountId!: string;

  @ApiProperty()
  @IsUUID()
  destinationAccountId!: string;

  @ApiProperty({ example: '250000000' })
  @IsString()
  fromAmount!: string;

  @ApiProperty({ enum: CurrencyCode })
  @IsEnum(CurrencyCode)
  fromCurrency!: CurrencyCode;

  @ApiProperty({ example: '1000' })
  @IsString()
  toAmount!: string;

  @ApiProperty({ enum: CurrencyCode })
  @IsEnum(CurrencyCode)
  toCurrency!: CurrencyCode;

  @ApiProperty({ example: '250000', description: '1 rateBase = appliedRate rateQuote' })
  @IsString()
  appliedRate!: string;

  @ApiProperty({ enum: CurrencyCode })
  @IsEnum(CurrencyCode)
  rateBaseCurrency!: CurrencyCode;

  @ApiProperty({ enum: CurrencyCode })
  @IsEnum(CurrencyCode)
  rateQuoteCurrency!: CurrencyCode;

  @ApiPropertyOptional({ description: 'Optional link to stored FxRate row.' })
  @IsOptional()
  @IsUUID()
  fxRateId?: string;

  @ApiPropertyOptional({ description: 'Optional fee amount (foundation for 4.7).' })
  @IsOptional()
  @IsString()
  feeAmount?: string;

  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  feeCurrency?: CurrencyCode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  feeAccountId?: string;

  @ApiPropertyOptional({ description: 'ISO-8601; defaults to now.' })
  @IsOptional()
  @IsISO8601()
  effectiveAt?: string;

  @ApiPropertyOptional({ maxLength: FX_CONVERSION_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(FX_CONVERSION_NOTES_MAX_LENGTH)
  notes?: string;

  @ApiPropertyOptional({
    description: 'When true, create as DRAFT then post in the same transaction.',
  })
  @IsOptional()
  @IsBoolean()
  postImmediately?: boolean;

  @ApiProperty({ description: 'Idempotency key (UUID).' })
  @IsUUID()
  requestId!: string;
}

export class ListFxConversionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: FxConversionStatus })
  @IsOptional()
  @IsEnum(FxConversionStatus)
  status?: FxConversionStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sourceAccountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  destinationAccountId?: string;

  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  fromCurrency?: CurrencyCode;

  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  toCurrency?: CurrencyCode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(FX_SEARCH_MAX_LENGTH)
  q?: string;
}

export class FxConvertPreviewDto {
  @ApiProperty({ example: '250000000' })
  @IsString()
  fromAmount!: string;

  @ApiProperty({ enum: CurrencyCode })
  @IsEnum(CurrencyCode)
  fromCurrency!: CurrencyCode;

  @ApiProperty({ enum: CurrencyCode })
  @IsEnum(CurrencyCode)
  toCurrency!: CurrencyCode;

  @ApiProperty({ example: '250000' })
  @IsString()
  appliedRate!: string;

  @ApiProperty({ enum: CurrencyCode })
  @IsEnum(CurrencyCode)
  rateBaseCurrency!: CurrencyCode;

  @ApiProperty({ enum: CurrencyCode })
  @IsEnum(CurrencyCode)
  rateQuoteCurrency!: CurrencyCode;
}

export class FxValuationQueryDto {
  @ApiPropertyOptional({ description: 'ISO-8601; defaults to now.' })
  @IsOptional()
  @IsISO8601()
  asOf?: string;

  @ApiPropertyOptional({
    enum: FxRateType,
    description: 'Preferred rate type (default VALUATION). Falls back to REFERENCE when missing.',
  })
  @IsOptional()
  @IsEnum(FxRateType)
  rateType?: FxRateType;
}
