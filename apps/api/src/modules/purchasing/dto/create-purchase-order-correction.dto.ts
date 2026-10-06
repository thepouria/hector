import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentTermType, PurchaseCorrectionType } from '@hector/database';
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
  ValidateIf,
} from 'class-validator';
import {
  PURCHASE_CORRECTION_REASON_MAX_LENGTH,
  PURCHASE_ORDER_MAX_NET_DAYS,
  PURCHASE_ORDER_MAX_QUANTITY,
} from '../purchasing.constants';

/**
 * Explicit committed-PO correction command (Phase 2.11).
 * Not a generic field patch — domain-controlled types only.
 */
export class CreatePurchaseOrderCorrectionDto {
  @ApiProperty({ enum: PurchaseCorrectionType })
  @IsEnum(PurchaseCorrectionType)
  type!: PurchaseCorrectionType;

  @ApiProperty({ minLength: 1, maxLength: PURCHASE_CORRECTION_REASON_MAX_LENGTH })
  @IsString()
  @MinLength(1)
  @MaxLength(PURCHASE_CORRECTION_REASON_MAX_LENGTH)
  reason!: string;

  @ApiProperty({ description: 'PO optimistic concurrency version' })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ description: 'Required for quantity/price item corrections' })
  @IsOptional()
  @IsUUID()
  purchaseOrderItemId?: string;

  @ApiPropertyOptional({ description: 'Corrected ordered quantity (item-scoped)' })
  @ValidateIf((o: CreatePurchaseOrderCorrectionDto) => o.quantity !== undefined)
  @IsInt()
  @Min(1)
  @Max(PURCHASE_ORDER_MAX_QUANTITY)
  quantity?: number;

  @ApiPropertyOptional({ description: 'Corrected unit price decimal string (item-scoped)' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  unitPrice?: string;

  @ApiPropertyOptional({ enum: PaymentTermType })
  @IsOptional()
  @IsEnum(PaymentTermType)
  paymentTermType?: PaymentTermType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(PURCHASE_ORDER_MAX_NET_DAYS)
  netDays?: number;

  @ApiPropertyOptional({
    description: 'FIXED_DATE due date (YYYY-MM-DD). Ignored for NET_DAYS (server recalculates).',
  })
  @IsOptional()
  @IsString()
  dueDate?: string;

  @ApiPropertyOptional({
    description: 'FX_CREDIT foreign obligation amount (does not use today FX rate).',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  obligationAmount?: string;

  @ApiPropertyOptional({ description: 'FX_CREDIT reference rate correction (valuation only).' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  referenceFxRate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  referenceFxRateAt?: string;
}
