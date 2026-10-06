import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CapitalContributionStatus,
  CapitalFundingType,
  CurrencyCode,
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
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  CAPITAL_CONTRIBUTOR_NAME_MAX_LENGTH,
  CAPITAL_NOTES_MAX_LENGTH,
  CAPITAL_REFERENCE_MAX_LENGTH,
  CAPITAL_SEARCH_MAX_LENGTH,
} from '../finance-capital-loans.constants';

export class CreateCapitalContributionDto {
  @ApiProperty({ enum: CapitalFundingType })
  @IsEnum(CapitalFundingType)
  fundingType!: CapitalFundingType;

  @ApiProperty({ enum: FinanceCounterpartyType })
  @IsEnum(FinanceCounterpartyType)
  contributorType!: FinanceCounterpartyType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  contributorId?: string;

  @ApiProperty({ maxLength: CAPITAL_CONTRIBUTOR_NAME_MAX_LENGTH })
  @IsString()
  @MaxLength(CAPITAL_CONTRIBUTOR_NAME_MAX_LENGTH)
  contributorName!: string;

  @ApiProperty()
  @IsUUID()
  accountId!: string;

  @ApiProperty({ example: '2000000000' })
  @IsString()
  amount!: string;

  @ApiPropertyOptional({ description: 'ISO-8601; defaults to now.' })
  @IsOptional()
  @IsISO8601()
  effectiveAt?: string;

  @ApiPropertyOptional({ maxLength: CAPITAL_REFERENCE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(CAPITAL_REFERENCE_MAX_LENGTH)
  reference?: string;

  @ApiPropertyOptional({ maxLength: CAPITAL_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(CAPITAL_NOTES_MAX_LENGTH)
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

export class UpdateCapitalContributionDto {
  @ApiPropertyOptional({ enum: CapitalFundingType })
  @IsOptional()
  @IsEnum(CapitalFundingType)
  fundingType?: CapitalFundingType;

  @ApiPropertyOptional({ enum: FinanceCounterpartyType })
  @IsOptional()
  @IsEnum(FinanceCounterpartyType)
  contributorType?: FinanceCounterpartyType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  contributorId?: string | null;

  @ApiPropertyOptional({ maxLength: CAPITAL_CONTRIBUTOR_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(CAPITAL_CONTRIBUTOR_NAME_MAX_LENGTH)
  contributorName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  amount?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  effectiveAt?: string;

  @ApiPropertyOptional({ maxLength: CAPITAL_REFERENCE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(CAPITAL_REFERENCE_MAX_LENGTH)
  reference?: string | null;

  @ApiPropertyOptional({ maxLength: CAPITAL_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(CAPITAL_NOTES_MAX_LENGTH)
  notes?: string | null;
}

export class ListCapitalContributionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CapitalContributionStatus })
  @IsOptional()
  @IsEnum(CapitalContributionStatus)
  status?: CapitalContributionStatus;

  @ApiPropertyOptional({ enum: CapitalFundingType })
  @IsOptional()
  @IsEnum(CapitalFundingType)
  fundingType?: CapitalFundingType;

  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(CAPITAL_SEARCH_MAX_LENGTH)
  q?: string;
}
