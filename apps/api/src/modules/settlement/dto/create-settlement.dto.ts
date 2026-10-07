import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CurrencyCode, SettlementType } from '@hector/database';
import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  SETTLEMENT_NOTES_MAX,
  SETTLEMENT_REFERENCE_MAX,
} from '../settlement.constants';

export class CreateSettlementDto {
  @ApiProperty({ enum: CurrencyCode })
  @IsEnum(CurrencyCode)
  currency!: CurrencyCode;

  @ApiPropertyOptional({ enum: SettlementType, default: SettlementType.GENERIC })
  @IsOptional()
  @IsEnum(SettlementType)
  type?: SettlementType;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  partyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  settlementDate?: string;

  @ApiPropertyOptional({ maxLength: SETTLEMENT_REFERENCE_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(SETTLEMENT_REFERENCE_MAX)
  reference?: string;

  @ApiPropertyOptional({ maxLength: SETTLEMENT_NOTES_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(SETTLEMENT_NOTES_MAX)
  notes?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  requestId?: string;
}
