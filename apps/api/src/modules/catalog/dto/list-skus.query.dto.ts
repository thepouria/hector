import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { CatalogLifecycleStatus } from '@hector/database';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { CATALOG_SEARCH_MAX_LENGTH, SKU_SORT_FIELDS } from '../catalog.constants';

export class ListSkusQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    maxLength: CATALOG_SEARCH_MAX_LENGTH,
    description:
      'Search SKU code/name, parent product name/code, and active barcode values.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(CATALOG_SEARCH_MAX_LENGTH)
  search?: string;

  @ApiPropertyOptional({ enum: CatalogLifecycleStatus })
  @IsOptional()
  @IsIn(Object.values(CatalogLifecycleStatus))
  status?: CatalogLifecycleStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({
    description: 'When set, filter SKUs that have (true) or lack (false) at least one active barcode.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === true || value === 'true' || value === '1') return true;
    if (value === false || value === 'false' || value === '0') return false;
    return value;
  })
  @IsBoolean()
  hasBarcode?: boolean;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Filter SKUs that use this VariantOptionValue id.',
  })
  @IsOptional()
  @IsUUID()
  variantValueId?: string;

  @ApiPropertyOptional({ enum: SKU_SORT_FIELDS, default: 'code' })
  @IsOptional()
  @IsIn([...SKU_SORT_FIELDS])
  sortBy: (typeof SKU_SORT_FIELDS)[number] = 'code';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'asc';
}
