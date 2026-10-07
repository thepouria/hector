import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import {
  SUPPLIER_ADDRESS_MAX_LENGTH,
  SUPPLIER_CODE_MAX_LENGTH,
  SUPPLIER_EMAIL_MAX_LENGTH,
  SUPPLIER_LEGAL_NAME_MAX_LENGTH,
  SUPPLIER_NAME_MAX_LENGTH,
  SUPPLIER_PHONE_MAX_LENGTH,
} from '../purchasing.constants';

export class CreateSupplierDto {
  @ApiProperty({ example: 'پخش تهران', maxLength: SUPPLIER_NAME_MAX_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(SUPPLIER_NAME_MAX_LENGTH)
  name!: string;

  @ApiPropertyOptional({ maxLength: SUPPLIER_LEGAL_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SUPPLIER_LEGAL_NAME_MAX_LENGTH)
  legalName?: string;

  @ApiPropertyOptional({ example: 'TEH-BEAUTY', maxLength: SUPPLIER_CODE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SUPPLIER_CODE_MAX_LENGTH)
  code?: string;

  @ApiPropertyOptional({ example: '09121234567', maxLength: SUPPLIER_PHONE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SUPPLIER_PHONE_MAX_LENGTH)
  phone?: string;

  @ApiPropertyOptional({ example: 'sales@example.com', maxLength: SUPPLIER_EMAIL_MAX_LENGTH })
  @IsOptional()
  @IsEmail()
  @MaxLength(SUPPLIER_EMAIL_MAX_LENGTH)
  email?: string;

  @ApiPropertyOptional({ maxLength: SUPPLIER_ADDRESS_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SUPPLIER_ADDRESS_MAX_LENGTH)
  address?: string;

  /** Attach SUPPLIER relationship to an existing same-company Party. */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  partyId?: string;
}
