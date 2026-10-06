import { ApiPropertyOptional } from '@nestjs/swagger';
import { CompanyMemberStatus } from '@hector/database';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { MEMBER_SORT_FIELDS, type MemberSortField } from '../companies.constants';

export class ListMembersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CompanyMemberStatus })
  @IsOptional()
  @IsEnum(CompanyMemberStatus)
  status?: CompanyMemberStatus;

  @ApiPropertyOptional({ description: 'Search email, firstName, or lastName' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: MEMBER_SORT_FIELDS, default: 'joinedAt' })
  @IsOptional()
  @IsIn(MEMBER_SORT_FIELDS)
  sortBy: MemberSortField = 'joinedAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';
}
