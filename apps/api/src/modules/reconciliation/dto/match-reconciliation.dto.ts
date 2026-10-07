import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SettlementFinanceTxnType } from '@hector/database';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';

export class MatchReconciliationDto {
  @ApiProperty({ enum: SettlementFinanceTxnType })
  @IsEnum(SettlementFinanceTxnType)
  financeTxnType!: SettlementFinanceTxnType;

  @ApiProperty()
  @IsUUID()
  financeTxnId!: string;

  @ApiProperty({ description: 'Allocation amount (obligation currency).' })
  @IsString()
  amount!: string;

  @ApiPropertyOptional({ description: 'Required for SETTLEMENT source when multiple items exist.' })
  @IsOptional()
  @IsUUID()
  settlementItemId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  paymentAmount?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  requestId?: string;
}
