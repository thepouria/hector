import { ApiPropertyOptional } from '@nestjs/swagger';
import { PurchasingLifecycleStatus } from '@hector/database';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  SUPPLIER_SEARCH_MAX_LENGTH,
  SUPPLIER_SORT_FIELDS,
  type SupplierSortField,
} from '../purchasing.constants';

export class ListSuppliersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Search name, legalName, code, phone, contact name/phone' })
  @IsOptional()
  @IsString()
  @MaxLength(SUPPLIER_SEARCH_MAX_LENGTH)
  search?: string;

  @ApiPropertyOptional({
    enum: PurchasingLifecycleStatus,
    description: 'When omitted, ARCHIVED suppliers are excluded from the default list.',
  })
  @IsOptional()
  @IsEnum(PurchasingLifecycleStatus)
  status?: PurchasingLifecycleStatus;

  @ApiPropertyOptional({ enum: SUPPLIER_SORT_FIELDS, default: 'name' })
  @IsOptional()
  @IsIn([...SUPPLIER_SORT_FIELDS])
  sortBy: SupplierSortField = 'name';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'asc';

  @ApiPropertyOptional({ enum: ['full', 'options'], description: 'options = id/name/code/status' })
  @IsOptional()
  @IsIn(['full', 'options'])
  view?: 'full' | 'options';
}
