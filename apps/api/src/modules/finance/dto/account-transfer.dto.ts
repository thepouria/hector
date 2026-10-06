import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CurrencyCode, FinancialAccountTransferStatus } from '@hector/database';
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
  ACCOUNT_TRANSFER_NOTES_MAX_LENGTH,
  ACCOUNT_TRANSFER_SEARCH_MAX_LENGTH,
} from '../finance-accounts.constants';

export class CreateAccountTransferDto {
  @ApiProperty()
  @IsUUID()
  sourceAccountId!: string;

  @ApiProperty()
  @IsUUID()
  destinationAccountId!: string;

  @ApiProperty({ example: '100000000' })
  @IsString()
  amount!: string;

  @ApiPropertyOptional({ description: 'ISO-8601; defaults to now.' })
  @IsOptional()
  @IsISO8601()
  effectiveAt?: string;

  @ApiPropertyOptional({ maxLength: ACCOUNT_TRANSFER_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(ACCOUNT_TRANSFER_NOTES_MAX_LENGTH)
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

export class ListAccountTransfersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: FinancialAccountTransferStatus })
  @IsOptional()
  @IsEnum(FinancialAccountTransferStatus)
  status?: FinancialAccountTransferStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sourceAccountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  destinationAccountId?: string;

  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode;

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
  @MaxLength(ACCOUNT_TRANSFER_SEARCH_MAX_LENGTH)
  q?: string;
}
