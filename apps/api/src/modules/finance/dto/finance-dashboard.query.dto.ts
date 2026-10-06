import { ApiPropertyOptional } from '@nestjs/swagger';
import { CurrencyCode } from '@hector/database';
import { IsDateString, IsEnum, IsIn, IsOptional } from 'class-validator';

const RANGE_PRESETS = ['today', '1d', '7d', '30d', 'this_month', 'custom'] as const;

export class FinanceDashboardQueryDto {
  @ApiPropertyOptional({
    enum: RANGE_PRESETS,
    description: 'Period metrics preset. Default 30d. Snapshot metrics ignore this.',
  })
  @IsOptional()
  @IsIn(RANGE_PRESETS)
  range?: (typeof RANGE_PRESETS)[number];

  @ApiPropertyOptional({ description: 'Custom range start (ISO date/datetime, UTC business day)' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Custom range end (ISO date/datetime)' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    enum: CurrencyCode,
    description: 'Currency for cash movement trend series (never mixed with other currencies)',
  })
  @IsOptional()
  @IsEnum(CurrencyCode)
  chartCurrency?: CurrencyCode;
}
