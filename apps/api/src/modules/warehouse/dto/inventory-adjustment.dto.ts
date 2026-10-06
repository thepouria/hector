import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  InventoryAdjustmentDirection,
  InventoryAdjustmentReason,
  InventoryAdjustmentStatus,
  StockClassification,
} from '@hector/database';
import { Type } from 'class-transformer';
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
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  INVENTORY_ADJUSTMENT_NOTES_MAX_LENGTH,
  INVENTORY_ADJUSTMENT_REASON_TEXT_MAX_LENGTH,
  INVENTORY_ADJUSTMENT_SEARCH_MAX_LENGTH,
} from '../inventory-adjustment.constants';

export class InventoryAdjustmentItemInputDto {
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

  @ApiProperty({ enum: InventoryAdjustmentDirection })
  @IsEnum(InventoryAdjustmentDirection)
  direction!: InventoryAdjustmentDirection;

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({ maxLength: INVENTORY_ADJUSTMENT_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(INVENTORY_ADJUSTMENT_NOTES_MAX_LENGTH)
  notes?: string;
}

export class CreateInventoryAdjustmentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  warehouseId!: string;

  @ApiProperty({ enum: InventoryAdjustmentReason })
  @IsEnum(InventoryAdjustmentReason)
  reason!: InventoryAdjustmentReason;

  @ApiPropertyOptional({ maxLength: INVENTORY_ADJUSTMENT_REASON_TEXT_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(INVENTORY_ADJUSTMENT_REASON_TEXT_MAX_LENGTH)
  reasonText?: string;

  @ApiPropertyOptional({ maxLength: INVENTORY_ADJUSTMENT_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(INVENTORY_ADJUSTMENT_NOTES_MAX_LENGTH)
  notes?: string;

  @ApiPropertyOptional({ type: [InventoryAdjustmentItemInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InventoryAdjustmentItemInputDto)
  items?: InventoryAdjustmentItemInputDto[];
}

export class UpdateInventoryAdjustmentDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ enum: InventoryAdjustmentReason })
  @IsOptional()
  @IsEnum(InventoryAdjustmentReason)
  reason?: InventoryAdjustmentReason;

  @ApiPropertyOptional({ maxLength: INVENTORY_ADJUSTMENT_REASON_TEXT_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(INVENTORY_ADJUSTMENT_REASON_TEXT_MAX_LENGTH)
  reasonText?: string | null;

  @ApiPropertyOptional({ maxLength: INVENTORY_ADJUSTMENT_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(INVENTORY_ADJUSTMENT_NOTES_MAX_LENGTH)
  notes?: string | null;

  @ApiPropertyOptional({ type: [InventoryAdjustmentItemInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => InventoryAdjustmentItemInputDto)
  items?: InventoryAdjustmentItemInputDto[];
}

export class UpsertInventoryAdjustmentItemDto extends InventoryAdjustmentItemInputDto {}

export class ListInventoryAdjustmentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: InventoryAdjustmentStatus })
  @IsOptional()
  @IsEnum(InventoryAdjustmentStatus)
  status?: InventoryAdjustmentStatus;

  @ApiPropertyOptional({ enum: InventoryAdjustmentReason })
  @IsOptional()
  @IsEnum(InventoryAdjustmentReason)
  reason?: InventoryAdjustmentReason;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  skuId?: string;

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

  @ApiPropertyOptional({ maxLength: INVENTORY_ADJUSTMENT_SEARCH_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(INVENTORY_ADJUSTMENT_SEARCH_MAX_LENGTH)
  q?: string;
}
