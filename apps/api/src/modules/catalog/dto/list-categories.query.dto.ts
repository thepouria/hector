import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { CatalogLifecycleStatus } from '@hector/database';
import { CATALOG_SEARCH_MAX_LENGTH, CATEGORY_SORT_FIELDS } from '../catalog.constants';
import { CatalogPaginatedListQueryDto } from './catalog-list-view.query.dto';

export class ListCategoriesQueryDto extends CatalogPaginatedListQueryDto {
  @ApiPropertyOptional({ maxLength: CATALOG_SEARCH_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(CATALOG_SEARCH_MAX_LENGTH)
  search?: string;

  @ApiPropertyOptional({ enum: CatalogLifecycleStatus })
  @IsOptional()
  @IsIn(Object.values(CatalogLifecycleStatus))
  status?: CatalogLifecycleStatus;

  @ApiPropertyOptional({ format: 'uuid', description: 'Filter by parent id' })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({ description: 'When true, only root categories (parentId null)' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === true || value === 'true' || value === '1') return true;
    if (value === false || value === 'false' || value === '0') return false;
    return value;
  })
  @IsBoolean()
  rootOnly?: boolean;

  @ApiPropertyOptional({ enum: CATEGORY_SORT_FIELDS, default: 'sortOrder' })
  @IsOptional()
  @IsIn([...CATEGORY_SORT_FIELDS])
  sortBy: (typeof CATEGORY_SORT_FIELDS)[number] = 'sortOrder';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'asc';
}
