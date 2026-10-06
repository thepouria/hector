import { ApiPropertyOptional } from '@nestjs/swagger';
import { PurchaseReturnStatus } from '@hector/database';
import { IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  PURCHASE_RETURN_SEARCH_MAX_LENGTH,
  PURCHASE_RETURN_SORT_FIELDS,
  type PurchaseReturnSortField,
} from '../purchasing.constants';

export class ListPurchaseReturnsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PurchaseReturnStatus })
  @IsOptional()
  @IsEnum(PurchaseReturnStatus)
  status?: PurchaseReturnStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  purchaseOrderId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(PURCHASE_RETURN_SEARCH_MAX_LENGTH)
  search?: string;

  @ApiPropertyOptional({ enum: PURCHASE_RETURN_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn([...PURCHASE_RETURN_SORT_FIELDS])
  sortBy: PurchaseReturnSortField = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';
}
