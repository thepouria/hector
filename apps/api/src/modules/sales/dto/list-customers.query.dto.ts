import { ApiPropertyOptional } from '@nestjs/swagger';
import { CustomerStatus, CustomerType } from '@hector/database';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  CUSTOMER_SEARCH_MAX_LENGTH,
  CUSTOMER_SORT_FIELDS,
  type CustomerSortField,
} from '../sales.constants';

export class ListCustomersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Search displayName, businessName, code, mobile, phone, email',
  })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_SEARCH_MAX_LENGTH)
  search?: string;

  @ApiPropertyOptional({ enum: CustomerType })
  @IsOptional()
  @IsEnum(CustomerType)
  type?: CustomerType;

  @ApiPropertyOptional({ enum: CustomerStatus })
  @IsOptional()
  @IsEnum(CustomerStatus)
  status?: CustomerStatus;

  @ApiPropertyOptional({ enum: CUSTOMER_SORT_FIELDS, default: 'displayName' })
  @IsOptional()
  @IsIn([...CUSTOMER_SORT_FIELDS])
  sortBy: CustomerSortField = 'displayName';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'asc';
}
