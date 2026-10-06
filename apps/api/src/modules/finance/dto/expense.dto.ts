import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CurrencyCode,
  ExpenseCategoryStatus,
  ExpensePaymentStatus,
  ExpenseStatus,
  FinanceCounterpartyType,
} from '@hector/database';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  EXPENSE_CATEGORY_CODE_MAX_LENGTH,
  EXPENSE_CATEGORY_DESCRIPTION_MAX_LENGTH,
  EXPENSE_CATEGORY_NAME_MAX_LENGTH,
  EXPENSE_COUNTERPARTY_NAME_MAX_LENGTH,
  EXPENSE_DESCRIPTION_MAX_LENGTH,
  EXPENSE_NOTES_MAX_LENGTH,
  EXPENSE_REFERENCE_MAX_LENGTH,
  EXPENSE_SEARCH_MAX_LENGTH,
} from '../finance-expenses.constants';

export class CreateExpenseCategoryDto {
  @ApiProperty({ example: 'MARKETING' })
  @IsString()
  @MinLength(2)
  @MaxLength(EXPENSE_CATEGORY_CODE_MAX_LENGTH)
  code!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(EXPENSE_CATEGORY_NAME_MAX_LENGTH)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(EXPENSE_CATEGORY_DESCRIPTION_MAX_LENGTH)
  description?: string;
}

export class UpdateExpenseCategoryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(EXPENSE_CATEGORY_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(EXPENSE_CATEGORY_DESCRIPTION_MAX_LENGTH)
  description?: string | null;
}

export class ListExpenseCategoriesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ExpenseCategoryStatus })
  @IsOptional()
  @IsEnum(ExpenseCategoryStatus)
  status?: ExpenseCategoryStatus;

  @ApiPropertyOptional({ maxLength: EXPENSE_SEARCH_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(EXPENSE_SEARCH_MAX_LENGTH)
  q?: string;
}

export class CreateExpenseDto {
  @ApiProperty()
  @IsUUID()
  categoryId!: string;

  @ApiProperty({ example: '100000000' })
  @IsString()
  amount!: string;

  @ApiProperty({ enum: CurrencyCode })
  @IsEnum(CurrencyCode)
  currency!: CurrencyCode;

  @ApiProperty({ description: 'ISO-8601 business date' })
  @IsISO8601()
  expenseDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  dueDate?: string;

  @ApiPropertyOptional({ enum: FinanceCounterpartyType })
  @IsOptional()
  @IsEnum(FinanceCounterpartyType)
  counterpartyType?: FinanceCounterpartyType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  counterpartyId?: string;

  @ApiPropertyOptional({ maxLength: EXPENSE_COUNTERPARTY_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(EXPENSE_COUNTERPARTY_NAME_MAX_LENGTH)
  counterpartyName?: string;

  @ApiProperty({ maxLength: EXPENSE_DESCRIPTION_MAX_LENGTH })
  @IsString()
  @MinLength(1)
  @MaxLength(EXPENSE_DESCRIPTION_MAX_LENGTH)
  description!: string;

  @ApiPropertyOptional({ maxLength: EXPENSE_REFERENCE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(EXPENSE_REFERENCE_MAX_LENGTH)
  reference?: string;

  @ApiPropertyOptional({ maxLength: EXPENSE_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(EXPENSE_NOTES_MAX_LENGTH)
  notes?: string;

  @ApiPropertyOptional({ description: 'Approve in the same request.' })
  @IsOptional()
  @IsBoolean()
  approveImmediately?: boolean;

  @ApiPropertyOptional({ description: 'Idempotency key (UUID).' })
  @IsOptional()
  @IsUUID()
  requestId?: string;
}

export class UpdateExpenseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  amount?: string;

  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  expenseDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  dueDate?: string | null;

  @ApiPropertyOptional({ enum: FinanceCounterpartyType })
  @IsOptional()
  @IsEnum(FinanceCounterpartyType)
  counterpartyType?: FinanceCounterpartyType | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  counterpartyId?: string | null;

  @ApiPropertyOptional({ maxLength: EXPENSE_COUNTERPARTY_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(EXPENSE_COUNTERPARTY_NAME_MAX_LENGTH)
  counterpartyName?: string | null;

  @ApiPropertyOptional({ maxLength: EXPENSE_DESCRIPTION_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(EXPENSE_DESCRIPTION_MAX_LENGTH)
  description?: string;

  @ApiPropertyOptional({ maxLength: EXPENSE_REFERENCE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(EXPENSE_REFERENCE_MAX_LENGTH)
  reference?: string | null;

  @ApiPropertyOptional({ maxLength: EXPENSE_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(EXPENSE_NOTES_MAX_LENGTH)
  notes?: string | null;
}

export class ListExpensesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ExpenseStatus })
  @IsOptional()
  @IsEnum(ExpenseStatus)
  status?: ExpenseStatus;

  @ApiPropertyOptional({ enum: ExpensePaymentStatus })
  @IsOptional()
  @IsEnum(ExpensePaymentStatus)
  paymentStatus?: ExpensePaymentStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode;

  @ApiPropertyOptional({ maxLength: EXPENSE_SEARCH_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(EXPENSE_SEARCH_MAX_LENGTH)
  q?: string;
}

export class AllocateExpensePaymentDto {
  @ApiProperty()
  @IsUUID()
  paymentId!: string;

  @ApiProperty({ example: '40000000' })
  @IsString()
  amount!: string;

  @ApiPropertyOptional({ description: 'Idempotency key (UUID).' })
  @IsOptional()
  @IsUUID()
  requestId?: string;
}

export class PayExpenseNowDto {
  @ApiProperty()
  @IsUUID()
  accountId!: string;

  @ApiPropertyOptional({
    description: 'Defaults to full outstanding when omitted.',
  })
  @IsOptional()
  @IsString()
  amount?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  effectiveAt?: string;

  @ApiPropertyOptional({ maxLength: EXPENSE_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(EXPENSE_NOTES_MAX_LENGTH)
  notes?: string;

  @ApiPropertyOptional({ description: 'Idempotency key (UUID).' })
  @IsOptional()
  @IsUUID()
  requestId?: string;
}
