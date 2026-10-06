import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CurrencyCode,
  PaymentTermType,
  PurchaseCommercialType,
} from '@hector/database';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { SUPPLIER_OFFER_NOTES_MAX_LENGTH } from '../purchasing.constants';

/**
 * Create a historical supplier price quote.
 * Money: `unitPrice` is a decimal string. When `currency=IRR`, amount is in **rials**
 * (UI may collect Toman and convert ×10). Never send JS floating money authority.
 */
export class CreateSupplierOfferDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  supplierId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  skuId!: string;

  @ApiProperty({
    example: '5850000',
    description: 'Decimal string. IRR = rials. USD may include fractional digits.',
  })
  @IsString()
  @IsNotEmpty()
  unitPrice!: string;

  @ApiProperty({ enum: CurrencyCode, example: CurrencyCode.IRR })
  @IsEnum(CurrencyCode)
  currency!: CurrencyCode;

  @ApiProperty({
    example: '2026-10-03T10:00:00.000Z',
    description: 'When the supplier quoted (may differ from createdAt).',
  })
  @IsDateString()
  quotedAt!: string;

  @ApiPropertyOptional({ enum: PurchaseCommercialType })
  @IsOptional()
  @IsEnum(PurchaseCommercialType)
  purchaseType?: PurchaseCommercialType;

  @ApiPropertyOptional({ enum: PaymentTermType })
  @IsOptional()
  @IsEnum(PaymentTermType)
  paymentTermType?: PaymentTermType;

  @ApiPropertyOptional({ example: 30, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  netDays?: number;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  quotedQuantity?: number;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  minimumQuantity?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  availableQuantity?: number;

  @ApiPropertyOptional({
    example: '2050000',
    description: 'Reference FX rate as decimal string (pair required when set).',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  referenceFxRate?: string;

  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  referenceFxBaseCurrency?: CurrencyCode;

  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  referenceFxQuoteCurrency?: CurrencyCode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  supplierContactId?: string;

  @ApiPropertyOptional({ maxLength: SUPPLIER_OFFER_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SUPPLIER_OFFER_NOTES_MAX_LENGTH)
  notes?: string;
}
