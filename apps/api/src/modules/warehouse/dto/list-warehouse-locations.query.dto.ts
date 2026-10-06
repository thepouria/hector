import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { WarehouseLocationType, WarehouseStatus } from '@hector/database';
import { IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  LOCATION_SEARCH_MAX_LENGTH,
  LOCATION_SORT_FIELDS,
  type LocationSortField,
} from '../warehouse-location.constants';

export class ListWarehouseLocationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Search code, name, or barcode' })
  @IsOptional()
  @IsString()
  @MaxLength(LOCATION_SEARCH_MAX_LENGTH)
  search?: string;

  @ApiPropertyOptional({ enum: WarehouseLocationType })
  @IsOptional()
  @IsEnum(WarehouseLocationType)
  type?: WarehouseLocationType;

  @ApiPropertyOptional({ enum: WarehouseStatus })
  @IsOptional()
  @IsEnum(WarehouseStatus)
  status?: WarehouseStatus;

  @ApiPropertyOptional({
    description: 'Filter by parent. Pass "null" for root locations.',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === '') return undefined;
    if (value === 'null' || value === null) return null;
    return value;
  })
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsUUID()
  parentId?: string | null;

  @ApiPropertyOptional({ enum: LOCATION_SORT_FIELDS, default: 'sortOrder' })
  @IsOptional()
  @IsIn([...LOCATION_SORT_FIELDS])
  sortBy: LocationSortField = 'sortOrder';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'asc';

  @ApiPropertyOptional({
    enum: ['flat', 'tree'],
    default: 'flat',
    description: 'tree returns nested children; flat returns adjacency-list rows',
  })
  @IsOptional()
  @IsIn(['flat', 'tree'])
  view?: 'flat' | 'tree' = 'flat';
}
