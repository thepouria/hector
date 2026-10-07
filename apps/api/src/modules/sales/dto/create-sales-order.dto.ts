import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CurrencyCode,
  SalesOrderPaymentTermType,
  SalesOrderSource,
} from '@hector/database';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  SALES_ORDER_EXTERNAL_ID_MAX_LENGTH,
  SALES_ORDER_MAX_ITEMS,
  SALES_ORDER_NOTES_MAX_LENGTH,
  SALES_ORDER_SNAPSHOT_MAX_LENGTH,
} from '../sales.constants';
import { SalesOrderItemInputDto } from './sales-order-item.dto';

/**
 * Create a DRAFT sales order. `orderNumber`, `status`, and money totals are server-owned.
 */
export class CreateSalesOrderDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  channelId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiProperty({ enum: CurrencyCode, example: CurrencyCode.IRR })
  @IsEnum(CurrencyCode)
  currency!: CurrencyCode;

  @ApiProperty({ enum: SalesOrderPaymentTermType })
  @IsEnum(SalesOrderPaymentTermType)
  paymentTermType!: SalesOrderPaymentTermType;

  @ApiPropertyOptional({ description: 'CREDIT/PARTIAL due date (ISO).' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({
    description: 'PARTIAL commercial agreement only — not paidAmount.',
  })
  @IsOptional()
  @IsString()
  expectedUpfrontAmount?: string;

  @ApiPropertyOptional({ enum: SalesOrderSource, default: SalesOrderSource.MANUAL })
  @IsOptional()
  @IsEnum(SalesOrderSource)
  source?: SalesOrderSource;

  @ApiPropertyOptional({ maxLength: SALES_ORDER_EXTERNAL_ID_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SALES_ORDER_EXTERNAL_ID_MAX_LENGTH)
  externalOrderId?: string;

  @ApiPropertyOptional({ maxLength: SALES_ORDER_EXTERNAL_ID_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SALES_ORDER_EXTERNAL_ID_MAX_LENGTH)
  externalReference?: string;

  @ApiPropertyOptional({ maxLength: SALES_ORDER_SNAPSHOT_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SALES_ORDER_SNAPSHOT_MAX_LENGTH)
  customerNameSnapshot?: string;

  @ApiPropertyOptional({ maxLength: SALES_ORDER_SNAPSHOT_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SALES_ORDER_SNAPSHOT_MAX_LENGTH)
  customerPhoneSnapshot?: string;

  @ApiPropertyOptional({ maxLength: SALES_ORDER_SNAPSHOT_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SALES_ORDER_SNAPSHOT_MAX_LENGTH)
  shippingAddressSnapshot?: string;

  @ApiPropertyOptional({ maxLength: SALES_ORDER_SNAPSHOT_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SALES_ORDER_SNAPSHOT_MAX_LENGTH)
  billingAddressSnapshot?: string;

  @ApiPropertyOptional({ description: 'Order-level discount as decimal string. Default 0.' })
  @IsOptional()
  @IsString()
  orderDiscountTotal?: string;

  @ApiPropertyOptional({ description: 'Shipping amount as decimal string. Default 0.' })
  @IsOptional()
  @IsString()
  shippingAmount?: string;

  @ApiPropertyOptional({ description: 'Other charges as decimal string. Default 0.' })
  @IsOptional()
  @IsString()
  otherCharges?: string;

  @ApiPropertyOptional({ maxLength: SALES_ORDER_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SALES_ORDER_NOTES_MAX_LENGTH)
  notes?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Idempotency key.' })
  @IsOptional()
  @IsUUID()
  requestId?: string;

  @ApiProperty({ type: [SalesOrderItemInputDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(SALES_ORDER_MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => SalesOrderItemInputDto)
  items!: SalesOrderItemInputDto[];
}
