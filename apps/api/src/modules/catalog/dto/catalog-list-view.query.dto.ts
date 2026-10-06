import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export const CATALOG_LIST_VIEWS = ['full', 'options'] as const;
export type CatalogListView = (typeof CATALOG_LIST_VIEWS)[number];

export class CatalogPaginatedListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: CATALOG_LIST_VIEWS,
    default: 'full',
    description: 'Use options for a lightweight id/name/code/status projection.',
  })
  @IsOptional()
  @IsIn([...CATALOG_LIST_VIEWS])
  view: CatalogListView = 'full';
}
