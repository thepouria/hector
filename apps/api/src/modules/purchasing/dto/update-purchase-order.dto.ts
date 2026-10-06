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
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  PURCHASE_ORDER_MAX_NET_DAYS,
  PURCHASE_ORDER_NOTES_MAX_LENGTH,
  PURCHASE_ORDER_PAYMENT_TERMS_NOTE_MAX_LENGTH,
} from '../purchasing.constants';

/**
 * Header update.
 * DRAFT: commercial fields including purchase type / terms.
 * APPROVED/ORDERED: only `notes` and `expectedAt`.
 * Supplier / currency cannot change while the PO has items.
 * `dueDate` is server-computed for NET_DAYS + ORDER_DATE and is not accepted.
 */
export class UpdatePurchaseOrderDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  supplierContactId?: string | null;

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

  @ApiPropertyOptional({ minimum: 1, maximum: PURCHASE_ORDER_MAX_NET_DAYS, nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(PURCHASE_ORDER_MAX_NET_DAYS)
  netDays?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'FIXED_DATE only. NET_DAYS dueDate is server-calculated.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  dueDate?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: PURCHASE_ORDER_PAYMENT_TERMS_NOTE_MAX_LENGTH,
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(PURCHASE_ORDER_PAYMENT_TERMS_NOTE_MAX_LENGTH)
  paymentTermsNote?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  obligationAmount?: string | null;

  @ApiPropertyOptional({ enum: CurrencyCode, nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsEnum(CurrencyCode)
  obligationCurrency?: CurrencyCode | null;

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

  @ApiPropertyOptional({
    nullable: true,
    description: 'FX_CREDIT: when the reference FX rate was agreed/observed.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  referenceFxRateAt?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  orderDate?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  expectedAt?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: PURCHASE_ORDER_NOTES_MAX_LENGTH })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(PURCHASE_ORDER_NOTES_MAX_LENGTH)
  notes?: string | null;

  @ApiPropertyOptional({ minimum: 1, description: 'Optimistic concurrency guard.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}
