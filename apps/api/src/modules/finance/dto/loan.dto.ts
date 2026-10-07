import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CurrencyCode,
  FinanceCounterpartyType,
  LoanStatus,
} from '@hector/database';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  LOAN_LENDER_NAME_MAX_LENGTH,
  LOAN_NOTES_MAX_LENGTH,
  LOAN_REFERENCE_MAX_LENGTH,
  LOAN_SEARCH_MAX_LENGTH,
} from '../finance-capital-loans.constants';

export class CreateLoanFirstDisbursementDto {
  @ApiProperty()
  @IsUUID()
  accountId!: string;

  @ApiProperty({ example: '500000000' })
  @IsString()
  amount!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  effectiveAt?: string;

  @ApiPropertyOptional({ maxLength: LOAN_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(LOAN_NOTES_MAX_LENGTH)
  notes?: string;

  @ApiPropertyOptional({ description: 'Idempotency key for the disbursement row.' })
  @IsOptional()
  @IsUUID()
  requestId?: string;
}

export class CreateLoanDto {
  @ApiProperty({ enum: FinanceCounterpartyType })
  @IsEnum(FinanceCounterpartyType)
  lenderType!: FinanceCounterpartyType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  lenderId?: string;

  @ApiProperty({ maxLength: LOAN_LENDER_NAME_MAX_LENGTH })
  @IsString()
  @MaxLength(LOAN_LENDER_NAME_MAX_LENGTH)
  lenderName!: string;

  /** Canonical lender Party (same company). Preferred over free-text identity. */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  lenderPartyId?: string;

  /** Borrower Party when Hector is the lender (receivable loan). */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  borrowerPartyId?: string;

  @ApiProperty({ enum: CurrencyCode })
  @IsEnum(CurrencyCode)
  currency!: CurrencyCode;

  @ApiProperty({ example: '500000000', description: 'Contracted principal ceiling.' })
  @IsString()
  contractedPrincipal!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  receivingAccountId?: string;

  @ApiPropertyOptional({ example: '250000' })
  @IsOptional()
  @IsString()
  referenceFxRate?: string;

  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  referenceFxBaseCurrency?: CurrencyCode;

  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  referenceFxQuoteCurrency?: CurrencyCode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  dueDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  interestRate?: string;

  @ApiPropertyOptional({ maxLength: LOAN_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(LOAN_NOTES_MAX_LENGTH)
  interestNotes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  feeAmount?: string;

  @ApiPropertyOptional({ maxLength: LOAN_REFERENCE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(LOAN_REFERENCE_MAX_LENGTH)
  reference?: string;

  @ApiPropertyOptional({ maxLength: LOAN_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(LOAN_NOTES_MAX_LENGTH)
  notes?: string;

  @ApiPropertyOptional({ type: CreateLoanFirstDisbursementDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateLoanFirstDisbursementDto)
  firstDisbursement?: CreateLoanFirstDisbursementDto;

  @ApiPropertyOptional({
    description: 'When true with firstDisbursement, post disbursement immediately.',
  })
  @IsOptional()
  @IsBoolean()
  postImmediately?: boolean;

  @ApiProperty({ description: 'Idempotency key for loan create (UUID).' })
  @IsUUID()
  requestId!: string;
}

export class UpdateLoanDto {
  @ApiPropertyOptional({ enum: FinanceCounterpartyType })
  @IsOptional()
  @IsEnum(FinanceCounterpartyType)
  lenderType?: FinanceCounterpartyType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  lenderId?: string | null;

  @ApiPropertyOptional({ maxLength: LOAN_LENDER_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(LOAN_LENDER_NAME_MAX_LENGTH)
  lenderName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contractedPrincipal?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  receivingAccountId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  referenceFxRate?: string | null;

  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  referenceFxBaseCurrency?: CurrencyCode | null;

  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  referenceFxQuoteCurrency?: CurrencyCode | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  dueDate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  interestRate?: string | null;

  @ApiPropertyOptional({ maxLength: LOAN_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(LOAN_NOTES_MAX_LENGTH)
  interestNotes?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  feeAmount?: string | null;

  @ApiPropertyOptional({ maxLength: LOAN_REFERENCE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(LOAN_REFERENCE_MAX_LENGTH)
  reference?: string | null;

  @ApiPropertyOptional({ maxLength: LOAN_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(LOAN_NOTES_MAX_LENGTH)
  notes?: string | null;
}

export class CreateLoanDisbursementDto {
  @ApiProperty()
  @IsUUID()
  accountId!: string;

  @ApiProperty({ example: '500000000' })
  @IsString()
  amount!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  effectiveAt?: string;

  @ApiPropertyOptional({ maxLength: LOAN_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(LOAN_NOTES_MAX_LENGTH)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  postImmediately?: boolean;

  @ApiProperty()
  @IsUUID()
  requestId!: string;
}

export class CreateLoanRepaymentDto {
  @ApiProperty()
  @IsUUID()
  accountId!: string;

  @ApiProperty({ example: '3000' })
  @IsString()
  principalAmount!: string;

  @ApiPropertyOptional({ example: '0' })
  @IsOptional()
  @IsString()
  interestAmount?: string;

  @ApiPropertyOptional({ example: '0' })
  @IsOptional()
  @IsString()
  feeAmount?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  effectiveAt?: string;

  @ApiPropertyOptional({ maxLength: LOAN_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(LOAN_NOTES_MAX_LENGTH)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  postImmediately?: boolean;

  @ApiProperty()
  @IsUUID()
  requestId!: string;
}

export class ListLoansQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: LoanStatus })
  @IsOptional()
  @IsEnum(LoanStatus)
  status?: LoanStatus;

  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode;

  @ApiPropertyOptional({ description: 'When true, only overdue loans with outstanding > 0.' })
  @IsOptional()
  @IsBoolean()
  overdueOnly?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(LOAN_SEARCH_MAX_LENGTH)
  q?: string;
}
