import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AttributeScope, AttributeType, CatalogLifecycleStatus } from '@hector/database';
import { ATTRIBUTE_SORT_FIELDS, CATALOG_SEARCH_MAX_LENGTH } from '../catalog.constants';
import { CatalogPaginatedListQueryDto } from './catalog-list-view.query.dto';

export class ListAttributesQueryDto extends CatalogPaginatedListQueryDto {
  @ApiPropertyOptional({ maxLength: CATALOG_SEARCH_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(CATALOG_SEARCH_MAX_LENGTH)
  search?: string;

  @ApiPropertyOptional({ enum: AttributeType })
  @IsOptional()
  @IsIn(Object.values(AttributeType))
  type?: AttributeType;

  @ApiPropertyOptional({ enum: AttributeScope })
  @IsOptional()
  @IsIn(Object.values(AttributeScope))
  scope?: AttributeScope;

  @ApiPropertyOptional({ enum: CatalogLifecycleStatus })
  @IsOptional()
  @IsIn(Object.values(CatalogLifecycleStatus))
  status?: CatalogLifecycleStatus;

  @ApiPropertyOptional({ enum: ATTRIBUTE_SORT_FIELDS, default: 'name' })
  @IsOptional()
  @IsIn([...ATTRIBUTE_SORT_FIELDS])
  sortBy: (typeof ATTRIBUTE_SORT_FIELDS)[number] = 'name';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'asc';

}
