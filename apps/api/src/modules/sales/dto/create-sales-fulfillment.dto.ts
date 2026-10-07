import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StockClassification } from '@hector/database';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
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
  SALES_FULFILLMENT_NOTES_MAX_LENGTH,
  SALES_ORDER_MAX_QUANTITY,
} from '../sales.constants';

export class SalesFulfillmentItemInputDto {
  @ApiProperty()
  @IsUUID()
  salesOrderItemId!: string;

  @ApiProperty()
  @IsUUID()
  skuId!: string;

  @ApiProperty()
  @IsUUID()
  locationId!: string;

  @ApiProperty()
  @IsUUID()
  batchId!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(SALES_ORDER_MAX_QUANTITY)
  quantity!: number;

  @ApiPropertyOptional({ enum: StockClassification, default: StockClassification.SELLABLE })
  @IsOptional()
  @IsEnum(StockClassification)
  classification?: StockClassification;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(SALES_FULFILLMENT_NOTES_MAX_LENGTH)
  notes?: string;
}

export class CreateSalesFulfillmentDto {
  @ApiProperty()
  @IsUUID()
  salesOrderId!: string;

  @ApiProperty()
  @IsUUID()
  warehouseId!: string;

  @ApiProperty({ type: [SalesFulfillmentItemInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SalesFulfillmentItemInputDto)
  items!: SalesFulfillmentItemInputDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(SALES_FULFILLMENT_NOTES_MAX_LENGTH)
  notes?: string;

  @ApiPropertyOptional({ description: 'Idempotency key' })
  @IsOptional()
  @IsUUID()
  requestId?: string;
}
