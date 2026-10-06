import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import {
  CATALOG_LOOKUP_DEFAULT_LIMIT,
  CATALOG_LOOKUP_MAX_LIMIT,
  CATALOG_SEARCH_MAX_LENGTH,
} from '../catalog.constants';

export class CatalogLookupQueryDto {
  @ApiProperty({
    maxLength: CATALOG_SEARCH_MAX_LENGTH,
    description:
      'Unified Catalog lookup. Exact barcode/SKU/product code outrank fuzzy name matches. Empty → [].',
  })
  @IsString()
  @MaxLength(CATALOG_SEARCH_MAX_LENGTH)
  search!: string;

  @ApiPropertyOptional({
    default: CATALOG_LOOKUP_DEFAULT_LIMIT,
    maximum: CATALOG_LOOKUP_MAX_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CATALOG_LOOKUP_MAX_LIMIT)
  limit: number = CATALOG_LOOKUP_DEFAULT_LIMIT;

  @ApiPropertyOptional({
    description: 'Comma-separated result types: PRODUCT,SKU,BARCODE (default all).',
    example: 'PRODUCT,SKU',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  types?: string;
}
