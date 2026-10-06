import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CurrencyCode,
  FinancialAccountStatus,
  FinancialAccountType,
} from '@hector/database';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  FINANCIAL_ACCOUNT_BANK_NAME_MAX_LENGTH,
  FINANCIAL_ACCOUNT_CODE_MAX_LENGTH,
  FINANCIAL_ACCOUNT_DESCRIPTION_MAX_LENGTH,
  FINANCIAL_ACCOUNT_IBAN_MAX_LENGTH,
  FINANCIAL_ACCOUNT_NAME_MAX_LENGTH,
  FINANCIAL_ACCOUNT_NUMBER_MAX_LENGTH,
  FINANCIAL_ACCOUNT_SEARCH_MAX_LENGTH,
  FINANCIAL_ACCOUNT_SORT_FIELDS,
  type FinancialAccountSortField,
} from '../finance-accounts.constants';

export class CreateFinancialAccountDto {
  @ApiProperty({ example: 'CASH-IRR', maxLength: FINANCIAL_ACCOUNT_CODE_MAX_LENGTH })
  @IsString()
  @MaxLength(FINANCIAL_ACCOUNT_CODE_MAX_LENGTH)
  code!: string;

  @ApiProperty({ example: 'صندوق ریالی', maxLength: FINANCIAL_ACCOUNT_NAME_MAX_LENGTH })
  @IsString()
  @MaxLength(FINANCIAL_ACCOUNT_NAME_MAX_LENGTH)
  name!: string;

  @ApiProperty({ enum: FinancialAccountType })
  @IsEnum(FinancialAccountType)
  type!: FinancialAccountType;

  @ApiProperty({ enum: CurrencyCode })
  @IsEnum(CurrencyCode)
  currency!: CurrencyCode;

  @ApiPropertyOptional({ maxLength: FINANCIAL_ACCOUNT_DESCRIPTION_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(FINANCIAL_ACCOUNT_DESCRIPTION_MAX_LENGTH)
  description?: string;

  @ApiPropertyOptional({ maxLength: FINANCIAL_ACCOUNT_BANK_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(FINANCIAL_ACCOUNT_BANK_NAME_MAX_LENGTH)
  bankName?: string;

  @ApiPropertyOptional({ maxLength: FINANCIAL_ACCOUNT_NUMBER_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(FINANCIAL_ACCOUNT_NUMBER_MAX_LENGTH)
  accountNumber?: string;

  @ApiPropertyOptional({ maxLength: FINANCIAL_ACCOUNT_IBAN_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(FINANCIAL_ACCOUNT_IBAN_MAX_LENGTH)
  iban?: string;

  @ApiPropertyOptional({
    description: 'When true, becomes the default account for this currency (company-scoped).',
  })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateFinancialAccountDto {
  @ApiPropertyOptional({ maxLength: FINANCIAL_ACCOUNT_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(FINANCIAL_ACCOUNT_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({ maxLength: FINANCIAL_ACCOUNT_DESCRIPTION_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(FINANCIAL_ACCOUNT_DESCRIPTION_MAX_LENGTH)
  description?: string | null;

  @ApiPropertyOptional({ maxLength: FINANCIAL_ACCOUNT_BANK_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(FINANCIAL_ACCOUNT_BANK_NAME_MAX_LENGTH)
  bankName?: string | null;

  @ApiPropertyOptional({ maxLength: FINANCIAL_ACCOUNT_NUMBER_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(FINANCIAL_ACCOUNT_NUMBER_MAX_LENGTH)
  accountNumber?: string | null;

  @ApiPropertyOptional({ maxLength: FINANCIAL_ACCOUNT_IBAN_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(FINANCIAL_ACCOUNT_IBAN_MAX_LENGTH)
  iban?: string | null;

  /** Rejected in service — balance is ledger-derived only. */
  @ApiPropertyOptional({ description: 'Forbidden — balance is never patchable.' })
  @IsOptional()
  balance?: unknown;

  /** Rejected in service — currency is immutable after create. */
  @ApiPropertyOptional({ description: 'Forbidden — currency is immutable.' })
  @IsOptional()
  currency?: unknown;

  /** Rejected when movements exist. */
  @ApiPropertyOptional({ description: 'Type change rejected after any movement.' })
  @IsOptional()
  type?: unknown;
}

export class ListFinancialAccountsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(FINANCIAL_ACCOUNT_SEARCH_MAX_LENGTH)
  search?: string;

  @ApiPropertyOptional({ enum: FinancialAccountStatus })
  @IsOptional()
  @IsEnum(FinancialAccountStatus)
  status?: FinancialAccountStatus;

  @ApiPropertyOptional({ enum: FinancialAccountType })
  @IsOptional()
  @IsEnum(FinancialAccountType)
  type?: FinancialAccountType;

  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return value;
  })
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ enum: FINANCIAL_ACCOUNT_SORT_FIELDS, default: 'name' })
  @IsOptional()
  @IsIn([...FINANCIAL_ACCOUNT_SORT_FIELDS])
  sortBy: FinancialAccountSortField = 'name';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'asc';

  @ApiPropertyOptional({ enum: ['full', 'options'] })
  @IsOptional()
  @IsIn(['full', 'options'])
  view?: 'full' | 'options';
}

export class RecordOpeningBalanceDto {
  @ApiProperty({
    description: 'Positive amount as decimal string (currency precision enforced).',
    example: '2000000000',
  })
  @IsString()
  amount!: string;

  @ApiPropertyOptional({ description: 'ISO-8601 effective timestamp; defaults to now.' })
  @IsOptional()
  @IsISO8601()
  effectiveAt?: string;

  @ApiPropertyOptional({ maxLength: FINANCIAL_ACCOUNT_DESCRIPTION_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(FINANCIAL_ACCOUNT_DESCRIPTION_MAX_LENGTH)
  description?: string;

  @ApiProperty({
    description: 'Idempotency key (UUID). Retries with same key return the same movement.',
  })
  @IsUUID()
  requestId!: string;
}

export class ListAccountMovementsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['IN', 'OUT'] })
  @IsOptional()
  @IsIn(['IN', 'OUT'])
  direction?: 'IN' | 'OUT';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  dateTo?: string;
}
