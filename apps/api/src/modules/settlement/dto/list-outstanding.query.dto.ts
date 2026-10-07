import { ApiPropertyOptional } from '@nestjs/swagger';
import { CurrencyCode, SupplierPayableStatus } from '@hector/database';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ListOutstandingPayablesQueryDto {
  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  partyId?: string;

  @ApiPropertyOptional({ enum: SupplierPayableStatus })
  @IsOptional()
  @IsEnum(SupplierPayableStatus)
  status?: SupplierPayableStatus;

  @ApiPropertyOptional({ enum: ['DUE', 'OVERDUE', 'NOT_DUE'] })
  @IsOptional()
  @IsEnum(['DUE', 'OVERDUE', 'NOT_DUE'] as const)
  dueState?: 'DUE' | 'OVERDUE' | 'NOT_DUE';

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class ListOutstandingLoansQueryDto {
  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  partyId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
