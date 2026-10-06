import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  StockClassification,
  SupplierReturnExecutionStatus,
} from '@hector/database';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
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
  SUPPLIER_RETURN_EXECUTION_NOTES_MAX_LENGTH,
  SUPPLIER_RETURN_EXECUTION_SEARCH_MAX_LENGTH,
  SUPPLIER_RETURN_FULFILLMENT_STATUSES,
  type SupplierReturnFulfillmentStatus,
} from '../supplier-return-execution.constants';

export class SupplierReturnExecutionItemInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  purchaseReturnItemId!: string;

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

  @ApiPropertyOptional({ maxLength: SUPPLIER_RETURN_EXECUTION_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SUPPLIER_RETURN_EXECUTION_NOTES_MAX_LENGTH)
  notes?: string;
}

export class CreateSupplierReturnExecutionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  warehouseId!: string;

  @ApiPropertyOptional({ maxLength: SUPPLIER_RETURN_EXECUTION_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SUPPLIER_RETURN_EXECUTION_NOTES_MAX_LENGTH)
  notes?: string;

  @ApiPropertyOptional({ type: [SupplierReturnExecutionItemInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SupplierReturnExecutionItemInputDto)
  items?: SupplierReturnExecutionItemInputDto[];
}

export class UpdateSupplierReturnExecutionDto {
  @ApiPropertyOptional({ maxLength: SUPPLIER_RETURN_EXECUTION_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SUPPLIER_RETURN_EXECUTION_NOTES_MAX_LENGTH)
  notes?: string | null;

  @ApiPropertyOptional({ type: [SupplierReturnExecutionItemInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => SupplierReturnExecutionItemInputDto)
  items?: SupplierReturnExecutionItemInputDto[];
}

export class UpsertSupplierReturnExecutionItemDto extends SupplierReturnExecutionItemInputDto {
  @ApiPropertyOptional({
    description:
      'When true and an identical position line exists, add quantity instead of replacing.',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  increment?: boolean;
}

export class ScanApplySupplierReturnExecutionDto {
  @ApiProperty({ format: 'uuid', description: 'Client request UUID for idempotent retries' })
  @IsUUID()
  requestId!: string;

  @ApiProperty({ format: 'uuid', description: 'Purchase return line to allocate against' })
  @IsUUID()
  purchaseReturnItemId!: string;

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

export class ListSupplierReturnExecutionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: SupplierReturnExecutionStatus })
  @IsOptional()
  @IsEnum(SupplierReturnExecutionStatus)
  status?: SupplierReturnExecutionStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  purchaseReturnId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ maxLength: SUPPLIER_RETURN_EXECUTION_SEARCH_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SUPPLIER_RETURN_EXECUTION_SEARCH_MAX_LENGTH)
  @MinLength(1)
  q?: string;
}

export class ListWarehouseSupplierReturnsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({
    enum: SUPPLIER_RETURN_FULFILLMENT_STATUSES,
    description: 'Filter by warehouse dispatch progress projection',
  })
  @IsOptional()
  @IsIn([...SUPPLIER_RETURN_FULFILLMENT_STATUSES])
  fulfillmentStatus?: SupplierReturnFulfillmentStatus;

  @ApiPropertyOptional({ maxLength: SUPPLIER_RETURN_EXECUTION_SEARCH_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SUPPLIER_RETURN_EXECUTION_SEARCH_MAX_LENGTH)
  @MinLength(1)
  q?: string;
}
