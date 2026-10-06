import { ApiPropertyOptional } from '@nestjs/swagger';
import { InventoryValuationStatus, StockClassification } from '@hector/database';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListCostLayersQueryDto extends PaginationQueryDto {
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
  batchId?: string;

  @ApiPropertyOptional({ enum: StockClassification })
  @IsOptional()
  @IsEnum(StockClassification)
  classification?: StockClassification;

  @ApiPropertyOptional({ enum: InventoryValuationStatus })
  @IsOptional()
  @IsEnum(InventoryValuationStatus)
  valuationStatus?: InventoryValuationStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  remainingOnly?: boolean;
}

export class ValuationBreakdownQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}
