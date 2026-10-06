import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import {
  PURCHASE_DISCREPANCY_NOTES_MAX_LENGTH,
  PURCHASE_DISCREPANCY_REASON_MAX_LENGTH,
  PURCHASE_ORDER_MAX_QUANTITY,
} from '../purchasing.constants';

export class ShortClosePurchaseOrderItemDto {
  @ApiPropertyOptional({
    description:
      'Additional quantity to short-close (never rewrites ordered quantity). ' +
      'When omitted, closes all remaining expected (ordered − posted − already short).',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(PURCHASE_ORDER_MAX_QUANTITY)
  quantity?: number;

  @ApiProperty({ minLength: 1, maxLength: PURCHASE_DISCREPANCY_REASON_MAX_LENGTH })
  @IsString()
  @MinLength(1)
  @MaxLength(PURCHASE_DISCREPANCY_REASON_MAX_LENGTH)
  reason!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(PURCHASE_DISCREPANCY_NOTES_MAX_LENGTH)
  notes?: string;

  @ApiPropertyOptional({ description: 'PO optimistic concurrency version' })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}
