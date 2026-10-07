import { ApiPropertyOptional } from '@nestjs/swagger';
import { SalesOrderPaymentTermType, SalesOrderStatus } from '@hector/database';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  SALES_ORDER_SEARCH_MAX_LENGTH,
  SALES_ORDER_SORT_FIELDS,
} from '../sales.constants';

export class ListSalesOrdersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ maxLength: SALES_ORDER_SEARCH_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SALES_ORDER_SEARCH_MAX_LENGTH)
  search?: string;

  @ApiPropertyOptional({ enum: SalesOrderStatus })
  @IsOptional()
  @IsEnum(SalesOrderStatus)
  status?: SalesOrderStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  channelId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ enum: SalesOrderPaymentTermType })
  @IsOptional()
  @IsEnum(SalesOrderPaymentTermType)
  paymentTermType?: SalesOrderPaymentTermType;

  @ApiPropertyOptional({ description: 'Filter by orderedAt/createdAt >= from (ISO)' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Filter by orderedAt/createdAt <= to (ISO)' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ enum: SALES_ORDER_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn([...SALES_ORDER_SORT_FIELDS])
  sortBy: (typeof SALES_ORDER_SORT_FIELDS)[number] = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';
}
