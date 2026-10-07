import { ApiPropertyOptional } from '@nestjs/swagger';
import { SalesReturnStatus } from '@hector/database';
import { IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  SALES_RETURN_SEARCH_MAX_LENGTH,
  SALES_RETURN_SORT_FIELDS,
} from '../sales.constants';

export class ListSalesReturnsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ maxLength: SALES_RETURN_SEARCH_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SALES_RETURN_SEARCH_MAX_LENGTH)
  search?: string;

  @ApiPropertyOptional({ enum: SalesReturnStatus })
  @IsOptional()
  @IsEnum(SalesReturnStatus)
  status?: SalesReturnStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  salesOrderId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ enum: SALES_RETURN_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn([...SALES_RETURN_SORT_FIELDS])
  sortBy: (typeof SALES_RETURN_SORT_FIELDS)[number] = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';
}
