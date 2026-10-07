import { ApiPropertyOptional } from '@nestjs/swagger';
import { SettlementFinanceTxnType } from '@hector/database';
import { IsEnum, IsISO8601, IsOptional, IsString } from 'class-validator';

export class ListReconciliationCandidatesQueryDto {
  @ApiPropertyOptional({ enum: SettlementFinanceTxnType })
  @IsOptional()
  @IsEnum(SettlementFinanceTxnType)
  financeTxnType?: SettlementFinanceTxnType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reference?: string;
}
