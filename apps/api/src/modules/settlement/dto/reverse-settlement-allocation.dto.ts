import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { SETTLEMENT_REVERSE_REASON_MAX } from '../settlement.constants';

export class ReverseSettlementAllocationDto {
  @ApiPropertyOptional({ maxLength: SETTLEMENT_REVERSE_REASON_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(SETTLEMENT_REVERSE_REASON_MAX)
  reason?: string;
}
