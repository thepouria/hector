import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StockClassification } from '@hector/database';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  STOCK_CLASSIFICATION_NOTES_MAX_LENGTH,
  STOCK_CLASSIFICATION_REASON_MAX_LENGTH,
} from '../stock-classification.constants';

export class ChangeStockClassificationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  warehouseId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  locationId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  skuId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  batchId!: string;

  @ApiProperty({ enum: StockClassification })
  @IsEnum(StockClassification)
  fromClassification!: StockClassification;

  @ApiProperty({ enum: StockClassification })
  @IsEnum(StockClassification)
  toClassification!: StockClassification;

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({ maxLength: STOCK_CLASSIFICATION_REASON_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(STOCK_CLASSIFICATION_REASON_MAX_LENGTH)
  reason?: string;

  @ApiPropertyOptional({ maxLength: STOCK_CLASSIFICATION_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(STOCK_CLASSIFICATION_NOTES_MAX_LENGTH)
  notes?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Optional client idempotency key; used as change document id when provided.',
  })
  @IsOptional()
  @IsUUID()
  requestId?: string;
}

export class ListStockClassificationChangesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  skuId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}
