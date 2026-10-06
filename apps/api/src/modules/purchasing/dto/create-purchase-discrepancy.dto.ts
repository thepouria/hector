import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PurchaseDiscrepancySource, PurchaseDiscrepancyType } from '@hector/database';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  PURCHASE_DISCREPANCY_NOTES_MAX_LENGTH,
  PURCHASE_DISCREPANCY_REASON_MAX_LENGTH,
  PURCHASE_ORDER_MAX_QUANTITY,
} from '../purchasing.constants';

export class CreatePurchaseDiscrepancyDto {
  @ApiProperty()
  @IsUUID()
  purchaseOrderItemId!: string;

  @ApiProperty({ enum: PurchaseDiscrepancyType })
  @IsEnum(PurchaseDiscrepancyType)
  type!: PurchaseDiscrepancyType;

  @ApiProperty({ enum: PurchaseDiscrepancySource })
  @IsEnum(PurchaseDiscrepancySource)
  source!: PurchaseDiscrepancySource;

  @ApiProperty({ description: 'Discrepancy quantity (> 0). Does not rewrite ordered quantity.' })
  @IsInt()
  @Min(1)
  @Max(PURCHASE_ORDER_MAX_QUANTITY)
  quantity!: number;

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
}
