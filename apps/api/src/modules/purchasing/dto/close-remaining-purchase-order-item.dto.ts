import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import {
  PURCHASE_DISCREPANCY_NOTES_MAX_LENGTH,
  PURCHASE_DISCREPANCY_REASON_MAX_LENGTH,
} from '../purchasing.constants';

/**
 * Close all currently remaining expected quantity as short (Phase 3.5).
 * Server recalculates remaining = ordered − posted − short under PO lock.
 */
export class CloseRemainingPurchaseOrderItemDto {
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
