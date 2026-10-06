import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CurrencyCode,
  FinanceCounterpartyType,
  PaymentPurposeType,
  PaymentStatus,
} from '@hector/database';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  PAYMENT_COUNTERPARTY_NAME_MAX_LENGTH,
  PAYMENT_EXTERNAL_REFERENCE_MAX_LENGTH,
  PAYMENT_NOTES_MAX_LENGTH,
  PAYMENT_PURPOSE_REFERENCE_TYPE_MAX_LENGTH,
  PAYMENT_REFERENCE_MAX_LENGTH,
  PAYMENT_REVERSAL_REASON_MAX_LENGTH,
  PAYMENT_SEARCH_MAX_LENGTH,
} from '../finance-payments-receipts.constants';

export class CreatePaymentDto {
  @ApiProperty()
  @IsUUID()
  accountId!: string;

  @ApiProperty({ example: '500000000' })
  @IsString()
  amount!: string;

  @ApiProperty({ enum: PaymentPurposeType })
  @IsEnum(PaymentPurposeType)
  purposeType!: PaymentPurposeType;

  @ApiPropertyOptional({ enum: FinanceCounterpartyType })
  @IsOptional()
  @IsEnum(FinanceCounterpartyType)
  counterpartyType?: FinanceCounterpartyType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  counterpartyId?: string;

  @ApiPropertyOptional({ maxLength: PAYMENT_COUNTERPARTY_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PAYMENT_COUNTERPARTY_NAME_MAX_LENGTH)
  counterpartyName?: string;

  @ApiPropertyOptional({ maxLength: PAYMENT_PURPOSE_REFERENCE_TYPE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PAYMENT_PURPOSE_REFERENCE_TYPE_MAX_LENGTH)
  purposeReferenceType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  purposeReferenceId?: string;

  @ApiPropertyOptional({ description: 'ISO-8601; defaults to now.' })
  @IsOptional()
  @IsISO8601()
  effectiveAt?: string;

  @ApiPropertyOptional({ maxLength: PAYMENT_REFERENCE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PAYMENT_REFERENCE_MAX_LENGTH)
  reference?: string;

  @ApiPropertyOptional({ maxLength: PAYMENT_EXTERNAL_REFERENCE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PAYMENT_EXTERNAL_REFERENCE_MAX_LENGTH)
  externalReference?: string;

  @ApiPropertyOptional({ maxLength: PAYMENT_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PAYMENT_NOTES_MAX_LENGTH)
  notes?: string;

  @ApiPropertyOptional({
    description: 'When true, create as DRAFT then post in the same transaction.',
  })
  @IsOptional()
  @IsBoolean()
  postImmediately?: boolean;

  @ApiProperty({ description: 'Idempotency key (UUID).' })
  @IsUUID()
  requestId!: string;
}

export class UpdatePaymentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  amount?: string;

  @ApiPropertyOptional({ enum: PaymentPurposeType })
  @IsOptional()
  @IsEnum(PaymentPurposeType)
  purposeType?: PaymentPurposeType;

  @ApiPropertyOptional({ enum: FinanceCounterpartyType })
  @IsOptional()
  @IsEnum(FinanceCounterpartyType)
  counterpartyType?: FinanceCounterpartyType | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  counterpartyId?: string | null;

  @ApiPropertyOptional({ maxLength: PAYMENT_COUNTERPARTY_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PAYMENT_COUNTERPARTY_NAME_MAX_LENGTH)
  counterpartyName?: string | null;

  @ApiPropertyOptional({ maxLength: PAYMENT_PURPOSE_REFERENCE_TYPE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PAYMENT_PURPOSE_REFERENCE_TYPE_MAX_LENGTH)
  purposeReferenceType?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  purposeReferenceId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  effectiveAt?: string;

  @ApiPropertyOptional({ maxLength: PAYMENT_REFERENCE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PAYMENT_REFERENCE_MAX_LENGTH)
  reference?: string | null;

  @ApiPropertyOptional({ maxLength: PAYMENT_EXTERNAL_REFERENCE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PAYMENT_EXTERNAL_REFERENCE_MAX_LENGTH)
  externalReference?: string | null;

  @ApiPropertyOptional({ maxLength: PAYMENT_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PAYMENT_NOTES_MAX_LENGTH)
  notes?: string | null;
}

export class ReversePaymentDto {
  @ApiProperty({ maxLength: PAYMENT_REVERSAL_REASON_MAX_LENGTH })
  @IsString()
  @MaxLength(PAYMENT_REVERSAL_REASON_MAX_LENGTH)
  reason!: string;
}

export class ListPaymentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @ApiPropertyOptional({ enum: PaymentPurposeType })
  @IsOptional()
  @IsEnum(PaymentPurposeType)
  purposeType?: PaymentPurposeType;

  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional({ enum: FinanceCounterpartyType })
  @IsOptional()
  @IsEnum(FinanceCounterpartyType)
  counterpartyType?: FinanceCounterpartyType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(PAYMENT_SEARCH_MAX_LENGTH)
  q?: string;
}
