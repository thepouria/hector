import { ApiPropertyOptional } from '@nestjs/swagger';
import { CustomerType } from '@hector/database';
import { IsEmail, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  CUSTOMER_BUSINESS_NAME_MAX_LENGTH,
  CUSTOMER_CODE_MAX_LENGTH,
  CUSTOMER_DISPLAY_NAME_MAX_LENGTH,
  CUSTOMER_EMAIL_MAX_LENGTH,
  CUSTOMER_ID_FIELD_MAX_LENGTH,
  CUSTOMER_NOTES_MAX_LENGTH,
  CUSTOMER_PERSON_NAME_MAX_LENGTH,
  CUSTOMER_PHONE_MAX_LENGTH,
} from '../sales.constants';

export class UpdateCustomerDto {
  @ApiPropertyOptional({ enum: CustomerType })
  @IsOptional()
  @IsEnum(CustomerType)
  type?: CustomerType;

  @ApiPropertyOptional({ maxLength: CUSTOMER_DISPLAY_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_DISPLAY_NAME_MAX_LENGTH)
  displayName?: string;

  @ApiPropertyOptional({ maxLength: CUSTOMER_CODE_MAX_LENGTH, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_CODE_MAX_LENGTH)
  code?: string | null;

  @ApiPropertyOptional({ maxLength: CUSTOMER_PERSON_NAME_MAX_LENGTH, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_PERSON_NAME_MAX_LENGTH)
  firstName?: string | null;

  @ApiPropertyOptional({ maxLength: CUSTOMER_PERSON_NAME_MAX_LENGTH, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_PERSON_NAME_MAX_LENGTH)
  lastName?: string | null;

  @ApiPropertyOptional({ maxLength: CUSTOMER_BUSINESS_NAME_MAX_LENGTH, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_BUSINESS_NAME_MAX_LENGTH)
  businessName?: string | null;

  @ApiPropertyOptional({ maxLength: CUSTOMER_PHONE_MAX_LENGTH, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_PHONE_MAX_LENGTH)
  mobile?: string | null;

  @ApiPropertyOptional({ maxLength: CUSTOMER_PHONE_MAX_LENGTH, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_PHONE_MAX_LENGTH)
  phone?: string | null;

  @ApiPropertyOptional({ maxLength: CUSTOMER_EMAIL_MAX_LENGTH, nullable: true })
  @IsOptional()
  @IsEmail()
  @MaxLength(CUSTOMER_EMAIL_MAX_LENGTH)
  email?: string | null;

  @ApiPropertyOptional({ maxLength: CUSTOMER_ID_FIELD_MAX_LENGTH, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_ID_FIELD_MAX_LENGTH)
  nationalId?: string | null;

  @ApiPropertyOptional({ maxLength: CUSTOMER_ID_FIELD_MAX_LENGTH, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_ID_FIELD_MAX_LENGTH)
  taxId?: string | null;

  @ApiPropertyOptional({ maxLength: CUSTOMER_ID_FIELD_MAX_LENGTH, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_ID_FIELD_MAX_LENGTH)
  registrationNumber?: string | null;

  @ApiPropertyOptional({ maxLength: CUSTOMER_NOTES_MAX_LENGTH, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_NOTES_MAX_LENGTH)
  notes?: string | null;
}
