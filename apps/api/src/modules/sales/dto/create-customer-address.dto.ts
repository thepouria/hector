import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  CUSTOMER_ADDRESS_CITY_MAX_LENGTH,
  CUSTOMER_ADDRESS_LABEL_MAX_LENGTH,
  CUSTOMER_ADDRESS_LINE_MAX_LENGTH,
  CUSTOMER_ADDRESS_NOTES_MAX_LENGTH,
  CUSTOMER_ADDRESS_POSTAL_MAX_LENGTH,
  CUSTOMER_ADDRESS_PROVINCE_MAX_LENGTH,
  CUSTOMER_ADDRESS_RECIPIENT_MAX_LENGTH,
  CUSTOMER_PHONE_MAX_LENGTH,
} from '../sales.constants';

export class CreateCustomerAddressDto {
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

  @ApiPropertyOptional({ description: 'When true, clears other defaults atomically' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
