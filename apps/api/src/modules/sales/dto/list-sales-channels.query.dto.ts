import { ApiPropertyOptional } from '@nestjs/swagger';
import { SalesChannelStatus, SalesChannelType } from '@hector/database';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  SALES_CHANNEL_SEARCH_MAX_LENGTH,
  SALES_CHANNEL_SORT_FIELDS,
  type SalesChannelSortField,
} from '../sales.constants';

export class ListSalesChannelsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Search code or name' })
  @IsOptional()
  @IsString()
  @MaxLength(SALES_CHANNEL_SEARCH_MAX_LENGTH)
  search?: string;

  @ApiPropertyOptional({ enum: SalesChannelType })
  @IsOptional()
  @IsEnum(SalesChannelType)
  type?: SalesChannelType;

  @ApiPropertyOptional({ enum: SalesChannelStatus })
  @IsOptional()
  @IsEnum(SalesChannelStatus)
  status?: SalesChannelStatus;

  @ApiPropertyOptional({ enum: SALES_CHANNEL_SORT_FIELDS, default: 'name' })
  @IsOptional()
  @IsIn([...SALES_CHANNEL_SORT_FIELDS])
  sortBy: SalesChannelSortField = 'name';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'asc';
}
