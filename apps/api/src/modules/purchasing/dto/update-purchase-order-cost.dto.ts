import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  CurrencyCode,
  PurchaseCostAllocationMethod,
  PurchaseCostType,
} from '@hector/database';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  PURCHASE_COST_DESCRIPTION_MAX_LENGTH,
  PURCHASE_COST_NOTES_MAX_LENGTH,
  PURCHASE_COST_PAYEE_NAME_MAX_LENGTH,
  PURCHASE_COST_REFERENCE_MAX_LENGTH,
} from '../purchasing.constants';

/**
 * Draft-only cost edit. Confirmed/historical costs use void + create instead.
 * Mass-assignment of system fields is rejected by ValidationPipe.
 */
export class UpdatePurchaseOrderCostDto {
  @ApiPropertyOptional({ enum: PurchaseCostType })
  @IsOptional()
  @IsEnum(PurchaseCostType)
  type?: PurchaseCostType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  amount?: string;

  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(PURCHASE_COST_DESCRIPTION_MAX_LENGTH)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  costDate?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(PURCHASE_COST_PAYEE_NAME_MAX_LENGTH)
  payeeName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(PURCHASE_COST_REFERENCE_MAX_LENGTH)
  reference?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(PURCHASE_COST_NOTES_MAX_LENGTH)
  notes?: string | null;

  @ApiPropertyOptional({ enum: PurchaseCostAllocationMethod })
  @IsOptional()
  @IsEnum(PurchaseCostAllocationMethod)
  allocationMethod?: PurchaseCostAllocationMethod;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  supplierId?: string | null;
}
