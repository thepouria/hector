import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SalesReturnCondition, SalesReturnReason } from '@hector/database';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
  SALES_ORDER_MAX_ITEMS,
  SALES_ORDER_MAX_QUANTITY,
  SALES_RETURN_NOTES_MAX_LENGTH,
} from '../sales.constants';

export class SalesReturnItemInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  salesOrderItemId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  skuId!: string;

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SALES_ORDER_MAX_QUANTITY)
  quantity!: number;

  @ApiPropertyOptional({ enum: SalesReturnReason })
  @IsOptional()
  @IsEnum(SalesReturnReason)
  reason?: SalesReturnReason;

  @ApiPropertyOptional({ enum: SalesReturnCondition })
  @IsOptional()
  @IsEnum(SalesReturnCondition)
  condition?: SalesReturnCondition;
}

export class CreateSalesReturnDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  salesOrderId!: string;

  @ApiPropertyOptional({ enum: SalesReturnReason })
  @IsOptional()
  @IsEnum(SalesReturnReason)
  reason?: SalesReturnReason;

  @ApiPropertyOptional({ enum: SalesReturnCondition })
  @IsOptional()
  @IsEnum(SalesReturnCondition)
  condition?: SalesReturnCondition;

  @ApiPropertyOptional({ maxLength: SALES_RETURN_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SALES_RETURN_NOTES_MAX_LENGTH)
  notes?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  requestId?: string;

  @ApiProperty({ type: [SalesReturnItemInputDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(SALES_ORDER_MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => SalesReturnItemInputDto)
  items!: SalesReturnItemInputDto[];
}

export class CancelSalesReturnDto {
  @ApiPropertyOptional({ maxLength: SALES_RETURN_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SALES_RETURN_NOTES_MAX_LENGTH)
  notes?: string;
}
