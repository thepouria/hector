import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
} from 'class-validator';
import {
  PURCHASE_COST_DESCRIPTION_MAX_LENGTH,
  PURCHASE_COST_NOTES_MAX_LENGTH,
  PURCHASE_COST_PAYEE_NAME_MAX_LENGTH,
  PURCHASE_COST_REFERENCE_MAX_LENGTH,
} from '../purchasing.constants';

/**
 * Create a Purchase Order cost (Phase 2.8).
 * System fields (companyId, status, createdBy, void*) are server-owned.
 */
export class CreatePurchaseOrderCostDto {
  @ApiProperty({ enum: PurchaseCostType })
  @IsEnum(PurchaseCostType)
  type!: PurchaseCostType;

  @ApiProperty({
    description: 'Decimal string. IRR = whole rials. USD up to 6 decimals.',
    example: '20000000',
  })
  @IsString()
  @MaxLength(40)
  amount!: string;

  @ApiProperty({ enum: CurrencyCode })
  @IsEnum(CurrencyCode)
  currency!: CurrencyCode;

  @ApiPropertyOptional({
    description: 'Required when type=OTHER. Optional otherwise.',
    maxLength: PURCHASE_COST_DESCRIPTION_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(PURCHASE_COST_DESCRIPTION_MAX_LENGTH)
  description?: string;

  @ApiPropertyOptional({
    description: 'Business cost date (ISO date or datetime). Defaults to today UTC.',
  })
  @IsOptional()
  @IsDateString()
  costDate?: string;

  @ApiPropertyOptional({ maxLength: PURCHASE_COST_PAYEE_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PURCHASE_COST_PAYEE_NAME_MAX_LENGTH)
  payeeName?: string;

  @ApiPropertyOptional({ maxLength: PURCHASE_COST_REFERENCE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PURCHASE_COST_REFERENCE_MAX_LENGTH)
  reference?: string;

  @ApiPropertyOptional({ maxLength: PURCHASE_COST_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PURCHASE_COST_NOTES_MAX_LENGTH)
  notes?: string;

  @ApiPropertyOptional({
    enum: PurchaseCostAllocationMethod,
    description: 'Defaults to UNALLOCATED. Allocation is not performed in Phase 2.8.',
  })
  @IsOptional()
  @IsEnum(PurchaseCostAllocationMethod)
  allocationMethod?: PurchaseCostAllocationMethod;

  @ApiPropertyOptional({
    description: 'Optional supplier link when the PO supplier charged this cost.',
  })
  @IsOptional()
  @IsUUID()
  supplierId?: string;
}
