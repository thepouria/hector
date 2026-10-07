import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';

const RANGE_PRESETS = ['today', '7d', '30d', 'custom'] as const;

export class SalesDashboardQueryDto {
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
  from?: string;

  @ApiPropertyOptional({ description: 'Custom range end (ISO date/datetime)' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Optional sales channel filter' })
  @IsOptional()
  @IsUUID()
  channelId?: string;
}
