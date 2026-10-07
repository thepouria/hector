import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CustomerType } from '@hector/database';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
  IsUUID,
} from 'class-validator';
import {
  CUSTOMER_ADDRESS_CITY_MAX_LENGTH,
  CUSTOMER_ADDRESS_LABEL_MAX_LENGTH,
  CUSTOMER_ADDRESS_LINE_MAX_LENGTH,
  CUSTOMER_ADDRESS_NOTES_MAX_LENGTH,
  CUSTOMER_ADDRESS_POSTAL_MAX_LENGTH,
  CUSTOMER_ADDRESS_PROVINCE_MAX_LENGTH,
  CUSTOMER_ADDRESS_RECIPIENT_MAX_LENGTH,
  CUSTOMER_BUSINESS_NAME_MAX_LENGTH,
  CUSTOMER_CODE_MAX_LENGTH,
  CUSTOMER_DISPLAY_NAME_MAX_LENGTH,
  CUSTOMER_EMAIL_MAX_LENGTH,
  CUSTOMER_ID_FIELD_MAX_LENGTH,
  CUSTOMER_NOTES_MAX_LENGTH,
  CUSTOMER_PERSON_NAME_MAX_LENGTH,
  CUSTOMER_PHONE_MAX_LENGTH,
} from '../sales.constants';

export class CreateCustomerAddressNestedDto {
  @ApiPropertyOptional({ maxLength: CUSTOMER_ADDRESS_LABEL_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_ADDRESS_LABEL_MAX_LENGTH)
  label?: string;

  @ApiPropertyOptional({ maxLength: CUSTOMER_ADDRESS_RECIPIENT_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_ADDRESS_RECIPIENT_MAX_LENGTH)
  recipientName?: string;

  @ApiPropertyOptional({ maxLength: CUSTOMER_PHONE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_PHONE_MAX_LENGTH)
  mobile?: string;

  @ApiPropertyOptional({ maxLength: CUSTOMER_ADDRESS_PROVINCE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_ADDRESS_PROVINCE_MAX_LENGTH)
  province?: string;

  @ApiPropertyOptional({ maxLength: CUSTOMER_ADDRESS_CITY_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_ADDRESS_CITY_MAX_LENGTH)
  city?: string;

  @ApiPropertyOptional({ maxLength: CUSTOMER_ADDRESS_LINE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_ADDRESS_LINE_MAX_LENGTH)
  addressLine?: string;

  @ApiPropertyOptional({ maxLength: CUSTOMER_ADDRESS_POSTAL_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_ADDRESS_POSTAL_MAX_LENGTH)
  postalCode?: string;

  @ApiPropertyOptional({ maxLength: CUSTOMER_ADDRESS_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_ADDRESS_NOTES_MAX_LENGTH)
  notes?: string;

  @ApiPropertyOptional({ default: true, description: 'Nested create defaults to default address' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class CreateCustomerDto {
  @ApiProperty({ enum: CustomerType, example: CustomerType.BUSINESS })
  @IsEnum(CustomerType)
  type!: CustomerType;

  @ApiProperty({
    example: 'فروشگاه آرایشی آریا',
    maxLength: CUSTOMER_DISPLAY_NAME_MAX_LENGTH,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(CUSTOMER_DISPLAY_NAME_MAX_LENGTH)
  displayName!: string;

  @ApiPropertyOptional({ example: 'CUS-DEMO', maxLength: CUSTOMER_CODE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_CODE_MAX_LENGTH)
  code?: string;

  @ApiPropertyOptional({ maxLength: CUSTOMER_PERSON_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_PERSON_NAME_MAX_LENGTH)
  firstName?: string;

  @ApiPropertyOptional({ maxLength: CUSTOMER_PERSON_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_PERSON_NAME_MAX_LENGTH)
  lastName?: string;

  @ApiPropertyOptional({ maxLength: CUSTOMER_BUSINESS_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_BUSINESS_NAME_MAX_LENGTH)
  businessName?: string;

  @ApiPropertyOptional({ example: '09121234567', maxLength: CUSTOMER_PHONE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_PHONE_MAX_LENGTH)
  mobile?: string;

  @ApiPropertyOptional({ maxLength: CUSTOMER_PHONE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_PHONE_MAX_LENGTH)
  phone?: string;

  @ApiPropertyOptional({ maxLength: CUSTOMER_EMAIL_MAX_LENGTH })
  @IsOptional()
  @IsEmail()
  @MaxLength(CUSTOMER_EMAIL_MAX_LENGTH)
  email?: string;

  @ApiPropertyOptional({ maxLength: CUSTOMER_ID_FIELD_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_ID_FIELD_MAX_LENGTH)
  nationalId?: string;

  @ApiPropertyOptional({ maxLength: CUSTOMER_ID_FIELD_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_ID_FIELD_MAX_LENGTH)
  taxId?: string;

  @ApiPropertyOptional({ maxLength: CUSTOMER_ID_FIELD_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_ID_FIELD_MAX_LENGTH)
  registrationNumber?: string;

  @ApiPropertyOptional({ maxLength: CUSTOMER_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_NOTES_MAX_LENGTH)
  notes?: string;

  @ApiPropertyOptional({ type: CreateCustomerAddressNestedDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateCustomerAddressNestedDto)
  defaultAddress?: CreateCustomerAddressNestedDto;

  /** Attach CUSTOMER relationship to an existing same-company Party. */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  partyId?: string;
}
