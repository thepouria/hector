import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ChannelSettlementComponentEffect,
  ChannelSettlementComponentType,
  CurrencyCode,
} from '@hector/database';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { SETTLEMENT_NOTES_MAX, SETTLEMENT_REFERENCE_MAX } from '../settlement.constants';

export class ChannelSettlementComponentDto {
  @ApiProperty({ enum: ChannelSettlementComponentType })
  @IsEnum(ChannelSettlementComponentType)
  type!: ChannelSettlementComponentType;

  @ApiProperty({ enum: ChannelSettlementComponentEffect })
  @IsEnum(ChannelSettlementComponentEffect)
  effect!: ChannelSettlementComponentEffect;

  @ApiProperty({ example: '500000000' })
  @IsString()
  @MinLength(1)
  amount!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

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
}

export class CreateChannelSettlementDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  channelId!: string;

  @ApiProperty({ example: '2026-09-01T00:00:00.000Z' })
  @IsDateString()
  periodStart!: string;

  @ApiProperty({ example: '2026-09-15T23:59:59.999Z' })
  @IsDateString()
  periodEnd!: string;

  @ApiProperty({ enum: CurrencyCode })
  @IsEnum(CurrencyCode)
  currency!: CurrencyCode;

  @ApiPropertyOptional({ maxLength: SETTLEMENT_REFERENCE_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(SETTLEMENT_REFERENCE_MAX)
  externalReference?: string;

  @ApiPropertyOptional({ maxLength: SETTLEMENT_NOTES_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(SETTLEMENT_NOTES_MAX)
  notes?: string;

  @ApiProperty({ type: [ChannelSettlementComponentDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ChannelSettlementComponentDto)
  components!: ChannelSettlementComponentDto[];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  requestId?: string;
}

export class ReplaceChannelSettlementComponentsDto {
  @ApiProperty({ type: [ChannelSettlementComponentDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ChannelSettlementComponentDto)
  components!: ChannelSettlementComponentDto[];
}

export class AllocateChannelReceiptDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  receiptId!: string;

  @ApiProperty({ example: '1000000000', description: 'Amount in settlement/receipt currency' })
  @IsString()
  @MinLength(1)
  amount!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  requestId?: string;
}
