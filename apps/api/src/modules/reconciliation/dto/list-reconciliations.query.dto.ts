import { ApiPropertyOptional } from '@nestjs/swagger';
import { CurrencyCode, ReconciliationSourceType, ReconciliationStatus } from '@hector/database';
import { IsEnum, IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListReconciliationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ReconciliationStatus })
  @IsOptional()
  @IsEnum(ReconciliationStatus)
  status?: ReconciliationStatus;

  @ApiPropertyOptional({ enum: ReconciliationSourceType })
  @IsOptional()
  @IsEnum(ReconciliationSourceType)
  sourceType?: ReconciliationSourceType;

  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode;

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  hasDifference?: 'true' | 'false';

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  needsReview?: 'true' | 'false';
}
