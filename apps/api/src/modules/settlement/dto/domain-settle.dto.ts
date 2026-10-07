import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CurrencyCode, FxRateSourceType } from '@hector/database';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class SettlementFxDto {
  @ApiProperty({ example: '280000', description: '1 rateBase = rate × rateQuote' })
  @IsString()
  rate!: string;

  @ApiProperty({ enum: CurrencyCode, example: CurrencyCode.USD })
  @IsEnum(CurrencyCode)
  rateBaseCurrency!: CurrencyCode;

  @ApiProperty({ enum: CurrencyCode, example: CurrencyCode.IRR })
  @IsEnum(CurrencyCode)
  rateQuoteCurrency!: CurrencyCode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  rateDate?: string;

  @ApiPropertyOptional({ enum: FxRateSourceType, default: FxRateSourceType.MANUAL })
  @IsOptional()
  @IsEnum(FxRateSourceType)
  rateSourceType?: FxRateSourceType;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  fxRateId?: string;
}

export class SettleSupplierPayableDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  paymentId!: string;

  @ApiProperty({
    example: '200000000',
    description: 'Obligation-currency amount to settle',
  })
  @IsString()
  amount!: string;

  @ApiPropertyOptional({
    description: 'Payment-currency amount (required consistency for cross-currency)',
  })
  @IsOptional()
  @IsString()
  paymentAmount?: string;

  @ApiPropertyOptional({ type: SettlementFxDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SettlementFxDto)
  fx?: SettlementFxDto;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  requestId?: string;
}

export class RepayLoanDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  paymentId!: string;

  @ApiProperty({
    example: '1000',
    description: 'Principal obligation amount to repay (obligation currency)',
  })
  @IsString()
  amount!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentAmount?: string;

  @ApiPropertyOptional({ type: SettlementFxDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SettlementFxDto)
  fx?: SettlementFxDto;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  requestId?: string;
}
