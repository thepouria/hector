import { ApiPropertyOptional } from '@nestjs/swagger';
import { SalesFulfillmentStatus } from '@hector/database';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import {
  SALES_FULFILLMENT_SEARCH_MAX_LENGTH,
  SALES_FULFILLMENT_SORT_FIELDS,
  type SalesFulfillmentSortField,
} from '../sales.constants';

export class ListSalesFulfillmentsQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;

  @ApiPropertyOptional({ enum: SalesFulfillmentStatus })
  @IsOptional()
  @IsEnum(SalesFulfillmentStatus)
  status?: SalesFulfillmentStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  salesOrderId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(SALES_FULFILLMENT_SEARCH_MAX_LENGTH)
  search?: string;

  @ApiPropertyOptional({ enum: SALES_FULFILLMENT_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(SALES_FULFILLMENT_SORT_FIELDS)
  sortBy: SalesFulfillmentSortField = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';
}
