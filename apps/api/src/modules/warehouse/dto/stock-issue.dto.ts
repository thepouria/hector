import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  StockClassification,
  StockIssueReason,
  StockIssueStatus,
} from '@hector/database';
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
  STOCK_ISSUE_NOTES_MAX_LENGTH,
  STOCK_ISSUE_REASON_TEXT_MAX_LENGTH,
  STOCK_ISSUE_SEARCH_MAX_LENGTH,
} from '../stock-issue.constants';

export class StockIssueItemInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  skuId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  batchId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  locationId!: string;

  @ApiPropertyOptional({ enum: StockClassification, default: StockClassification.SELLABLE })
  @IsOptional()
  @IsEnum(StockClassification)
  classification?: StockClassification;

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({ maxLength: STOCK_ISSUE_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(STOCK_ISSUE_NOTES_MAX_LENGTH)
  notes?: string;
}

export class CreateStockIssueDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  warehouseId!: string;

  @ApiProperty({ enum: StockIssueReason })
  @IsEnum(StockIssueReason)
  reason!: StockIssueReason;

  @ApiPropertyOptional({ maxLength: STOCK_ISSUE_REASON_TEXT_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(STOCK_ISSUE_REASON_TEXT_MAX_LENGTH)
  reasonText?: string;

  @ApiPropertyOptional({ maxLength: STOCK_ISSUE_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(STOCK_ISSUE_NOTES_MAX_LENGTH)
  notes?: string;

  @ApiPropertyOptional({ type: [StockIssueItemInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StockIssueItemInputDto)
  items?: StockIssueItemInputDto[];
}

export class UpdateStockIssueDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ enum: StockIssueReason })
  @IsOptional()
  @IsEnum(StockIssueReason)
  reason?: StockIssueReason;

  @ApiPropertyOptional({ maxLength: STOCK_ISSUE_REASON_TEXT_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(STOCK_ISSUE_REASON_TEXT_MAX_LENGTH)
  reasonText?: string | null;

  @ApiPropertyOptional({ maxLength: STOCK_ISSUE_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(STOCK_ISSUE_NOTES_MAX_LENGTH)
  notes?: string | null;

  @ApiPropertyOptional({ type: [StockIssueItemInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => StockIssueItemInputDto)
  items?: StockIssueItemInputDto[];
}

export class UpsertStockIssueItemDto extends StockIssueItemInputDto {
  @ApiPropertyOptional({
    description:
      'When true and an identical position line exists, add quantity instead of replacing.',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  increment?: boolean;
}

export class ScanApplyStockIssueDto {
  @ApiProperty({ format: 'uuid', description: 'Client request UUID for idempotent retries' })
  @IsUUID()
  requestId!: string;

  @ApiPropertyOptional({ description: 'Source location barcode (LOC-…)' })
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

export class ListStockIssuesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: StockIssueStatus })
  @IsOptional()
  @IsEnum(StockIssueStatus)
  status?: StockIssueStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ enum: StockIssueReason })
  @IsOptional()
  @IsEnum(StockIssueReason)
  reason?: StockIssueReason;

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

  @ApiPropertyOptional({ maxLength: STOCK_ISSUE_SEARCH_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(STOCK_ISSUE_SEARCH_MAX_LENGTH)
  @MinLength(1)
  q?: string;
}
