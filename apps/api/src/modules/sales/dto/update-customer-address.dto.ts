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

export class UpdateCustomerAddressDto {
  @ApiPropertyOptional({ maxLength: CUSTOMER_ADDRESS_LABEL_MAX_LENGTH, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_ADDRESS_LABEL_MAX_LENGTH)
  label?: string | null;

  @ApiPropertyOptional({ maxLength: CUSTOMER_ADDRESS_RECIPIENT_MAX_LENGTH, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_ADDRESS_RECIPIENT_MAX_LENGTH)
  recipientName?: string | null;

  @ApiPropertyOptional({ maxLength: CUSTOMER_PHONE_MAX_LENGTH, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_PHONE_MAX_LENGTH)
  mobile?: string | null;

  @ApiPropertyOptional({ maxLength: CUSTOMER_ADDRESS_PROVINCE_MAX_LENGTH, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_ADDRESS_PROVINCE_MAX_LENGTH)
  province?: string | null;

  @ApiPropertyOptional({ maxLength: CUSTOMER_ADDRESS_CITY_MAX_LENGTH, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_ADDRESS_CITY_MAX_LENGTH)
  city?: string | null;

  @ApiPropertyOptional({ maxLength: CUSTOMER_ADDRESS_LINE_MAX_LENGTH, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_ADDRESS_LINE_MAX_LENGTH)
  addressLine?: string | null;

  @ApiPropertyOptional({ maxLength: CUSTOMER_ADDRESS_POSTAL_MAX_LENGTH, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_ADDRESS_POSTAL_MAX_LENGTH)
  postalCode?: string | null;

  @ApiPropertyOptional({ maxLength: CUSTOMER_ADDRESS_NOTES_MAX_LENGTH, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_ADDRESS_NOTES_MAX_LENGTH)
  notes?: string | null;

  @ApiPropertyOptional({ description: 'When true, clears other defaults atomically' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
