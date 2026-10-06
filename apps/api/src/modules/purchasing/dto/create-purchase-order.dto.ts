import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CurrencyCode,
  PaymentTermType,
  PurchaseCommercialType,
} from '@hector/database';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  PURCHASE_ORDER_MAX_ITEMS,
  PURCHASE_ORDER_MAX_NET_DAYS,
  PURCHASE_ORDER_NOTES_MAX_LENGTH,
  PURCHASE_ORDER_PAYMENT_TERMS_NOTE_MAX_LENGTH,
} from '../purchasing.constants';
import { PurchaseOrderItemInputDto } from './purchase-order-item.dto';

/**
 * Create a DRAFT purchase order with at least one item.
 * `number`, `status`, `subtotal`, `total`, `dueDate`, and snapshots are server-owned.
 */
export class CreatePurchaseOrderDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  supplierId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  supplierContactId?: string;

  @ApiProperty({ enum: CurrencyCode, example: CurrencyCode.IRR })
  @IsEnum(CurrencyCode)
  currency!: CurrencyCode;

  @ApiPropertyOptional({ enum: PurchaseCommercialType })
  @IsOptional()
  @IsEnum(PurchaseCommercialType)
  purchaseType?: PurchaseCommercialType;

  @ApiPropertyOptional({ enum: PaymentTermType })
  @IsOptional()
  @IsEnum(PaymentTermType)
  paymentTermType?: PaymentTermType;

  @ApiPropertyOptional({ minimum: 1, maximum: PURCHASE_ORDER_MAX_NET_DAYS })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(PURCHASE_ORDER_MAX_NET_DAYS)
  netDays?: number;

  @ApiPropertyOptional({
    description:
      'FIXED_DATE only — explicit contractual due date (ISO date or datetime). Ignored/rejected for NET_DAYS.',
  })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({
    description: 'Optional free-text payment-terms context (not structured authority).',
    maxLength: PURCHASE_ORDER_PAYMENT_TERMS_NOTE_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(PURCHASE_ORDER_PAYMENT_TERMS_NOTE_MAX_LENGTH)
  paymentTermsNote?: string;

  @ApiPropertyOptional({
    description: 'FX_CREDIT only. Usually omitted — server syncs from total on approve.',
  })
  @IsOptional()
  @IsString()
  obligationAmount?: string;

  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  obligationCurrency?: CurrencyCode;

  @ApiPropertyOptional({ description: 'FX_CREDIT reference rate (IRR per USD when quote=IRR).' })
  @IsOptional()
  @IsString()
  referenceFxRate?: string;

  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  referenceFxBaseCurrency?: CurrencyCode;

  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  referenceFxQuoteCurrency?: CurrencyCode;

  @ApiPropertyOptional({
    description:
      'FX_CREDIT: when the reference FX rate was agreed/observed (may differ from orderDate).',
  })
  @IsOptional()
  @IsDateString()
  referenceFxRateAt?: string;

  @ApiPropertyOptional({ description: 'Defaults to now. Its UTC year drives the PO number.' })
  @IsOptional()
  @IsDateString()
  orderDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expectedAt?: string;

  @ApiPropertyOptional({ maxLength: PURCHASE_ORDER_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PURCHASE_ORDER_NOTES_MAX_LENGTH)
  notes?: string;

  @ApiProperty({ type: [PurchaseOrderItemInputDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PURCHASE_ORDER_MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemInputDto)
  items!: PurchaseOrderItemInputDto[];
}
