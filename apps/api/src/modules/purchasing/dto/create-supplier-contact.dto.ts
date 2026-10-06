import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  SUPPLIER_CONTACT_NAME_MAX_LENGTH,
  SUPPLIER_CONTACT_NOTES_MAX_LENGTH,
  SUPPLIER_CONTACT_ROLE_MAX_LENGTH,
  SUPPLIER_EMAIL_MAX_LENGTH,
  SUPPLIER_PHONE_MAX_LENGTH,
} from '../purchasing.constants';

export class CreateSupplierContactDto {
  @ApiProperty({ example: 'آقای رضایی', maxLength: SUPPLIER_CONTACT_NAME_MAX_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(SUPPLIER_CONTACT_NAME_MAX_LENGTH)
  name!: string;

  @ApiPropertyOptional({ example: 'فروش', maxLength: SUPPLIER_CONTACT_ROLE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SUPPLIER_CONTACT_ROLE_MAX_LENGTH)
  role?: string;

  @ApiPropertyOptional({ example: '02112345678', maxLength: SUPPLIER_PHONE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SUPPLIER_PHONE_MAX_LENGTH)
  phone?: string;

  @ApiPropertyOptional({ example: '09121234567', maxLength: SUPPLIER_PHONE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SUPPLIER_PHONE_MAX_LENGTH)
  mobile?: string;

  @ApiPropertyOptional({ maxLength: SUPPLIER_EMAIL_MAX_LENGTH })
  @IsOptional()
  @IsEmail()
  @MaxLength(SUPPLIER_EMAIL_MAX_LENGTH)
  email?: string;

  @ApiPropertyOptional({ maxLength: SUPPLIER_CONTACT_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SUPPLIER_CONTACT_NOTES_MAX_LENGTH)
  notes?: string;

  @ApiPropertyOptional({
    description: 'When true, becomes primary. First contact becomes primary by default.',
  })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
