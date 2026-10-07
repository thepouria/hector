import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReconciliationDiscrepancyReason } from '@hector/database';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class AddReconciliationDiscrepancyDto {
  @ApiProperty({
    description: 'Signed amount in reconciliation currency (e.g. -5000000 for under-receipt).',
  })
  @IsString()
  amount!: string;

  @ApiProperty({ enum: ReconciliationDiscrepancyReason })
  @IsEnum(ReconciliationDiscrepancyReason)
  reasonCode!: ReconciliationDiscrepancyReason;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
