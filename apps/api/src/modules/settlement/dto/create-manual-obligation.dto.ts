import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CurrencyCode } from '@hector/database';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { SETTLEMENT_NOTES_MAX } from '../settlement.constants';

export class CreateManualObligationDto {
  @ApiProperty({ enum: CurrencyCode })
  @IsEnum(CurrencyCode)
  currency!: CurrencyCode;

  @ApiProperty({ example: '500000000', description: 'Positive money amount string' })
  @IsString()
  originalAmount!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  partyId?: string;

  @ApiPropertyOptional({ maxLength: SETTLEMENT_NOTES_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(SETTLEMENT_NOTES_MAX)
  notes?: string;
}
