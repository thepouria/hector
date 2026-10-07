import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  SALES_ORDER_MAX_QUANTITY,
  SALES_ORDER_NOTES_MAX_LENGTH,
} from '../sales.constants';

export class SalesOrderItemInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  skuId!: string;

  @ApiProperty({ minimum: 1, maximum: SALES_ORDER_MAX_QUANTITY })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SALES_ORDER_MAX_QUANTITY)
  quantity!: number;

  @ApiProperty({ description: 'Unit price as decimal string (server validates currency scale).' })
  @IsString()
  unitPrice!: string;

  @ApiPropertyOptional({
    description: 'Line discount as decimal string. Default 0. Cannot exceed line subtotal.',
  })
  @IsOptional()
  @IsString()
  discountAmount?: string;

  @ApiPropertyOptional({ maxLength: SALES_ORDER_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SALES_ORDER_NOTES_MAX_LENGTH)
  notes?: string;
}

export class CancelSalesOrderItemDto {
  @ApiProperty({ minimum: 1, description: 'Quantity to cancel from remaining open qty.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SALES_ORDER_MAX_QUANTITY)
  quantity!: number;

  @ApiPropertyOptional({ maxLength: SALES_ORDER_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SALES_ORDER_NOTES_MAX_LENGTH)
  notes?: string;
}
