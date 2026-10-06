import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  LedgerAccountKind,
  LedgerAccountStatus,
  LedgerAccountType,
} from '@hector/database';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListLedgerAccountsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(LedgerAccountStatus)
  status?: LedgerAccountStatus;

  @IsOptional()
  @IsEnum(LedgerAccountType)
  type?: LedgerAccountType;

  @IsOptional()
  @IsEnum(LedgerAccountKind)
  kind?: LedgerAccountKind;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class CreateLedgerAccountDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsEnum(LedgerAccountType)
  type!: LedgerAccountType;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
