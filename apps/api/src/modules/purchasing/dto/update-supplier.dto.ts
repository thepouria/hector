import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import {
  SUPPLIER_ADDRESS_MAX_LENGTH,
  SUPPLIER_CODE_MAX_LENGTH,
  SUPPLIER_EMAIL_MAX_LENGTH,
  SUPPLIER_LEGAL_NAME_MAX_LENGTH,
  SUPPLIER_NAME_MAX_LENGTH,
  SUPPLIER_PHONE_MAX_LENGTH,
} from '../purchasing.constants';

export class UpdateSupplierDto {
  @ApiPropertyOptional({ maxLength: SUPPLIER_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SUPPLIER_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: SUPPLIER_LEGAL_NAME_MAX_LENGTH })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(SUPPLIER_LEGAL_NAME_MAX_LENGTH)
  legalName?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: SUPPLIER_CODE_MAX_LENGTH })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(SUPPLIER_CODE_MAX_LENGTH)
  code?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: SUPPLIER_PHONE_MAX_LENGTH })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(SUPPLIER_PHONE_MAX_LENGTH)
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: SUPPLIER_EMAIL_MAX_LENGTH })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsEmail()
  @MaxLength(SUPPLIER_EMAIL_MAX_LENGTH)
  email?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: SUPPLIER_ADDRESS_MAX_LENGTH })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(SUPPLIER_ADDRESS_MAX_LENGTH)
  address?: string | null;
}
