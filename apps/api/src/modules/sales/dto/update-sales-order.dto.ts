import { ApiPropertyOptional } from '@nestjs/swagger';
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

/** DRAFT-only commercial update. When `items` is provided it replaces all lines. */
export class UpdateSalesOrderDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  channelId?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  customerId?: string | null;

  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode;

  @ApiPropertyOptional({ enum: SalesOrderPaymentTermType })
  @IsOptional()
  @IsEnum(SalesOrderPaymentTermType)
  paymentTermType?: SalesOrderPaymentTermType;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  dueDate?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  expectedUpfrontAmount?: string | null;

  @ApiPropertyOptional({ enum: SalesOrderSource })
  @IsOptional()
  @IsEnum(SalesOrderSource)
  source?: SalesOrderSource;

  @ApiPropertyOptional({ nullable: true, maxLength: SALES_ORDER_EXTERNAL_ID_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SALES_ORDER_EXTERNAL_ID_MAX_LENGTH)
  externalOrderId?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: SALES_ORDER_EXTERNAL_ID_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SALES_ORDER_EXTERNAL_ID_MAX_LENGTH)
  externalReference?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: SALES_ORDER_SNAPSHOT_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SALES_ORDER_SNAPSHOT_MAX_LENGTH)
  customerNameSnapshot?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: SALES_ORDER_SNAPSHOT_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SALES_ORDER_SNAPSHOT_MAX_LENGTH)
  customerPhoneSnapshot?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: SALES_ORDER_SNAPSHOT_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SALES_ORDER_SNAPSHOT_MAX_LENGTH)
  shippingAddressSnapshot?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: SALES_ORDER_SNAPSHOT_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SALES_ORDER_SNAPSHOT_MAX_LENGTH)
  billingAddressSnapshot?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  orderDiscountTotal?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  shippingAmount?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  otherCharges?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: SALES_ORDER_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SALES_ORDER_NOTES_MAX_LENGTH)
  notes?: string | null;

  @ApiPropertyOptional({ type: [SalesOrderItemInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(SALES_ORDER_MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => SalesOrderItemInputDto)
  items?: SalesOrderItemInputDto[];
}
