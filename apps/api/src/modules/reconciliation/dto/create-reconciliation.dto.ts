import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReconciliationSourceType } from '@hector/database';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateReconciliationDto {
  @ApiProperty({ enum: ReconciliationSourceType })
  @IsEnum(ReconciliationSourceType)
  sourceType!: ReconciliationSourceType;

  @ApiProperty()
  @IsUUID()
  sourceId!: string;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @ApiPropertyOptional({ description: 'Idempotency key (UUID).' })
  @IsOptional()
  @IsUUID()
  requestId?: string;
}
