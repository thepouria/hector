import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CatalogLifecycleStatus } from '@hector/database';
import {
  ATTRIBUTE_TEXT_VALUE_MAX_LENGTH,
  BULK_IDS_MAX,
  BULK_OPERATION_VALUES,
  CATALOG_SEARCH_MAX_LENGTH,
} from '../catalog.constants';

export class BulkProductQueryDto {
  @ApiPropertyOptional({ maxLength: CATALOG_SEARCH_MAX_LENGTH })
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
  brandId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === true || value === 'true' || value === '1') return true;
    if (value === false || value === 'false' || value === '0') return false;
    return value;
  })
  @IsBoolean()
  includeDescendants?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === true || value === 'true' || value === '1') return true;
    if (value === false || value === 'false' || value === '0') return false;
    return value;
  })
  @IsBoolean()
  hasSku?: boolean;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  attrs?: string;
}

export class BulkSkuQueryDto {
  @ApiPropertyOptional({ maxLength: CATALOG_SEARCH_MAX_LENGTH })
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

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === true || value === 'true' || value === '1') return true;
    if (value === false || value === 'false' || value === '0') return false;
    return value;
  })
  @IsBoolean()
  hasBarcode?: boolean;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  variantValueId?: string;
}

export class BulkSelectionDto {
  @ApiProperty({ enum: ['IDS', 'QUERY'] })
  @IsIn(['IDS', 'QUERY'])
  mode!: 'IDS' | 'QUERY';

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @ValidateIf((o: BulkSelectionDto) => o.mode === 'IDS')
  @IsArray()
  @ArrayMaxSize(BULK_IDS_MAX)
  @IsUUID('4', { each: true })
  ids?: string[];

  @ApiPropertyOptional({
    description: 'Validated Catalog filters (Phase 1.9). Never a raw Prisma where.',
  })
  @ValidateIf((o: BulkSelectionDto) => o.mode === 'QUERY')
  @IsOptional()
  @ValidateNested()
  @Type(() => BulkProductQueryDto)
  query?: BulkProductQueryDto | BulkSkuQueryDto;

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(BULK_IDS_MAX)
  @IsUUID('4', { each: true })
  excludedIds?: string[];

  @ApiPropertyOptional({
    description:
      'Required when QUERY has no meaningful filters. Prevents accidental whole-catalog mutation.',
  })
  @IsOptional()
  @IsBoolean()
  selectAll?: boolean;
}

export class BulkAttributePayloadDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  attributeId!: string;

  @ApiPropertyOptional({ maxLength: ATTRIBUTE_TEXT_VALUE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(ATTRIBUTE_TEXT_VALUE_MAX_LENGTH)
  textValue?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  numberValue?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  booleanValue?: boolean | null;

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  optionIds?: string[] | null;
}

export class BulkChangeBrandPayloadDto {
  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'null clears brand' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  brandId!: string | null;
}

export class BulkChangeCategoryPayloadDto {
  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'null clears category' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  categoryId!: string | null;
}

export class BulkAttributeRemovePayloadDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  attributeId!: string;
}

export class BulkCommandDto {
  @ApiProperty({ enum: BULK_OPERATION_VALUES })
  @IsIn([...BULK_OPERATION_VALUES])
  operation!: (typeof BULK_OPERATION_VALUES)[number];

  @ApiProperty({ type: BulkSelectionDto })
  @ValidateNested()
  @Type(() => BulkSelectionDto)
  selection!: BulkSelectionDto;

  @ApiPropertyOptional({
    description:
      'Operation-specific payload. Required for brand/category/attribute ops; omit for lifecycle.',
  })
  @IsOptional()
  payload?: Record<string, unknown>;
}
