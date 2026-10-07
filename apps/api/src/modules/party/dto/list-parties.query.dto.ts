import { ApiPropertyOptional } from '@nestjs/swagger';
import { PartyRoleType, PartyStatus, PartyType } from '@hector/database';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { PARTY_SEARCH_MAX_LENGTH } from '../party.constants';

export const PARTY_LIST_SORT_FIELDS = [
  'displayName',
  'partyCode',
  'createdAt',
  'updatedAt',
] as const;

export type PartyListSortField = (typeof PARTY_LIST_SORT_FIELDS)[number];

export class ListPartiesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ maxLength: PARTY_SEARCH_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_SEARCH_MAX_LENGTH)
  search?: string;

  @ApiPropertyOptional({ enum: PartyType })
  @IsOptional()
  @IsEnum(PartyType)
  type?: PartyType;

  @ApiPropertyOptional({ enum: PartyStatus })
  @IsOptional()
  @IsEnum(PartyStatus)
  status?: PartyStatus;

  @ApiPropertyOptional({ enum: PartyRoleType, description: 'Filter by active role capacity' })
  @IsOptional()
  @IsEnum(PartyRoleType)
  role?: PartyRoleType;

  @ApiPropertyOptional({ enum: PARTY_LIST_SORT_FIELDS, default: 'updatedAt' })
  @IsOptional()
  @IsIn(PARTY_LIST_SORT_FIELDS)
  sortBy?: PartyListSortField = 'updatedAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc' = 'desc';
}
