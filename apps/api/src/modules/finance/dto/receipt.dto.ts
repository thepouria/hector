import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CurrencyCode,
  FinanceCounterpartyType,
  ReceiptSourceType,
  ReceiptStatus,
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
  RECEIPT_COUNTERPARTY_NAME_MAX_LENGTH,
  RECEIPT_EXTERNAL_REFERENCE_MAX_LENGTH,
  RECEIPT_NOTES_MAX_LENGTH,
  RECEIPT_REFERENCE_MAX_LENGTH,
  RECEIPT_REVERSAL_REASON_MAX_LENGTH,
  RECEIPT_SEARCH_MAX_LENGTH,
  RECEIPT_SOURCE_REFERENCE_TYPE_MAX_LENGTH,
} from '../finance-payments-receipts.constants';

export class CreateReceiptDto {
  @ApiProperty()
  @IsUUID()
  accountId!: string;

  @ApiProperty({ example: '1000000000' })
  @IsString()
  amount!: string;

  @ApiProperty({ enum: ReceiptSourceType })
  @IsEnum(ReceiptSourceType)
  sourceType!: ReceiptSourceType;

  @ApiPropertyOptional({ enum: FinanceCounterpartyType })
  @IsOptional()
  @IsEnum(FinanceCounterpartyType)
  counterpartyType?: FinanceCounterpartyType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  counterpartyId?: string;

  @ApiPropertyOptional({ maxLength: RECEIPT_COUNTERPARTY_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(RECEIPT_COUNTERPARTY_NAME_MAX_LENGTH)
  counterpartyName?: string;

  @ApiPropertyOptional({ maxLength: RECEIPT_SOURCE_REFERENCE_TYPE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(RECEIPT_SOURCE_REFERENCE_TYPE_MAX_LENGTH)
  sourceReferenceType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sourceReferenceId?: string;

  @ApiPropertyOptional({ description: 'ISO-8601; defaults to now.' })
  @IsOptional()
  @IsISO8601()
  effectiveAt?: string;

  @ApiPropertyOptional({ maxLength: RECEIPT_REFERENCE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(RECEIPT_REFERENCE_MAX_LENGTH)
  reference?: string;

  @ApiPropertyOptional({ maxLength: RECEIPT_EXTERNAL_REFERENCE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(RECEIPT_EXTERNAL_REFERENCE_MAX_LENGTH)
  externalReference?: string;

  @ApiPropertyOptional({ maxLength: RECEIPT_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(RECEIPT_NOTES_MAX_LENGTH)
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

export class UpdateReceiptDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  amount?: string;

  @ApiPropertyOptional({ enum: ReceiptSourceType })
  @IsOptional()
  @IsEnum(ReceiptSourceType)
  sourceType?: ReceiptSourceType;

  @ApiPropertyOptional({ enum: FinanceCounterpartyType })
  @IsOptional()
  @IsEnum(FinanceCounterpartyType)
  counterpartyType?: FinanceCounterpartyType | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  counterpartyId?: string | null;

  @ApiPropertyOptional({ maxLength: RECEIPT_COUNTERPARTY_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(RECEIPT_COUNTERPARTY_NAME_MAX_LENGTH)
  counterpartyName?: string | null;

  @ApiPropertyOptional({ maxLength: RECEIPT_SOURCE_REFERENCE_TYPE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(RECEIPT_SOURCE_REFERENCE_TYPE_MAX_LENGTH)
  sourceReferenceType?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sourceReferenceId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  effectiveAt?: string;

  @ApiPropertyOptional({ maxLength: RECEIPT_REFERENCE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(RECEIPT_REFERENCE_MAX_LENGTH)
  reference?: string | null;

  @ApiPropertyOptional({ maxLength: RECEIPT_EXTERNAL_REFERENCE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(RECEIPT_EXTERNAL_REFERENCE_MAX_LENGTH)
  externalReference?: string | null;

  @ApiPropertyOptional({ maxLength: RECEIPT_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(RECEIPT_NOTES_MAX_LENGTH)
  notes?: string | null;
}

export class ReverseReceiptDto {
  @ApiProperty({ maxLength: RECEIPT_REVERSAL_REASON_MAX_LENGTH })
  @IsString()
  @MaxLength(RECEIPT_REVERSAL_REASON_MAX_LENGTH)
  reason!: string;
}

export class ListReceiptsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ReceiptStatus })
  @IsOptional()
  @IsEnum(ReceiptStatus)
  status?: ReceiptStatus;

  @ApiPropertyOptional({ enum: ReceiptSourceType })
  @IsOptional()
  @IsEnum(ReceiptSourceType)
  sourceType?: ReceiptSourceType;

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
  @MaxLength(RECEIPT_SEARCH_MAX_LENGTH)
  q?: string;
}
