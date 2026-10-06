import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CurrencyCode, JournalEntryStatus, JournalLineDirection } from '@hector/database';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListJournalsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(JournalEntryStatus)
  status?: JournalEntryStatus;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sourceType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  effectType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class ManualJournalLineDto {
  @IsUUID()
  ledgerAccountId!: string;

  @IsEnum(JournalLineDirection)
  direction!: JournalLineDirection;

  @IsString()
  @MinLength(1)
  @MaxLength(40)
  originalAmount!: string;

  @IsEnum(CurrencyCode)
  originalCurrency!: CurrencyCode;

  @IsString()
  @MinLength(1)
  @MaxLength(40)
  baseAmount!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  fxRate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  fxRateSource?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class CreateManualJournalDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;

  @IsOptional()
  @IsISO8601()
  effectiveAt?: string;

  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => ManualJournalLineDto)
  lines!: ManualJournalLineDto[];

  @IsOptional()
  @IsBoolean()
  postImmediately?: boolean;

  @IsOptional()
  @IsUUID()
  requestId?: string;
}

export class ListLedgerQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  ledgerAccountId?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

/** Phase 4.10 — General ledger with server-derived running balance (base currency). */
export class GeneralLedgerQueryDto extends PaginationQueryDto {
  @IsUUID()
  ledgerAccountId!: string;

  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @IsOptional()
  @IsISO8601()
  dateTo?: string;
}

export class TrialBalanceQueryDto {
  @IsOptional()
  @IsISO8601()
  asOf?: string;
}
