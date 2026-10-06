import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsIn } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

const NOTE_SORT_FIELDS = ['createdAt'] as const;
const SORT_ORDERS = ['asc', 'desc'] as const;

export class ListSupplierNotesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: NOTE_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn([...NOTE_SORT_FIELDS])
  sortBy: (typeof NOTE_SORT_FIELDS)[number] = 'createdAt';

  @ApiPropertyOptional({ enum: SORT_ORDERS, default: 'desc' })
  @IsOptional()
  @IsIn([...SORT_ORDERS])
  sortOrder: (typeof SORT_ORDERS)[number] = 'desc';
}
