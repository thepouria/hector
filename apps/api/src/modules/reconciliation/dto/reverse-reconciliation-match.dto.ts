import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { SETTLEMENT_REVERSE_REASON_MAX } from '../../settlement/settlement.constants';

export class ReverseReconciliationMatchDto {
  @ApiProperty()
  @IsUUID()
  allocationId!: string;

  @ApiPropertyOptional({ maxLength: SETTLEMENT_REVERSE_REASON_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(SETTLEMENT_REVERSE_REASON_MAX)
  reason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  requestId?: string;
}
