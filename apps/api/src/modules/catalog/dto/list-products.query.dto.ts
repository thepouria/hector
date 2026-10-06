import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { CatalogLifecycleStatus } from '@hector/database';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { CATALOG_SEARCH_MAX_LENGTH, PRODUCT_SORT_FIELDS } from '../catalog.constants';

export class ListProductsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    maxLength: CATALOG_SEARCH_MAX_LENGTH,
    description:
      'Search product name/code plus nested SKU code/name and barcode value (case-insensitive).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(CATALOG_SEARCH_MAX_LENGTH)
  search?: string;

  @ApiPropertyOptional({ enum: CatalogLifecycleStatus })
  @IsOptional()
  @IsIn(Object.values(CatalogLifecycleStatus))
  status?: CatalogLifecycleStatus;

  @ApiPropertyOptional({ format: 'uuid', description: 'Filter by category (see includeDescendants).' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({
    description:
      'When categoryId is set, include products in descendant categories. Default true (parent category represents its subtree). Pass false for exact category only.',
    default: true,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === true || value === 'true' || value === '1') return true;
    if (value === false || value === 'false' || value === '0') return false;
    return value;
  })
  @IsBoolean()
  includeDescendants?: boolean;

  @ApiPropertyOptional({
    description:
      'Structured attribute filters: comma-separated code:op:value (e.g. spf:gte:30,oil_free:eq:true). Identity is Attribute code. Does not make attributes required.',
    example: 'spf:gte:30,oil_free:eq:true',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  attrs?: string;

  @ApiPropertyOptional({
    description: 'When set, filter products that have (true) or lack (false) at least one SKU.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === true || value === 'true' || value === '1') return true;
    if (value === false || value === 'false' || value === '0') return false;
    return value;
  })
  @IsBoolean()
  hasSku?: boolean;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  brandId?: string;

  @ApiPropertyOptional({ enum: PRODUCT_SORT_FIELDS, default: 'name' })
  @IsOptional()
  @IsIn([...PRODUCT_SORT_FIELDS])
  sortBy: (typeof PRODUCT_SORT_FIELDS)[number] = 'name';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'asc';
}
