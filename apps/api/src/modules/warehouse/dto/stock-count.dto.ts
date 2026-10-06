import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  StockClassification,
  StockCountStatus,
  StockCountType,
} from '@hector/database';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  STOCK_COUNT_NOTES_MAX_LENGTH,
  STOCK_COUNT_SEARCH_MAX_LENGTH,
} from '../stock-count.constants';

export class CreateStockCountDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  warehouseId!: string;

  @ApiProperty({ enum: StockCountType })
  @IsEnum(StockCountType)
  type!: StockCountType;

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  locationIds?: string[];

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  skuIds?: string[];

  @ApiPropertyOptional({ enum: StockClassification, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(StockClassification, { each: true })
  classifications?: StockClassification[];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  blindCount?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  allowDiscoveredItems?: boolean;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  highDifferenceThreshold?: number;

  @ApiPropertyOptional({ maxLength: STOCK_COUNT_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(STOCK_COUNT_NOTES_MAX_LENGTH)
  notes?: string;
}

export class UpdateStockCountDto {
  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  locationIds?: string[];

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  skuIds?: string[];

  @ApiPropertyOptional({ enum: StockClassification, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(StockClassification, { each: true })
  classifications?: StockClassification[];

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  blindCount?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  allowDiscoveredItems?: boolean;

  @ApiPropertyOptional({ minimum: 0, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  highDifferenceThreshold?: number | null;

  @ApiPropertyOptional({ maxLength: STOCK_COUNT_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(STOCK_COUNT_NOTES_MAX_LENGTH)
  notes?: string | null;
}

export class RecordStockCountItemDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Optional; when omitted, the path itemId is used.',
  })
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiProperty({ minimum: 0, description: 'Explicit physical quantity; 0 is valid.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  countedQuantity!: number;

  @ApiPropertyOptional({ maxLength: STOCK_COUNT_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(STOCK_COUNT_NOTES_MAX_LENGTH)
  notes?: string;

  @ApiPropertyOptional({
    description: 'When true, add to existing counted quantity instead of replacing.',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  increment?: boolean;
}

export class SkipStockCountItemDto {
  @ApiPropertyOptional({ maxLength: STOCK_COUNT_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(STOCK_COUNT_NOTES_MAX_LENGTH)
  notes?: string;
}

export class AddDiscoveredStockCountItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  locationId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  skuId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  batchId!: string;

  @ApiPropertyOptional({ enum: StockClassification, default: StockClassification.SELLABLE })
  @IsOptional()
  @IsEnum(StockClassification)
  classification?: StockClassification;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  countedQuantity!: number;

  @ApiPropertyOptional({ maxLength: STOCK_COUNT_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(STOCK_COUNT_NOTES_MAX_LENGTH)
  notes?: string;
}

export class ScanApplyStockCountDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  requestId!: string;

  @ApiPropertyOptional({ description: 'Location barcode (LOC-…)' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  locationBarcode?: string;

  @ApiPropertyOptional({ description: 'Product / SKU barcode' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  productBarcode?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  skuId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  batchId?: string;

  @ApiPropertyOptional({ enum: StockClassification })
  @IsOptional()
  @IsEnum(StockClassification)
  classification?: StockClassification;

  @ApiPropertyOptional({
    minimum: 0,
    description: 'When omitted with product scan, increments counted by 1.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  countedQuantity?: number;

  @ApiPropertyOptional({
    description: 'When true (default for bare product scan), increment counted quantity.',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  increment?: boolean;

  @ApiPropertyOptional({ maxLength: STOCK_COUNT_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(STOCK_COUNT_NOTES_MAX_LENGTH)
  notes?: string;
}

export class ListStockCountsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: StockCountStatus })
  @IsOptional()
  @IsEnum(StockCountStatus)
  status?: StockCountStatus;

  @ApiPropertyOptional({ enum: StockCountType })
  @IsOptional()
  @IsEnum(StockCountType)
  type?: StockCountType;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  createdById?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ maxLength: STOCK_COUNT_SEARCH_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(STOCK_COUNT_SEARCH_MAX_LENGTH)
  q?: string;
}

export class RequestRecountDto {
  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description: 'Specific item ids to recount; omit to recount all difference lines.',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  itemIds?: string[];

  @ApiPropertyOptional({ maxLength: STOCK_COUNT_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(STOCK_COUNT_NOTES_MAX_LENGTH)
  notes?: string;
}

