import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  InventoryMovementType,
  InventorySourceType,
  StockClassification,
} from '@hector/database';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { INVENTORY_SEARCH_MAX_LENGTH } from '../inventory-ledger.constants';

export class ListInventoryMovementsQueryDto extends PaginationQueryDto {
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
  skuId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  batchId?: string;

  @ApiPropertyOptional({ enum: StockClassification })
  @IsOptional()
  @IsEnum(StockClassification)
  classification?: StockClassification;

  @ApiPropertyOptional({ enum: InventoryMovementType })
  @IsOptional()
  @IsEnum(InventoryMovementType)
  movementType?: InventoryMovementType;

  @ApiPropertyOptional({ enum: InventorySourceType })
  @IsOptional()
  @IsEnum(InventorySourceType)
  sourceType?: InventorySourceType;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  sourceId?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ maxLength: INVENTORY_SEARCH_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(INVENTORY_SEARCH_MAX_LENGTH)
  @MinLength(1)
  q?: string;
}

export class ListInventoryBalancesQueryDto extends PaginationQueryDto {
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
  skuId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  batchId?: string;

  @ApiPropertyOptional({ enum: StockClassification })
  @IsOptional()
  @IsEnum(StockClassification)
  classification?: StockClassification;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  brandId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({
    description:
      'When true, only rows with onHandQuantity > 0. Default list behavior hides zeros unless includeZero=true.',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  onlyPositive?: boolean;

  @ApiPropertyOptional({
    description: 'When true, include zero On Hand positions (overrides default hide-zero).',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  includeZero?: boolean;

  @ApiPropertyOptional({
    description:
      'When true, include system TRANSIT positions. Default excludes in-transit stock from physical warehouse views.',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  includeTransit?: boolean;

  @ApiPropertyOptional({
    maxLength: INVENTORY_SEARCH_MAX_LENGTH,
    description:
      'Search product name/code, SKU code, barcode, batch number, location code/barcode, warehouse code',
  })
  @IsOptional()
  @IsString()
  @MaxLength(INVENTORY_SEARCH_MAX_LENGTH)
  @MinLength(1)
  q?: string;
}

export class InventoryLookupQueryDto {
  @ApiProperty({ description: 'Raw scanned barcode value (product or location)' })
  @IsString()
  @MinLength(1)
  @MaxLength(INVENTORY_SEARCH_MAX_LENGTH)
  value!: string;

  @ApiPropertyOptional({
    enum: ['PRODUCT', 'LOCATION', 'AUTO'],
    description: 'PRODUCT = Catalog barcode; LOCATION = Warehouse location barcode; AUTO tries product then location',
  })
  @IsOptional()
  @IsIn(['PRODUCT', 'LOCATION', 'AUTO'])
  kind?: 'PRODUCT' | 'LOCATION' | 'AUTO';
}

export class WarehouseInventoryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Include zero On Hand positions' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  includeZero?: boolean;
}
