import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Validate,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

@ValidatorConstraint({ name: 'auditDateRange', async: false })
class AuditDateRangeConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments): boolean {
    const object = args.object as ListAuditLogsQueryDto;
    if (object.from && object.to && object.from.getTime() > object.to.getTime()) {
      return false;
    }
    return true;
  }

  defaultMessage(): string {
    return '`from` must be less than or equal to `to`';
  }
}

export class ListAuditLogsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  action?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  entityType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  entityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  actorUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  actorCompanyMemberId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  requestId?: string;

  @ApiPropertyOptional({ description: 'Inclusive lower bound (ISO datetime)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({ description: 'Inclusive upper bound (ISO datetime)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @Validate(AuditDateRangeConstraint)
  to?: Date;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';
}
