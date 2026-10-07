import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PartyAddressType,
  PartyContactPointType,
  PartyRoleType,
  PartyType,
} from '@hector/database';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  PARTY_ADDRESS_GEO_MAX_LENGTH,
  PARTY_ADDRESS_LABEL_MAX_LENGTH,
  PARTY_ADDRESS_LINE_MAX_LENGTH,
  PARTY_ADDRESS_NOTES_MAX_LENGTH,
  PARTY_ADDRESS_POSTAL_MAX_LENGTH,
  PARTY_ADDRESS_RECIPIENT_MAX_LENGTH,
  PARTY_CONTACT_LABEL_MAX_LENGTH,
  PARTY_CONTACT_VALUE_MAX_LENGTH,
  PARTY_DISPLAY_NAME_MAX_LENGTH,
  PARTY_ID_FIELD_MAX_LENGTH,
  PARTY_LEGAL_NAME_MAX_LENGTH,
  PARTY_NOTES_MAX_LENGTH,
  PARTY_PERSON_NAME_MAX_LENGTH,
  PARTY_TRADE_NAME_MAX_LENGTH,
} from '../party.constants';

export class CreatePartyContactNestedDto {
  @ApiProperty({ enum: PartyContactPointType })
  @IsEnum(PartyContactPointType)
  type!: PartyContactPointType;

  @ApiProperty({ maxLength: PARTY_CONTACT_VALUE_MAX_LENGTH })
  @IsString()
  @MaxLength(PARTY_CONTACT_VALUE_MAX_LENGTH)
  value!: string;

  @ApiPropertyOptional({ maxLength: PARTY_CONTACT_LABEL_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_CONTACT_LABEL_MAX_LENGTH)
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class CreatePartyAddressNestedDto {
  @ApiPropertyOptional({ maxLength: PARTY_ADDRESS_LABEL_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_ADDRESS_LABEL_MAX_LENGTH)
  label?: string;

  @ApiPropertyOptional({ enum: PartyAddressType })
  @IsOptional()
  @IsEnum(PartyAddressType)
  type?: PartyAddressType;

  @ApiPropertyOptional({ maxLength: PARTY_ADDRESS_GEO_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_ADDRESS_GEO_MAX_LENGTH)
  country?: string;

  @ApiPropertyOptional({ maxLength: PARTY_ADDRESS_GEO_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_ADDRESS_GEO_MAX_LENGTH)
  province?: string;

  @ApiPropertyOptional({ maxLength: PARTY_ADDRESS_GEO_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_ADDRESS_GEO_MAX_LENGTH)
  city?: string;

  @ApiPropertyOptional({ maxLength: PARTY_ADDRESS_GEO_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_ADDRESS_GEO_MAX_LENGTH)
  district?: string;

  @ApiPropertyOptional({ maxLength: PARTY_ADDRESS_POSTAL_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_ADDRESS_POSTAL_MAX_LENGTH)
  postalCode?: string;

  @ApiProperty({ maxLength: PARTY_ADDRESS_LINE_MAX_LENGTH })
  @IsString()
  @MaxLength(PARTY_ADDRESS_LINE_MAX_LENGTH)
  addressLine1!: string;

  @ApiPropertyOptional({ maxLength: PARTY_ADDRESS_LINE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_ADDRESS_LINE_MAX_LENGTH)
  addressLine2?: string;

  @ApiPropertyOptional({ maxLength: PARTY_ADDRESS_RECIPIENT_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_ADDRESS_RECIPIENT_MAX_LENGTH)
  recipientName?: string;

  @ApiPropertyOptional({ maxLength: PARTY_CONTACT_VALUE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_CONTACT_VALUE_MAX_LENGTH)
  recipientPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @ApiPropertyOptional({ maxLength: PARTY_ADDRESS_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_ADDRESS_NOTES_MAX_LENGTH)
  notes?: string;
}

export class CreatePartyDto {
  @ApiProperty({ enum: PartyType })
  @IsEnum(PartyType)
  type!: PartyType;

  @ApiPropertyOptional({ maxLength: PARTY_DISPLAY_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_DISPLAY_NAME_MAX_LENGTH)
  displayName?: string;

  @ApiPropertyOptional({ maxLength: PARTY_PERSON_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_PERSON_NAME_MAX_LENGTH)
  firstName?: string;

  @ApiPropertyOptional({ maxLength: PARTY_PERSON_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_PERSON_NAME_MAX_LENGTH)
  lastName?: string;

  @ApiPropertyOptional({ description: 'ISO date YYYY-MM-DD' })
  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @ApiPropertyOptional({ maxLength: PARTY_LEGAL_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_LEGAL_NAME_MAX_LENGTH)
  legalName?: string;

  @ApiPropertyOptional({ maxLength: PARTY_TRADE_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_TRADE_NAME_MAX_LENGTH)
  tradeName?: string;

  @ApiPropertyOptional({ maxLength: PARTY_ID_FIELD_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_ID_FIELD_MAX_LENGTH)
  nationalId?: string;

  @ApiPropertyOptional({ maxLength: PARTY_ID_FIELD_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_ID_FIELD_MAX_LENGTH)
  registrationNumber?: string;

  @ApiPropertyOptional({ maxLength: PARTY_ID_FIELD_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_ID_FIELD_MAX_LENGTH)
  taxId?: string;

  @ApiPropertyOptional({ maxLength: PARTY_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_NOTES_MAX_LENGTH)
  notes?: string;

  @ApiPropertyOptional({ type: [CreatePartyContactNestedDto] })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreatePartyContactNestedDto)
  contacts?: CreatePartyContactNestedDto[];

  @ApiPropertyOptional({ type: [CreatePartyAddressNestedDto] })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreatePartyAddressNestedDto)
  addresses?: CreatePartyAddressNestedDto[];

  @ApiPropertyOptional({ enum: PartyRoleType, isArray: true })
  @IsOptional()
  @IsEnum(PartyRoleType, { each: true })
  roles?: PartyRoleType[];
}
