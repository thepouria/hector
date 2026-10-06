import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { CatalogLifecycleStatus } from '@hector/database';
import { BRAND_SORT_FIELDS, CATALOG_SEARCH_MAX_LENGTH } from '../catalog.constants';
import { CatalogPaginatedListQueryDto } from './catalog-list-view.query.dto';

export class ListBrandsQueryDto extends CatalogPaginatedListQueryDto {
  @ApiPropertyOptional({ maxLength: CATALOG_SEARCH_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(CATALOG_SEARCH_MAX_LENGTH)
  search?: string;

  @ApiPropertyOptional({ enum: CatalogLifecycleStatus })
  @IsOptional()
  @IsIn(Object.values(CatalogLifecycleStatus))
  status?: CatalogLifecycleStatus;

  @ApiPropertyOptional({ enum: BRAND_SORT_FIELDS, default: 'name' })
  @IsOptional()
  @IsIn([...BRAND_SORT_FIELDS])
  sortBy: (typeof BRAND_SORT_FIELDS)[number] = 'name';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'asc';
}
