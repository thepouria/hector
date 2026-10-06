import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StockClassification, StockTransferStatus } from '@hector/database';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  STOCK_TRANSFER_NOTES_MAX_LENGTH,
  STOCK_TRANSFER_REFERENCE_MAX_LENGTH,
  STOCK_TRANSFER_SEARCH_MAX_LENGTH,
} from '../stock-transfer.constants';

export class StockTransferItemInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  skuId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  batchId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  sourceLocationId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  destinationLocationId!: string;

  @ApiPropertyOptional({ enum: StockClassification, default: StockClassification.SELLABLE })
  @IsOptional()
  @IsEnum(StockClassification)
  classification?: StockClassification;

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({ maxLength: STOCK_TRANSFER_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(STOCK_TRANSFER_NOTES_MAX_LENGTH)
  notes?: string;
}

export class CreateStockTransferDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  sourceWarehouseId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  destinationWarehouseId!: string;

  @ApiPropertyOptional({ maxLength: STOCK_TRANSFER_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(STOCK_TRANSFER_NOTES_MAX_LENGTH)
  notes?: string;

  @ApiPropertyOptional({ maxLength: STOCK_TRANSFER_REFERENCE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(STOCK_TRANSFER_REFERENCE_MAX_LENGTH)
  externalReference?: string;

  @ApiPropertyOptional({ type: [StockTransferItemInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StockTransferItemInputDto)
  items?: StockTransferItemInputDto[];
}

export class UpdateStockTransferDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  sourceWarehouseId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  destinationWarehouseId?: string;

  @ApiPropertyOptional({ maxLength: STOCK_TRANSFER_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(STOCK_TRANSFER_NOTES_MAX_LENGTH)
  notes?: string | null;

  @ApiPropertyOptional({ maxLength: STOCK_TRANSFER_REFERENCE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(STOCK_TRANSFER_REFERENCE_MAX_LENGTH)
  externalReference?: string | null;

  @ApiPropertyOptional({ type: [StockTransferItemInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => StockTransferItemInputDto)
  items?: StockTransferItemInputDto[];
}

export class UpsertStockTransferItemDto extends StockTransferItemInputDto {
  @ApiPropertyOptional({
    description:
      'When true and an identical position line exists, add quantity instead of replacing.',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  increment?: boolean;
}

export class ScanApplyStockTransferDto {
  @ApiProperty({ format: 'uuid', description: 'Client request UUID for idempotent retries' })
  @IsUUID()
  requestId!: string;

  @ApiPropertyOptional({ description: 'Source location barcode (LOC-…)' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  sourceLocationBarcode?: string;

  @ApiPropertyOptional({ description: 'Destination location barcode (LOC-…)' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  destinationLocationBarcode?: string;

  @ApiPropertyOptional({ description: 'Product / SKU barcode' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  productBarcode?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  batchId?: string;

  @ApiPropertyOptional({ enum: StockClassification, default: StockClassification.SELLABLE })
  @IsOptional()
  @IsEnum(StockClassification)
  classification?: StockClassification;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;
}

export class ListStockTransfersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: StockTransferStatus })
  @IsOptional()
  @IsEnum(StockTransferStatus)
  status?: StockTransferStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  sourceWarehouseId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  destinationWarehouseId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  skuId?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ maxLength: STOCK_TRANSFER_SEARCH_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(STOCK_TRANSFER_SEARCH_MAX_LENGTH)
  @MinLength(1)
  q?: string;
}
