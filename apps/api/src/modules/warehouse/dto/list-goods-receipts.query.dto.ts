import { ApiPropertyOptional } from '@nestjs/swagger';
import { GoodsReceiptStatus } from '@hector/database';
import { Transform } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  GOODS_RECEIPT_SEARCH_MAX_LENGTH,
  GOODS_RECEIPT_SORT_FIELDS,
  type GoodsReceiptSortField,
} from '../goods-receipt.constants';

export class ListGoodsReceiptsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: GoodsReceiptStatus })
  @IsOptional()
  @IsEnum(GoodsReceiptStatus)
  status?: GoodsReceiptStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  purchaseOrderId?: string;

  @ApiPropertyOptional({ description: 'Filter receivedAt >= (ISO datetime)' })
  @IsOptional()
  @IsDateString()
  receivedFrom?: string;

  @ApiPropertyOptional({ description: 'Filter receivedAt <= (ISO datetime)' })
  @IsOptional()
  @IsDateString()
  receivedTo?: string;

  @ApiPropertyOptional({ maxLength: GOODS_RECEIPT_SEARCH_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(GOODS_RECEIPT_SEARCH_MAX_LENGTH)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @ApiPropertyOptional({ enum: GOODS_RECEIPT_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(GOODS_RECEIPT_SORT_FIELDS)
  sortBy: GoodsReceiptSortField = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';
}
