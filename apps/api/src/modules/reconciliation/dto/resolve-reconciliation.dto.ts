import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReconciliationResolutionType } from '@hector/database';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class ResolveReconciliationDto {
  @ApiProperty({ enum: ReconciliationResolutionType })
  @IsEnum(ReconciliationResolutionType)
  resolutionType!: ReconciliationResolutionType;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  resolutionNotes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  resolutionReference?: string;

  @ApiPropertyOptional({ description: 'Idempotency key (UUID).' })
  @IsOptional()
  @IsString()
  requestId?: string;
}
