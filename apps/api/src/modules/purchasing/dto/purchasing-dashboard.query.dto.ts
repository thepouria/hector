import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  CurrencyCode,
  PurchaseCommercialType,
  PurchaseOrderStatus,
} from '@hector/database';
import { IsDateString, IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { IsDateRangeStart } from './date-range.constraint';

const RANGE_PRESETS = ['7d', '30d', '90d', 'this_month', 'last_month', 'custom'] as const;

export class PurchasingDashboardQueryDto {
  @ApiPropertyOptional({
    enum: RANGE_PRESETS,
    description: 'Analytics period preset. Default 30d. Use custom with from/to.',
  })
  @IsOptional()
  @IsIn(RANGE_PRESETS)
  range?: (typeof RANGE_PRESETS)[number];

  @ApiPropertyOptional({ description: 'Custom range start (ISO date/datetime, UTC business day)' })
  @IsOptional()
  @IsDateString()
  @IsDateRangeStart('to')
  from?: string;

  @ApiPropertyOptional({ description: 'Custom range end (ISO date/datetime)' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ enum: PurchaseCommercialType })
  @IsOptional()
  @IsEnum(PurchaseCommercialType)
  purchaseType?: PurchaseCommercialType;

  @ApiPropertyOptional({ enum: PurchaseOrderStatus })
  @IsOptional()
  @IsEnum(PurchaseOrderStatus)
  status?: PurchaseOrderStatus;

  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode;
}
