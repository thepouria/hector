import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CurrencyCode } from '@hector/database';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class SettlementLineDto {
  @ApiProperty()
  @IsUUID()
  payableId!: string;

  /** Liability-currency amount to settle. */
  @ApiProperty({ example: '1000000' })
  @IsString()
  liabilityAmount!: string;

  /**
   * Payment-currency amount applied from the Payment.
   * Same-currency: defaults to liabilityAmount.
   * Cross-currency: required (or derived from settlement rate × liability).
   */
  @ApiPropertyOptional({ example: '250000000' })
  @IsOptional()
  @IsString()
  paymentAmount?: string;

  /** Prefer explicit SETTLEMENT FxRate id (FIN-SET-007). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  settlementFxRateId?: string;

  /** Validated rate input when fxRateId not provided (still explicit — never "latest"). */
  @ApiPropertyOptional({ example: '250000' })
  @IsOptional()
  @IsString()
  settlementRate?: string;

  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  settlementRateBaseCurrency?: CurrencyCode;

  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  settlementRateQuoteCurrency?: CurrencyCode;
}

export class SettlePaymentDto {
  @ApiProperty({ type: [SettlementLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SettlementLineDto)
  lines!: SettlementLineDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  requestId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  effectiveAt?: string;
}

export class SettlePayableDto {
  @ApiProperty()
  @IsUUID()
  paymentId!: string;

  @ApiProperty({ example: '1000000' })
  @IsString()
  liabilityAmount!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentAmount?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  settlementFxRateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  settlementRate?: string;

  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  settlementRateBaseCurrency?: CurrencyCode;

  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  settlementRateQuoteCurrency?: CurrencyCode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  requestId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  effectiveAt?: string;
}

export class PreviewSettlementDto extends SettlePaymentDto {
  @ApiProperty()
  @IsUUID()
  paymentId!: string;
}
