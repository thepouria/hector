import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import {
  SUPPLIER_CONTACT_NAME_MAX_LENGTH,
  SUPPLIER_CONTACT_NOTES_MAX_LENGTH,
  SUPPLIER_CONTACT_ROLE_MAX_LENGTH,
  SUPPLIER_EMAIL_MAX_LENGTH,
  SUPPLIER_PHONE_MAX_LENGTH,
} from '../purchasing.constants';

export class UpdateSupplierContactDto {
  @ApiPropertyOptional({ maxLength: SUPPLIER_CONTACT_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SUPPLIER_CONTACT_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: SUPPLIER_CONTACT_ROLE_MAX_LENGTH })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(SUPPLIER_CONTACT_ROLE_MAX_LENGTH)
  role?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: SUPPLIER_PHONE_MAX_LENGTH })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(SUPPLIER_PHONE_MAX_LENGTH)
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: SUPPLIER_PHONE_MAX_LENGTH })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(SUPPLIER_PHONE_MAX_LENGTH)
  mobile?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: SUPPLIER_EMAIL_MAX_LENGTH })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsEmail()
  @MaxLength(SUPPLIER_EMAIL_MAX_LENGTH)
  email?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: SUPPLIER_CONTACT_NOTES_MAX_LENGTH })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(SUPPLIER_CONTACT_NOTES_MAX_LENGTH)
  notes?: string | null;

  @ApiPropertyOptional({ description: 'Set true to make this contact primary' })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
