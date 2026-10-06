import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  CurrencyCode,
  PaymentTermType,
  PurchaseCommercialType,
} from '@hector/database';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { SUPPLIER_OFFER_NOTES_MAX_LENGTH } from '../purchasing.constants';

/** Controlled correction of a recorded quote. Commercial changes are audited. */
export class UpdateSupplierOfferDto {
  @ApiPropertyOptional({ description: 'Decimal string' })
  @IsOptional()
  @IsString()
  unitPrice?: string;

  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode;

  @ApiPropertyOptional({ enum: PurchaseCommercialType, nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsEnum(PurchaseCommercialType)
  purchaseType?: PurchaseCommercialType | null;

  @ApiPropertyOptional({ enum: PaymentTermType, nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsEnum(PaymentTermType)
  paymentTermType?: PaymentTermType | null;

  @ApiPropertyOptional({ nullable: true, minimum: 1 })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  netDays?: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: 1 })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  quotedQuantity?: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: 1 })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  minimumQuantity?: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  availableQuantity?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  referenceFxRate?: string | null;

  @ApiPropertyOptional({ enum: CurrencyCode, nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsEnum(CurrencyCode)
  referenceFxBaseCurrency?: CurrencyCode | null;

  @ApiPropertyOptional({ enum: CurrencyCode, nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsEnum(CurrencyCode)
  referenceFxQuoteCurrency?: CurrencyCode | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  quotedAt?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  validUntil?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  supplierContactId?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: SUPPLIER_OFFER_NOTES_MAX_LENGTH })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(SUPPLIER_OFFER_NOTES_MAX_LENGTH)
  notes?: string | null;
}
