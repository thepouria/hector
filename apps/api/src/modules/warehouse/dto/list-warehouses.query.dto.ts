import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { WarehouseStatus } from '@hector/database';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  WAREHOUSE_SEARCH_MAX_LENGTH,
  WAREHOUSE_SORT_FIELDS,
  type WarehouseSortField,
} from '../warehouse.constants';

export class ListWarehousesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Search code, name, or address' })
  @IsOptional()
  @IsString()
  @MaxLength(WAREHOUSE_SEARCH_MAX_LENGTH)
  search?: string;

  @ApiPropertyOptional({ enum: WarehouseStatus })
  @IsOptional()
  @IsEnum(WarehouseStatus)
  status?: WarehouseStatus;

  @ApiPropertyOptional({ description: 'Filter default warehouse' })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return value;
  })
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ enum: WAREHOUSE_SORT_FIELDS, default: 'name' })
  @IsOptional()
  @IsIn([...WAREHOUSE_SORT_FIELDS])
  sortBy: WarehouseSortField = 'name';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'asc';

  @ApiPropertyOptional({ enum: ['full', 'options'] })
  @IsOptional()
  @IsIn(['full', 'options'])
  view?: 'full' | 'options';
}
